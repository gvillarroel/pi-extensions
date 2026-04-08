# Dashboard Extension

Related docs:

- [README.md](./README.md)
- [architecture.md](./architecture.md)
- [long-term-roadmap.md](./long-term-roadmap.md)

The dashboard extension turns Pi into a work triage surface. It loads items from external systems, presents them in a navigable interface, and lets you run workflows against selected items without leaving the agent session.

Entry point: `extensions/dashboard.ts`

## Overview

The dashboard connects to three external systems:

| Source | Item type | API used |
|--------|-----------|----------|
| **GitHub** | Issues and Discussions | REST v3 + GraphQL |
| **Jira** | Issues | REST API v3 (`/search/jql`) |
| **AHA** | Features | API v1 (`/products/{product}/features`) |

All items are normalized into the same `DashboardItem` shape so the UI, filters, workflow launcher, and run history work identically regardless of origin.

## Getting Started

### 1. Load the extension

Add the dashboard to your `package.json`:

```json
{
  "pi": {
    "extensions": [
      "./extensions/dashboard.ts"
    ]
  }
}
```

Or load it directly:

```bash
pi --extension ./extensions/dashboard.ts
```

### 2. Create the configuration file

Create `dashboard.sources.yaml` at the root of your repository (or globally under `~/.pi-extensions/`):

```yaml
sources:
  - id: my-github
    type: github
    enabled: true
    owner: my-org
    repositories:
      - my-repo
    issueState: open
```

### 3. Set the required environment variables

Each connector reads credentials from environment variables. Set them before starting Pi:

```bash
# GitHub
export GITHUB_TOKEN="ghp_..."

# Jira
export JIRA_USERNAME="user@company.com"
export JIRA_TOKEN="your-jira-api-token"

# AHA
export AHA_TOKEN="your-aha-api-token"
```

### 4. Use the commands

Once Pi starts, the dashboard auto-loads in interactive mode. You can also trigger it manually:

```
/dashboard              # List all items from all configured sources
/dashboard_panel        # Open the interactive TUI workspace
/dashboard_run <wf> <id>  # Run a workflow against a specific item
```

## Commands

### `/dashboard`

Fetches items from all enabled sources and prints them as a flat list. In interactive mode it also updates the above-editor widget.

Output per item:

```
[source-id] issue my-repo#42 Fix login timeout (In Progress) https://...
```

### `/dashboard_panel`

Opens a full interactive workspace with four blocks:

| Block | Location | Purpose |
|-------|----------|---------|
| **Items** | Left | Paginated list of item IDs in the active context |
| **Detail** | Center | Title, status, assignees, body, metadata for the selected item |
| **Workflows** | Right | Available workflows for the selected item |
| **Controls** | Bottom | Context tabs, keybinding hints |

#### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Tab` or `→` | Move focus to next block |
| `Shift+Tab` or `←` | Move focus to previous block |
| `[` or `Ctrl+←` | Switch to previous context (e.g. GH Issues → Jira) |
| `]` or `Ctrl+→` | Switch to next context |
| `↑` / `↓` | Navigate items, detail scroll, or workflow list |
| `PageUp` / `PageDown` | Page through long lists |
| `Enter` | Run the selected workflow (from the Workflows block) |
| `Escape` | Close the panel |

#### Context lanes

The panel groups items into four fixed context tabs:

1. **GH Issues** — GitHub issues
2. **GH Discs** — GitHub discussions
3. **Jira** — Jira issues
4. **Aha** — AHA features

Switch between them with `[` and `]`. Empty contexts show "No items".

### `/dashboard_run <workflowId> <itemId> [custom prompt]`

Runs a specific workflow against an item without opening the panel. Useful for scripted or non-interactive usage.

```
/dashboard_run quick-triage 42
/dashboard_run quick-triage PROJ-101 "Focus on performance impact"
```

The optional trailing text is passed as `{{customPrompt}}` to workflow templates.

### `dashboard_list_items` (tool)

The extension also registers a tool callable by the AI agent:

```
Tool: dashboard_list_items
Description: List dashboard items from configured sources.
```

This allows the agent to query the dashboard programmatically during a conversation.

## Source Configuration

All sources are defined in `dashboard.sources.yaml` under a top-level `sources` array. Every source must have at least `id` and `type`.

### GitHub

Fetches issues and optionally discussions from one or more repositories.

```yaml
sources:
  - id: github-core
    type: github
    enabled: true
    owner: openai
    repositories:
      - openai-node
      - openai-python
    includeDiscussions: true
    issueState: open           # open | closed | all
    tokenEnvVar: GITHUB_TOKEN  # defaults to GITHUB_TOKEN
```

**Required fields:**

| Field | Description |
|-------|-------------|
| `owner` | GitHub organization or user |
| `repositories` | List of repository names |

**Optional fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `includeDiscussions` | `false` | Also fetch discussions via GraphQL |
| `issueState` | `open` | Filter issues by state |
| `tokenEnvVar` | `GITHUB_TOKEN` | Environment variable holding the personal access token |

**Authentication:** Requires a GitHub personal access token with `repo` scope. For discussions, the token also needs `read:discussion`.

### Jira

Fetches issues from Jira Cloud using the REST API v3.

```yaml
sources:
  - id: jira-engineering
    type: jira
    enabled: true
    baseUrl: https://mycompany.atlassian.net
    project: ENG
    maxResults: 50
```

**Required fields:**

| Field | Description |
|-------|-------------|
| `baseUrl` | Jira Cloud instance URL (e.g. `https://mycompany.atlassian.net`) |
| `project` or `jql` | Either a project key for auto-generated JQL, or an explicit JQL string |

**Optional fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `jql` | — | Explicit JQL query. Overrides auto-generated query from `project` |
| `project` | — | Jira project key. Used to build `project = X ORDER BY updated DESC` |
| `usernameEnvVar` | `JIRA_USERNAME` | Environment variable holding the Jira email |
| `tokenEnvVar` | `JIRA_TOKEN` | Environment variable holding the Jira API token |
| `maxResults` | `100` | Maximum issues per API page |

**Authentication:** Uses HTTP Basic auth with email + API token. Generate a token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).

**JQL examples:**

```yaml
# Simple project query (auto-generated)
project: ENG

# Explicit JQL for full control
jql: "project = ENG AND status != Done AND assignee = currentUser() ORDER BY priority DESC"

# Multiple projects
jql: "project in (ENG, PLATFORM) AND updated >= -7d"
```

**Normalized labels:** Jira items include synthetic labels prefixed with `type:` and `priority:` so you can filter them in the dashboard:

- `type:Bug`, `type:Task`, `type:Story`
- `priority:High`, `priority:Medium`, `priority:Low`
- Plus any native Jira labels from the issue

### AHA

Fetches features from an AHA product workspace using the API v1.

```yaml
sources:
  - id: aha-product
    type: aha
    enabled: true
    subdomain: acme
    product: ACME
    maxResults: 100
```

**Required fields:**

| Field | Description |
|-------|-------------|
| `subdomain` | Your AHA subdomain (the `acme` part of `acme.aha.io`) |
| `product` | AHA product key or ID |

**Optional fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `tokenEnvVar` | `AHA_TOKEN` | Environment variable holding the AHA API key |
| `maxResults` | `100` | Maximum features per request |

**Authentication:** Uses Bearer token auth. Generate an API key from your AHA account settings under **Settings → Personal → Developer → API key**.

**Item mapping:**

| AHA field | Dashboard field |
|-----------|----------------|
| `reference_num` | `id` |
| `name` | `title` |
| `workflow_status.name` | `status` |
| `assigned_to_user.name` | `assignees` |
| `tags` | `labels` |
| `updated_at` | `updatedAt` |

All AHA items appear with `itemType: "feature"`.

## Common Source Options

These fields work on all source types:

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Set to `false` to skip this source. Default: `true` |
| `labels` | `string[]` | Only keep items that have at least one of these labels |
| `assignees` | `string[]` | Only keep items assigned to at least one of these people |
| `statuses` | `string[]` | Only keep items with one of these statuses |
| `itemTypes` | `string[]` | Only keep items of these types: `issue`, `discussion`, `feature` |
| `defaultWorkflowId` | `string` | Workflow shown first in the panel for items from this source |
| `allowedWorkflowIds` | `string[]` | Restrict the workflow list to only these IDs |

Filters are applied **after** fetching from the API. They are AND-combined: an item must pass all specified filters.

## Workflows

Workflows are defined in `workflows.yaml` and can be launched from the dashboard panel or via `/dashboard_run`.

### Minimal workflow

```yaml
workflows:
  - id: quick-triage
    label: Quick Triage
    steps:
      - id: summarize
        type: note
        message: |
          Review {{item.title}} from {{item.repositoryOrBoard}}.
          Status: {{item.status}}
          URL: {{item.url}}
```

### Workflow with gates and scripts

```yaml
workflows:
  - id: full-review
    label: Full Review
    gates:
      - requiredContextFields:
          - item.id
          - item.title
    preHooks:
      - name: announce
        run: echo "Starting review for {{item.id}}"
    steps:
      - id: check-status
        type: script
        run: echo "Status is {{item.status}}"
      - id: review-note
        type: note
        message: |
          Prepare a review for {{item.title}}.
          Custom context: {{customPrompt}}
    postHooks:
      - name: cleanup
        run: echo "Review completed"
```

### Bash-only shorthand

```yaml
bashWorkflows:
  - id: quick-check
    label: Quick Check
    bash:
      - echo "Checking {{item.id}}"
      - echo "Title: {{item.title}}"
```

### Available template variables

When a workflow runs from the dashboard, these variables are available in `{{...}}` templates:

| Variable | Description |
|----------|-------------|
| `{{item.id}}` | Item ID (e.g. `42`, `PROJ-101`, `ACME-F-1`) |
| `{{item.title}}` | Item title |
| `{{item.status}}` | Current status |
| `{{item.url}}` | Web URL to the item |
| `{{item.source}}` | Source ID from the config |
| `{{item.repositoryOrBoard}}` | Repository name or project key |
| `{{item.labels}}` | Comma-separated labels |
| `{{item.assignees}}` | Comma-separated assignees |
| `{{item.itemType}}` | `issue`, `discussion`, or `feature` |
| `{{customPrompt}}` | Optional free-text prompt entered by the operator |

### Source-specific workflow control

You can restrict which workflows appear for items from a specific source:

```yaml
# dashboard.sources.yaml
sources:
  - id: jira-eng
    type: jira
    baseUrl: https://mycompany.atlassian.net
    project: ENG
    defaultWorkflowId: jira-triage        # shown first
    allowedWorkflowIds:                   # only these are shown
      - jira-triage
      - jira-escalate
```

If `allowedWorkflowIds` is not set, all workflows from `workflows.yaml` are available.

## Run History

Every workflow execution from the dashboard is recorded in `.pi-extensions/dashboard-runs.yaml`:

```yaml
version: 1
updatedAt: "2026-03-25T14:30:00.000Z"
entries:
  - itemId: "PROJ-101"
    workflowId: "jira-triage"
    status: "passed"
    endedAt: "2026-03-25T14:30:00.000Z"
    summary: "Workflow result: passed"
```

The latest run for each item is shown in:

- The `/dashboard` list output
- The detail view in `/dashboard_panel`
- The above-editor widget

History is bounded to the last 200 entries.

## Error Handling

Connectors fail independently. If one source returns an error (network failure, auth issue, API rate limit), the other sources still load and display normally. Errors are logged to stderr:

```
Dashboard source errors:
  [jira-broken] Jira request failed (401): Unauthorized
```

When credentials are missing entirely (environment variable not set or empty), the connector returns zero items silently — no error is thrown. This makes it safe to define sources in a shared config even if not all team members have credentials for every system.

## Configuration Precedence

The dashboard reads `dashboard.sources.yaml` from two locations:

1. **Global:** `~/.pi-extensions/dashboard.sources.yaml`
2. **Local:** `./dashboard.sources.yaml` (repository root)

Local values override global ones. Objects are deep-merged; arrays (like `sources`) are replaced entirely by the local file.

## Interactive Widget

In interactive Pi mode, the dashboard automatically loads on session start and renders a compact widget above the editor:

```
 Dashboard
I openai-node#42 Fix login timeout
I openai-node#55 Add retry logic  jira-triage:passed
D openai-node#7 Release cadence
F ACME#ACME-F-1 Dark mode support
Use /dashboard_panel for navigation
```

Item type indicators:

- `I` = Issue (GitHub or Jira)
- `D` = Discussion (GitHub)
- `F` = Feature (AHA)

The widget shows the last 6 items. Use `/dashboard_panel` for full navigation.

## Complete Example

Here is a full working setup with all three connectors and two workflows:

### `dashboard.sources.yaml`

```yaml
sources:
  - id: github-core
    type: github
    enabled: true
    owner: my-org
    repositories:
      - backend
      - frontend
    includeDiscussions: true
    issueState: open
    defaultWorkflowId: quick-triage

  - id: jira-engineering
    type: jira
    enabled: true
    baseUrl: https://mycompany.atlassian.net
    project: ENG
    statuses:
      - In Progress
      - To Do
    maxResults: 50
    defaultWorkflowId: jira-triage

  - id: aha-roadmap
    type: aha
    enabled: true
    subdomain: mycompany
    product: ROADMAP
    statuses:
      - Under consideration
      - In development
    defaultWorkflowId: feature-review
```

### `workflows.yaml`

```yaml
workflows:
  - id: quick-triage
    label: Quick Triage
    gates:
      - requiredContextFields:
          - item.title
    steps:
      - id: summarize
        type: note
        message: |
          Triage {{item.title}} ({{item.status}}).
          Source: {{item.source}}
          URL: {{item.url}}
          Operator notes: {{customPrompt}}

  - id: jira-triage
    label: Jira Triage
    steps:
      - id: check-priority
        type: script
        run: echo "Issue {{item.id}} labels are {{item.labels}}"
      - id: review
        type: note
        message: |
          Review Jira issue {{item.id}}: {{item.title}}
          Current status: {{item.status}}

  - id: feature-review
    label: Feature Review
    steps:
      - id: review-feature
        type: note
        message: |
          Review AHA feature {{item.id}}: {{item.title}}
          Status: {{item.status}}
          Assigned to: {{item.assignees}}
```

### Environment variables

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
export JIRA_USERNAME="engineer@company.com"
export JIRA_TOKEN="xxxxxxxxxxxxxxxxxxxxxxxx"
export AHA_TOKEN="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Run it

```bash
pi --extension ./extensions/dashboard.ts
```

Then inside Pi:

```
/dashboard               # See all items from all three sources
/dashboard_panel         # Open the interactive workspace
/dashboard_run quick-triage 42 "Check if this blocks the release"
/dashboard_run jira-triage PROJ-101
/dashboard_run feature-review ACME-F-1
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| No items from Jira | Missing `JIRA_USERNAME` or `JIRA_TOKEN` | Set both env vars |
| No items from AHA | Missing `AHA_TOKEN` | Set the env var |
| No items from GitHub | Missing `GITHUB_TOKEN` or wrong owner/repo | Verify token and config |
| "Dashboard source errors" in stderr | API returned an error | Check the status code in the message: 401=auth, 403=permissions, 404=wrong URL |
| Items show but no workflows | No `workflows.yaml` or wrong IDs in `allowedWorkflowIds` | Check that workflow IDs match |
| `/dashboard_panel` error | Running in non-interactive mode (`-p`) | Panel requires interactive TUI mode |
| Jira JQL errors | Invalid project key or JQL syntax | Test the JQL in Jira's issue search first |
