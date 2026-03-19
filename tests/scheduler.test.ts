import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createJobRuntimeState,
  getJobHistoryPath,
  getNextRun,
  loadJobHistory,
  renderJobHistory,
  shouldSkipJob,
} from "../src/shared/scheduler.js";
import { renderJobStatus, runJobNow } from "../extensions/job-scheduler.js";
import { writeYamlFile } from "../src/shared/yaml.js";

describe("scheduler helpers", () => {
  it("computes the next cron run", () => {
    const next = getNextRun(
      {
        id: "daily",
        label: "Daily",
        schedule: "0 6 * * *",
        target: { type: "script", run: "echo daily" },
      },
      new Date("2026-03-18T05:00:00.000Z"),
    );

    expect(next.toISOString()).toBe("2026-03-18T06:00:00.000Z");
  });

  it("skips forbidden concurrent jobs", () => {
    const state = createJobRuntimeState();
    state.running.add("nightly");
    const reason = shouldSkipJob(
      {
        id: "nightly",
        label: "Nightly",
        schedule: "0 6 * * *",
        concurrency: "forbid",
        target: { type: "script", run: "echo nightly" },
      },
      state,
    );

    expect(reason).toContain("already running");
  });

  it("executes a configured script job immediately", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-scheduler-"));
    writeYamlFile(path.join(root, "jobs.yaml"), {
      jobs: [
        {
          id: "manual",
          label: "Manual",
          schedule: "0 6 * * *",
          target: { type: "script", run: "echo scheduler-ok" },
        },
      ],
    });

    const state = createJobRuntimeState();
    const output = await runJobNow("manual", state, root);
    expect(output).toContain("scheduler-ok");
    expect(fs.existsSync(getJobHistoryPath(root))).toBe(true);
    expect(loadJobHistory(root)[0]?.jobId).toBe("manual");
    expect(renderJobStatus(root, state)).toContain("last=passed@");
  });

  it("renders persisted history for a specific job", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-scheduler-history-"));
    writeYamlFile(path.join(root, "jobs.yaml"), {
      jobs: [
        {
          id: "manual",
          label: "Manual",
          schedule: "0 6 * * *",
          target: { type: "script", run: "echo scheduler-ok" },
        },
      ],
    });

    const state = createJobRuntimeState();
    await runJobNow("manual", state, root);

    const history = renderJobHistory(state, root, { jobId: "manual" });
    expect(history).toContain("manual | status=passed");
  });

  it("executes a workflow-backed job and records a failure summary", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-scheduler-workflow-"));
    writeYamlFile(path.join(root, "jobs.yaml"), {
      jobs: [
        {
          id: "workflow-job",
          label: "Workflow Job",
          schedule: "0 6 * * *",
          target: { type: "workflow", workflowId: "needs-item" },
        },
      ],
    });
    writeYamlFile(path.join(root, "workflows.yaml"), {
      workflows: [
        {
          id: "needs-item",
          label: "Needs Item",
          gates: [{ requiredContextFields: ["item.id"] }],
          steps: [{ id: "note-1", type: "note", message: "Hello" }],
        },
      ],
    });

    const state = createJobRuntimeState();
    const output = await runJobNow("workflow-job", state, root);

    expect(output).toContain('"status": "failed"');
    expect(renderJobHistory(state, root, { jobId: "workflow-job" })).toContain("Missing required context field");
  });
});
