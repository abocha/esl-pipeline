# Transcription Pipeline Implementation Manual (Phase 2+)

Purpose: a step-by-step, coder-AI friendly manual for implementing the Phase 2+ pipeline-native transcription system defined in `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`. Each stage ends with a review gate. Do not proceed to the next stage until the review gate is explicitly approved.

Audience: a coder-AI implementing the backend + UI integration in this repo.

---

## Pre-flight (Required Reading)

Read and confirm alignment with (start here):
- `AGENTS.md` (entry point and SSOT pointer)
- `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md` (Phase 2+ requirements and terminology)
- `docs/PIPELINE_INTEGRATION_VISION.md` (Phase 1 manual; this work is the successor)
- `docs/design/FRONTEND_VISION.md` (end-state UI journey)
- `docs/reference/agents-ssot.md` (repo-wide invariants)
- `docs/backend-frontend/batch-backend-ssot.md` (batch-backend invariants)
- `docs/reference/env.md` (environment variable conventions)
- `docs/backend-frontend/backend-frontend-alignment.md` (API status tracker)

Confirm these decisions (already approved):
- Store Deepgram raw JSON in MVP via `raw_response_uri`, optional via config.
- Add nullable job linkage columns: `recording_id`, `transcript_id`, `prompt_package_id`, `draft_id`.
- Reuse `/jobs/events` SSE stream for transcription progress (extend payloads if needed).
- Drafts are materialized to filesystem before `/jobs/:jobId/approve`.
- Scan ingestion is MVP; upload ingestion is future (S3-backed).

---

## Stage 0: Baseline Alignment and Planning

Goal: lock scope, names, and review checkpoints before any new code.

Steps:
1) Confirm all phase/terminology references in docs are consistent (Phase 1 vs Phase 2+).
2) Confirm config naming alignment:
   - Deepgram: `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`, `DEEPGRAM_LANGUAGE`, `DEEPGRAM_STORE_RAW_RESPONSE`.
   - Ingestion: `RECORDINGS_ROOT`, `RECORDINGS_SCAN_INTERVAL_SEC`, `RECORDINGS_GLOB`.
   - Storage: `STORAGE_PROVIDER`, `FILESYSTEM_UPLOAD_DIR`, `S3_*` / `AWS_*`.
3) Update `docs/backend-frontend/backend-frontend-alignment.md` with new endpoints and state if needed.

Review Gate 0 (stop here):
- Post a short summary of the confirmed config names and endpoints.
- Confirm no conflicts with SSOT docs.

---

## Stage 1: Data Model and Migrations

Goal: add the Phase 2+ data model and job linkage without breaking Phase 1.

Steps:
1) Add DB tables for:
   - `recordings`
   - `transcripts`
   - `prompt_packages`
   - `drafts`
2) Add job linkage columns:
   - `recording_id`, `transcript_id`, `prompt_package_id`, `draft_id`
3) Update schema sources:
   - `packages/batch-backend/schema.sql`
   - `packages/batch-backend/src/infrastructure/db.ts` (runtime patching)
4) Update domain and DTOs:
   - `packages/batch-backend/src/domain/job-model.ts`
   - `packages/batch-backend/src/domain/job-repository.ts`
   - `packages/batch-backend/src/application/job-dto.ts`
   - `packages/batch-backend/src/infrastructure/job-event-redis-bridge.ts`
   - `packages/contracts/src/index.ts` (JobStatusDto additions)
5) Add/update tests:
   - repository mapping tests
   - DTO serialization tests

Review Gate 1 (stop here):
- Provide the SQL table definitions and new columns list.
- Confirm DTO shape changes are reflected in contracts + backend.
- Confirm tests covering new fields.

---

## Stage 2: Storage Adapter (Artifacts)

Goal: implement artifact storage for audio, transcripts, raw JSON, prompt packages, drafts.

Steps:
1) Define a storage interface matching the spec (put/get/delete).
2) Implement filesystem adapter:
   - Base directory: `FILESYSTEM_UPLOAD_DIR`.
   - Suggested paths:
     - `recordings/<recordingId>.<ext>`
     - `transcripts/<transcriptId>.txt`
     - `transcripts/<transcriptId>.json`
     - `prompt-packages/<promptPackageId>.txt`
     - `drafts/<draftId>.md`
3) Add config wiring using `packages/shared-infrastructure/src/storage/config.ts`.
4) Add unit tests for:
   - path resolution
   - read/write behavior
   - optional raw JSON storage

Review Gate 2 (stop here):
- Show interface + filesystem adapter API surface.
- Confirm path conventions and config usage.

---

## Stage 3: Ingestion Service (Scan Mode)

Goal: auto-ingest recordings from a local folder into `recordings` and enqueue transcription jobs.

Steps:
1) Implement scanner:
   - `RECORDINGS_ROOT` + `RECORDINGS_GLOB`.
   - Deduplicate by `sha256` or `(path + mtime + size)`.
2) Store discovered audio using the storage adapter.
3) Insert `recordings` row with `source="scan"` and `status="queued"`.
4) Enqueue `transcribe-queue` with `{ recordingId }`.
5) Add manual sync endpoint:
   - `POST /recordings/sync` returns `{ discovered: number }`.

Review Gate 3 (stop here):
- Provide scan algorithm and dedupe rules.
- Confirm `recordings` schema and queue payload.
- Confirm endpoint contract.

---

## Stage 4: Transcription Worker (Deepgram)

Goal: create a worker that transcribes recordings and persists artifacts.

Steps:
1) Use Deepgram SDK:
   - Server-side: `createClient(DEEPGRAM_API_KEY)`.
   - Token auth: pass temporary token via `accessToken`.
   - No browser direct calls; proxy required.
2) Worker flow:
   - Load `recordings` row.
   - If transcript exists: no-op.
   - Mark recording `transcribing`.
   - Call Deepgram (primary multichannel, fallback diarized).
   - Format transcript (timeline/stack).
   - Store transcript + optional raw JSON + summary_json.
   - Mark recording `transcribed` or `failed`.
3) Emit progress via `/jobs/events` (extend payload with `recordingId` + `transcriptId`).

Review Gate 4 (stop here):
- Provide worker flow pseudocode + error handling.
- Confirm SSE payload extension.
- Confirm raw JSON storage toggle.

---

## Stage 5: Transcript Review API

Goal: allow UI to fetch and edit transcripts.

Steps:
1) `GET /recordings/:id/transcript`:
   - Read transcript from storage.
   - Return text + metadata (summary_json, model, language, mode).
2) `PUT /recordings/:id/transcript`:
   - Replace transcript text in storage.
   - Update transcript record `updated_at`.

Review Gate 5 (stop here):
- Provide request/response shapes.
- Confirm storage update behavior.

---

## Stage 6: Prompt Package Assembly

Goal: assemble prompt packages using the canonical stitching order.

Steps:
1) Load:
   - prompt template (configurable path)
   - profile (DB record or file export)
   - notes (from UI)
   - transcript (storage)
2) Stitch in canonical order:
   - Replace `INSERT PROFILE HERE` with full profile.
   - Append `[NOTES]` + notes.
   - Append `[TRANSCRIPT]` + transcript text.
3) Store prompt package artifact + DB row.
4) Expose endpoints:
   - `POST /recordings/:id/prompt-package`
   - `GET /prompt-packages/:id`

Review Gate 6 (stop here):
- Provide canonical stitching output example.
- Confirm endpoints and storage URIs.

---

## Stage 7: Draft Creation + Materialization

Goal: store draft content and materialize to filesystem for orchestrator approval.

Steps:
1) `POST /prompt-packages/:id/draft`:
   - Store draft content via storage adapter.
   - Insert `drafts` row.
2) `POST /drafts/:id/materialize`:
   - Write `.md` to `FILESYSTEM_UPLOAD_DIR/drafts/<draftId>.md`.
   - Update job record with `md` path + `draft_id`.
   - Return `md_path` for `/jobs/:jobId/approve`.
3) Continue to use `/jobs/:jobId/approve` (existing).

Review Gate 7 (stop here):
- Confirm materialization path and security (no path injection).
- Confirm job update behavior.

---

## Stage 8: UI Integration (Phase 2 MVP)

Goal: wire UI flows to the new endpoints and `/jobs/events`.

Steps:
1) Add recording list + transcript review UI.
2) Add notes + prompt package view/download.
3) Add draft paste + approve flow:
   - Draft save -> materialize -> approve.
4) Subscribe to `/jobs/events` for transcription status updates.
5) Ensure error states and retries surface clearly.

Review Gate 8 (stop here):
- Provide UI flow screenshots or component list.
- Confirm SSE payload usage and state mapping.

---

## Stage 9: Documentation and Final Checks

Goal: keep docs and contracts in sync before release.

Steps:
1) Update docs:
   - `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md` if implementation diverges.
   - `docs/backend-frontend/backend-frontend-alignment.md` for new endpoints.
   - `docs/reference/env.md` for new env vars.
2) Verify test coverage for new data paths.
3) Record any deferred work in `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md` open questions.

Review Gate 9 (stop here):
- Provide a final changelog summary and test results.
- Confirm the Phase 1 workflow remains operational.

---

## Notes for Coder-AI Execution

- Do not change orchestrator behavior (it still expects a filesystem path).
- Keep Phase 1 ttdg flow intact; Phase 2 is additive until cutover.
- Prefer small, reviewable changes per stage.
- When in doubt, pause and request clarification before proceeding.
