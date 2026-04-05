# Batch System Guide (Active)

## Meta

- Audience: AI agents and maintainers for batch frontend/backend tasks.
- Read Time: 6 minutes.
- Authority Level: Active system map.
- Last Verified Against: 2026-04-05 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after major batch workflow changes.
- Status: `active`.

## Purpose

- Provide active architecture and integration map for the batch system.
- Point to authoritative status and contract sources.

## Canonical Sources

1. [`docs/reference/agents-ssot.md`](../reference/agents-ssot.md)
2. [`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend-alignment.md)
3. [`packages/batch-frontend/README.md`](../../packages/batch-frontend/README.md)
4. [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)

## Current State

- Frontend is an authenticated assignment console.
- Backend exposes extended API routes and queue-backed processing.
- Prompt templates/profiles are runtime-managed from Postgres revisions (DB-canonical).
- Canonical student-memory artifacts, inspection routes, and replay tooling are backend-live.
- Orchestrator remains the publish execution engine after approval handoff.

## Architecture

```text
Batch Frontend (React + Vite)
  -> Batch Backend (Fastify + queue workers + Postgres/Redis)
  -> Orchestrator (validation/import/TTS/upload/manifest)
```

## Active User Flow

1. Authenticate.
2. Upload recording.
3. Review/edit transcript.
4. Generate prompt package.
5. Save draft markdown.
6. Materialize draft.
7. Approve job and publish.

## Integration Surface (Minimal)

- Auth: `/auth/*`
- Recordings/transcripts: `/recordings/*`
- Students: `GET /students/:id/memory`, `GET /students/:id/lesson-memory`, `GET /students/:id/homework-memory`, `GET /students/:id/memory-snapshots` for authenticated student-memory inspection
- Prompt config/options: `/config/prompts`, `/config/job-options`
- Prompt package and drafts: `/recordings/:id/prompt-package`, `GET /prompt-packages/:id` for canonical prompt-package lineage and assignment-level memory provenance inspection, `/prompt-packages/:id/draft`, `/drafts/:id/materialize`
- Approval and status: `/jobs/:jobId/approve`, `/jobs/:jobId`, `/jobs/events`
- Validation: `/validation/markdown`

Operator repair/backfill surfaces:

- `pnpm --filter @esl-pipeline/batch-backend lesson-memory:refresh`
- `pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-homework-memory.ts`
- `pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-student-memory-snapshots.ts`

Event fanout behavior (Redis bridge):

- Job events publish on targeted channels only: `batch_job_events:<jobId>`.
- All-jobs listeners consume targeted channels through pattern subscription: `batch_job_events:*`.

## Related

- [`docs/operations/prompt-gallery-bootstrap.md`](../operations/prompt-gallery-bootstrap.md)
- [`docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`](../design/TRANSCRIPTION_PIPELINE_SPEC.md)
