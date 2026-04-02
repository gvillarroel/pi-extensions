# Long-Term Implementation and Verification Roadmap

This document is the operating plan for evolving this repository without needing a fresh product prompt.
It is intentionally explicit about outcomes, sequencing, validation, and exit criteria so future work can continue from here directly.

## 1. Mission and non-negotiable rules

### Mission

Build a maintainable Pi extension suite that:

- aggregates engineering work into one dashboard
- distills markdown knowledge into clearer, reusable documentation
- schedules recurring scripts and workflows from a Pi-friendly UI

### Non-negotiable rules

- Configuration uses YAML whenever Pi does not force another format.
- Documentation, comments, examples, and user-facing strings are in English.
- Simpler implementations beat ambitious but fragile abstractions.
- Reuse from other extensions is encouraged, but every reuse must be documented:
  - what was reused
  - why it was reused
  - how to replace or extend it
- Code must expose explicit extension seams with comments such as `Next expected extension point:`.
- Every phase must include automated validation and at least one executable verification path using either:
  - the `pi` CLI directly
  - the Pi SDK

## 2. Current baseline as of 2026-03-18

### Implemented foundation

- Shared YAML loading and precedence logic
- Shared config validation with actionable file-and-field diagnostics
- Shared workflow engine with:
  - gates
  - hooks
  - sequential steps
  - parallel steps
- GitHub-backed dashboard data loading
- GitHub-backed dashboard filtering and workflow run summaries
- Markdown knowledge scanning and clarification writing
- Cron-based job scheduling, immediate job execution, and persisted job history
- TypeScript build and Vitest test suite

### Implemented extension entrypoints

- `extensions/dashboard.ts`
- `extensions/knowledge-distiller.ts`
- `extensions/job-scheduler.ts`
- `extensions/state-capture-reporter.ts`

### Existing verification assets

- Unit and behavioral tests in `tests/`
- SDK verification harness in `scripts/verify-sdk.mjs`
- CLI verification harness in `scripts/verify-cli.mjs`

### Spike results already confirmed

- The `pi` CLI can load local TypeScript extensions and execute slash commands in non-interactive mode.
- The Pi SDK can load the same extension files with `DefaultResourceLoader` and `createAgentSession`.
- The following scenarios have working executable verification paths in this repository:
  - state capture extension through CLI
  - state capture extension through SDK
  - dashboard slash command through SDK with mocked GitHub fetch
  - dashboard workflow launch through SDK with mocked GitHub fetch
  - dashboard run summaries rendered through SDK after workflow execution
  - knowledge scan slash command through SDK
  - knowledge write slash command through SDK
  - job execution slash command through SDK
  - persisted job history rendering through SDK
  - knowledge scan through CLI in a temporary workspace
  - job execution and persisted history rendering through CLI in a temporary workspace
  - malformed scheduler config diagnostics through CLI in a temporary workspace

## 3. Operating model for all future work

Every future implementation cycle must follow this order:

1. Update this roadmap if the intent, scope, or sequencing changed.
2. Add or update YAML examples that describe the new behavior.
3. Implement the smallest stable slice of behavior.
4. Add unit or behavioral tests first.
5. Add at least one executable verification path using CLI or SDK.
6. Run `npm run check`.
7. Run `npm run verify`.
8. Record remaining limitations in this document before moving on.

Work is not complete if behavior exists but no verification path proves it.

## 4. Long-term phases

## Phase A: Harden the shared platform

### Goal

Turn the current foundation into a stable platform for multiple extensions and future contributors.

### Tasks

- Strengthen YAML merge semantics:
  - add deep-merge support where shallow merge is insufficient
  - define replacement vs merge rules per top-level key
- Add schema validation for:
  - `dashboard.sources.yaml`
  - `workflows.yaml`
  - `gates.yaml`
  - `jobs.yaml`
- Add durable execution logs for workflows and jobs
- Add stable error objects instead of free-form error strings where it improves diagnostics
- Add reusable file-safe write utilities for knowledge updates and future dashboard actions
- Add fixture builders to reduce duplication across tests and verification scripts
- Add a repo-local `.pi/` sample setup for easier manual smoke testing

### Acceptance criteria

- Invalid YAML reports actionable errors with file path and failing field
- Workflow and scheduler results have stable machine-readable fields
- Shared helpers remain readable and do not leak extension-specific behavior
- `npm run check` and `npm run verify` pass cleanly

### Verification

- Expand Vitest coverage for invalid config and merge precedence
- Add one CLI smoke test that intentionally fails on malformed YAML and confirms readable diagnostics

## Phase B: Dashboard MVP to production-grade dashboard

### Goal

Evolve the current GitHub-only dashboard into the primary triage and workflow-launch surface.

### Tasks

#### B1. Stabilize GitHub support

- Add explicit source-level rate limit handling
- Differentiate issue and discussion item types in the normalized model
- Add dashboard filters:
  - repository
  - status
  - labels
  - assignee
- Add recent workflow execution summaries beside items
- Add workflow selection metadata:
  - default workflow per source
  - allowed workflows per source

#### B2. Add Jira

- Define Jira connector YAML contract
- Implement query execution from configured JQL
- Normalize Jira issues into the shared item model
- Preserve source-specific metadata in `rawMetadata`
- Add tests for pagination, auth errors, and empty query results

#### B3. Add AHA

- Define AHA connector YAML contract
- Implement project filtering and status filtering
- Normalize AHA items into the shared item model
- Add tests for auth, empty results, and field mapping drift

#### B4. Workflow orchestration from dashboard

- Add workflow launch history
- Add gate and hook results to dashboard views
- Add approval-oriented gates for risky workflows
- Add optional parallel branches for selected workflow families
- Add source-specific workflow presets

### Acceptance criteria

- A dashboard item from any supported source can be listed, opened, and used as workflow context
- Source connectors fail independently and do not break the whole dashboard
- Workflow runs keep stable status output that can be surfaced in the dashboard
- GitHub, Jira, and AHA all have source-specific fixtures and normalization tests

### Verification

- Unit tests for each connector normalization path
- SDK verification for dashboard command with mocked GitHub, Jira, and AHA responses
- CLI smoke test for dashboard command in a temporary fixture workspace
- Manual Pi check:
  - run `/dashboard`
  - inspect listed items
  - launch a workflow from a selected item
  - confirm gate and step results render correctly

## Phase C: Knowledge distillation system

### Goal

Turn markdown knowledge folders into a governed clarification pipeline instead of a passive archive.

### Tasks

#### C1. Improve discovery and ambiguity detection

- Add richer heuristics:
  - missing examples
  - missing boundaries
  - missing owners
  - broken related concept links
- Distinguish concept files from notes or logs using frontmatter conventions
- Add ranking for ambiguity severity

#### C2. Structured clarification workflows

- Add YAML-defined knowledge workflows
- Support separate roles:
  - scanner
  - boundary reviewer
  - writer
  - consistency reviewer
- Add parallel scanning with serialized writes per target file

#### C3. Controlled write-back

- Add section-targeted updates
- Add append-only mode
- Add replace-explicit-section mode
- Preserve frontmatter and unrelated sections
- Emit a summary artifact for each write

#### C4. Knowledge governance

- Add document status lifecycle
- Add required frontmatter fields for curated knowledge
- Add periodic “unclear concept” review job integration with the scheduler

### Acceptance criteria

- The extension can identify unclear concepts from both `$HOME/.knowledge` and `./knowledge`
- It can write clarified content into an explicit target without damaging unrelated content
- It can explain why a concept was flagged
- The ambiguity report is deterministic for the same input corpus

### Verification

- Vitest coverage for signal extraction, ranking, and write preservation
- SDK verification for `/knowledge_scan` and `/knowledge_write`
- CLI smoke test in a temporary workspace with knowledge fixtures
- Manual Pi check:
  - run `/knowledge_scan`
  - confirm candidate list appears
  - select or specify one concept
  - write a clarification
  - inspect final markdown result

## Phase D: Scheduler and jobs UI

### Goal

Replace ad hoc cron usage with an inspectable scheduler model inside the Pi extension ecosystem.

### Tasks

#### D1. Stabilize current scheduler

- Add persistent run history
- Add retry and timeout handling in execution results
- Add overlap prevention reporting
- Add disabled job and skipped job visibility

#### D2. Add workflow-backed jobs

- Support launching existing YAML workflows as jobs
- Surface gate failures and workflow failures in job history
- Add job-level default context values

#### D3. Add UI-focused job management

- Improve the `/jobs` rendering for readability
- Add filtering by enabled state and failure state
- Add recent run summaries
- Add command support for:
  - enable
  - disable
  - trigger now
  - inspect history

#### D4. Expand beyond scripts

- Add assistant-targeted jobs only after local script jobs are stable
- Add calendar-aware triggers only after cron semantics are stable
- Evaluate whether Claude-style loop patterns are worth imitating or whether a smaller Pi-native model is better

### Acceptance criteria

- Jobs can be listed, run, skipped, and inspected predictably
- Job state survives enough runtime context to be operationally useful
- Workflow-backed jobs reuse the same workflow engine without special-case forks
- Timezone behavior is explicit and tested

### Verification

- Vitest coverage for cron parsing, concurrency, retries, and workflow-backed jobs
- SDK verification for `/jobs` and `/job_run`
- CLI smoke test for immediate execution in a temporary workspace
- Manual Pi check:
  - run `/jobs`
  - trigger a job
  - inspect the visible result and persisted history

## Phase E: Multi-agent and governance features

### Goal

Introduce optional orchestration features only after the foundation is stable.

### Tasks

- Add workflow step types for agent delegation
- Add approval gates for risky workflows
- Add source-specific policies for dashboard launches
- Add lightweight audit artifacts for:
  - who launched the workflow
  - what config applied
  - which gates passed or failed
- Add policy docs for future contributors so governance remains simple and explicit

### Acceptance criteria

- Governance features remain optional and do not bloat the simple path
- Delegation uses the existing workflow model instead of a second orchestration system
- Approval and audit paths remain testable

### Verification

- SDK verification with mocked delegated steps
- CLI smoke tests for gate failure and approval-required flows
- Documentation review to ensure extension and governance seams are explicit

## 5. Verification strategy that must exist at all times

There are three required verification layers in this repository.

### Layer 1: Fast automated correctness

Command:

```bash
npm run check
```

Purpose:

- type safety
- deterministic unit tests
- workflow behavior
- config parsing
- knowledge write safety
- scheduler semantics

### Layer 2: Executable extension loading through SDK and CLI

Commands:

```bash
npm run verify:sdk
npm run verify:cli
```

Purpose:

- prove extension files actually load in Pi-compatible runtime paths
- prove slash commands can be triggered outside pure unit tests
- prove temporary-workspace scenarios work against real extension entrypoints
- prove malformed config diagnostics remain readable in at least one executable runtime path

### Layer 3: Manual product smoke tests in Pi

Manual commands to keep current:

```bash
pi --extension ./extensions/dashboard.ts
pi --extension ./extensions/knowledge-distiller.ts
pi --extension ./extensions/job-scheduler.ts
```

Each manual test session should confirm:

- extension loads without startup errors
- command appears and executes
- status or notify behavior is visible when relevant
- expected file or workflow side effects occur

## 6. Definition of done per feature slice

A slice is done only if all statements below are true:

- the behavior is implemented
- YAML examples exist
- English docs exist
- extension seams are commented where future expansion is expected
- unit or behavioral tests exist
- at least one CLI or SDK verification path exists
- `npm run check` passes
- `npm run verify` passes
- known limitations are recorded in this roadmap

## 7. Current known limitations

- Dashboard source support is implemented for GitHub, Jira, and AHA
- GitHub dashboard filters now cover labels, assignees, statuses, and item types; source-level rate limit handling is still pending
- Jira connector supports project-based queries and explicit JQL; pagination uses `nextPageToken`; only basic auth (email + API token) is supported
- AHA connector fetches product features; pagination beyond the initial page is not yet implemented
- Connectors now fail independently: a broken source does not prevent other sources from loading
- CLI verification is currently strongest for state capture, knowledge scan, and malformed config diagnostics; dashboard and scheduler happy paths are already covered through the SDK harness and should gain additional CLI smoke tests in later phases
- Scheduler now persists history, but job enable/disable commands and richer history filtering are still pending
- Scheduler currently evaluates cron schedules in UTC for deterministic behavior
- Dashboard workflow launching works through internal helpers and commands, but richer UI selection and workflow history are still pending
- Knowledge clarification writes are currently conservative and file-targeted; broader restructuring is intentionally deferred
- In the current Pi SDK build, slash-command failures triggered via `session.prompt("/command")` are not surfaced programmatically in a way that is reliable for negative-path assertions, so malformed-config executable verification currently depends on the CLI harness plus Vitest coverage

## 8. Immediate next execution queue

The next engineer or agent should work in this order unless a new business priority overrides it:

1. Add `/jobs` filtering plus enable/disable commands
2. Add retry and timeout handling to persisted scheduler history
3. Add GitHub rate limit/error reporting and source-level workflow metadata
4. Add AHA pagination for products with many features
5. Add Jira advanced field mapping and ADF-to-Markdown rendering in detail view
6. Revisit SDK negative-path verification if Pi exposes command failure results programmatically

## 9. Re-planning rule

This document must be edited whenever any of the following changes:

- feature priority
- verification strategy
- config contract
- accepted connector scope
- workflow engine contract
- knowledge write safety model
- scheduler semantics

If one of those changes happens and this document is not updated, the plan is stale and should not be treated as the source of truth.
