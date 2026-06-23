# ESL Pipeline

ESL Pipeline is a private, backend-first system for turning lesson material into student-ready
assignments. The tutor workflow is recording or lesson context → transcript → draft → review →
publish, with student memory, scheduling, and lesson-credit support around it.

## Start Here

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm env:validate -- --profile=development
pnpm dev:batch
```

For prerequisites, local Docker behavior, environment setup, and operational commands, read
[`docs/QUICK_START.md`](docs/QUICK_START.md) and
[`docs/reference/env.md`](docs/reference/env.md).

## Validate

```bash
pnpm check:fast
pnpm docs:check
```

Use `pnpm check:pre-pr` for broad changes and `pnpm check` when reproducing full CI or validating
database, worker, migration, or integration behavior.

## Architecture

- `packages/batch-backend` and `packages/batch-frontend` provide the authenticated tutor workflow,
  API, and workers.
- `packages/orchestrator` is the canonical pipeline library for validation, rendering, speech,
  upload, and manifest behavior.
- `packages/contracts`, `shared-infrastructure`, provider packages, `md-validator`, `pmd`,
  `html-publisher`, and `storage-uploader` support those product boundaries.

Read [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md) for the package map and
[`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md) for the active
system boundary.

## Current Product Direction

The product is in one-tutor pre-alpha. Current implementation work and cohort gates are in
[`docs/plans/2026-06-23-alpha-readiness.md`](docs/plans/2026-06-23-alpha-readiness.md) and
[`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md).

## Documentation And Operations

- Agent and maintainer routing: [`AGENTS.md`](AGENTS.md) →
  [`docs/README.md`](docs/README.md) →
  [`docs/reference/DOCS_IA_MAP.md`](docs/reference/DOCS_IA_MAP.md) →
  [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md)
- Deployment: [`docs/backend-frontend/DEPLOYMENT.md`](docs/backend-frontend/DEPLOYMENT.md)
- Release/versioning: [`docs/reference/VERSIONING_MODEL.md`](docs/reference/VERSIONING_MODEL.md)
- Student-memory repair: [`docs/operations/student-memory-replay-backfill.md`](docs/operations/student-memory-replay-backfill.md)

Historical material lives in [`docs/archive/`](docs/archive/) and is non-authoritative.
