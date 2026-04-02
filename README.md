# pi-extensions

`pi-extensions` is a private collection of extensions for [pi](https://github.com/nicholasgasior/pi-coding-agent). Its goal is to make Pi more useful for real operational work: triaging incoming work, running repeatable workflows, scanning knowledge bases for gaps, and capturing runtime state for debugging.

If you use Pi as an agent inside a repository, this package gives you a lightweight automation layer driven by YAML instead of custom code.

## Purpose

This repository exists to solve three practical problems:

1. Turn incoming items such as GitHub issues and discussions into a dashboard Pi can inspect and act on.
2. Define reusable workflows and scheduled jobs without hardcoding logic into each extension.
3. Help maintainers improve project knowledge and debug Pi integrations with explicit, inspectable tooling.

## What It Does

The package ships four extensions:

| Extension | What it does | Main commands |
|-----------|--------------|---------------|
| **Dashboard** | Loads work items from configured sources and lets Pi inspect or run workflows against them. | `/dashboard`, `/dashboard_panel`, `/dashboard_run` |
| **Job Scheduler** | Defines cron-based jobs and records execution history. | `/jobs`, `/job_run`, `/job_history` |
| **Knowledge Distiller** | Scans markdown knowledge files for unclear concepts and writes clarifications. | `/knowledge_scan`, `/knowledge_write` |
| **State Capture Reporter** | Logs Pi lifecycle events so extension behavior can be debugged. | `/captured_states` |

Under the hood, these extensions share the same building blocks:

- YAML configuration with global defaults and repo-local overrides
- A workflow engine with gates, hooks, note steps, and script steps
- Persisted run history for dashboard workflows and scheduled jobs
- Small shared utilities that can also be imported programmatically from [`src/index.ts`](/C:/Users/villa/dev/pi-extensions/src/index.ts)

## How To Use It

### 1. Install dependencies

```bash
npm install
```

This package is private and intended to be used from the repository, not published to npm.

### 2. Register the extensions in Pi

The simplest option is to keep the extension list in `package.json`:

```json
{
  "pi": {
    "extensions": [
      "./extensions/dashboard.ts",
      "./extensions/knowledge-distiller.ts",
      "./extensions/job-scheduler.ts",
      "./extensions/state-capture-reporter.ts"
    ]
  }
}
```

You can also load one extension explicitly:

```bash
pi --extension ./extensions/dashboard.ts
```

### 3. Add the YAML files you need

The extensions read configuration from two places:

1. Global defaults in `~/.pi-extensions/`
2. Local files in the current repository

Local files override global ones. Objects are deep-merged; arrays are replaced.

Supported configuration files:

- `dashboard.sources.yaml`
- `workflows.yaml`
- `gates.yaml`
- `jobs.yaml`

Generated runtime files:

- `.pi-extensions/dashboard-runs.yaml`
- `.pi-extensions/job-history.yaml`

## Quick Start

If your main use case is triage, this is the minimum useful setup.

### `dashboard.sources.yaml`

```yaml
sources:
  - id: github-core
    type: github
    enabled: true
    owner: openai
    repositories:
      - openai-python
    includeDiscussions: true
    issueState: open
    itemTypes:
      - issue
      - discussion
    tokenEnvVar: GITHUB_TOKEN
    defaultWorkflowId: github-triage
    allowedWorkflowIds:
      - github-triage
```

### `workflows.yaml`

```yaml
workflows:
  - id: github-triage
    label: GitHub Triage
    gates:
      - requiredContextFields:
          - item.title
          - item.url
    steps:
      - id: summarize-item
        type: note
        message: Summarize the issue and identify the next owner.
      - id: validate-metadata
        type: script
        run: echo Metadata available for {{item.id}}
```

### Run it in Pi

Once the extension is loaded:

- Use `/dashboard` to fetch and list items from configured sources.
- Use `/dashboard_panel` to open the interactive TUI panel and select an item plus workflow.
- Use `/dashboard_run <workflowId> <itemId>` to execute a workflow directly.

That is the core loop of this repository: load external work, choose a workflow, run it, and persist the outcome.

## Configuration Guide

### Dashboard

`dashboard.sources.yaml` defines the external systems Pi should read from. The dashboard supports three connector types:

#### GitHub

Fetches issues and discussions from GitHub repositories using the REST and GraphQL APIs.

```yaml
sources:
  - id: github-core
    type: github
    owner: openai
    repositories: [openai-node]
    includeDiscussions: true
    issueState: open
    tokenEnvVar: GITHUB_TOKEN
```

#### Jira

Fetches issues from Jira Cloud using the REST API v3. Requires `JIRA_USERNAME` and `JIRA_TOKEN` environment variables (configurable via `usernameEnvVar` and `tokenEnvVar`).

```yaml
sources:
  - id: jira-eng
    type: jira
    baseUrl: https://mycompany.atlassian.net
    project: ENG
    statuses: [In Progress, To Do]
    maxResults: 50
```

You can provide an explicit `jql` field instead of `project` for full control over the query.

#### AHA

Fetches features from an AHA workspace using the API v1. Requires the `AHA_TOKEN` environment variable (configurable via `tokenEnvVar`).

```yaml
sources:
  - id: aha-product
    type: aha
    subdomain: acme
    product: ACME
    maxResults: 100
```

#### Common source options

All source types support:

- `enabled` to toggle a source on or off
- `labels`, `assignees`, `statuses` for post-fetch filtering
- `itemTypes` to filter by item kind (`issue`, `discussion`, `feature`)
- `defaultWorkflowId` and `allowedWorkflowIds` for workflow selection
- `tokenEnvVar` to customize the environment variable holding the API token

Connectors fail independently: if one source errors, the remaining sources still load and an error is logged.

See [`examples/dashboard.sources.yaml`](/C:/Users/villa/dev/pi-extensions/examples/dashboard.sources.yaml) for a working sample.

### Workflows

`workflows.yaml` defines reusable automation units shared by dashboard actions and scheduled jobs.

A workflow can include:

- gates that must pass before execution
- pre-hooks and post-hooks
- `note` steps for operator guidance
- `script` steps for shell execution
- a `bashWorkflows` shorthand for simple bash-only sequences

See [`examples/workflows.yaml`](/C:/Users/villa/dev/pi-extensions/examples/workflows.yaml).

### Gates

`gates.yaml` holds reusable validation rules, typically to guarantee that required context exists before a workflow writes output or performs side effects.

See [`examples/gates.yaml`](/C:/Users/villa/dev/pi-extensions/examples/gates.yaml).

### Jobs

`jobs.yaml` schedules recurring work using cron expressions in UTC.

A job can:

- execute an inline script
- execute a named workflow
- define concurrency behavior
- persist run history and status summaries

See [`examples/jobs.yaml`](/C:/Users/villa/dev/pi-extensions/examples/jobs.yaml).

## Common Flows

### Triage GitHub work

1. Configure `dashboard.sources.yaml`
2. Define one or more workflows in `workflows.yaml`
3. Run `/dashboard` or `/dashboard_panel`
4. Execute a workflow for a selected item
5. Review persisted results in `.pi-extensions/dashboard-runs.yaml`

### Run recurring automation

1. Define jobs in `jobs.yaml`
2. Check upcoming runs with `/jobs`
3. Execute one immediately with `/job_run <jobId>`
4. Inspect history with `/job_history`

### Improve project knowledge

1. Store markdown knowledge under `~/.knowledge` or `./knowledge`
2. Run `/knowledge_scan`
3. Add a clarification with `/knowledge_write <title> <targetFile> [content...]`

### Debug Pi extension behavior

Load the state capture extension and run `/captured_states` after interacting with Pi. It logs registered lifecycle events and which ones have already been observed in the current session.

## Development

```bash
npm run build
npm test
npm run check
npm run verify:sdk
npm run verify:cli
```

The codebase is organized into extension entry points under `extensions/` and shared logic under `src/shared/`. A higher-level design summary is available in [`docs/architecture.md`](/C:/Users/villa/dev/pi-extensions/docs/architecture.md).

## License

Private repository. Not published to npm.
