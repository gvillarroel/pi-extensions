import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function captureConsoleLogs(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
    originalLog(...args);
  };

  return Promise.resolve()
    .then(fn)
    .then(
      (result) => {
        console.log = originalLog;
        return { result, lines };
      },
      (error) => {
        console.log = originalLog;
        throw error;
      },
    );
}

async function runSlashCommandWithExtension({ cwd, extensionFile, prompt, setup }) {
  try {
    await setup?.();
    const resourceLoader = new DefaultResourceLoader({
      additionalExtensionPaths: [path.resolve(repoRoot, extensionFile)],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
    });
    return captureConsoleLogs(async () => {
      await session.prompt(prompt);
    });
  } finally {
    // Nothing to restore because the SDK supports an explicit cwd.
  }
}

async function verifyStateCapture() {
  const { lines } = await runSlashCommandWithExtension({
    cwd: repoRoot,
    extensionFile: "extensions/state-capture-reporter.ts",
    prompt: "/captured_states",
  });

  if (!lines.some((line) => line.includes("Registered events"))) {
    throw new Error("State capture extension did not print the registered events report.");
  }

  return "state-capture reporter loaded and responded through the SDK";
}

async function verifyKnowledgeScan() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sdk-knowledge-"));
  fs.mkdirSync(path.join(tempRoot, "knowledge"), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, "knowledge", "concept.md"),
    `---\ntitle: Concept A\nstatus: draft\nconfidence: low\n---\n\nTODO: define this better.\n`,
    "utf8",
  );

  const { lines } = await runSlashCommandWithExtension({
    cwd: tempRoot,
    extensionFile: "extensions/knowledge-distiller.ts",
    prompt: "/knowledge_scan",
  });

  if (!lines.some((line) => line.includes("Concept A"))) {
    throw new Error("Knowledge distiller did not report the expected unclear concept.");
  }

  return "knowledge distiller scanned markdown content through the SDK";
}

async function verifyKnowledgeWrite() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sdk-knowledge-write-"));

  await runSlashCommandWithExtension({
    cwd: tempRoot,
    extensionFile: "extensions/knowledge-distiller.ts",
    prompt: "/knowledge_write Scope knowledge/guide.md The scope is explicit.",
  });

  const written = fs.readFileSync(path.join(tempRoot, "knowledge", "guide.md"), "utf8");
  if (!written.includes("## Scope") || !written.includes("The scope is explicit.")) {
    throw new Error("Knowledge distiller did not write the expected clarification content.");
  }

  return "knowledge distiller wrote a clarification file through the SDK";
}

async function verifyJobRun() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sdk-jobs-"));
  fs.writeFileSync(
    path.join(tempRoot, "jobs.yaml"),
    `jobs:\n  - id: manual\n    label: Manual\n    enabled: true\n    schedule: "0 6 * * *"\n    target:\n      type: script\n      run: echo scheduler-sdk-ok\n`,
    "utf8",
  );

  const { lines } = await runSlashCommandWithExtension({
    cwd: tempRoot,
    extensionFile: "extensions/job-scheduler.ts",
    prompt: "/job_run manual",
  });

  if (!lines.some((line) => line.includes("scheduler-sdk-ok"))) {
    throw new Error("Job scheduler did not execute the configured script job.");
  }

  const historyPath = path.join(tempRoot, ".pi-extensions", "job-history.yaml");
  if (!fs.existsSync(historyPath)) {
    throw new Error("Job scheduler did not persist a history file.");
  }

  const { lines: statusLines } = await runSlashCommandWithExtension({
    cwd: tempRoot,
    extensionFile: "extensions/job-scheduler.ts",
    prompt: "/jobs",
  });
  const { lines: historyLines } = await runSlashCommandWithExtension({
    cwd: tempRoot,
    extensionFile: "extensions/job-scheduler.ts",
    prompt: "/job_history manual",
  });

  if (!statusLines.some((line) => line.includes("last=passed@"))) {
    throw new Error("Job scheduler did not surface recent run status in /jobs.");
  }

  if (!historyLines.some((line) => line.includes("manual | status=passed"))) {
    throw new Error("Job scheduler did not render persisted history through /job_history.");
  }

  return "job scheduler executed and rendered persisted history through the SDK";
}

async function verifyDashboard() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sdk-dashboard-"));
  fs.writeFileSync(
    path.join(tempRoot, "dashboard.sources.yaml"),
    `sources:\n  - id: github-main\n    type: github\n    enabled: true\n    owner: openai\n    repositories:\n      - openai-node\n    includeDiscussions: true\n    labels:\n      - bug\n    assignees:\n      - alice\n    statuses:\n      - open\n    itemTypes:\n      - issue\n`,
    "utf8",
  );

  const originalFetch = global.fetch;
  global.fetch = async (input) => {
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
  };
  process.env.GITHUB_TOKEN = "test-token";

  try {
    const { lines } = await runSlashCommandWithExtension({
      cwd: tempRoot,
      extensionFile: "extensions/dashboard.ts",
      prompt: "/dashboard",
    });

    if (!lines.some((line) => line.includes("Broken build"))) {
      throw new Error("Dashboard extension did not list the expected GitHub items.");
    }

    if (lines.some((line) => line.includes("Release cadence"))) {
      throw new Error("Dashboard extension did not apply the configured item type filter.");
    }

    if (!lines.some((line) => line.includes("issue openai-node#42"))) {
      throw new Error("Dashboard extension did not render the normalized item type.");
    }

    return "dashboard listed filtered normalized GitHub data through the SDK";
  } finally {
    global.fetch = originalFetch;
    delete process.env.GITHUB_TOKEN;
  }
}

async function verifyDashboardRun() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sdk-dashboard-run-"));
  fs.writeFileSync(
    path.join(tempRoot, "dashboard.sources.yaml"),
    `sources:\n  - id: github-main\n    type: github\n    enabled: true\n    owner: openai\n    repositories:\n      - openai-node\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(tempRoot, "workflows.yaml"),
    `workflows:\n  - id: inspect\n    label: Inspect\n    gates:\n      - requiredContextFields:\n          - item.id\n    steps:\n      - id: note-1\n        type: note\n        message: "Inspect {{item.title}}"\n      - id: script-1\n        type: script\n        run: echo dashboard-run-ok\n`,
    "utf8",
  );

  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          number: 42,
          title: "Broken build",
          html_url: "https://github.com/openai/openai-node/issues/42",
          state: "open",
          updated_at: "2026-03-18T10:00:00.000Z",
          labels: [{ name: "bug" }],
          assignees: [{ login: "alice" }],
        },
      ]),
      { status: 200 },
    );

  try {
    const { lines } = await runSlashCommandWithExtension({
      cwd: tempRoot,
      extensionFile: "extensions/dashboard.ts",
      prompt: "/dashboard_run inspect 42",
    });

    const combined = lines.join("\n");
    if (!combined.includes('"workflowId": "inspect"') || !combined.includes("dashboard-run-ok")) {
      throw new Error("Dashboard workflow execution did not emit the expected workflow result.");
    }

    const { lines: dashboardLines } = await runSlashCommandWithExtension({
      cwd: tempRoot,
      extensionFile: "extensions/dashboard.ts",
      prompt: "/dashboard",
    });

    if (!dashboardLines.some((line) => line.includes("lastWorkflow=inspect:passed@"))) {
      throw new Error("Dashboard did not render the latest persisted workflow summary.");
    }

    return "dashboard workflow launch completed and persisted run summaries through the SDK";
  } finally {
    global.fetch = originalFetch;
  }
}

const checks = [
  verifyStateCapture,
  verifyKnowledgeScan,
  verifyKnowledgeWrite,
  verifyJobRun,
  verifyDashboard,
  verifyDashboardRun,
];

for (const check of checks) {
  const message = await check();
  console.log(`[verify-sdk] ${message}`);
}
