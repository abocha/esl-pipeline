# Pipeline Integration Phase 3 Manual (Phase 2+ Polish)

Purpose: step-by-step manual for delivering Phase 3 polish in the
transcription pipeline. This manual assumes the Phase 2+ foundation is
already implemented. Use this document for future work only.

Audience: maintainers and agents implementing Phase 3 UX polish in the
batch-backend and batch-frontend.

Scope:

- One-click approval (no manual job ID).
- Recording search and filters in the list view.
- Keep existing Phase 2+ behavior stable and backward compatible.

Status:

- Phase 2+ is implemented and stable.
- Phase 3 polish is planned; implementation may be partial.

---

## Pre-flight (Required Reading)

- AGENTS.md (SSOT pointer)
- docs/reference/agents-ssot.md (repo invariants)
- docs/backend-frontend/batch-backend-ssot.md (backend contracts)
- docs/backend-frontend/backend-frontend-alignment.md (API status tracker)
- docs/design/TRANSCRIPTION_PIPELINE_SPEC.md (Phase 2+ spec)
- docs/PIPELINE_INTEGRATION_VISION.md (operational runbook + roadmap)
- docs/design/FRONTEND_VISION.md (target UX)
- docs/reference/env.md (env conventions)
- docs/backend-frontend/BATCH_SYSTEM.md (batch system overview)

Confirm these guardrails:

- Phase 2+ is the active path; do not break existing ingestion, transcription,
  draft, or approval flows.
- Orchestrator still expects a filesystem markdown path.
- Extended API routes require `BATCH_BACKEND_ENABLE_EXTENDED_API=true`.
- Any API contract changes must be reflected in
  docs/backend-frontend/batch-backend-ssot.md and
  docs/backend-frontend/backend-frontend-alignment.md.

---

## Stage 0: Baseline audit

Goal: confirm current Phase 2+ behavior and document what is already complete.

Steps:

1. Verify the end-to-end Phase 2+ flow:
   recording ingestion -> transcript -> prompt package -> draft -> materialize
   -> approve -> orchestrator run.
2. Confirm `POST /drafts/:id/materialize`:
   - Accepts a missing `jobId`.
   - Returns `{ draftId, jobId, mdPath }`.
3. Confirm `GET /recordings`:
   - Returns `{ items, limit, offset, total, order }`.
   - Supports `status` and `studentId`/`student` filters.
4. Confirm `/jobs/events` includes `recording_state_changed` payloads that the
   transcription workspace can merge into the recordings list.

Review Gate 0:

- Post a short summary of verified behaviors and any drift from docs.

---

## Stage 1: One-click approval

Goal: enable draft approval without manual job ID input.

Implementation steps:

1. Backend: keep the materialize contract stable.
   - `POST /drafts/:draftId/materialize` must accept an optional `jobId`.
   - If `jobId` is missing, create an approval job in `awaiting_approval`.
   - Response must include `{ draftId, jobId, mdPath }`.
2. Backend: ensure `POST /jobs/:jobId/approve` accepts the job returned by
   materialize and transitions it to `queued` for the orchestrator worker.
3. Backend: ensure the job record is updated with `draftId` and `md`, and that
   SSE payloads include `recordingId` where present.
4. Frontend: remove any manual job ID input.
   - On "Approve", call materialize, then approve using the returned `jobId`.
   - Surface errors with a retry option if materialize or approve fails.
5. Tests:
   - Backend integration test: materialize without `jobId` returns a job.
   - Backend integration test: approve transitions job state.
   - Frontend test: approve flow succeeds without manual input.

Review Gate 1:

- Provide request/response examples and confirm the UI has no job ID field.

---

## Stage 2: Recording search and filters

Goal: add searchable, filterable recording lists that stay in sync with SSE.

Implementation steps:

1. Backend: extend `GET /recordings` query support.
   - Existing: `status`, `studentId`/`student`, `limit`, `offset`, `order`.
   - Add: `source` (scan|upload).
   - Add: `q` for text search (recording ID and a filename-like label).
2. Backend: expose a display label for search and list rendering.
   - Add `displayName` to the recording DTO (derived from `sourcePath` or
     `storageUri` basename).
   - Include `displayName` in `recording_state_changed` SSE payloads so the UI
     can update in-place without refetching.
3. Backend: update repository queries and add indexes if needed:
   - Filter by `source` and `q` without regressing list performance.
4. Frontend: add filters and search UI.
   - Status filter (multi-select).
   - Student filter (by ID or name).
   - Source filter (scan|upload).
   - Search input bound to `q`.
5. Frontend: preserve filters while merging SSE updates.
   - Only update visible rows if they still match the active filters.
6. Tests:
   - Backend tests for `source` and `q` filters.
   - Frontend tests for filtering, search, and SSE merge behavior.

Review Gate 2:

- Provide endpoint contract examples and confirm list view behavior with filters
  and live updates.

---

## Stage 3: Documentation and release checklist

Goal: keep contracts and roadmap synchronized with the Phase 3 polish work.

Steps:

1. Update `docs/backend-frontend/batch-backend-ssot.md` with any new query
   params or DTO fields.
2. Update `docs/backend-frontend/backend-frontend-alignment.md` with Phase 3
   status and endpoint contracts.
3. Update `docs/PIPELINE_INTEGRATION_VISION.md` to mark Phase 3 progress and
   link to this manual.
4. Update `docs/backend-frontend/BATCH_SYSTEM.md` if the UI or endpoint
   descriptions change.

Review Gate 3:

- Provide a short changelog and confirm docs match the implemented behavior.

---

## Notes

- Keep Phase 2+ behaviors stable; avoid new pipeline stages.
- Do not change manifest schema in Phase 3.
- When adding or changing API fields, update the SSOT and alignment docs in the
  same change set.
