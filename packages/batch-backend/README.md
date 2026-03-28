# @esl-pipeline/batch-backend

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and operational usage guide.
- Last Verified Against: 2026-03-13 repo state.
- Owner: batch-backend maintainers + automation agents.
- Review Cadence: monthly or after major API/worker changes.
- Status: `active`.

Async workflow API and worker runtime for ESL Pipeline.

## Role

`@esl-pipeline/batch-backend` is the operational execution surface for the monorepo:

- authenticated HTTP API
- queue-backed workers
- durable Postgres-backed workflow state
- bridge to `@esl-pipeline/orchestrator` for final pipeline semantics

It does not redefine orchestrator behavior. Contract and architecture detail stay in:

- [`docs/backend-frontend/batch-backend-ssot.md`](../../docs/backend-frontend/batch-backend-ssot.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)

## Runtime Surface

Core surfaces:

- jobs, drafts, prompt packages, recordings, students, auth
- student-memory inspection under `/students/:id/memory`, `/students/:id/lesson-memory`, `/students/:id/homework-memory`, and `/students/:id/memory-snapshots`
- optional ops control under `/ops/*`
- API server + worker processes sharing the same config

Useful indexes:

- [`docs/generated/backend-route-index.md`](../../docs/generated/backend-route-index.md)
- [`docs/generated/env-surface-index.md`](../../docs/generated/env-surface-index.md)

## Current Operational Notes

- Postgres is the durable store.
- Redis/BullMQ backs queue execution.
- Local/dev startup runs the API server, batch worker, transcribe worker, and dedicated student-memory worker as separate processes.
- Prompt catalog runtime is DB-canonical.
- Prompt-package lineage is the canonical assignment-level student-memory provenance surface.
- Student-memory replay/backfill is source-truth driven; version 1 repair uses regenerate workflows rather than manual memory-row editing.
- Schema changes belong in versioned migrations; runtime legacy patching is emergency-only.
- Fresh database bootstrap uses the generated `schema.sql` baseline; existing databases upgrade through versioned migrations.
- Extended API and ops-control surfaces are additive and must be explicitly enabled.

## Environment and Docs

Read these instead of relying on this README for exhaustive env details:

- [`docs/reference/env.md`](../../docs/reference/env.md)
- [`docs/operations/prompt-gallery-bootstrap.md`](../../docs/operations/prompt-gallery-bootstrap.md)
- [`docs/operations/postgres-backup-restore.md`](../../docs/operations/postgres-backup-restore.md)
- [`docs/operations/telegram-ops-control-panel.md`](../../docs/operations/telegram-ops-control-panel.md)

High-signal env groups for this package:

- service runtime: `BATCH_BACKEND_*`
- infra: `PG_*`, `REDIS_*`
- auth/security/upload controls: `JWT_*`, `REFRESH_*`, `ENABLE_*`
- optional ops control: `BATCH_BACKEND_OPS_CONTROL_*`

Student-memory operator workflows:

- lesson memory replay: `pnpm --filter @esl-pipeline/batch-backend lesson-memory:refresh`
- homework memory replay: `pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-homework-memory.ts`
- student-memory snapshot replay: `pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-student-memory-snapshots.ts`
- focused runbook: [`docs/operations/student-memory-replay-backfill.md`](../../docs/operations/student-memory-replay-backfill.md)

## Validation

From repo root:

```bash
pnpm --filter @esl-pipeline/batch-backend build
pnpm --filter @esl-pipeline/batch-backend test
pnpm --filter @esl-pipeline/batch-backend test:integration:http
pnpm --filter @esl-pipeline/batch-backend db:verify-baseline
```

`db:generate-baseline` and `db:verify-baseline` require a Postgres connection that can create and drop temporary databases on the target server.

Repo-wide checks commonly used before merge:

```bash
pnpm docs:check
pnpm check:fast
```

## Related

- [`packages/orchestrator/README.md`](../orchestrator/README.md)
- [`docs/backend-frontend/batch-backend-ssot.md`](../../docs/backend-frontend/batch-backend-ssot.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)
