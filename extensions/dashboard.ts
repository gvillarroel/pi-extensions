import { loadMergedYamlConfig } from "../src/shared/config.js";
import {
  getLatestDashboardRunSummary,
  loadDashboardItems,
  recordDashboardRunSummary,
} from "../src/shared/dashboard.js";
import { asRecord } from "../src/shared/paths.js";
import type {
  DashboardConfigFile,
  DashboardItem,
  DashboardSourceDefinition,
  ExtensionContext,
  PiExtensionHost,
  WorkflowConfigFile,
  WorkflowDefinition,
} from "../src/shared/types.js";
import { executeWorkflow } from "../src/shared/workflow.js";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

const STATUS_SLOT = "dashboard";
const WIDGET_SLOT = "dashboard-items";
const DEFAULT_WIDGET_LIMIT = 6;
const PANEL_ITEM_PAGE_SIZE = 12;
const PANEL_WORKFLOW_PAGE_SIZE = 10;
const DETAIL_BODY_LINE_LIMIT = 8;
const ITEMS_CACHE_TTL_MS = 60_000;

type DashboardPanelContextId = "github-issues" | "github-discussions" | "jira" | "aha";
type DashboardPanelFocus = "items" | "detail" | "workflows";

interface DashboardPanelContext {
  id: DashboardPanelContextId;
  label: string;
  hint: string;
  items: DashboardItem[];
}

interface DashboardPanelSelection {
  item: DashboardItem;
  workflow?: WorkflowDefinition;
}

function notify(ctx: ExtensionContext | undefined, message: string, kind = "info"): void {
  ctx?.ui?.notify?.(message, kind);
  ctx?.ui?.setStatus?.(STATUS_SLOT, message);
}

function getDashboardConfig(cwd?: string): DashboardConfigFile {
  return loadMergedYamlConfig<DashboardConfigFile>("dashboard.sources.yaml", { cwd });
}

function buildDashboardEditorText(item: DashboardItem, cwd?: string, suggestedWorkflowId?: string): string {
  const lastRun = getLatestDashboardRunSummary(item.id, cwd);
  const details = [
    `Title: ${item.title}`,
    `Type: ${item.itemType}`,
    `Status: ${item.status}`,
    `Repository: ${item.repositoryOrBoard}`,
    `URL: ${item.url}`,
  ];

  if (item.assignees.length) {
    details.push(`Assignees: ${item.assignees.join(", ")}`);
  }

  if (item.labels.length) {
    details.push(`Labels: ${item.labels.join(", ")}`);
  }

  if (lastRun) {
    details.push(`Last workflow: ${lastRun.workflowId} (${lastRun.status}) at ${lastRun.endedAt}`);
    details.push(`Last summary: ${lastRun.summary}`);
  }

  details.push("", `Suggested command: /dashboard_run ${suggestedWorkflowId ?? "<workflowId>"} ${item.id}`);
  return details.join("\n");
}

function buildWorkflowExecutionEditorText(
  item: DashboardItem,
  workflow: WorkflowDefinition,
  output: string,
  cwd?: string,
  customPrompt?: string,
): string {
  const sections = [
    `Workflow executed: ${workflow.label} (${workflow.id})`,
    "",
    "Workflow result:",
    output,
    "",
    "Selected item:",
    buildDashboardEditorText(item, cwd, workflow.id),
  ];

  if (customPrompt) {
    sections.push("", "Custom prompt:", customPrompt);
  }

  return sections.join("\n");
}

function findSourceForItem(item: DashboardItem, cwd?: string): DashboardSourceDefinition | undefined {
  return getDashboardConfig(cwd).sources?.find((source) => source.id === item.source);
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  const available = maxLength - 3;
  const left = Math.ceil(available / 2);
  const right = Math.floor(available / 2);
  return `${value.slice(0, left)}...${value.slice(value.length - right)}`;
}

function padRight(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
}

function formatPanelItemId(item: DashboardItem): string {
  if (item.itemType === "discussion" && item.id.startsWith("discussion-")) {
    return item.id.slice("discussion-".length);
  }

  return item.id;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length ? value.trim() : undefined;
}

function extractPrimaryContent(item: DashboardItem): string[] {
  const metadata = asRecord(item.rawMetadata);
  const candidates = [
    asString(metadata?.body),
    asString(metadata?.bodyText),
    asString(metadata?.excerpt),
    asString(metadata?.content),
  ].filter((value): value is string => Boolean(value));

  if (!candidates.length) {
    return ["No ticket body available from this source."];
  }

  const normalized = candidates[0]
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0));

  return normalized.slice(0, DETAIL_BODY_LINE_LIMIT);
}

export function buildDetailLines(item: DashboardItem | undefined, cwd?: string): string[] {
  if (!item) {
    return ["No item in this context.", "Switch context with [ or ]."];
  }

  const lastRun = getLatestDashboardRunSummary(item.id, cwd);
  const headerBits = [`#${formatPanelItemId(item)}`, item.status.toUpperCase()];
  if (item.assignees.length) {
    headerBits.push(`@${item.assignees.join(", @")}`);
  }

  const lines = [item.title, headerBits.join("  "), "", ...extractPrimaryContent(item)];
  const metadata: string[] = [];

  if (item.labels.length) {
    metadata.push(`labels: ${item.labels.join(", ")}`);
  }

  metadata.push(`repo: ${item.repositoryOrBoard}`);

  if (item.updatedAt) {
    metadata.push(`updated: ${item.updatedAt}`);
  }

  if (lastRun) {
    metadata.push(`last workflow: ${lastRun.workflowId} (${lastRun.status})`);
    metadata.push(`last summary: ${lastRun.summary}`);
  }

  if (item.url) {
    metadata.push(`url: ${item.url}`);
  }

  if (metadata.length) {
    lines.push("", ...metadata);
  }

  return lines;
}

function renderBox(
  width: number,
  title: string,
  lines: string[],
  bodyHeight: number,
  style: {
    border: (text: string) => string;
    title?: (text: string) => string;
    body?: (text: string) => string;
  },
): string[] {
  const safeWidth = Math.max(12, width);
  const innerWidth = safeWidth - 2;
  const titleText = truncateToWidth(` ${title} `, Math.max(1, innerWidth));
  const topFill = "-".repeat(Math.max(0, innerWidth - titleText.length));
  const titleLine = `+${titleText}${topFill}+`;
  const output = [style.title ? style.title(titleLine) : style.border(titleLine)];

  for (let index = 0; index < bodyHeight; index++) {
    const raw = truncateToWidth(lines[index] ?? "", innerWidth);
    const content = style.body ? style.body(padRight(raw, innerWidth)) : padRight(raw, innerWidth);
    output.push(`${style.border("|")}${content}${style.border("|")}`);
  }

  output.push(style.border(`+${"-".repeat(innerWidth)}+`));
  return output;
}

export function buildDashboardPanelContexts(items: DashboardItem[], cwd?: string): DashboardPanelContext[] {
  const contextMap = new Map<DashboardPanelContextId, DashboardPanelContext>([
    ["github-issues", { id: "github-issues", label: "GH Issues", hint: "GitHub issues", items: [] }],
    ["github-discussions", { id: "github-discussions", label: "GH Discs", hint: "GitHub discussions", items: [] }],
    ["jira", { id: "jira", label: "Jira", hint: "Jira tickets", items: [] }],
    ["aha", { id: "aha", label: "Aha", hint: "Aha ideas", items: [] }],
  ]);

  for (const item of items) {
    const sourceType = findSourceForItem(item, cwd)?.type;
    if (sourceType === "github" && item.itemType === "issue") {
      contextMap.get("github-issues")?.items.push(item);
      continue;
    }

    if (sourceType === "github" && item.itemType === "discussion") {
      contextMap.get("github-discussions")?.items.push(item);
      continue;
    }

    if (sourceType === "jira") {
      contextMap.get("jira")?.items.push(item);
      continue;
    }

    if (sourceType === "aha") {
      contextMap.get("aha")?.items.push(item);
    }
  }

  return Array.from(contextMap.values());
}

class DashboardWorkspaceComponent {
  private readonly contexts: DashboardPanelContext[];
  private readonly itemPageSize = PANEL_ITEM_PAGE_SIZE;
  private readonly workflowPageSize = PANEL_WORKFLOW_PAGE_SIZE;
  private focus: DashboardPanelFocus = "items";
  private contextIndex = 0;
  private itemIndexByContext = new Map<DashboardPanelContextId, number>();
  private itemPageByContext = new Map<DashboardPanelContextId, number>();
  private workflowIndex = 0;
  private workflowPage = 0;
  private detailOffset = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    items: DashboardItem[],
    private readonly cwd: string | undefined,
    private readonly theme: {
      fg: (color: string, text: string) => string;
      bg: (color: string, text: string) => string;
      bold: (text: string) => string;
    },
    private readonly onSelect: (selection: DashboardPanelSelection) => void,
    private readonly onClose: () => void,
    private readonly requestRender: () => void,
  ) {
    this.contexts = buildDashboardPanelContexts(items, cwd);
    for (const context of this.contexts) {
      this.itemIndexByContext.set(context.id, 0);
      this.itemPageByContext.set(context.id, 0);
    }
    this.syncState();
  }

  private get currentContext(): DashboardPanelContext {
    return this.contexts[this.contextIndex];
  }

  private get currentItems(): DashboardItem[] {
    return this.currentContext.items;
  }

  private get selectedItemIndex(): number {
    return this.itemIndexByContext.get(this.currentContext.id) ?? 0;
  }

  private set selectedItemIndex(value: number) {
    this.itemIndexByContext.set(this.currentContext.id, value);
  }

  private get currentItemPage(): number {
    return this.itemPageByContext.get(this.currentContext.id) ?? 0;
  }

  private set currentItemPage(value: number) {
    this.itemPageByContext.set(this.currentContext.id, value);
  }

  private get selectedItem(): DashboardItem | undefined {
    return this.currentItems[this.selectedItemIndex];
  }

  private get currentWorkflows(): WorkflowDefinition[] {
    return this.selectedItem ? listDashboardWorkflows(this.selectedItem, this.cwd) : [];
  }

  private get visibleItems(): DashboardItem[] {
    const start = this.currentItemPage * this.itemPageSize;
    return this.currentItems.slice(start, start + this.itemPageSize);
  }

  private get visibleWorkflows(): WorkflowDefinition[] {
    const start = this.workflowPage * this.workflowPageSize;
    return this.currentWorkflows.slice(start, start + this.workflowPageSize);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onClose();
      return;
    }

    if (data === "[" || matchesKey(data, Key.ctrl("left"))) {
      this.changeContext(-1);
      return;
    }

    if (data === "]" || matchesKey(data, Key.ctrl("right"))) {
      this.changeContext(1);
      return;
    }

    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      this.changeFocus(1);
      return;
    }

    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
      this.changeFocus(-1);
      return;
    }

    if (this.focus === "items") {
      this.handleItemInput(data);
      return;
    }

    if (this.focus === "detail") {
      this.handleDetailInput(data);
      return;
    }

    this.handleWorkflowInput(data);
  }

  private handleItemInput(data: string): void {
    if (!this.currentItems.length) {
      return;
    }

    if (matchesKey(data, Key.up) && this.selectedItemIndex > 0) {
      this.selectedItemIndex -= 1;
      this.syncState();
      this.invalidateAndRender();
      return;
    }

    if (matchesKey(data, Key.down) && this.selectedItemIndex < this.currentItems.length - 1) {
      this.selectedItemIndex += 1;
      this.syncState();
      this.invalidateAndRender();
      return;
    }

    if (matchesKey(data, "pageUp") && this.currentItemPage > 0) {
      this.currentItemPage -= 1;
      this.selectedItemIndex = this.currentItemPage * this.itemPageSize;
      this.syncState();
      this.invalidateAndRender();
      return;
    }

    if (matchesKey(data, "pageDown")) {
      const totalPages = Math.max(1, Math.ceil(this.currentItems.length / this.itemPageSize));
      if (this.currentItemPage < totalPages - 1) {
        this.currentItemPage += 1;
        this.selectedItemIndex = this.currentItemPage * this.itemPageSize;
        this.syncState();
        this.invalidateAndRender();
      }
    }
  }

  private handleDetailInput(data: string): void {
    const detailLines = buildDetailLines(this.selectedItem, this.cwd);
    const maxOffset = Math.max(0, detailLines.length - 12);

    if (matchesKey(data, Key.up) && this.detailOffset > 0) {
      this.detailOffset -= 1;
      this.invalidateAndRender();
      return;
    }

    if (matchesKey(data, Key.down) && this.detailOffset < maxOffset) {
      this.detailOffset += 1;
      this.invalidateAndRender();
      return;
    }

    if (matchesKey(data, "pageUp")) {
      this.detailOffset = Math.max(0, this.detailOffset - 12);
      this.invalidateAndRender();
      return;
    }

    if (matchesKey(data, "pageDown")) {
      this.detailOffset = Math.min(maxOffset, this.detailOffset + 12);
      this.invalidateAndRender();
    }
  }

  private handleWorkflowInput(data: string): void {
    if (!this.currentWorkflows.length) {
      return;
    }

    if (matchesKey(data, Key.up) && this.workflowIndex > 0) {
      this.workflowIndex -= 1;
      this.syncState();
      this.invalidateAndRender();
      return;
    }

    if (matchesKey(data, Key.down) && this.workflowIndex < this.currentWorkflows.length - 1) {
      this.workflowIndex += 1;
      this.syncState();
      this.invalidateAndRender();
      return;
    }

    if (matchesKey(data, "pageUp") && this.workflowPage > 0) {
      this.workflowPage -= 1;
      this.workflowIndex = this.workflowPage * this.workflowPageSize;
      this.syncState();
      this.invalidateAndRender();
      return;
    }

    if (matchesKey(data, "pageDown")) {
      const totalPages = Math.max(1, Math.ceil(this.currentWorkflows.length / this.workflowPageSize));
      if (this.workflowPage < totalPages - 1) {
        this.workflowPage += 1;
        this.workflowIndex = this.workflowPage * this.workflowPageSize;
        this.syncState();
        this.invalidateAndRender();
        return;
      }
    }

    if (matchesKey(data, Key.enter) && this.selectedItem) {
      const workflow = this.currentWorkflows[this.workflowIndex];
      if (workflow) {
        this.onSelect({ item: this.selectedItem, workflow });
      }
    }
  }

  private changeContext(direction: -1 | 1): void {
    const next = this.contextIndex + direction;
    if (next < 0 || next >= this.contexts.length) {
      return;
    }

    this.contextIndex = next;
    this.syncState();
    this.invalidateAndRender();
  }

  private changeFocus(direction: -1 | 1): void {
    const order: DashboardPanelFocus[] = ["items", "detail", "workflows"];
    const currentIndex = order.indexOf(this.focus);
    const nextIndex = (currentIndex + direction + order.length) % order.length;
    this.focus = order[nextIndex];
    this.invalidateAndRender();
  }

  private syncState(): void {
    if (!this.currentItems.length) {
      this.selectedItemIndex = 0;
      this.currentItemPage = 0;
      this.workflowIndex = 0;
      this.workflowPage = 0;
      this.detailOffset = 0;
      return;
    }

    this.selectedItemIndex = Math.min(this.selectedItemIndex, this.currentItems.length - 1);
    this.currentItemPage = Math.floor(this.selectedItemIndex / this.itemPageSize);
    this.detailOffset = 0;

    if (!this.currentWorkflows.length) {
      this.workflowIndex = 0;
      this.workflowPage = 0;
      return;
    }

    this.workflowIndex = Math.min(this.workflowIndex, this.currentWorkflows.length - 1);
    this.workflowPage = Math.floor(this.workflowIndex / this.workflowPageSize);
  }

  private invalidateAndRender(): void {
    this.invalidate();
    this.requestRender();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const safeWidth = Math.max(80, width);
    const leftWidth = 14;
    const rightWidth = 24;
    const gap = 1;
    const middleWidth = Math.max(34, safeWidth - leftWidth - rightWidth - gap * 2);
    const bodyHeight = 14;

    const itemCount = this.currentItems.length;
    const itemPages = Math.max(1, Math.ceil(itemCount / this.itemPageSize));
    const itemLines = this.visibleItems.map((item, index) => {
      const absoluteIndex = this.currentItemPage * this.itemPageSize + index;
      const selected = absoluteIndex === this.selectedItemIndex;
      const marker = selected ? this.theme.bold(">") : this.theme.fg("dim", "·");
      const idText = selected ? this.theme.bold(formatPanelItemId(item)) : formatPanelItemId(item);
      return `${marker} ${idText}`;
    });
    if (!itemLines.length) {
      itemLines.push(this.theme.fg("dim", "No items"));
    }

    const detailAllLines = buildDetailLines(this.selectedItem, this.cwd);
    const detailLines = detailAllLines.slice(this.detailOffset, this.detailOffset + bodyHeight).map((line, index) => {
      if (index === 0) {
        return this.theme.bold(line);
      }

      if (index === 1) {
        return this.theme.fg("warning", line);
      }

      if (line.startsWith("labels:") || line.startsWith("repo:") || line.startsWith("updated:") || line.startsWith("last workflow:") || line.startsWith("last summary:") || line.startsWith("url:")) {
        return this.theme.fg("dim", line);
      }

      return line;
    });
    const workflowCount = this.currentWorkflows.length;
    const workflowPages = Math.max(1, Math.ceil(workflowCount / this.workflowPageSize));
    const workflowLines = this.visibleWorkflows.map((workflow, index) => {
      const absoluteIndex = this.workflowPage * this.workflowPageSize + index;
      const selected = absoluteIndex === this.workflowIndex;
      const marker = selected ? this.theme.bold(">") : this.theme.fg("dim", "·");
      const label = truncateMiddle(workflow.label || workflow.id, rightWidth - 6);
      return `${marker} ${selected ? this.theme.bold(label) : label}`;
    });
    if (!workflowLines.length) {
      workflowLines.push(this.theme.fg("dim", "No workflows"));
    }

    const activeStyle = {
      border: (text: string) => this.theme.fg("warning", this.theme.bold(text)),
      title: (text: string) => this.theme.bg("selectedBg", this.theme.fg("warning", this.theme.bold(text))),
    };
    const passiveStyle = {
      border: (text: string) => this.theme.fg("muted", text),
      title: (text: string) => this.theme.fg("dim", text),
      body: (text: string) => this.theme.fg("muted", text),
    };
    const detailStyle = this.focus === "detail"
      ? {
          border: (text: string) => this.theme.fg("accent", this.theme.bold(text)),
          title: (text: string) => this.theme.bg("customMessageBg", this.theme.fg("accent", this.theme.bold(text))),
        }
      : passiveStyle;

    const itemTitle = `${this.currentContext.label} ${this.currentItemPage + 1}/${itemPages}`;
    const detailTitle = `Detail ${this.detailOffset > 0 ? `+${this.detailOffset}` : ""}`.trim();
    const workflowTitle = `Flows ${this.workflowPage + 1}/${workflowPages}`;

    const leftBox = renderBox(leftWidth, itemTitle, itemLines, bodyHeight, this.focus === "items" ? activeStyle : passiveStyle);
    const middleBox = renderBox(middleWidth, detailTitle, detailLines, bodyHeight, detailStyle);
    const rightBox = renderBox(rightWidth, workflowTitle, workflowLines, bodyHeight, this.focus === "workflows" ? activeStyle : passiveStyle);

    const bodyLines: string[] = [];
    for (let index = 0; index < leftBox.length; index++) {
      bodyLines.push(`${leftBox[index]} ${middleBox[index]} ${rightBox[index]}`);
    }

    const contextText = this.contexts
      .map((context, index) => {
        const base = `${context.label}:${context.items.length}`;
        return index === this.contextIndex
          ? this.theme.bg("selectedBg", this.theme.fg("warning", ` ${base} `))
          : this.theme.fg("dim", base);
      })
      .join("  ");
    const helpText = `focus ${this.focus} | left/right or tab switch block | [ ] context | up/down move | pgup/pgdn page | enter run workflow`;
    const footerLines = [
      `Context ${contextText}`,
      `${this.currentContext.hint} | esc close`,
      this.theme.fg("dim", helpText),
    ];
    const footerBox = renderBox(safeWidth, "Controls", footerLines, 3, {
      border: (text: string) => this.theme.fg("warning", text),
      title: (text: string) => this.theme.bg("selectedBg", this.theme.fg("warning", this.theme.bold(text))),
    });

    const lines = [...bodyLines, ...footerBox];
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

function createDashboardWidgetComponent(items: DashboardItem[], cwd?: string) {
  return (
    _tui: { requestRender?: () => void },
    theme: {
      fg: (color: string, text: string) => string;
      bg: (color: string, text: string) => string;
      bold: (text: string) => string;
    },
  ) => ({
    render(width: number): string[] {
      const title = theme.bg("customMessageBg", theme.fg("accent", theme.bold(" Dashboard ")));
      if (!items.length) {
        return [
          truncateToWidth(title, width),
          truncateToWidth(theme.fg("dim", "No items found."), width),
        ];
      }

      const lines = items.slice(0, DEFAULT_WIDGET_LIMIT).map((item) => {
        const lastRun = getLatestDashboardRunSummary(item.id, cwd);
        const kind = item.itemType === "issue" ? theme.fg("warning", "I") : item.itemType === "feature" ? theme.fg("accent", "F") : theme.fg("success", "D");
        const suffix = lastRun ? theme.fg("dim", ` ${lastRun.workflowId}:${lastRun.status}`) : "";
        return truncateToWidth(`${kind} ${item.repositoryOrBoard}#${item.id} ${item.title}${suffix}`, width);
      });

      if (items.length > DEFAULT_WIDGET_LIMIT) {
        lines.push(truncateToWidth(theme.fg("dim", `... ${items.length - DEFAULT_WIDGET_LIMIT} more items`), width));
      }

      lines.push(truncateToWidth(theme.fg("dim", "Use /dashboard_panel for navigation"), width));
      return [truncateToWidth(title, width), ...lines];
    },
    invalidate() {},
  });
}

export function listDashboardWorkflows(item: DashboardItem, cwd?: string): WorkflowDefinition[] {
  const workflowConfig = loadMergedYamlConfig<WorkflowConfigFile>("workflows.yaml", { cwd });
  const workflows = workflowConfig.workflows ?? [];
  const source = findSourceForItem(item, cwd);

  if (!source?.allowedWorkflowIds?.length) {
    if (!source?.defaultWorkflowId) {
      return workflows;
    }

    const defaultWorkflow = workflows.find((workflow) => workflow.id === source.defaultWorkflowId);
    const remaining = workflows.filter((workflow) => workflow.id !== source.defaultWorkflowId);
    return defaultWorkflow ? [defaultWorkflow, ...remaining] : workflows;
  }

  const allowed = new Set(source.allowedWorkflowIds);
  const filtered = workflows.filter((workflow) => allowed.has(workflow.id));
  if (!source.defaultWorkflowId) {
    return filtered;
  }

  const defaultWorkflow = filtered.find((workflow) => workflow.id === source.defaultWorkflowId);
  const remaining = filtered.filter((workflow) => workflow.id !== source.defaultWorkflowId);
  return defaultWorkflow ? [defaultWorkflow, ...remaining] : filtered;
}

function formatItems(items: DashboardItem[], cwd?: string): string {
  if (!items.length) {
    return "No dashboard items were found.";
  }

  return items
    .map((item) => {
      const lastRun = getLatestDashboardRunSummary(item.id, cwd);
      const workflowSuffix = lastRun
        ? ` | lastWorkflow=${lastRun.workflowId}:${lastRun.status}@${lastRun.endedAt}`
        : "";
      return `[${item.source}] ${item.itemType} ${item.repositoryOrBoard}#${item.id} ${item.title} (${item.status}) ${item.url}${workflowSuffix}`;
    })
    .join("\n");
}

function findWorkflow(workflowId: string, cwd?: string) {
  const config = loadMergedYamlConfig<WorkflowConfigFile>("workflows.yaml", { cwd });
  return config.workflows?.find((workflow) => workflow.id === workflowId);
}

export async function listDashboardItems(cwd?: string): Promise<DashboardItem[]> {
  const config = loadMergedYamlConfig("dashboard.sources.yaml", { cwd });
  return loadDashboardItems(config);
}

let cachedItems: DashboardItem[] | undefined;
let cachedItemsCwd: string | undefined;
let cachedItemsTimestamp = 0;

async function listDashboardItemsCached(cwd?: string, forceRefresh = false): Promise<DashboardItem[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedItems &&
    cachedItemsCwd === cwd &&
    now - cachedItemsTimestamp < ITEMS_CACHE_TTL_MS
  ) {
    return cachedItems;
  }

  cachedItems = await listDashboardItems(cwd);
  cachedItemsCwd = cwd;
  cachedItemsTimestamp = now;
  return cachedItems;
}

async function refreshDashboardSurface(ctx: ExtensionContext | undefined): Promise<void> {
  if (!ctx?.hasUI) {
    return;
  }

  try {
    ctx.ui?.setStatus?.(STATUS_SLOT, "Loading dashboard...");
    const items = await listDashboardItemsCached(ctx.cwd);
    ctx.ui?.setWidget?.(WIDGET_SLOT, createDashboardWidgetComponent(items, ctx.cwd), { placement: "aboveEditor" });
    ctx.ui?.setStatus?.(STATUS_SLOT, `Dashboard: ${items.length} items`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui?.setWidget?.(WIDGET_SLOT, ["Dashboard", `Load failed: ${message}`], { placement: "aboveEditor" });
    ctx.ui?.setStatus?.(STATUS_SLOT, "Dashboard load failed");
  }
}

export async function runDashboardWorkflow(
  workflowId: string,
  item: DashboardItem,
  cwd?: string,
  options: { customPrompt?: string } = {},
): Promise<string> {
  const workflow = findWorkflow(workflowId, cwd);
  if (!workflow) {
    throw new Error(`Workflow '${workflowId}' was not found.`);
  }

  const result = await executeWorkflow(workflow, {
    cwd,
    item,
    customPrompt: options.customPrompt ?? "",
  });
  recordDashboardRunSummary(
    {
      itemId: item.id,
      workflowId,
      status: result.status,
      endedAt: result.endedAt,
      summary: result.errorSummary ?? `Workflow result: ${result.status}`,
    },
    cwd,
  );

  return JSON.stringify(result, null, 2);
}

export default function registerDashboardExtension(pi: PiExtensionHost) {
  // Next expected extension point: register Jira and AHA connectors here without changing workflow APIs.
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    await refreshDashboardSurface(ctx);
  });

  pi.registerCommand("dashboard", {
    description: "Load dashboard items from configured sources.",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const items = await listDashboardItems(ctx.cwd);
      const message = formatItems(items, ctx.cwd);
      console.log(message);
      if (ctx.hasUI) {
        ctx?.ui?.setWidget?.(WIDGET_SLOT, createDashboardWidgetComponent(items, ctx.cwd), { placement: "aboveEditor" });
      }
      notify(ctx, `Dashboard loaded ${items.length} items.`);
    },
  });

  pi.registerCommand("dashboard_panel", {
    description: "Open an interactive dashboard workspace with contexts, details, and workflows.",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!ctx.hasUI || !ctx.ui?.custom) {
        throw new Error("/dashboard_panel requires interactive mode.");
      }

      const items = await listDashboardItems(ctx.cwd);
      if (!items.length) {
        notify(ctx, "No dashboard items were found.", "warning");
        return;
      }

      const selection = await ctx.ui.custom<DashboardPanelSelection | undefined>((tui, theme, _kb, done) =>
        new DashboardWorkspaceComponent(
          items,
          ctx.cwd,
          theme,
          (value) => done(value),
          () => done(undefined),
          () => tui.requestRender(),
        ),
      );

      if (!selection?.item) {
        return;
      }

      if (!selection.workflow) {
        ctx.ui.setEditorText?.(buildDashboardEditorText(selection.item, ctx.cwd));
        notify(ctx, `Selected ${selection.item.repositoryOrBoard}#${selection.item.id}.`);
        return;
      }

      const customPrompt = (await ctx.ui.editor?.(`Prompt for ${selection.workflow.label}`, ""))?.trim() ?? "";
      const output = await runDashboardWorkflow(selection.workflow.id, selection.item, ctx.cwd, { customPrompt });
      await refreshDashboardSurface(ctx);
      console.log(output);
      ctx.ui.setEditorText?.(
        buildWorkflowExecutionEditorText(selection.item, selection.workflow, output, ctx.cwd, customPrompt),
      );
      notify(ctx, `Workflow '${selection.workflow.id}' completed for ${selection.item.title}.`);
    },
  });

  pi.registerCommand("dashboard_run", {
    description: "Run a workflow against a selected dashboard item using /dashboard_run <workflowId> <itemId> [custom prompt].",
    handler: async (args: string, ctx: ExtensionContext) => {
      const [workflowId, itemId, ...promptParts] = args.split(/\s+/).filter(Boolean);
      if (!workflowId || !itemId) {
        throw new Error("Usage: /dashboard_run <workflowId> <itemId> [custom prompt]");
      }

      const items = await listDashboardItems(ctx.cwd);
      const item = items.find((entry) => entry.id === itemId || `${entry.repositoryOrBoard}#${entry.id}` === itemId);
      if (!item) {
        throw new Error(`Dashboard item '${itemId}' was not found.`);
      }

      const output = await runDashboardWorkflow(workflowId, item, ctx.cwd, {
        customPrompt: promptParts.join(" ").trim(),
      });
      console.log(output);
      await refreshDashboardSurface(ctx);
      notify(ctx, `Workflow '${workflowId}' completed for ${item.title}.`);
    },
  });

  pi.registerTool({
    name: "dashboard_list_items",
    description: "List dashboard items from configured sources.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () => ({
      content: [{ type: "text", text: formatItems(await listDashboardItems()) }],
    }),
  });
}

