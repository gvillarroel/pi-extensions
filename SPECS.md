# Pi Extensions Specs

This document is the product and repository source of truth for the `pi-extensions` workspace.
It defines what the project is, what is in scope, how it is organized, and what quality bar every change must meet.

## 1. Product definition

`pi-extensions` is a TypeScript workspace that packages a small suite of Pi extensions for recurring engineering workflows.

The suite currently targets three primary capabilities:

- dashboard-driven work triage and workflow launching
- markdown knowledge distillation and clarification
- recurring job scheduling and execution

A fourth extension, `state-capture-reporter`, is kept as a utility and compatibility artifact from earlier repository work.

## 2. Product goals

The repository must make it easy to:

- load local Pi extensions directly from source
- define behavior through YAML instead of hidden code paths
- reuse shared logic across extensions without coupling feature code together
- validate behavior through tests and executable Pi verification flows
- extend the suite with new connectors, gates, workflows, and job targets

## 3. Non-goals

The repository is not trying to be:

- a generic plugin marketplace
- a UI-heavy frontend application outside Pi
- a framework with deep abstraction layers
- a connector collection with weak validation or unclear ownership

When there is a tradeoff, explicitness and maintainability win over cleverness.

## 4. Core rules

- Configuration is YAML-first.
- Documentation, comments, examples, and user-visible text are in English.
- Each extension owns one main entry file under `extensions/`.
- Shared logic lives in `src/shared/`.
- Future extension seams must stay visible and easy to modify.
- Every meaningful feature change must include tests and an executable verification path.

## 5. Current feature inventory

### Dashboard extension

Entry point: `extensions/dashboard.ts`

Current responsibilities:

- load dashboard sources from YAML
- fetch and normalize GitHub work items
- filter by labels, assignees, statuses, and item types
- render dashboard views in command and interactive panel flows
- launch configured workflows against selected items
- persist workflow summaries under `.pi-extensions/dashboard-runs.yaml`

### Knowledge distiller extension

Entry point: `extensions/knowledge-distiller.ts`

Current responsibilities:

- scan markdown knowledge folders
- identify ambiguous or incomplete concepts
- write clarification content to explicit targets
- preserve conservative write behavior

### Job scheduler extension

Entry point: `extensions/job-scheduler.ts`

Current responsibilities:

- load jobs from YAML
- evaluate cron schedules
- run script-backed and workflow-backed jobs
- persist bounded run history under `.pi-extensions/job-history.yaml`
- render job and history views

### State capture reporter

Entry point: `extensions/state-capture-reporter.ts`

Current responsibilities:

- provide the original event/state discovery utility kept in the workspace

## 6. Repository organization

The repository is organized by role, not by technical layer explosion.

- `extensions/`
  Main Pi extension entrypoints. Keep these readable and close to product behavior.
- `src/shared/`
  Shared contracts, config loading, YAML utilities, workflow execution, scheduler helpers, dashboard helpers, and path logic.
- `tests/`
  Fast automated validation for core behavior.
- `scripts/`
  Executable verification harnesses for Pi SDK and CLI loading.
- `examples/`
  Example YAML and markdown fixtures that describe expected user-facing configuration.
- `docs/`
  Supporting architecture, roadmap, and progress history.
- `.pi-extensions/`
  Runtime-generated local state inside a workspace context when extensions execute.

## 7. Documentation hierarchy

The project documentation should be read in this order:

1. `README.md`
   Short orientation, setup, commands, and repository map.
2. `SPECS.md`
   Product scope, architecture boundaries, organization rules, and definition of done.
3. `docs/dashboard.md`
   Complete dashboard extension guide: connectors, configuration, commands, workflows, and troubleshooting.
4. `docs/architecture.md`
   Shared execution model, config precedence, and extension points.
4. `docs/long-term-roadmap.md`
   Sequencing, planned phases, known limitations, and next slices.
5. `docs/progress.log`
   Historical implementation notes and completed validation slices.

## 8. Configuration and runtime contracts

Supported configuration files:

- `dashboard.sources.yaml`
- `workflows.yaml`
- `gates.yaml`
- `jobs.yaml`

`workflows.yaml` supports two authoring modes:

- full `workflows` definitions for gates, hooks, notes, scripts, and parallel steps
- minimal `bashWorkflows` definitions for sequential bash-only automation

Precedence rules:

- global defaults load from the user's home directory under `.pi-extensions/`
- repository-local files override global files with the same name

Runtime-generated files:

- `.pi-extensions/job-history.yaml`
- `.pi-extensions/dashboard-runs.yaml`

## 9. Architecture constraints

- Shared helpers must stay extension-agnostic.
- Extension entrypoints may compose shared helpers but should not duplicate platform logic.
- New connectors or job targets must plug into existing contracts before inventing new execution paths.
- Persistent artifacts must use stable, documented YAML structures.
- Error reporting should favor actionable diagnostics with file and field context.

## 10. Quality bar

Every completed slice should include all of the following:

- implementation
- example configuration when behavior is config-driven
- English documentation
- automated tests
- executable verification through `npm run verify` or an equivalent covered path
- updated roadmap or specs when scope or contracts changed

## 11. Immediate organization policy

When organizing this repository going forward:

- do not create new top-level folders unless a new repository role appears
- keep feature-specific logic out of `src/shared/` unless reused by at least one extension or clearly part of the shared platform
- prefer adding docs to existing canonical files instead of scattering new planning documents
- treat `SPECS.md` as the primary source for project scope and repository rules

## 12. Next structural improvements

These are the next structural improvements worth making, in order:

1. Split oversized extension entrypoints when a single file starts mixing UI rendering, command parsing, and domain behavior.
2. Add fixture builders under `tests/` or `scripts/` when duplication starts slowing changes down.
3. Introduce connector-specific shared modules only when Jira or AHA implementation creates real duplication.
4. Keep the runtime state format documented whenever a persisted file changes.
