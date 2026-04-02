import { loadMergedYamlConfig } from "../src/shared/config.js";
import type {
  ExtensionContext,
  JobDefinition,
  JobsConfigFile,
  PiExtensionHost,
  WorkflowConfigFile,
} from "../src/shared/types.js";
import {
  createJobRuntimeState,
  getLatestJobHistorySummary,
  getNextRun,
  hydrateJobRuntimeState,
  recordJobHistoryEntry,
  renderJobHistory,
  shouldSkipJob,
  type JobRuntimeState,
} from "../src/shared/scheduler.js";
import { executeWorkflow } from "../src/shared/workflow.js";

const schedulerState = createJobRuntimeState();
const STATUS_SLOT = "scheduler";

function loadJobs(cwd?: string): JobDefinition[] {
  const config = loadMergedYamlConfig<JobsConfigFile>("jobs.yaml", { cwd });
  return config.jobs ?? [];
}

async function executeJobTarget(job: JobDefinition, cwd?: string) {
  if (job.target.type === "script") {
    const workflow = {
      id: `${job.id}-script-wrapper`,
      label: job.label,
      steps: [
        {
          id: `${job.id}-script-step`,
          type: "script" as const,
          run: job.target.run ?? "",
        },
      ],
    };

    return executeWorkflow(workflow, { cwd, job });
  }

  const workflows = loadMergedYamlConfig<WorkflowConfigFile>("workflows.yaml", { cwd }).workflows ?? [];
  const workflow = workflows.find((candidate) => candidate.id === job.target.workflowId);
  if (!workflow) {
    throw new Error(`Workflow '${job.target.workflowId}' was not found for job '${job.id}'.`);
  }

  return executeWorkflow(workflow, {
    cwd,
    job,
    ...(job.target.context ?? {}),
  });
}

export async function runJobNow(
  jobId: string,
  state: JobRuntimeState = schedulerState,
  cwd?: string,
): Promise<string> {
  hydrateJobRuntimeState(state, cwd);
  const job = loadJobs(cwd).find((entry) => entry.id === jobId);
  if (!job) {
    throw new Error(`Job '${jobId}' was not found.`);
  }

  const skipReason = shouldSkipJob(job, state);
  if (skipReason) {
    const timestamp = new Date().toISOString();
    recordJobHistoryEntry(state, {
      jobId,
      status: "skipped",
      startedAt: timestamp,
      endedAt: timestamp,
      summary: skipReason,
    }, cwd);
    return skipReason;
  }

  const startedAt = new Date().toISOString();
  state.running.add(job.id);
  try {
    const result = await executeJobTarget(job, cwd);
    recordJobHistoryEntry(state, {
      jobId,
      status: result.status,
      startedAt,
      endedAt: new Date().toISOString(),
      summary: result.errorSummary ?? `Workflow result: ${result.status}`,
    }, cwd);
    return JSON.stringify(result, null, 2);
  } catch (error) {
    recordJobHistoryEntry(state, {
      jobId,
      status: "failed",
      startedAt,
      endedAt: new Date().toISOString(),
      summary: error instanceof Error ? error.message : String(error),
    }, cwd);
    throw error;
  } finally {
    state.running.delete(job.id);
  }
}

export function renderJobStatus(cwd?: string, state: JobRuntimeState = schedulerState): string {
  hydrateJobRuntimeState(state, cwd);
  return loadJobs(cwd)
    .map((job) => {
      const nextRun = getNextRun(job).toISOString();
      const lastRun = getLatestJobHistorySummary(job.id, state, cwd);
      const lastSummary = lastRun
        ? ` | last=${lastRun.status}@${lastRun.endedAt} | summary=${lastRun.summary}`
        : " | last=none";
      return `${job.id} | enabled=${job.enabled !== false} | next=${nextRun} | target=${job.target.type}${lastSummary}`;
    })
    .join("\n");
}

export default function registerJobScheduler(pi: PiExtensionHost) {
  // Next expected extension point: replace the polling strategy with a persistent scheduler when Pi exposes a stable background API.
  pi.registerCommand("jobs", {
    description: "List scheduled jobs and their next run times.",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const message = renderJobStatus(ctx.cwd);
      console.log(message);
      ctx?.ui?.notify?.("Job list loaded.", "info");
      ctx?.ui?.setStatus?.(STATUS_SLOT, "Job list loaded.");
    },
  });

  pi.registerCommand("job_run", {
    description: "Run a configured job immediately using /job_run <jobId>.",
    handler: async (args: string, ctx: ExtensionContext) => {
      const jobId = args.trim();
      if (!jobId) {
        throw new Error("Usage: /job_run <jobId>");
      }

      const output = await runJobNow(jobId, schedulerState, ctx.cwd);
      console.log(output);
      ctx?.ui?.notify?.(`Job '${jobId}' executed.`, "info");
      ctx?.ui?.setStatus?.(STATUS_SLOT, `Job '${jobId}' executed.`);
    },
  });

  pi.registerCommand("job_history", {
    description: "Show recent persisted job history using /job_history [jobId].",
    handler: async (args: string, ctx: ExtensionContext) => {
      const jobId = args.trim() || undefined;
      const message = renderJobHistory(schedulerState, ctx.cwd, { jobId });
      console.log(message);
      ctx?.ui?.notify?.("Job history loaded.", "info");
      ctx?.ui?.setStatus?.(STATUS_SLOT, "Job history loaded.");
    },
  });

  pi.registerTool({
    name: "jobs_list",
    description: "List jobs and next execution times from YAML configuration.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () => ({
      content: [{ type: "text", text: renderJobStatus() }],
    }),
  });
}
