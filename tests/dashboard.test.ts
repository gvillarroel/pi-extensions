import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getLatestDashboardRunSummary,
  loadDashboardItems,
  recordDashboardRunSummary,
} from "../src/shared/dashboard.js";
import type { DashboardItem } from "../src/shared/types.js";
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

  it("loads normalized Jira issues from mocked API", async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/rest/api/3/search")) {
        return new Response(
          JSON.stringify({
            issues: [
              {
                key: "PROJ-101",
                id: "10001",
                fields: {
                  summary: "Fix login timeout",
                  status: { name: "In Progress" },
                  assignee: { displayName: "Carol" },
                  labels: ["backend"],
                  priority: { name: "High" },
                  issuetype: { name: "Bug" },
                  updated: "2026-03-20T14:00:00.000Z",
                  description: { type: "doc", content: [] },
                },
              },
              {
                key: "PROJ-102",
                id: "10002",
                fields: {
                  summary: "Add metrics endpoint",
                  status: { name: "To Do" },
                  assignee: null,
                  labels: [],
                  priority: { name: "Medium" },
                  issuetype: { name: "Task" },
                  updated: "2026-03-19T10:00:00.000Z",
                },
              },
            ],
            total: 2,
          }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    process.env.JIRA_USERNAME = "user@example.com";
    process.env.JIRA_TOKEN = "jira-test-token";

    try {
      const items = await loadDashboardItems({
        sources: [
          {
            id: "jira-main",
            type: "jira",
            enabled: true,
            baseUrl: "https://mycompany.atlassian.net",
            project: "PROJ",
          },
        ],
      });

      expect(items).toHaveLength(2);
      expect(items[0].id).toBe("PROJ-101");
      expect(items[0].itemType).toBe("issue");
      expect(items[0].status).toBe("In Progress");
      expect(items[0].assignees).toEqual(["Carol"]);
      expect(items[0].labels).toContain("type:Bug");
      expect(items[0].labels).toContain("priority:High");
      expect(items[0].labels).toContain("backend");
      expect(items[0].url).toBe("https://mycompany.atlassian.net/browse/PROJ-101");

      expect(items[1].id).toBe("PROJ-102");
      expect(items[1].assignees).toEqual([]);
    } finally {
      delete process.env.JIRA_USERNAME;
      delete process.env.JIRA_TOKEN;
    }
  });

  it("loads normalized AHA features from mocked API", async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/products/")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                id: "feat-001",
                reference_num: "ACME-F-1",
                name: "Dark mode support",
                workflow_status: { name: "Under consideration" },
                assigned_to_user: { name: "Dave" },
                tags: ["ux", "theme"],
                updated_at: "2026-03-21T08:00:00.000Z",
              },
              {
                id: "feat-002",
                reference_num: "ACME-F-2",
                name: "API rate limiting",
                workflow_status: { name: "In development" },
                assigned_to_user: null,
                tags: [],
                updated_at: "2026-03-20T16:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    process.env.AHA_TOKEN = "aha-test-token";

    try {
      const items = await loadDashboardItems({
        sources: [
          {
            id: "aha-main",
            type: "aha",
            enabled: true,
            subdomain: "acme",
            product: "ACME",
          },
        ],
      });

      expect(items).toHaveLength(2);
      expect(items[0].id).toBe("ACME-F-1");
      expect(items[0].itemType).toBe("feature");
      expect(items[0].status).toBe("Under consideration");
      expect(items[0].assignees).toEqual(["Dave"]);
      expect(items[0].labels).toEqual(["ux", "theme"]);
      expect(items[0].url).toBe("https://acme.aha.io/features/ACME-F-1");
      expect(items[0].project).toBe("ACME");

      expect(items[1].id).toBe("ACME-F-2");
      expect(items[1].assignees).toEqual([]);
      expect(items[1].labels).toEqual([]);
    } finally {
      delete process.env.AHA_TOKEN;
    }
  });

  it("applies status filters on Jira items", async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          issues: [
            {
              key: "PROJ-201",
              fields: {
                summary: "Filtered issue",
                status: { name: "Done" },
                assignee: null,
                labels: [],
                priority: { name: "Low" },
                issuetype: { name: "Task" },
                updated: "2026-03-20T12:00:00.000Z",
              },
            },
          ],
          total: 1,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    process.env.JIRA_USERNAME = "user@example.com";
    process.env.JIRA_TOKEN = "jira-test-token";

    try {
      const items = await loadDashboardItems({
        sources: [
          {
            id: "jira-filtered",
            type: "jira",
            enabled: true,
            baseUrl: "https://mycompany.atlassian.net",
            project: "PROJ",
            statuses: ["In Progress"],
          },
        ],
      });

      // The item has status "Done" but we filter for "In Progress"
      expect(items).toHaveLength(0);
    } finally {
      delete process.env.JIRA_USERNAME;
      delete process.env.JIRA_TOKEN;
    }
  });

  it("returns empty items when Jira credentials are missing", async () => {
    delete process.env.JIRA_USERNAME;
    delete process.env.JIRA_TOKEN;

    const items = await loadDashboardItems({
      sources: [
        {
          id: "jira-no-creds",
          type: "jira",
          enabled: true,
          baseUrl: "https://mycompany.atlassian.net",
          project: "PROJ",
        },
      ],
    });

    expect(items).toHaveLength(0);
  });

  it("returns empty items when AHA token is missing", async () => {
    delete process.env.AHA_TOKEN;

    const items = await loadDashboardItems({
      sources: [
        {
          id: "aha-no-token",
          type: "aha",
          enabled: true,
          subdomain: "acme",
          product: "ACME",
        },
      ],
    });

    expect(items).toHaveLength(0);
  });

  it("continues loading other sources when one connector fails", async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("atlassian.net")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      if (url.includes("/issues")) {
        return new Response(
          JSON.stringify([
            {
              number: 99,
              title: "Surviving issue",
              html_url: "https://github.com/org/repo/issues/99",
              state: "open",
              updated_at: "2026-03-22T10:00:00.000Z",
              labels: [],
              assignees: [],
            },
          ]),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    process.env.JIRA_USERNAME = "user@example.com";
    process.env.JIRA_TOKEN = "jira-test-token";

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const items = await loadDashboardItems({
        sources: [
          {
            id: "jira-broken",
            type: "jira",
            enabled: true,
            baseUrl: "https://mycompany.atlassian.net",
            project: "PROJ",
          },
          {
            id: "github-ok",
            type: "github",
            enabled: true,
            owner: "org",
            repositories: ["repo"],
          },
        ],
      });

      // Jira fails but GitHub still returns its item
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("99");
      expect(items[0].source).toBe("github-ok");

      // Error was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("jira-broken"),
      );
    } finally {
      delete process.env.JIRA_USERNAME;
      delete process.env.JIRA_TOKEN;
      consoleSpy.mockRestore();
    }
  });

  it("groups Jira and AHA items into their panel contexts", () => {
    const items: DashboardItem[] = [
      {
        source: "jira-main",
        project: "PROJ",
        repositoryOrBoard: "PROJ",
        id: "PROJ-101",
        itemType: "issue",
        title: "Jira issue",
        url: "",
        status: "open",
        assignees: [],
        labels: [],
        updatedAt: "",
        rawMetadata: {},
      },
      {
        source: "aha-main",
        project: "ACME",
        repositoryOrBoard: "ACME",
        id: "ACME-F-1",
        itemType: "feature",
        title: "AHA feature",
        url: "",
        status: "open",
        assignees: [],
        labels: [],
        updatedAt: "",
        rawMetadata: {},
      },
    ];

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dashboard-jira-aha-ctx-"));
    writeYamlFile(path.join(root, "dashboard.sources.yaml"), {
      sources: [
        { id: "jira-main", type: "jira", enabled: true, baseUrl: "https://x.atlassian.net", project: "PROJ" },
        { id: "aha-main", type: "aha", enabled: true, subdomain: "acme", product: "ACME" },
      ],
    });

    const contexts = buildDashboardPanelContexts(items, root);
    expect(contexts.find((c) => c.id === "jira")?.items).toHaveLength(1);
    expect(contexts.find((c) => c.id === "aha")?.items).toHaveLength(1);
    expect(contexts.find((c) => c.id === "jira")?.items[0].id).toBe("PROJ-101");
    expect(contexts.find((c) => c.id === "aha")?.items[0].id).toBe("ACME-F-1");
  });
});
