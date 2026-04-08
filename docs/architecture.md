# Architecture Overview

Related docs:

- [dashboard.md](./dashboard.md)
- [long-term-roadmap.md](./long-term-roadmap.md)
- [README.md](./README.md)

## Design principles

- Prefer simple YAML configuration over hidden code paths.
- Keep the public extension entry point easy to read.
- Put complex behavior behind small shared helpers with documented contracts.
- Preserve obvious extension seams with explicit comments.

## Shared execution model

All three main extensions share the same execution primitives:

- YAML loaders with global and local override support
- workflow execution with gates, hooks, sequential steps, and optional parallel branches
- execution audit results that can be rendered in the UI or persisted by future extensions
- persisted scheduler history stored under `.pi-extensions/job-history.yaml` in the active workspace
- persisted dashboard workflow summaries stored under `.pi-extensions/dashboard-runs.yaml` in the active workspace

## Configuration precedence

Global defaults are loaded from the user's home directory under `.pi-extensions/`.
Repository-local files override the global defaults when a file with the same name exists.

Supported config files:

- `dashboard.sources.yaml`
- `workflows.yaml` (full `workflows` definitions plus optional `bashWorkflows` shorthand)
- `gates.yaml`
- `jobs.yaml`

`bashWorkflows` entries are compiled into standard workflows during config loading, so the rest of the execution engine and scheduler can treat them like any other workflow definition.

Runtime-generated files:

- `.pi-extensions/job-history.yaml`
- `.pi-extensions/dashboard-runs.yaml`

## Dashboard connector model

The dashboard normalizes items from multiple systems into a shared `DashboardItem` shape. Each connector is responsible for:

1. Reading credentials from environment variables.
2. Fetching data from the external API.
3. Normalizing each item into the shared model.
4. Applying post-fetch filters (labels, assignees, statuses, item types).

Connectors fail independently. If one source errors, the remaining sources still load and an error message is logged to stderr.

### Connector inventory

| Connector | Implementation | Auth method | API |
|-----------|---------------|-------------|-----|
| GitHub | `fetchGitHubIssues`, `fetchGitHubDiscussions` | Bearer token | REST v3 + GraphQL |
| Jira | `fetchJiraIssues` | Basic auth (email + API token) | REST API v3 `/search/jql` |
| AHA | `fetchAhaFeatures` | Bearer token | API v1 `/products/{product}/features` |

### Item type mapping

| Source | `itemType` |
|--------|-----------|
| GitHub issue | `issue` |
| GitHub discussion | `discussion` |
| Jira issue | `issue` |
| AHA feature | `feature` |

## Extension points

- Add a new dashboard connector by implementing a `fetch*` function in `src/shared/dashboard.ts`, normalizing items into `DashboardItem`, and registering it in `loadDashboardItems`. Add validation in `src/shared/config-schema.ts`.
- Add a new workflow step type by extending the step runner map in the workflow engine.
- Add a new gate by extending the built-in gate evaluator registry.
- Add a new knowledge heuristic by updating `collectKnowledgeSignals`.
- Add a new scheduler target by extending `executeJobTarget`.
