# Transcription Pipeline Implementation Manual (Phase 2+ Gap Closure)

Purpose: step-by-step manual for closing the remaining gaps in the Phase 2+
transcription system. This manual assumes the Phase 2+ foundation is already
implemented. Use this document for future work only.

Audience: maintainers and agents finishing Phase 2+ and moving toward the
FRONTEND_VISION end-state.

Scope:
- Close the known gaps that prevent Phase 2+ from being a complete, smooth flow.
- Do not rework the already shipped Phase 2+ core.

Status:
- Stages 0-6 complete; Phase 2+ gap closure finished.
- Ongoing enhancements belong to Phase 3+ in docs/PIPELINE_INTEGRATION_VISION.md.

---

## Pre-flight (Required Reading)

- AGENTS.md (SSOT pointer)
- docs/reference/agents-ssot.md (repo invariants)
- docs/backend-frontend/batch-backend-ssot.md (backend invariants)
- docs/design/TRANSCRIPTION_PIPELINE_SPEC.md (Phase 2+ spec + as-built status)
- docs/PIPELINE_INTEGRATION_VISION.md (operational runbook + roadmap)
- docs/design/FRONTEND_VISION.md (target UX)
- docs/reference/env.md (env conventions)
- docs/backend-frontend/backend-frontend-alignment.md (API status tracker)

Confirm these guardrails:
- Phase 2+ is the active path; do not break the existing pipeline.
- Orchestrator still expects a filesystem markdown path.

---

## Stage 0: Baseline Audit

Goal: confirm current Phase 2+ behavior and document the active gaps.

Steps:
1) Verify end-to-end Phase 2+ flow up to draft creation.
2) Confirm recording ingestion, transcript edit, prompt package, and draft save.
3) Confirm remaining gaps (approval job, recording list/backfill, upload ingestion,
   student association, template/profile UX).
4) Update docs/PIPELINE_INTEGRATION_VISION.md gaps list if it has drifted.

Review Gate 0:
- Post a short summary of verified behaviors and the confirmed gap list.

---

## Stage 1: Phase 2+ Approval Job Bridge

Goal: remove the manual "job ID" requirement when approving a Phase 2+ draft.

Preferred approach:
- Materialization should create or attach an approval job automatically.
- The UI should not ask for a job ID.

Implementation steps:
1) Backend: add a new use case to create an approval job from a draft + prompt
   package + recording metadata. Persist:
   - recordingId, transcriptId, promptPackageId, draftId
   - userId (if available)
   - state = awaiting_approval
2) Backend: extend the materialize endpoint to accept optional jobId.
   - If jobId is missing, create a new approval job and use it.
   - Return { draftId, jobId, mdPath }.
3) Frontend: remove manual job ID input in the transcription workspace.
   - Use the returned jobId for approve.
   - Show the created job in the UI.
4) Tests:
   - Backend: materialize without jobId creates a job in awaiting_approval.
   - Frontend: approval flow succeeds without manual job input.

Review Gate 1:
- Provide request/response examples and confirm the UI no longer needs jobId.

---

## Stage 2: Recording List + Backfill

Goal: remove reliance on SSE-only recording feed for listing.

Implementation steps:
1) Backend: implement GET /recordings?status=... with pagination and ordering.
2) Backend: implement GET /recordings/:id.
3) Frontend: load recordings on page load and merge with SSE updates.
4) Tests:
   - Add API tests for list + get.
   - Add frontend tests for initial render + SSE merge.

Review Gate 2:
- Provide endpoint contracts and confirm the UI can show recordings after reload.

---

## Stage 3: Upload Ingestion (S3-backed)

Goal: enable direct UI uploads instead of only scan mode.

Implementation steps:
1) Define upload endpoint and storage adapter wiring.
2) Create Recording rows from upload source with storage URI.
3) Enqueue transcribe jobs the same way as scan ingestion.
4) Update UI to upload recordings and reflect progress.
5) Tests for upload -> recording -> transcribe queue.

Review Gate 3:
- Provide API shapes and confirm a UI upload produces a transcript.

---

## Stage 4: Student Association

Goal: attach recordings/transcripts to student entities.

Implementation steps:
1) Define student ID mapping strategy (folder name, UI selection, or explicit ID).
2) Persist student_id on recordings and propagate to prompt packages/drafts.
3) Update UI to filter recordings by student.
4) Tests for mapping and persistence.

Review Gate 4:
- Confirm how student association is chosen and persisted.

---

## Stage 5: Template/Profile UX and Versioning

Goal: make prompt inputs explicit and safe without path fiddling.

Implementation steps:
1) Add server-side allowlist for profiles/templates (no arbitrary file paths).
2) Expose available templates and profiles in config endpoints.
3) Update UI to choose template/profile by ID instead of path.
4) Tests for allowlist and selection.

Review Gate 5:
- Provide the allowlist rules and UI selection behavior.

---

## Stage 6: Phase 2+ Hardening

Goal: remove duct tape and edge-case fragility.

Implementation steps:
1) Add clearer error surfacing in the transcription workspace.
2) Add retry actions for failed transcriptions.
3) Add explicit status in the UI for transcription queue states.
4) Validate storage and path configuration at startup.

Review Gate 6:
- Provide the final UX flow and list of known failure modes.

---

## Notes

- Do not remove Phase 1 until Phase 2+ is production-ready.
- Keep orchestrator integration unchanged; it still expects a filesystem path.
- Prefer incremental, reviewable changes; update docs at each stage.
