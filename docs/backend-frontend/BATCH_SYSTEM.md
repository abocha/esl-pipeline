# Batch System Guide (Active)

## Meta

- Audience: AI agents and maintainers for batch frontend/backend tasks.
- Read Time: 6 minutes.
- Authority Level: Active system map.
- Last Verified Against: 2026-02-06 repo state.

## Purpose

- Provide the active architecture and integration map for the batch system.
- Point to authoritative status and contract sources.

## When To Read

- Before editing `packages/batch-frontend` or `packages/batch-backend`.

## Canonical Sources

1. `docs/reference/agents-ssot.md`
2. `docs/backend-frontend/backend-frontend-alignment.md`
3. `packages/batch-frontend/README.md`
4. `packages/batch-backend/README.md`

## Current State

- Frontend is a minimal authenticated assignment console.
- Backend exposes extended API routes and queue-backed processing.
- Orchestrator remains the execution engine after approval handoff.

## Architecture

```text
Batch Frontend (React + Vite)
  -> Batch Backend (Fastify + queue workers)
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
- Recordings: `/recordings/*`
- Prompt config: `/config/prompts`
- Draft materialization: `/prompt-packages/:id/draft`, `/drafts/:id/materialize`
- Approval and status: `/jobs/:jobId/approve`, `/jobs/:jobId`, `/jobs/events`
- Validation: `/validation/markdown`

## Do / Don't

- Do treat this as architecture-level map, not detailed status ledger.
- Do use alignment doc for capability readiness.
- Don't store historical implementation narratives here.

## Related

- `docs/backend-frontend/backend-frontend-alignment.md`
- `docs/PIPELINE_INTEGRATION_VISION.md`
- `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`
- `docs/archive/frontend/README.md` (historical)
