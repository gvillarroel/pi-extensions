# Architecture Overview

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
- `workflows.yaml`
- `gates.yaml`
- `jobs.yaml`

Runtime-generated files:

- `.pi-extensions/job-history.yaml`
- `.pi-extensions/dashboard-runs.yaml`

## Extension points

- Add a new dashboard connector by implementing the dashboard source contract and registering it in the dashboard extension.
- Add a new workflow step type by extending the step runner map in the workflow engine.
- Add a new gate by extending the built-in gate evaluator registry.
- Add a new knowledge heuristic by updating `collectKnowledgeSignals`.
- Add a new scheduler target by extending `executeJobTarget`.
