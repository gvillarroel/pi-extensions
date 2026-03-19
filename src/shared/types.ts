export type AnyRecord = Record<string, unknown>;

export interface ExtensionContext {
  hasUI?: boolean;
  cwd?: string;
  ui?: {
    notify?: (message: string, kind?: string) => void;
    setStatus?: (slot: string, message: string) => void;
    setWidget?: (
      slot: string,
      content?:
        | string[]
        | ((
            tui: { requestRender?: () => void },
            theme: {
              fg: (color: string, text: string) => string;
              bg: (color: string, text: string) => string;
              bold: (text: string) => string;
            },
          ) => {
            render: (width: number) => string[];
            invalidate: () => void;
            handleInput?: (data: string) => void;
          }),
      options?: {
        placement?: "aboveEditor" | "belowEditor";
      },
    ) => void;
    custom?: <T>(
      componentFactory:
        | {
            render: (width: number) => string[];
            invalidate: () => void;
            handleInput?: (data: string) => void;
          }
        | ((
            tui: { requestRender: () => void },
            theme: {
              fg: (color: string, text: string) => string;
              bg: (color: string, text: string) => string;
              bold: (text: string) => string;
            },
            keybindings: unknown,
            done: (value: T) => void,
          ) => {
            render: (width: number) => string[];
            invalidate: () => void;
            handleInput?: (data: string) => void;
          }),
    ) => Promise<T>;
    editor?: (title: string, initialValue?: string) => Promise<string | undefined>;
    setEditorText?: (content: string) => void;
  };
}

export interface DashboardItem {
  source: string;
  project: string;
  repositoryOrBoard: string;
  id: string;
  itemType: "issue" | "discussion";
  title: string;
  url: string;
  status: string;
  assignees: string[];
  labels: string[];
  updatedAt: string;
  rawMetadata: AnyRecord;
}

export interface GateDefinition {
  id?: string;
  description?: string;
  run?: string;
  requiredContextFields?: string[];
}

export interface HookDefinition {
  name?: string;
  run: string;
}

export interface WorkflowStepDefinition {
  id: string;
  type: "script" | "note" | "parallel";
  run?: string;
  message?: string;
  steps?: WorkflowStepDefinition[];
}

export interface WorkflowDefinition {
  id: string;
  label: string;
  description?: string;
  gates?: GateDefinition[];
  preHooks?: HookDefinition[];
  steps: WorkflowStepDefinition[];
  postHooks?: HookDefinition[];
}

export interface ExecutionArtifact {
  type: string;
  label: string;
  content: string;
}

export interface StepExecutionResult {
  id: string;
  status: "passed" | "failed";
  output?: string;
  error?: string;
  artifacts?: ExecutionArtifact[];
  children?: StepExecutionResult[];
}

export interface GateExecutionResult {
  id: string;
  status: "passed" | "failed";
  reason: string;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  status: "passed" | "failed";
  startedAt: string;
  endedAt: string;
  stepResults: StepExecutionResult[];
  gateResults: GateExecutionResult[];
  artifacts: ExecutionArtifact[];
  errorSummary?: string;
}

export interface DashboardSourceDefinition {
  id: string;
  type: "github" | string;
  enabled?: boolean;
  owner?: string;
  repositories?: string[];
  includeDiscussions?: boolean;
  issueState?: "open" | "closed" | "all";
  labels?: string[];
  assignees?: string[];
  statuses?: string[];
  itemTypes?: Array<"issue" | "discussion">;
  tokenEnvVar?: string;
  defaultWorkflowId?: string;
  allowedWorkflowIds?: string[];
}

export interface DashboardConfigFile {
  sources?: DashboardSourceDefinition[];
}

export interface DashboardWorkflowSummary {
  itemId: string;
  workflowId: string;
  status: "passed" | "failed";
  endedAt: string;
  summary: string;
}

export interface DashboardRunHistoryFile {
  version: 1;
  updatedAt: string;
  entries: DashboardWorkflowSummary[];
}

export interface WorkflowConfigFile {
  workflows?: WorkflowDefinition[];
}

export interface GatesConfigFile {
  gates?: GateDefinition[];
}

export interface JobTargetDefinition {
  type: "script" | "workflow";
  run?: string;
  workflowId?: string;
  context?: AnyRecord;
}

export interface JobDefinition {
  id: string;
  label: string;
  enabled?: boolean;
  schedule: string;
  concurrency?: "allow" | "forbid";
  timeoutMs?: number;
  retryCount?: number;
  target: JobTargetDefinition;
}

export interface JobsConfigFile {
  jobs?: JobDefinition[];
}

export interface JobHistoryEntry {
  jobId: string;
  status: "passed" | "failed" | "skipped";
  startedAt: string;
  endedAt: string;
  summary: string;
}

export interface JobHistoryFile {
  version: 1;
  updatedAt: string;
  entries: JobHistoryEntry[];
}

export interface KnowledgeDocument {
  path: string;
  frontmatter: AnyRecord;
  body: string;
}

export interface KnowledgeSignal {
  type: "placeholder" | "low-confidence" | "draft-status" | "short-body";
  message: string;
}

export interface KnowledgeCandidate {
  path: string;
  title: string;
  signals: KnowledgeSignal[];
}
