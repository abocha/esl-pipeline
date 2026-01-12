# Pipeline Integration Operating Manual

This is the primary operational manual for integrating transcription into
esl-pipeline and running the end-to-end lesson workflow.

Status snapshot:
- Phase 2+ (pipeline-native transcription) is the active path and implemented end-to-end.
- Phase 5 (FRONTEND_VISION alignment) is implemented in batch-frontend (dashboard + wizard + editor + polish).
- Gap-closure manual: docs/archive/TRANSCRIPTION_PIPELINE_IMPLEMENTATION_MANUAL.md.
- Phase 3 manual: docs/design/PIPELINE_INTEGRATION_PHASE_3_MANUAL.md.
- The original staged manual is archived at
  docs/archive/TRANSCRIPTION_PIPELINE_IMPLEMENTATION_MANUAL.md.

---

## 1) System map (end-to-end)

### Phase 2+ (native transcription, implemented)
1. Recording scan or upload ingestion creates Recording rows.
2. Transcribe worker runs Deepgram and stores transcript artifacts.
3. UI reviews/edits transcript.
4. UI assembles prompt package from template + profile + notes + transcript.
5. UI saves draft.
6. Draft is materialized to filesystem and approved job runs orchestrator.

Implemented successfully (current as-built state):
- Scan ingestion with dedupe; manual sync endpoint.
- Upload ingestion via `POST /recordings/upload`.
- Transcribe queue + worker using Deepgram multichannel with utterances + punctuation.
- Diarization fallback for mono audio; transcript formatting with Teacher/Student labels.
- Transcript read/update endpoints wired to the UI.
- Prompt package creation and retrieval.
- Draft creation and materialization to FILESYSTEM_UPLOAD_DIR.
- Recording status SSE events consumed by the transcription workspace.
- Manual retry endpoint (`POST /recordings/:id/transcribe`) with queue status surfaced in UI.
- Startup validation for storage + prompt/recordings paths.

Notes for Phase 2+:
- Recording list/backfill endpoint is available; UI hydrates on load and merges SSE updates.
- Upload ingestion via `POST /recordings/upload` (S3 recommended).
- Student association uses a deterministic student ID derived from folder names or upload selection.
  - `/config/students` exposes configured student profiles for UI selection.
  - Recording list supports `studentId` filtering; UI supports filtering and upload association.
- Prompt templates/profiles are allowlisted; `/config/prompts` exposes IDs for UI selection.
- Transcription workspace surfaces queue status, errors, and retry actions for failed recordings.
- Draft approval jobs apply user settings defaults for preset + TTS strategy and set `upload=auto`.
  TTS runs when an ElevenLabs key is configured (user or env); otherwise TTS stays disabled.
- Only new audio content is discovered; renames do not re-ingest.
- Draft approval auto-creates an awaiting_approval job during materialization.

---

## 2) Current assets and where they live

### 2.1 esl-pipeline (Phase 2+)
Core runtime packages:
- packages/batch-backend
- packages/batch-frontend
- packages/orchestrator

System docs:
- docs/reference/agents-ssot.md (contracts)
- docs/reference/pipeline-manifest.md
- docs/backend-frontend/backend-frontend-alignment.md

### 2.2 Prompt assets (Phase 2+)
- Prompt template: docs/templates/hw_prompt_v4-1_clean.md
- Student profile example: docs/templates/PROFILE_2025-11-16.md
- Profile creation prompt: docs/templates/NEW PROFILE.txt

Prompt assembly order (canonical):
1) Template base
2) Replace INSERT PROFILE HERE with profile text
3) Append [NOTES]
4) Append [TRANSCRIPT]

---

## 3) Runbooks

### 3.1 Phase 2+ (native transcription)
Prereqs:
- docker compose includes the transcribe-worker service.
- RECORDINGS_ROOT is mounted to /recordings.
- DEEPGRAM_API_KEY set in .env.batch-backend.

Flow:
1) Drop a new audio file into the mounted recordings folder, or upload via the UI (`POST /recordings/upload`).
2) Click Sync recordings (UI) or POST /recordings/sync (scan mode only).
3) Wait for transcribe queue to complete.
4) Open transcript by Recording ID; edit if needed.
5) Build prompt package, then save draft.
6) Materialize + approve (job is created automatically; no manual job ID).

---

## 4) Configuration and secrets

Use .env for CLI and .env.batch-backend for the service stack.
See docs/reference/env.md for the full list. Key Phase 2+ entries:
- RECORDINGS_ROOT, RECORDINGS_GLOB, RECORDINGS_SCAN_INTERVAL_SEC
- DEEPGRAM_API_KEY, DEEPGRAM_MODEL, DEEPGRAM_LANGUAGE
- TRANSCRIBE_QUEUE_NAME, TRANSCRIBE_MODE, TRANSCRIBE_MAX_CONCURRENCY
- PROMPT_TEMPLATE_PATH, PROMPT_PROFILE_PATH (use docs/templates paths)

---

## 5) Known risks and gotchas

- Recording scan is delta-only; use a brand new file to test ingestion.
- Recording list loads on page load and stays in sync with SSE updates.
- Recording uploads honor `RECORDINGS_MAX_FILE_SIZE`; increase it for longer lessons.
- Draft approval auto-creates a job; no manual job selection needed.
- Prompt profile path is constrained to configured root; ensure the env paths exist.
- Student IDs are derived from normalized names; renaming folders or changing names creates a new ID.
- Prompt selection uses IDs; keep template/profile files under the configured directories.

---

## 6) Roadmap (restructured phases)

### Phase 2+ (implemented)
Implemented in repo:
- Scan ingestion, transcribe queue, Deepgram worker.
- Transcript review/edit UI and APIs.
- Prompt package and draft creation.
- Draft materialization to filesystem (auto-creates approval job).

### Shortcomings to achieve full Phase 2+
- None (hardening complete).

### New phases (fresh roadmap)
Phase 3: Phase 2+ polish (implemented)
- One-click approval (no manual job ID).
- Recording search + filters on the list view.
  - Implementation manual: docs/design/PIPELINE_INTEGRATION_PHASE_3_MANUAL.md.

Phase 4: Student-centric workflow (implemented)
- Student selection, profile CRUD, and per-student timelines.
- Per-student history and transcript/draft timeline.
- Implementation manual: docs/design/PIPELINE_INTEGRATION_PHASE_4_MANUAL.md.

Phase 5: FRONTEND_VISION alignment
- Richer upload UX, editor, dashboard/activity stream (implemented).
- Full guided multi-step flow for lesson -> transcript -> draft -> publish (implemented).
- Wizard completion resets state and returns to the dashboard.
- Notifications panel now includes a recent alert log of toast messages.

Phase 6: Storage modernization
- Move recordings/transcripts/prompts/drafts to S3.
- Lifecycle policies for retention and cleanup.

---

## 7) If you forget where to look

- docs/reference/agents-ssot.md (authoritative contracts)
- docs/reference/pipeline-manifest.md (manifest schema)
- docs/backend-frontend/backend-frontend-alignment.md (API status)
- docs/design/TRANSCRIPTION_PIPELINE_SPEC.md (Phase 2+ spec)
