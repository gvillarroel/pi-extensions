import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadMergedYamlConfig } from "../src/shared/config.js";
import { executeWorkflow } from "../src/shared/workflow.js";
import { writeYamlFile } from "../src/shared/yaml.js";

describe("executeWorkflow", () => {
  it("fails when a required field gate is missing", async () => {
    const result = await executeWorkflow(
      {
        id: "needs-item",
        label: "Needs Item",
        gates: [{ requiredContextFields: ["item.id"] }],
        steps: [{ id: "step-1", type: "note", message: "hello" }],
      },
      {},
    );

    expect(result.status).toBe("failed");
    expect(result.errorSummary).toContain("Missing required context field");
  });

  it("runs note, script, and parallel steps", async () => {
    const result = await executeWorkflow(
      {
        id: "full-workflow",
        label: "Full Workflow",
        steps: [
          { id: "note-1", type: "note", message: "Review {{item.id}}" },
          { id: "script-1", type: "script", run: "echo ready" },
          {
            id: "parallel-1",
            type: "parallel",
            steps: [
              { id: "child-a", type: "note", message: "child a" },
              { id: "child-b", type: "script", run: "echo child-b" },
            ],
          },
        ],
      },
      { item: { id: "123" } },
    );

    expect(result.status).toBe("passed");
    expect(result.stepResults).toHaveLength(3);
    expect(result.artifacts.some((artifact) => artifact.content.includes("Review 123"))).toBe(true);
  });

  it("executes a bash-only workflow loaded from workflows.yaml", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bash-workflow-run-"));
    writeYamlFile(path.join(root, "workflows.yaml"), {
      bashWorkflows: [
        {
          id: "bash-only",
          label: "Bash Only",
          bash: "echo bash-only-ok",
        },
      ],
    });

    const workflow = loadMergedYamlConfig<{ workflows?: Array<any> }>("workflows.yaml", { cwd: root }).workflows?.[0];
    const result = await executeWorkflow(workflow, { cwd: root });

    expect(result.status).toBe("passed");
    expect(result.artifacts.some((artifact) => artifact.content.includes("bash-only-ok"))).toBe(true);
  });
});
