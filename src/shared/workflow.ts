import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  AnyRecord,
  ExecutionArtifact,
  GateDefinition,
  GateExecutionResult,
  HookDefinition,
  StepExecutionResult,
  WorkflowDefinition,
  WorkflowExecutionResult,
  WorkflowStepDefinition,
} from "./types.js";
import { getByPath, interpolateTemplate } from "./paths.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;

async function runShellCommand(command: string, context: AnyRecord, timeoutMs?: number): Promise<string> {
  const rendered = interpolateTemplate(command, context);
  const shell = process.platform === "win32" ? "powershell" : "bash";
  const args =
    process.platform === "win32"
      ? ["-NoProfile", "-Command", rendered]
      : ["-lc", rendered];
  const { stdout, stderr } = await execFileAsync(shell, args, {
    cwd: typeof context.cwd === "string" ? context.cwd : process.cwd(),
    env: process.env,
    timeout: timeoutMs ?? (typeof context.timeoutMs === "number" ? context.timeoutMs : DEFAULT_TIMEOUT_MS),
  });

  return `${stdout}${stderr}`.trim();
}

async function evaluateGate(gate: GateDefinition, context: AnyRecord): Promise<GateExecutionResult> {
  const gateId = gate.id ?? gate.description ?? "anonymous-gate";

  if (gate.requiredContextFields?.length) {
    for (const field of gate.requiredContextFields) {
      const value = getByPath(context, field);
      if (value === undefined || value === null || value === "") {
        return {
          id: gateId,
          status: "failed",
          reason: `Missing required context field: ${field}`,
        };
      }
    }
  }

  if (gate.run) {
    try {
      await runShellCommand(gate.run, context);
    } catch (error) {
      return {
        id: gateId,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    id: gateId,
    status: "passed",
    reason: "Gate passed",
  };
}

async function runHooks(hooks: HookDefinition[] | undefined, context: AnyRecord): Promise<void> {
  for (const hook of hooks ?? []) {
    await runShellCommand(hook.run, context);
  }
}

async function executeStep(step: WorkflowStepDefinition, context: AnyRecord): Promise<StepExecutionResult> {
  if (step.type === "note") {
    return {
      id: step.id,
      status: "passed",
      output: step.message ?? "",
      artifacts: step.message
        ? [{ type: "note", label: step.id, content: interpolateTemplate(step.message, context) }]
        : [],
    };
  }

  if (step.type === "parallel") {
    const childResults = await Promise.all((step.steps ?? []).map((child) => executeStep(child, context)));
    const failedChild = childResults.find((child) => child.status === "failed");
    return {
      id: step.id,
      status: failedChild ? "failed" : "passed",
      children: childResults,
      artifacts: childResults.flatMap((child) => child.artifacts ?? []),
      error: failedChild?.error,
    };
  }

  try {
    const output = await runShellCommand(step.run ?? "", context);
    return {
      id: step.id,
      status: "passed",
      output,
      artifacts: output ? [{ type: "command-output", label: step.id, content: output }] : [],
    };
  } catch (error) {
    return {
      id: step.id,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  context: AnyRecord,
): Promise<WorkflowExecutionResult> {
  const startedAt = new Date().toISOString();
  const gateResults: GateExecutionResult[] = [];
  const stepResults: StepExecutionResult[] = [];
  const artifacts: ExecutionArtifact[] = [];

  for (const gate of workflow.gates ?? []) {
    const result = await evaluateGate(gate, context);
    gateResults.push(result);
    if (result.status === "failed") {
      return {
        workflowId: workflow.id,
        status: "failed",
        startedAt,
        endedAt: new Date().toISOString(),
        stepResults,
        gateResults,
        artifacts,
        errorSummary: result.reason,
      };
    }
  }

  try {
    await runHooks(workflow.preHooks, context);
  } catch (error) {
    return {
      workflowId: workflow.id,
      status: "failed",
      startedAt,
      endedAt: new Date().toISOString(),
      stepResults,
      gateResults,
      artifacts,
      errorSummary: error instanceof Error ? error.message : String(error),
    };
  }

  for (const step of workflow.steps) {
    const result = await executeStep(step, context);
    stepResults.push(result);
    artifacts.push(...(result.artifacts ?? []));
    if (result.status === "failed") {
      return {
        workflowId: workflow.id,
        status: "failed",
        startedAt,
        endedAt: new Date().toISOString(),
        stepResults,
        gateResults,
        artifacts,
        errorSummary: result.error ?? `Step ${step.id} failed`,
      };
    }
  }

  try {
    await runHooks(workflow.postHooks, context);
  } catch (error) {
    return {
      workflowId: workflow.id,
      status: "failed",
      startedAt,
      endedAt: new Date().toISOString(),
      stepResults,
      gateResults,
      artifacts,
      errorSummary: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    workflowId: workflow.id,
    status: "passed",
    startedAt,
    endedAt: new Date().toISOString(),
    stepResults,
    gateResults,
    artifacts,
  };
}
