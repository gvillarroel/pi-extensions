import path from "node:path";

import { CronExpressionParser } from "cron-parser";

import type { JobDefinition, JobHistoryEntry, JobHistoryFile } from "./types.js";
import { normalizePath, validateRecordFields } from "./paths.js";
import { readYamlFile, writeYamlFile } from "./yaml.js";

const DEFAULT_HISTORY_LIMIT = 100;

export interface JobRuntimeState {
  running: Set<string>;
  history: JobHistoryEntry[];
  historyCwd?: string;
}

export function createJobRuntimeState(): JobRuntimeState {
  return {
    running: new Set<string>(),
    history: [],
  };
}

export function getJobHistoryPath(cwd = process.cwd()): string {
  return path.join(cwd, ".pi-extensions", "job-history.yaml");
}

function normalizeHistoryEntry(value: unknown): JobHistoryEntry | undefined {
  return validateRecordFields<JobHistoryEntry>(
    value,
    ["jobId", "startedAt", "endedAt", "summary"],
    { status: ["passed", "failed", "skipped"] },
  );
}

export function loadJobHistory(cwd = process.cwd()): JobHistoryEntry[] {
  const historyPath = getJobHistoryPath(cwd);
  const file = readYamlFile<JobHistoryFile>(historyPath);
  if (!file?.entries?.length) {
    return [];
  }

  return file.entries.map(normalizeHistoryEntry).filter((entry): entry is JobHistoryEntry => Boolean(entry));
}

export function persistJobHistory(
  entries: JobHistoryEntry[],
  cwd = process.cwd(),
  limit = DEFAULT_HISTORY_LIMIT,
): JobHistoryEntry[] {
  const nextEntries = entries.slice(0, limit);
  const historyPath = getJobHistoryPath(cwd);
  writeYamlFile(historyPath, {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: nextEntries,
  } satisfies JobHistoryFile);
  return nextEntries;
}

export function hydrateJobRuntimeState(state: JobRuntimeState, cwd = process.cwd()): JobRuntimeState {
  const resolved = normalizePath(cwd);
  if (state.historyCwd === resolved && state.history.length > 0) {
    return state;
  }

  state.history = loadJobHistory(cwd);
  state.historyCwd = resolved;
  return state;
}

export function recordJobHistoryEntry(
  state: JobRuntimeState,
  entry: JobHistoryEntry,
  cwd = process.cwd(),
  limit = DEFAULT_HISTORY_LIMIT,
): JobHistoryEntry[] {
  hydrateJobRuntimeState(state, cwd);
  state.history.unshift(entry);
  state.history = persistJobHistory(state.history, cwd, limit);
  state.historyCwd = normalizePath(cwd);
  return state.history;
}

export function getLatestJobHistorySummary(
  jobId: string,
  state: JobRuntimeState,
  cwd = process.cwd(),
): JobHistoryEntry | undefined {
  hydrateJobRuntimeState(state, cwd);
  return state.history.find((entry) => entry.jobId === jobId);
}

export function renderJobHistory(
  state: JobRuntimeState,
  cwd = process.cwd(),
  options: { jobId?: string; limit?: number } = {},
): string {
  hydrateJobRuntimeState(state, cwd);
  const limit = options.limit ?? 10;
  const entries = state.history
    .filter((entry) => !options.jobId || entry.jobId === options.jobId)
    .slice(0, limit);

  if (!entries.length) {
    return options.jobId
      ? `No job history was found for '${options.jobId}'.`
      : "No job history was recorded yet.";
  }

  return entries
    .map(
      (entry) =>
        `${entry.jobId} | status=${entry.status} | started=${entry.startedAt} | ended=${entry.endedAt} | ${entry.summary}`,
    )
    .join("\n");
}

export function getNextRun(job: JobDefinition, currentDate = new Date()): Date {
  const interval = CronExpressionParser.parse(job.schedule, { currentDate, tz: "UTC" });
  return interval.next().toDate();
}

export function shouldSkipJob(job: JobDefinition, state: JobRuntimeState): string | undefined {
  if (job.enabled === false) {
    return "Job is disabled.";
  }

  if (job.concurrency === "forbid" && state.running.has(job.id)) {
    return "Job is already running and concurrency is forbidden.";
  }

  return undefined;
}
