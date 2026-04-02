// Barrel export for programmatic usage of pi-extensions shared utilities.

export type {
  AnyRecord,
  BashWorkflowDefinition,
  CommandDefinition,
  DashboardConfigFile,
  DashboardItem,
  DashboardRunHistoryFile,
  DashboardSourceDefinition,
  DashboardWorkflowSummary,
  EventHandler,
  ExecutionArtifact,
  ExtensionContext,
  GateDefinition,
  GateExecutionResult,
  GatesConfigFile,
  HookDefinition,
  JobDefinition,
  JobHistoryEntry,
  JobHistoryFile,
  JobsConfigFile,
  JobTargetDefinition,
  KnowledgeCandidate,
  KnowledgeDocument,
  KnowledgeSignal,
  PiExtensionHost,
  StepExecutionResult,
  ToolDefinition,
  ToolParameter,
  ToolResult,
  WorkflowConfigFile,
  WorkflowDefinition,
  WorkflowExecutionResult,
  WorkflowStepDefinition,
} from "./shared/types.js";

export {
  asRecord,
  ensureArray,
  escapeRegExp,
  getByPath,
  getHomeConfigDir,
  interpolateTemplate,
  normalizePath,
  validateRecordFields,
} from "./shared/paths.js";

export {
  ConfigValidationError,
  loadMergedYamlConfig,
} from "./shared/config.js";

export {
  validateDashboardConfig,
  validateGatesConfig,
  validateJobsConfig,
  validateWorkflowConfig,
} from "./shared/config-schema.js";

export {
  getDashboardRunHistoryPath,
  getLatestDashboardRunSummary,
  loadDashboardItems,
  loadDashboardRunHistory,
  persistDashboardRunHistory,
  recordDashboardRunSummary,
} from "./shared/dashboard.js";

export {
  collectKnowledgeSignals,
  findKnowledgeCandidates,
  loadKnowledgeDocuments,
  writeClarificationSection,
} from "./shared/knowledge.js";

export {
  createJobRuntimeState,
  getJobHistoryPath,
  getLatestJobHistorySummary,
  getNextRun,
  hydrateJobRuntimeState,
  loadJobHistory,
  persistJobHistory,
  recordJobHistoryEntry,
  renderJobHistory,
  shouldSkipJob,
} from "./shared/scheduler.js";

export { executeWorkflow } from "./shared/workflow.js";

export {
  parseFrontmatter,
  readYamlFile,
  renderFrontmatter,
  writeYamlFile,
  YamlFileError,
} from "./shared/yaml.js";
