# Pi Extensions Workspace

This repository contains a small extension suite for Pi focused on three long-lived workflows:

- a dashboard to review GitHub/Jira/AHA work and launch repeatable workflows
- a knowledge distillation assistant for markdown-based knowledge stores
- a scheduler UI for recurring scripts and workflow jobs

The implementation follows a few strict rules:

- configuration is YAML-first
- documentation and comments are in English
- each extension keeps a single main entry file under `extensions/`
- reusable helpers live in `src/shared/`
- every feature is designed with explicit extension points for future contributors

## Repository layout

- `extensions/`: Pi extension entry points
- `src/shared/`: reusable config, workflow, connector, and parsing helpers
- `examples/`: sample YAML and markdown fixtures
- `docs/`: architecture and extension guidance
- `tests/`: automated validation for core workflows

## Current feature set

- `dashboard.ts`: GitHub-backed dashboard data loading, filtering, workflow launching, and persisted run summaries
- `knowledge-distiller.ts`: markdown knowledge scanning, ambiguity detection, and clarification writing
- `job-scheduler.ts`: YAML-defined jobs with cron scheduling, script execution, workflow launches, and persisted run history
- `state-capture-reporter.ts`: event discovery utility preserved from the original repository

## Validation

```bash
npm install
npm run check
npm run verify
```

`npm run verify` executes real extension-loading smoke checks through both the Pi SDK and the `pi` CLI.
The verification suite now covers both happy paths and malformed-config diagnostics.
