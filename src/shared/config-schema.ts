import type {
  BashWorkflowDefinition,
  DashboardConfigFile,
  GateDefinition,
  GatesConfigFile,
  HookDefinition,
  JobDefinition,
  JobsConfigFile,
  WorkflowConfigFile,
  WorkflowDefinition,
  WorkflowStepDefinition,
} from "./types.js";

export interface ConfigValidationIssue {
  path: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pushTypeIssue(issues: ConfigValidationIssue[], fieldPath: string, expected: string, actual: unknown): void {
  issues.push({
    path: fieldPath,
    message: `Expected ${expected} but received ${actual === null ? "null" : Array.isArray(actual) ? "array" : typeof actual}.`,
  });
}

function expectOptionalString(issues: ConfigValidationIssue[], fieldPath: string, value: unknown): void {
  if (value !== undefined && typeof value !== "string") {
    pushTypeIssue(issues, fieldPath, "string", value);
  }
}

function expectOptionalBoolean(issues: ConfigValidationIssue[], fieldPath: string, value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") {
    pushTypeIssue(issues, fieldPath, "boolean", value);
  }
}

function expectOptionalNumber(issues: ConfigValidationIssue[], fieldPath: string, value: unknown): void {
  if (value !== undefined && typeof value !== "number") {
    pushTypeIssue(issues, fieldPath, "number", value);
  }
}

function expectStringArray(issues: ConfigValidationIssue[], fieldPath: string, value: unknown, required = false): void {
  if (value === undefined) {
    if (required) {
      issues.push({ path: fieldPath, message: "Field is required." });
    }
    return;
  }

  if (!Array.isArray(value)) {
    pushTypeIssue(issues, fieldPath, "array", value);
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      pushTypeIssue(issues, `${fieldPath}[${index}]`, "string", entry);
    }
  });
}

function validateGate(gate: unknown, fieldPath: string, issues: ConfigValidationIssue[]): gate is GateDefinition {
  if (!isRecord(gate)) {
    pushTypeIssue(issues, fieldPath, "object", gate);
    return false;
  }

  expectOptionalString(issues, `${fieldPath}.id`, gate.id);
  expectOptionalString(issues, `${fieldPath}.description`, gate.description);
  expectOptionalString(issues, `${fieldPath}.run`, gate.run);
  expectStringArray(issues, `${fieldPath}.requiredContextFields`, gate.requiredContextFields);

  if (gate.run === undefined && gate.requiredContextFields === undefined) {
    issues.push({
      path: fieldPath,
      message: "Gate must define either 'run' or 'requiredContextFields'.",
    });
  }

  return true;
}

function validateBashWorkflow(
  workflow: unknown,
  fieldPath: string,
  issues: ConfigValidationIssue[],
): workflow is BashWorkflowDefinition {
  if (!isRecord(workflow)) {
    pushTypeIssue(issues, fieldPath, "object", workflow);
    return false;
  }

  if (typeof workflow.id !== "string" || !workflow.id.trim()) {
    issues.push({
      path: `${fieldPath}.id`,
      message: "Bash workflow 'id' must be a non-empty string.",
    });
  }

  if (typeof workflow.label !== "string" || !workflow.label.trim()) {
    issues.push({
      path: `${fieldPath}.label`,
      message: "Bash workflow 'label' must be a non-empty string.",
    });
  }

  expectOptionalString(issues, `${fieldPath}.description`, workflow.description);

  if (typeof workflow.bash === "string") {
    if (!workflow.bash.trim()) {
      issues.push({
        path: `${fieldPath}.bash`,
        message: "Bash workflow 'bash' must be a non-empty string or a non-empty array of strings.",
      });
    }
    return true;
  }

  if (!Array.isArray(workflow.bash) || workflow.bash.length === 0) {
    issues.push({
      path: `${fieldPath}.bash`,
      message: "Bash workflow 'bash' must be a non-empty string or a non-empty array of strings.",
    });
    return false;
  }

  workflow.bash.forEach((command, index) => {
    if (typeof command !== "string" || !command.trim()) {
      issues.push({
        path: `${fieldPath}.bash[${index}]`,
        message: "Bash workflow commands must be non-empty strings.",
      });
    }
  });

  return true;
}

function validateHook(hook: unknown, fieldPath: string, issues: ConfigValidationIssue[]): hook is HookDefinition {
  if (!isRecord(hook)) {
    pushTypeIssue(issues, fieldPath, "object", hook);
    return false;
  }

  expectOptionalString(issues, `${fieldPath}.name`, hook.name);
  if (typeof hook.run !== "string" || !hook.run.trim()) {
    issues.push({
      path: `${fieldPath}.run`,
      message: "Hook 'run' must be a non-empty string.",
    });
  }

  return true;
}

function validateWorkflowStep(step: unknown, fieldPath: string, issues: ConfigValidationIssue[]): step is WorkflowStepDefinition {
  if (!isRecord(step)) {
    pushTypeIssue(issues, fieldPath, "object", step);
    return false;
  }

  if (typeof step.id !== "string" || !step.id.trim()) {
    issues.push({
      path: `${fieldPath}.id`,
      message: "Step 'id' must be a non-empty string.",
    });
  }

  if (step.type !== "script" && step.type !== "note" && step.type !== "parallel") {
    issues.push({
      path: `${fieldPath}.type`,
      message: "Step 'type' must be one of: script, note, parallel.",
    });
    return false;
  }

  if (step.type === "script" && (typeof step.run !== "string" || !step.run.trim())) {
    issues.push({
      path: `${fieldPath}.run`,
      message: "Script steps must define a non-empty 'run' command.",
    });
  }

  if (step.type === "note" && (typeof step.message !== "string" || !step.message.trim())) {
    issues.push({
      path: `${fieldPath}.message`,
      message: "Note steps must define a non-empty 'message'.",
    });
  }

  if (step.type === "parallel") {
    if (!Array.isArray(step.steps) || step.steps.length === 0) {
      issues.push({
        path: `${fieldPath}.steps`,
        message: "Parallel steps must define a non-empty 'steps' array.",
      });
    } else {
      step.steps.forEach((child, index) => {
        validateWorkflowStep(child, `${fieldPath}.steps[${index}]`, issues);
      });
    }
  }

  return true;
}

function validateWorkflow(workflow: unknown, fieldPath: string, issues: ConfigValidationIssue[]): workflow is WorkflowDefinition {
  if (!isRecord(workflow)) {
    pushTypeIssue(issues, fieldPath, "object", workflow);
    return false;
  }

  if (typeof workflow.id !== "string" || !workflow.id.trim()) {
    issues.push({
      path: `${fieldPath}.id`,
      message: "Workflow 'id' must be a non-empty string.",
    });
  }

  if (typeof workflow.label !== "string" || !workflow.label.trim()) {
    issues.push({
      path: `${fieldPath}.label`,
      message: "Workflow 'label' must be a non-empty string.",
    });
  }

  expectOptionalString(issues, `${fieldPath}.description`, workflow.description);

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    issues.push({
      path: `${fieldPath}.steps`,
      message: "Workflow 'steps' must be a non-empty array.",
    });
  } else {
    workflow.steps.forEach((step, index) => {
      validateWorkflowStep(step, `${fieldPath}.steps[${index}]`, issues);
    });
  }

  if (workflow.gates !== undefined) {
    if (!Array.isArray(workflow.gates)) {
      pushTypeIssue(issues, `${fieldPath}.gates`, "array", workflow.gates);
    } else {
      workflow.gates.forEach((gate, index) => {
        validateGate(gate, `${fieldPath}.gates[${index}]`, issues);
      });
    }
  }

  if (workflow.preHooks !== undefined) {
    if (!Array.isArray(workflow.preHooks)) {
      pushTypeIssue(issues, `${fieldPath}.preHooks`, "array", workflow.preHooks);
    } else {
      workflow.preHooks.forEach((hook, index) => {
        validateHook(hook, `${fieldPath}.preHooks[${index}]`, issues);
      });
    }
  }

  if (workflow.postHooks !== undefined) {
    if (!Array.isArray(workflow.postHooks)) {
      pushTypeIssue(issues, `${fieldPath}.postHooks`, "array", workflow.postHooks);
    } else {
      workflow.postHooks.forEach((hook, index) => {
        validateHook(hook, `${fieldPath}.postHooks[${index}]`, issues);
      });
    }
  }

  return true;
}

function validateJobs(jobs: unknown, fieldPath: string, issues: ConfigValidationIssue[]): jobs is JobDefinition[] {
  if (jobs === undefined) {
    return true;
  }

  if (!Array.isArray(jobs)) {
    pushTypeIssue(issues, fieldPath, "array", jobs);
    return false;
  }

  jobs.forEach((job, index) => {
    const jobPath = `${fieldPath}[${index}]`;
    if (!isRecord(job)) {
      pushTypeIssue(issues, jobPath, "object", job);
      return;
    }

    if (typeof job.id !== "string" || !job.id.trim()) {
      issues.push({ path: `${jobPath}.id`, message: "Job 'id' must be a non-empty string." });
    }

    if (typeof job.label !== "string" || !job.label.trim()) {
      issues.push({ path: `${jobPath}.label`, message: "Job 'label' must be a non-empty string." });
    }

    expectOptionalBoolean(issues, `${jobPath}.enabled`, job.enabled);

    if (typeof job.schedule !== "string" || !job.schedule.trim()) {
      issues.push({ path: `${jobPath}.schedule`, message: "Job 'schedule' must be a non-empty string." });
    }

    if (job.concurrency !== undefined && job.concurrency !== "allow" && job.concurrency !== "forbid") {
      issues.push({
        path: `${jobPath}.concurrency`,
        message: "Job 'concurrency' must be either 'allow' or 'forbid'.",
      });
    }

    expectOptionalNumber(issues, `${jobPath}.timeoutMs`, job.timeoutMs);
    expectOptionalNumber(issues, `${jobPath}.retryCount`, job.retryCount);

    if (!isRecord(job.target)) {
      issues.push({ path: `${jobPath}.target`, message: "Job 'target' must be an object." });
      return;
    }

    if (job.target.type !== "script" && job.target.type !== "workflow") {
      issues.push({
        path: `${jobPath}.target.type`,
        message: "Job target 'type' must be either 'script' or 'workflow'.",
      });
      return;
    }

    if (job.target.type === "script" && (typeof job.target.run !== "string" || !job.target.run.trim())) {
      issues.push({
        path: `${jobPath}.target.run`,
        message: "Script job targets must define a non-empty 'run' command.",
      });
    }

    if (
      job.target.type === "workflow" &&
      (typeof job.target.workflowId !== "string" || !job.target.workflowId.trim())
    ) {
      issues.push({
        path: `${jobPath}.target.workflowId`,
        message: "Workflow job targets must define a non-empty 'workflowId'.",
      });
    }
  });

  return true;
}

export function validateDashboardConfig(
  value: unknown,
  issues: ConfigValidationIssue[],
): value is DashboardConfigFile {
  if (!isRecord(value)) {
    pushTypeIssue(issues, "$", "object", value);
    return false;
  }

  if (value.sources === undefined) {
    return true;
  }

  if (!Array.isArray(value.sources)) {
    pushTypeIssue(issues, "sources", "array", value.sources);
    return false;
  }

  value.sources.forEach((source, index) => {
    const sourcePath = `sources[${index}]`;
    if (!isRecord(source)) {
      pushTypeIssue(issues, sourcePath, "object", source);
      return;
    }

    if (typeof source.id !== "string" || !source.id.trim()) {
      issues.push({ path: `${sourcePath}.id`, message: "Source 'id' must be a non-empty string." });
    }

    if (typeof source.type !== "string" || !source.type.trim()) {
      issues.push({ path: `${sourcePath}.type`, message: "Source 'type' must be a non-empty string." });
    }

    expectOptionalBoolean(issues, `${sourcePath}.enabled`, source.enabled);
    expectOptionalString(issues, `${sourcePath}.owner`, source.owner);
    expectOptionalBoolean(issues, `${sourcePath}.includeDiscussions`, source.includeDiscussions);
    expectStringArray(issues, `${sourcePath}.repositories`, source.repositories);
    expectStringArray(issues, `${sourcePath}.labels`, source.labels);
    expectStringArray(issues, `${sourcePath}.assignees`, source.assignees);
    expectStringArray(issues, `${sourcePath}.statuses`, source.statuses);
    expectStringArray(issues, `${sourcePath}.itemTypes`, source.itemTypes);
    expectOptionalString(issues, `${sourcePath}.tokenEnvVar`, source.tokenEnvVar);
    expectOptionalString(issues, `${sourcePath}.defaultWorkflowId`, source.defaultWorkflowId);
    expectStringArray(issues, `${sourcePath}.allowedWorkflowIds`, source.allowedWorkflowIds);

    if (source.type === "github") {
      if (
        source.issueState !== undefined &&
        source.issueState !== "open" &&
        source.issueState !== "closed" &&
        source.issueState !== "all"
      ) {
        issues.push({
          path: `${sourcePath}.issueState`,
          message: "GitHub source 'issueState' must be one of: open, closed, all.",
        });
      }

      if (typeof source.owner !== "string" || !source.owner.trim()) {
        issues.push({
          path: `${sourcePath}.owner`,
          message: "GitHub sources must define a non-empty 'owner'.",
        });
      }

      if (!Array.isArray(source.repositories) || source.repositories.length === 0) {
        issues.push({
          path: `${sourcePath}.repositories`,
          message: "GitHub sources must define a non-empty 'repositories' array.",
        });
      }
    }

    if (Array.isArray(source.itemTypes)) {
      source.itemTypes.forEach((itemType, itemTypeIndex) => {
        if (itemType !== "issue" && itemType !== "discussion" && itemType !== "feature") {
          issues.push({
            path: `${sourcePath}.itemTypes[${itemTypeIndex}]`,
            message: "Dashboard source 'itemTypes' entries must be one of: 'issue', 'discussion', 'feature'.",
          });
        }
      });
    }

    if (source.type === "jira") {
      if (typeof source.baseUrl !== "string" || !source.baseUrl.trim()) {
        issues.push({
          path: `${sourcePath}.baseUrl`,
          message: "Jira sources must define a non-empty 'baseUrl'.",
        });
      }

      if (
        source.jql === undefined &&
        (typeof source.project !== "string" || !source.project.trim())
      ) {
        issues.push({
          path: `${sourcePath}.project`,
          message: "Jira sources must define either 'project' or 'jql'.",
        });
      }

      expectOptionalString(issues, `${sourcePath}.jql`, source.jql);
      expectOptionalString(issues, `${sourcePath}.project`, source.project);
      expectOptionalString(issues, `${sourcePath}.usernameEnvVar`, source.usernameEnvVar);
      expectOptionalNumber(issues, `${sourcePath}.maxResults`, source.maxResults);
    }

    if (source.type === "aha") {
      if (typeof source.subdomain !== "string" || !source.subdomain.trim()) {
        issues.push({
          path: `${sourcePath}.subdomain`,
          message: "AHA sources must define a non-empty 'subdomain'.",
        });
      }

      if (typeof source.product !== "string" || !source.product.trim()) {
        issues.push({
          path: `${sourcePath}.product`,
          message: "AHA sources must define a non-empty 'product'.",
        });
      }

      expectOptionalNumber(issues, `${sourcePath}.maxResults`, source.maxResults);
    }
  });

  return true;
}

export function validateWorkflowConfig(
  value: unknown,
  issues: ConfigValidationIssue[],
): value is WorkflowConfigFile {
  if (!isRecord(value)) {
    pushTypeIssue(issues, "$", "object", value);
    return false;
  }

  if (value.workflows === undefined) {
    if (value.bashWorkflows === undefined) {
      return true;
    }
  } else {
    if (!Array.isArray(value.workflows)) {
      pushTypeIssue(issues, "workflows", "array", value.workflows);
      return false;
    }

    value.workflows.forEach((workflow, index) => {
      validateWorkflow(workflow, `workflows[${index}]`, issues);
    });
  }

  if (value.bashWorkflows !== undefined) {
    if (!Array.isArray(value.bashWorkflows)) {
      pushTypeIssue(issues, "bashWorkflows", "array", value.bashWorkflows);
      return false;
    }

    value.bashWorkflows.forEach((workflow, index) => {
      validateBashWorkflow(workflow, `bashWorkflows[${index}]`, issues);
    });
  }

  return true;
}

export function validateGatesConfig(
  value: unknown,
  issues: ConfigValidationIssue[],
): value is GatesConfigFile {
  if (!isRecord(value)) {
    pushTypeIssue(issues, "$", "object", value);
    return false;
  }

  if (value.gates === undefined) {
    return true;
  }

  if (!Array.isArray(value.gates)) {
    pushTypeIssue(issues, "gates", "array", value.gates);
    return false;
  }

  value.gates.forEach((gate, index) => {
    validateGate(gate, `gates[${index}]`, issues);
  });

  return true;
}

export function validateJobsConfig(
  value: unknown,
  issues: ConfigValidationIssue[],
): value is JobsConfigFile {
  if (!isRecord(value)) {
    pushTypeIssue(issues, "$", "object", value);
    return false;
  }

  validateJobs(value.jobs, "jobs", issues);
  return true;
}
