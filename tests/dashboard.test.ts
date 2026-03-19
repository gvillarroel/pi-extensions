import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getLatestDashboardRunSummary,
  loadDashboardItems,
  recordDashboardRunSummary,
} from "../src/shared/dashboard.js";
import {
  buildDashboardPanelContexts,
  buildDetailLines,
  listDashboardItems,
  listDashboardWorkflows,
  runDashboardWorkflow,
} from "../extensions/dashboard.js";
import { writeYamlFile } from "../src/shared/yaml.js";

describe("loadDashboardItems", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/issues")) {
        return new Response(
          JSON.stringify([
            {
              number: 42,
              title: "Broken build",
              html_url: "https://github.com/openai/openai-node/issues/42",
              state: "open",
              updated_at: "2026-03-18T10:00:00.000Z",
              labels: [{ name: "bug" }],
              assignees: [{ login: "alice" }],
              body: "Primary summary line\n\nSecond paragraph with more context.",
            },
          ]),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          data: {
            repository: {
              discussions: {
                nodes: [
                  {
                    number: 7,
                    title: "Release cadence",
                    url: "https://github.com/openai/openai-node/discussions/7",
                    updatedAt: "2026-03-18T11:00:00.000Z",
                    category: { name: "Ideas" },
                    author: { login: "bob" },
                  },
                ],
              },
            },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GITHUB_TOKEN;
  });

  it("loads normalized GitHub issues and discussions", async () => {
    const items = await loadDashboardItems({
      sources: [
        {
          id: "github-main",
          type: "github",
          enabled: true,
          owner: "openai",
          repositories: ["openai-node"],
          includeDiscussions: true,
        },
      ],
    });

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("discussion-7");
    expect(items[0].itemType).toBe("discussion");
    expect(items[1].id).toBe("42");
    expect(items[1].itemType).toBe("issue");
    expect(items[1].labels).toEqual(["bug"]);
  });

  it("applies assignee, status, and item type filters", async () => {
    const items = await loadDashboardItems({
      sources: [
        {
          id: "github-main",
          type: "github",
          enabled: true,
          owner: "openai",
          repositories: ["openai-node"],
          includeDiscussions: true,
          assignees: ["alice"],
          statuses: ["open"],
          itemTypes: ["issue"],
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("42");
  });

  it("records workflow summaries that can be reloaded for dashboard items", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dashboard-history-"));
    writeYamlFile(path.join(root, "dashboard.sources.yaml"), {
      sources: [
        {
          id: "github-main",
          type: "github",
          enabled: true,
          owner: "openai",
          repositories: ["openai-node"],
        },
      ],
    });
    writeYamlFile(path.join(root, "workflows.yaml"), {
      workflows: [
        {
          id: "inspect",
          label: "Inspect",
          steps: [{ id: "step-1", type: "script", run: "echo dashboard-test-ok {{customPrompt}}" }],
        },
      ],
    });

    const items = await listDashboardItems(root);
    const issue = items.find((item) => item.id === "42");
    expect(issue).toBeTruthy();

    const output = await runDashboardWorkflow("inspect", issue!, root, { customPrompt: "extra-context" });
    expect(output).toContain("dashboard-test-ok");
    expect(output).toContain("extra-context");

    const summary = getLatestDashboardRunSummary("42", root);
    expect(summary?.workflowId).toBe("inspect");
    expect(summary?.status).toBe("passed");
  });

  it("keeps the latest run summary at the top of persisted history", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dashboard-summary-"));
    recordDashboardRunSummary(
      { itemId: "42", workflowId: "older", status: "passed", endedAt: "2026-03-18T09:00:00.000Z", summary: "old" },
      root,
    );
    recordDashboardRunSummary(
      { itemId: "42", workflowId: "latest", status: "failed", endedAt: "2026-03-18T10:00:00.000Z", summary: "new" },
      root,
    );

    const summary = getLatestDashboardRunSummary("42", root);
    expect(summary?.workflowId).toBe("latest");
    expect(summary?.status).toBe("failed");
  });

  it("lists source-allowed workflows with the default one first", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dashboard-workflows-"));
    writeYamlFile(path.join(root, "dashboard.sources.yaml"), {
      sources: [
        {
          id: "github-main",
          type: "github",
          enabled: true,
          owner: "openai",
          repositories: ["openai-node"],
          defaultWorkflowId: "triage",
          allowedWorkflowIds: ["inspect", "triage"],
        },
      ],
    });
    writeYamlFile(path.join(root, "workflows.yaml"), {
      workflows: [
        { id: "inspect", label: "Inspect", steps: [{ id: "note-1", type: "note", message: "inspect" }] },
        { id: "triage", label: "Triage", steps: [{ id: "note-2", type: "note", message: "triage" }] },
        { id: "hidden", label: "Hidden", steps: [{ id: "note-3", type: "note", message: "hidden" }] },
      ],
    });

    const items = await listDashboardItems(root);
    const issue = items.find((item) => item.id === "42");
    const workflows = listDashboardWorkflows(issue!, root);

    expect(workflows.map((workflow) => workflow.id)).toEqual(["triage", "inspect"]);
  });

  it("builds fixed panel contexts for github, jira, and aha", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dashboard-contexts-"));
    writeYamlFile(path.join(root, "dashboard.sources.yaml"), {
      sources: [
        {
          id: "github-main",
          type: "github",
          enabled: true,
          owner: "openai",
          repositories: ["openai-node"],
          includeDiscussions: true,
        },
      ],
    });

    const items = await listDashboardItems(root);
    const contexts = buildDashboardPanelContexts(items, root);

    expect(contexts.map((context) => context.id)).toEqual([
      "github-issues",
      "github-discussions",
      "jira",
      "aha",
    ]);
    expect(contexts[0].items.map((item) => item.id)).toEqual(["42"]);
    expect(contexts[1].items.map((item) => item.id)).toEqual(["discussion-7"]);
    expect(contexts[2].items).toEqual([]);
    expect(contexts[3].items).toEqual([]);
  });

  it("prioritizes body content and omits empty metadata in the detail view", () => {
    const lines = buildDetailLines({
      source: "github-main",
      project: "openai",
      repositoryOrBoard: "openai-node",
      id: "42",
      itemType: "issue",
      title: "Broken build",
      url: "https://github.com/openai/openai-node/issues/42",
      status: "open",
      assignees: [],
      labels: [],
      updatedAt: "2026-03-18T10:00:00.000Z",
      rawMetadata: {
        body: "Primary summary line\n\nSecond paragraph.",
      },
    });

    expect(lines[0]).toBe("Broken build");
    expect(lines).toContain("Primary summary line");
    expect(lines).toContain("Second paragraph.");
    expect(lines.join("\n")).not.toContain("none");
  });
});
