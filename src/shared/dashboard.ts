import path from "node:path";

import type {
  DashboardConfigFile,
  DashboardItem,
  DashboardRunHistoryFile,
  DashboardSourceDefinition,
  DashboardWorkflowSummary,
} from "./types.js";
import { ensureArray } from "./paths.js";
import { readYamlFile, writeYamlFile } from "./yaml.js";

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_RUN_HISTORY_LIMIT = 200;

function pickToken(source: DashboardSourceDefinition): string | undefined {
  const envVar = source.tokenEnvVar ?? "GITHUB_TOKEN";
  const value = process.env[envVar];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function requestGitHub(
  source: DashboardSourceDefinition,
  endpoint: string,
  body?: string,
): Promise<unknown> {
  const token = pickToken(source);
  const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: token ? `Bearer ${token}` : "",
      "User-Agent": "pi-extensions",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function normalizeIssue(
  sourceId: string,
  owner: string,
  repository: string,
  issue: Record<string, unknown>,
): DashboardItem {
  const labels = ensureArray(issue.labels as unknown[]).flatMap((label) => {
    if (typeof label === "string") {
      return [label];
    }

    if (label && typeof label === "object" && typeof (label as Record<string, unknown>).name === "string") {
      return [(label as Record<string, unknown>).name as string];
    }

    return [];
  });

  const assignees = ensureArray(issue.assignees as unknown[]).flatMap((assignee) => {
    if (assignee && typeof assignee === "object" && typeof (assignee as Record<string, unknown>).login === "string") {
      return [(assignee as Record<string, unknown>).login as string];
    }

    return [];
  });

  return {
    source: sourceId,
    project: owner,
    repositoryOrBoard: repository,
    id: String(issue.number ?? issue.id ?? "unknown"),
    itemType: "issue",
    title: String(issue.title ?? "Untitled issue"),
    url: String(issue.html_url ?? ""),
    status: String(issue.state ?? "open"),
    assignees,
    labels,
    updatedAt: String(issue.updated_at ?? ""),
    rawMetadata: issue,
  };
}

function normalizeDiscussion(
  source: DashboardSourceDefinition,
  repository: string,
  discussion: Record<string, unknown>,
): DashboardItem {
  const author = asRecord(discussion.author);
  const category = asRecord(discussion.category);
  return {
    source: source.id,
    project: source.owner as string,
    repositoryOrBoard: repository,
    id: `discussion-${discussion.number ?? "unknown"}`,
    itemType: "discussion",
    title: String(discussion.title ?? "Untitled discussion"),
    url: String(discussion.url ?? ""),
    status: "open",
    assignees: typeof author?.login === "string" ? [author.login] : [],
    labels: typeof category?.name === "string" ? [category.name] : [],
    updatedAt: String(discussion.updatedAt ?? ""),
    rawMetadata: discussion,
  };
}

function matchesSourceFilters(item: DashboardItem, source: DashboardSourceDefinition): boolean {
  const expectedLabels = new Set(source.labels ?? []);
  const expectedAssignees = new Set(source.assignees ?? []);
  const expectedStatuses = new Set(source.statuses ?? []);
  const expectedItemTypes = new Set(source.itemTypes ?? []);

  if (expectedLabels.size > 0 && !item.labels.some((label) => expectedLabels.has(label))) {
    return false;
  }

  if (expectedAssignees.size > 0 && !item.assignees.some((assignee) => expectedAssignees.has(assignee))) {
    return false;
  }

  if (expectedStatuses.size > 0 && !expectedStatuses.has(item.status)) {
    return false;
  }

  if (expectedItemTypes.size > 0 && !expectedItemTypes.has(item.itemType)) {
    return false;
  }

  return true;
}

async function fetchGitHubIssues(source: DashboardSourceDefinition): Promise<DashboardItem[]> {
  const owner = source.owner;
  if (!owner) {
    return [];
  }

  const repositories = source.repositories ?? [];
  const state = source.issueState ?? "open";

  const batches = await Promise.all(
    repositories.map(async (repository) => {
      const payload = (await requestGitHub(
        source,
        `/repos/${owner}/${repository}/issues?state=${state}&per_page=100`,
      )) as Array<Record<string, unknown>>;

      return payload
        .filter((issue) => !("pull_request" in issue))
        .map((issue) => normalizeIssue(source.id, owner, repository, issue))
        .filter((item) => matchesSourceFilters(item, source));
    }),
  );

  return batches.flat();
}

async function fetchGitHubDiscussions(source: DashboardSourceDefinition): Promise<DashboardItem[]> {
  if (!source.includeDiscussions || !source.owner || !source.repositories?.length) {
    return [];
  }

  const token = pickToken(source);
  if (!token) {
    return [];
  }

  const batches = await Promise.all(
    source.repositories.map(async (repository) => {
      const query = {
        query: `
          query RepositoryDiscussions($owner: String!, $repository: String!) {
            repository(owner: $owner, name: $repository) {
              discussions(first: 25) {
                nodes {
                  number
                  title
                  url
                  updatedAt
                  category {
                    name
                  }
                  author {
                    login
                  }
                }
              }
            }
          }
        `,
        variables: {
          owner: source.owner,
          repository,
        },
      };

      const payload = (await requestGitHub(source, "/graphql", JSON.stringify(query))) as {
        data?: {
          repository?: {
            discussions?: {
              nodes?: Array<Record<string, unknown>>;
            };
          };
        };
      };

      const discussions = payload.data?.repository?.discussions?.nodes ?? [];
      return discussions
        .map((discussion) => normalizeDiscussion(source, repository, discussion))
        .filter((item) => matchesSourceFilters(item, source));
    }),
  );

  return batches.flat();
}

export function getDashboardRunHistoryPath(cwd = process.cwd()): string {
  return path.join(cwd, ".pi-extensions", "dashboard-runs.yaml");
}

function normalizeRunSummary(value: unknown): DashboardWorkflowSummary | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entry = value as Record<string, unknown>;
  if (
    typeof entry.itemId !== "string" ||
    typeof entry.workflowId !== "string" ||
    (entry.status !== "passed" && entry.status !== "failed") ||
    typeof entry.endedAt !== "string" ||
    typeof entry.summary !== "string"
  ) {
    return undefined;
  }

  return {
    itemId: entry.itemId,
    workflowId: entry.workflowId,
    status: entry.status,
    endedAt: entry.endedAt,
    summary: entry.summary,
  };
}

export function loadDashboardRunHistory(cwd = process.cwd()): DashboardWorkflowSummary[] {
  const file = readYamlFile<DashboardRunHistoryFile>(getDashboardRunHistoryPath(cwd));
  if (!file?.entries?.length) {
    return [];
  }

  return file.entries.map(normalizeRunSummary).filter((entry): entry is DashboardWorkflowSummary => Boolean(entry));
}

export function persistDashboardRunHistory(
  entries: DashboardWorkflowSummary[],
  cwd = process.cwd(),
  limit = DEFAULT_RUN_HISTORY_LIMIT,
): DashboardWorkflowSummary[] {
  const nextEntries = entries.slice(0, limit);
  writeYamlFile(getDashboardRunHistoryPath(cwd), {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: nextEntries,
  } satisfies DashboardRunHistoryFile);
  return nextEntries;
}

export function recordDashboardRunSummary(
  summary: DashboardWorkflowSummary,
  cwd = process.cwd(),
  limit = DEFAULT_RUN_HISTORY_LIMIT,
): DashboardWorkflowSummary[] {
  const history = loadDashboardRunHistory(cwd);
  history.unshift(summary);
  return persistDashboardRunHistory(history, cwd, limit);
}

export function getLatestDashboardRunSummary(
  itemId: string,
  cwd = process.cwd(),
): DashboardWorkflowSummary | undefined {
  return loadDashboardRunHistory(cwd).find((entry) => entry.itemId === itemId);
}

export async function loadDashboardItems(config: DashboardConfigFile): Promise<DashboardItem[]> {
  const items: DashboardItem[] = [];

  for (const source of config.sources ?? []) {
    if (source.enabled === false) {
      continue;
    }

    if (source.type === "github") {
      const [issues, discussions] = await Promise.all([
        fetchGitHubIssues(source),
        fetchGitHubDiscussions(source),
      ]);

      items.push(...issues, ...discussions);
    }
  }

  return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
