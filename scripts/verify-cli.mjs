import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const piBinary = process.platform === "win32"
  ? path.join(repoRoot, "node_modules", ".bin", "pi.cmd")
  : path.join(repoRoot, "node_modules", ".bin", "pi");

function runPiRaw({ cwd, args, env = {} }) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "cmd.exe" : piBinary;
    const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", piBinary, ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function runPi(options) {
  const result = await runPiRaw(options);
  if (result.code !== 0) {
    throw new Error(`pi exited with code ${result.code}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  return result;
}

async function verifyStateCaptureCli() {
  const { stdout } = await runPi({
    cwd: repoRoot,
    args: [
      "-p",
      "--no-session",
      "--offline",
      "--no-tools",
      "--extension",
      path.join(repoRoot, "extensions", "state-capture-reporter.ts"),
      "/captured_states",
    ],
  });

  if (!stdout.includes("Registered events")) {
    throw new Error("CLI verification for state capture did not print the event report.");
  }

  console.log("[verify-cli] state-capture reporter loaded through the pi CLI");
}

async function verifyKnowledgeCli() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cli-knowledge-"));
  fs.mkdirSync(path.join(tempRoot, "knowledge"), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, "knowledge", "concept.md"),
    `---\ntitle: Concept A\nstatus: draft\nconfidence: low\n---\n\nTODO: define this better.\n`,
    "utf8",
  );

  const { stdout, stderr } = await runPi({
    cwd: tempRoot,
    args: [
      "-p",
      "--no-session",
      "--offline",
      "--no-tools",
      "--extension",
      path.join(repoRoot, "extensions", "knowledge-distiller.ts"),
      "/knowledge_scan",
    ],
  });

  if (!stdout.includes("Concept A") && !stderr.includes("Concept A")) {
    throw new Error("CLI verification for knowledge distiller did not report the expected concept.");
  }

  console.log("[verify-cli] knowledge distiller responded through the pi CLI");
}

async function verifyJobSchedulerCli() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cli-jobs-"));
  fs.writeFileSync(
    path.join(tempRoot, "jobs.yaml"),
    `jobs:\n  - id: manual\n    label: Manual\n    enabled: true\n    schedule: "0 6 * * *"\n    target:\n      type: script\n      run: echo scheduler-cli-ok\n`,
    "utf8",
  );

  const runResult = await runPi({
    cwd: tempRoot,
    args: [
      "-p",
      "--no-session",
      "--offline",
      "--no-tools",
      "--extension",
      path.join(repoRoot, "extensions", "job-scheduler.ts"),
      "/job_run manual",
    ],
  });

  if (!runResult.stdout.includes("scheduler-cli-ok") && !runResult.stderr.includes("scheduler-cli-ok")) {
    throw new Error("CLI verification for job scheduler did not run the configured job.");
  }

  const historyResult = await runPi({
    cwd: tempRoot,
    args: [
      "-p",
      "--no-session",
      "--offline",
      "--no-tools",
      "--extension",
      path.join(repoRoot, "extensions", "job-scheduler.ts"),
      "/job_history manual",
    ],
  });

  const combined = `${historyResult.stdout}\n${historyResult.stderr}`;
  if (!combined.includes("manual | status=passed")) {
    throw new Error(`CLI verification for job history did not render the persisted entry.\n${combined}`);
  }

  console.log("[verify-cli] job scheduler executed and rendered persisted history through the pi CLI");
}

async function verifyMalformedConfigCli() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cli-invalid-config-"));
  fs.writeFileSync(
    path.join(tempRoot, "jobs.yaml"),
    `jobs:\n  - id: 17\n    schedule: no\n    target:\n      type: script\n`,
    "utf8",
  );

  const { code, stdout, stderr } = await runPiRaw({
    cwd: tempRoot,
    args: [
      "-p",
      "--no-session",
      "--offline",
      "--no-tools",
      "--extension",
      path.join(repoRoot, "extensions", "job-scheduler.ts"),
      "/jobs",
    ],
  });

  const combined = `${stdout}\n${stderr}`;
  if (!combined.includes("Invalid configuration.") || !combined.includes("jobs.yaml") || !combined.includes("jobs[0].label")) {
    throw new Error(`CLI verification for malformed job config did not report an actionable error.\n${combined}`);
  }

  console.log(
    `[verify-cli] malformed job config surfaced actionable diagnostics through the pi CLI (exit=${code})`,
  );
}

await verifyStateCaptureCli();
await verifyKnowledgeCli();
await verifyJobSchedulerCli();
await verifyMalformedConfigCli();
