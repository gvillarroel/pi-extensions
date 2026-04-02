import path from "node:path";

import type {
  DashboardConfigFile,
  DashboardItem,
  DashboardRunHistoryFile,
  DashboardSourceDefinition,
  DashboardWorkflowSummary,
} from "./types.js";
import { asRecord, ensureArray, validateRecordFields } from "./paths.js";
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

const MAX_PAGES = 10;

function parseLinkHeader(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1];
}

async function requestGitHubPaginated(
  source: DashboardSourceDefinition,
  endpoint: string,
): Promise<Array<Record<string, unknown>>> {
  const token = pickToken(source);
  const results: Array<Record<string, unknown>> = [];
  let url: string | undefined = `${GITHUB_API_BASE}${endpoint}`;
  let page = 0;

  while (url && page < MAX_PAGES) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: token ? `Bearer ${token}` : "",
        "User-Agent": "pi-extensions",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub request failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as Array<Record<string, unknown>>;
    results.push(...payload);
    url = parseLinkHeader(response.headers.get("link"));
    page++;
  }

  return results;
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
      const payload = await requestGitHubPaginated(
        source,
        `/repos/${owner}/${repository}/issues?state=${state}&per_page=100`,
      );

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

// --- Jira connector ---

function pickJiraCredentials(source: DashboardSourceDefinition): { username: string; token: string } | undefined {
  const usernameEnvVar = source.usernameEnvVar ?? "JIRA_USERNAME";
  const tokenEnvVar = source.tokenEnvVar ?? "JIRA_TOKEN";
  const username = process.env[usernameEnvVar];
  const token = process.env[tokenEnvVar];
  if (typeof username !== "string" || !username.length || typeof token !== "string" || !token.length) {
    return undefined;
  }
  return { username, token };
}

function buildJiraJql(source: DashboardSourceDefinition): string {
  if (source.jql) {
    return source.jql;
  }

  const clauses: string[] = [];
  if (source.project) {
    clauses.push(`project = ${source.project}`);
  }
  if (source.statuses?.length) {
    const quoted = source.statuses.map((s) => `"${s}"`).join(", ");
    clauses.push(`status in (${quoted})`);
  }
  if (source.assignees?.length) {
    const quoted = source.assignees.map((a) => `"${a}"`).join(", ");
    clauses.push(`assignee in (${quoted})`);
  }
  if (source.labels?.length) {
    const quoted = source.labels.map((l) => `"${l}"`).join(", ");
    clauses.push(`labels in (${quoted})`);
  }
  if (!clauses.length) {
    clauses.push("ORDER BY updated DESC");
    return clauses.join("");
  }
  return `${clauses.join(" AND ")} ORDER BY updated DESC`;
}

function normalizeJiraIssue(source: DashboardSourceDefinition, issue: Record<string, unknown>): DashboardItem {
  const fields = asRecord(issue.fields) ?? {};
  const key = String(issue.key ?? issue.id ?? "unknown");
  const baseUrl = (source.baseUrl ?? "").replace(/\/+$/, "");

  const assignee = asRecord(fields.assignee);
  const assigneeDisplay = typeof assignee?.displayName === "string"
    ? assignee.displayName
    : typeof assignee?.emailAddress === "string"
      ? assignee.emailAddress
      : undefined;

  const statusObj = asRecord(fields.status);
  const statusName = typeof statusObj?.name === "string" ? statusObj.name : "unknown";

  const labels = Array.isArray(fields.labels)
    ? (fields.labels as unknown[]).filter((l): l is string => typeof l === "string")
    : [];

  const priorityObj = asRecord(fields.priority);
  const priorityName = typeof priorityObj?.name === "string" ? priorityObj.name : undefined;

  const issueTypeObj = asRecord(fields.issuetype);
  const issueTypeName = typeof issueTypeObj?.name === "string" ? issueTypeObj.name : undefined;

  const title = typeof fields.summary === "string" ? fields.summary : key;
  const updatedAt = typeof fields.updated === "string" ? fields.updated : "";

  return {
    source: source.id,
    project: source.project ?? "",
    repositoryOrBoard: source.project ?? "",
    id: key,
    itemType: "issue",
    title,
    url: baseUrl ? `${baseUrl}/browse/${key}` : "",
    status: statusName,
    assignees: assigneeDisplay ? [assigneeDisplay] : [],
    labels: [
      ...(issueTypeName ? [`type:${issueTypeName}`] : []),
      ...(priorityName ? [`priority:${priorityName}`] : []),
      ...labels,
    ],
    updatedAt,
    rawMetadata: issue,
  };
}

async function fetchJiraIssues(source: DashboardSourceDefinition): Promise<DashboardItem[]> {
  const credentials = pickJiraCredentials(source);
  if (!credentials) {
    return [];
  }

  const baseUrl = source.baseUrl;
  if (!baseUrl) {
    return [];
  }

  const jql = buildJiraJql(source);
  const maxResults = source.maxResults ?? 100;
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const items: DashboardItem[] = [];
  let startAt = 0;

  while (true) {
    const url = `${normalizedBaseUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&startAt=${startAt}&fields=summary,status,assignee,labels,priority,issuetype,updated,description`;
    const authHeader = `Basic ${btoa(`${credentials.username}:${credentials.token}`)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
        "User-Agent": "pi-extensions",
      },
    });

    if (!response.ok) {
      throw new Error(`Jira request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as {
      issues?: Array<Record<string, unknown>>;
      nextPageToken?: string;
      total?: number;
    };

    const issues = data.issues ?? [];
    for (const issue of issues) {
      const normalized = normalizeJiraIssue(source, issue);
      if (matchesSourceFilters(normalized, source)) {
        items.push(normalized);
      }
    }

    if (!data.nextPageToken || issues.length === 0) {
      break;
    }

    startAt += issues.length;
    if (startAt >= (data.total ?? Infinity)) {
      break;
    }
  }

  return items;
}

// --- AHA connector ---

function pickAhaToken(source: DashboardSourceDefinition): string | undefined {
  const envVar = source.tokenEnvVar ?? "AHA_TOKEN";
  const value = process.env[envVar];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeAhaFeature(source: DashboardSourceDefinition, feature: Record<string, unknown>): DashboardItem {
  const subdomain = source.subdomain ?? "";
  const referenceNum = typeof feature.reference_num === "string" ? feature.reference_num : String(feature.id ?? "unknown");

  const workflowStatus = asRecord(feature.workflow_status);
  const statusName = typeof workflowStatus?.name === "string" ? workflowStatus.name : "unknown";

  const assignedUser = asRecord(feature.assigned_to_user);
  const assigneeName = typeof assignedUser?.name === "string" ? assignedUser.name : undefined;

  const title = typeof feature.name === "string" ? feature.name : referenceNum;
  const updatedAt = typeof feature.updated_at === "string" ? feature.updated_at : "";

  const tags = Array.isArray(feature.tags)
    ? (feature.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  return {
    source: source.id,
    project: source.product ?? "",
    repositoryOrBoard: source.product ?? "",
    id: referenceNum,
    itemType: "feature",
    title,
    url: subdomain ? `https://${subdomain}.aha.io/features/${referenceNum}` : "",
    status: statusName,
    assignees: assigneeName ? [assigneeName] : [],
    labels: tags,
    updatedAt,
    rawMetadata: feature,
  };
}

async function fetchAhaFeatures(source: DashboardSourceDefinition): Promise<DashboardItem[]> {
  const token = pickAhaToken(source);
  if (!token) {
    return [];
  }

  const subdomain = source.subdomain;
  if (!subdomain) {
    return [];
  }

  const product = source.product;
  if (!product) {
    return [];
  }

  const maxResults = source.maxResults ?? 100;
  const baseUrl = `https://${subdomain}.aha.io/api/v1`;
  const url = `${baseUrl}/products/${encodeURIComponent(product)}/features?per_page=${maxResults}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "pi-extensions",
    },
  });

  if (!response.ok) {
    throw new Error(`AHA request failed (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as {
    features?: Array<Record<string, unknown>>;
  };

  const features = data.features ?? [];
  return features
    .map((feature) => normalizeAhaFeature(source, feature))
    .filter((item) => matchesSourceFilters(item, source));
}

// --- Run history ---

export function getDashboardRunHistoryPath(cwd = process.cwd()): string {
  return path.join(cwd, ".pi-extensions", "dashboard-runs.yaml");
}

function normalizeRunSummary(value: unknown): DashboardWorkflowSummary | undefined {
  return validateRecordFields<DashboardWorkflowSummary>(
    value,
    ["itemId", "workflowId", "endedAt", "summary"],
    { status: ["passed", "failed"] },
  );
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
  const errors: Array<{ sourceId: string; error: string }> = [];

  for (const source of config.sources ?? []) {
    if (source.enabled === false) {
      continue;
    }

    try {
      if (source.type === "github") {
        const [issues, discussions] = await Promise.all([
          fetchGitHubIssues(source),
          fetchGitHubDiscussions(source),
        ]);
        items.push(...issues, ...discussions);
      } else if (source.type === "jira") {
        const issues = await fetchJiraIssues(source);
        items.push(...issues);
      } else if (source.type === "aha") {
        const features = await fetchAhaFeatures(source);
        items.push(...features);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ sourceId: source.id, error: message });
    }
  }

  if (errors.length > 0) {
    console.error(
      `Dashboard source errors:\n${errors.map((e) => `  [${e.sourceId}] ${e.error}`).join("\n")}`,
    );
  }

  return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
