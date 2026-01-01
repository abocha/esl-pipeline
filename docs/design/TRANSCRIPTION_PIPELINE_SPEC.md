# Transcription Pipeline Spec (Phase 2+ Draft)

Goal: define a pipeline-native transcription service that supersedes the Phase 1
ttdg CLI flow once the UI-driven pipeline is ready. Phase 1 remains the current
operational path; see docs/PIPELINE_INTEGRATION_VISION.md for the active manual.
The user should never touch file paths or manage cache. Recordings appear,
transcription runs in the background, and the UI presents the transcript for
review and prompt assembly.

This spec is designed to align with:
- docs/PIPELINE_INTEGRATION_VISION.md (Phase 1 manual; this spec is the Phase 2+ successor)
- docs/design/FRONTEND_VISION.md (end-state UI journey)
- docs/PROJECT_OVERVIEW.md (product intent)

This spec is implemented in the repo with known gaps. Current status and
roadmap live in `docs/PIPELINE_INTEGRATION_VISION.md`. Gap-closure steps are
tracked in `docs/design/TRANSCRIPTION_PIPELINE_IMPLEMENTATION_MANUAL.md`.
The original staged manual is archived at
`docs/archive/TRANSCRIPTION_PIPELINE_IMPLEMENTATION_MANUAL.md`.

---

## 1) Scope and Non-Goals

### Scope (Phase 2 MVP)
- Auto-ingest recordings from a local folder (scan mode) and enqueue transcription jobs.
- Upload recordings via the UI (`POST /recordings/upload`) and enqueue transcription jobs.
- Transcribe via Deepgram using the Node SDK.
- Persist transcript artifacts and metadata in DB + storage adapter.
- Expose transcript review/edit in the UI.
- Assemble prompt packages from template + profile + notes + transcript.
- Materialize approved drafts to filesystem and run the existing pipeline on the resulting markdown.

### Non-goals (explicitly out of scope)
- Replacing the Phase 1 ttdg CLI workflow before this system is production-ready.
- CLI tools (no new transcription CLI; Phase 1 ttdg remains for now).
- Archive reports, cache reports, manual file management.
- File moving/renaming in the recordings folder.
- Any requirement for the user to type paths.
- Browser-direct Deepgram calls (CORS requires a backend proxy).

---

## 2) Core Principles

1) Artifacts, not paths
   - Recordings, transcripts, prompt packages, drafts are DB entities with IDs.
   - Storage URIs are internal implementation details.

2) Idempotent by default
   - The system never re-transcribes if a transcript already exists for the
     recording unless explicitly requested.

3) Automatic, queued work
   - Ingestion auto-enqueues transcription jobs.
   - BullMQ queues enforce rate limits and concurrency.

4) Non-destructive transcription
   - Never move or rename source audio by default.
   - Optional retention policy can delete audio after N days.

5) Storage adapter abstraction
   - Local storage and S3 supported.
   - Swap storage without rewriting pipeline logic.

6) Phase coexistence
   - Phase 1 (ttdg CLI) remains the active path until Phase 2 is production-ready.

---

## 3) Terminology

- Recording: a discovered audio file (source data).
- Transcript: text output + metadata for a recording.
- Prompt Package: stitched prompt content for manual LLM step.
- Draft: user-pasted LLM markdown output.
- Artifact: any stored file content referenced by URI.
- Storage URI: local:// or s3:// pointers.

---

## 4) System Overview

### Services
- Ingestion service
  - Scan mode (MVP): scans a recordings root folder (local).
  - Upload mode: accepts UI uploads into storage (S3 recommended).
  - Creates Recording rows and enqueues transcription jobs.
  - Manual sync endpoint triggers an immediate scan.

- Transcriber service
  - Deepgram adapter, `transcribe(recordingId)` API.
  - Writes transcript artifacts to storage + DB.

- Prompt assembly service
  - Uses template + profile + notes + transcript.
  - Template/profile selections are allowlisted and selected by ID.
  - Stores prompt package artifact and metadata.
  - Stitching order (canonical, matches docs/PIPELINE_INTEGRATION_VISION.md):
    1. Start with the prompt template.
    2. Replace `INSERT PROFILE HERE` with the full profile text.
    3. Append a `[NOTES]` header and the notes text.
    4. Append a `[TRANSCRIPT]` header and the full transcript text.

- Orchestrator handoff
  - Materialize approved draft to filesystem (e.g., uploads/) and pass the path into
    the existing pipeline flow.

### Queues
1) transcribe-queue
   - Payload: { recordingId }
   - Concurrency and rate limit enforced at worker.
   - Progress is emitted through the existing /jobs/events SSE stream (extend payloads as needed).

2) existing jobs queue
   - Unchanged, still handles pipeline run on approved markdown.

---

## 5) Data Model (DB)

### recordings
- id (uuid, pk)
- source (enum: "scan" | "upload")
- student_id (nullable; derived from folder name or upload selection)
- source_path (text, original path for audit, nullable)
- storage_uri (text, canonical)
- sha256 (text, optional but recommended)
- bytes (int)
- duration_sec (int, nullable)
- channels (int, nullable)
- status (enum: "ingested" | "queued" | "transcribing" | "transcribed" | "failed")
- error (text, nullable)
- created_at, updated_at

Student association:
- student_id is a deterministic UUID derived from the normalized student name.
- Scan ingestion uses the top-level folder name; uploads accept `studentId` or `student` name.

### transcripts
- id (uuid, pk)
- recording_id (fk)
- storage_uri (text)  // transcript text
- raw_response_uri (text, nullable)  // raw Deepgram JSON (stored in MVP; configurable off)
- mode (enum: "timeline" | "stack")
- model (text, default "nova-3")
- language (text, default "multi")
- fallback_used (bool)
- summary_json (jsonb)  // duration, channel info, etc
- created_at, updated_at

### prompt_packages
- id (uuid, pk)
- recording_id (fk)
- transcript_id (fk)
- student_id (nullable)
- profile_id or profile_path (nullable)
- template_version (text; stores template ID)
- notes (text, nullable)
- storage_uri (text)  // assembled prompt payload
- created_at, updated_at

### drafts
- id (uuid, pk)
- prompt_package_id (fk)
- student_id (nullable)
- storage_uri (text)  // markdown draft content
- created_by (user id)
- created_at, updated_at

### jobs (existing)
- add optional columns (aligned with batch-backend SSOT):
  - recording_id
  - transcript_id
  - prompt_package_id
  - draft_id

---

## 6) Storage Adapter

Interface:
```
putAudio(inputPath | stream) -> { uri, bytes, sha256 }
putTranscript(text) -> { uri, bytes }
putRawResponse(json) -> { uri, bytes }
putPromptPackage(text) -> { uri, bytes }
putDraft(text) -> { uri, bytes }
getText(uri) -> string
getStream(uri) -> Readable
delete(uri) -> void
```

### Local Storage (now)
- Base path: FILESYSTEM_UPLOAD_DIR (default: ./uploads)
- URI format: local://recordings/<id>.opus, local://transcripts/<id>.txt, local://transcripts/<id>.json
- Retention policy for recordings:
  - keep N days (config), delete after successful transcription.

### S3 (supported)
- URI format: s3://bucket/prefix/...
- Retention via S3 lifecycle rule.

---

## 7) Ingestion Flow (Auto + Manual)

### Auto Scan
- Interval (e.g. every 1-2 minutes) scans configured root.
- Find new files by extension and optional glob (opus/mp3/wav/m4a).
- Deduplicate by sha256 or (path + mtime + size).
- For each new file:
  - derive student_id from the first folder segment when present
  - store audio in storage adapter
  - create Recording row
  - enqueue transcription job

### Manual Sync
- POST /recordings/sync (admin)
- triggers a scan immediately
- returns count of new recordings discovered

### Upload Ingestion
- `POST /recordings/upload` accepts audio uploads.
- UI uploads create Recording rows with source="upload".
- Optional student association via `studentId` or `student` name query params.
- Uses the same storage adapter (S3 recommended) and transcribe-queue.
- Progress still flows through /jobs/events SSE.

---

## 8) Transcription Flow

### Worker Steps (transcribe-queue)
1) Load Recording row; if status is transcribed -> no-op.
2) Mark status -> transcribing.
3) Call Deepgram adapter:
   - primary: multichannel
   - fallback: diarized
4) Format transcript:
   - timeline or stack
   - include optional header metadata
5) Save transcript artifact + metadata.
6) Mark Recording -> transcribed.

### Notes
- No file moves.
- Caching is DB-based: existing transcript = skip.
- Errors persisted to Recording.error.

### Deepgram Integration Requirements
- Server-side SDK usage: createClient(apiKey) with DEEPGRAM_API_KEY.
- Token auth: pass a temporary access token via the accessToken option (not a raw string).
- Browser transcription: requires a backend proxy (Deepgram does not allow custom CORS origins).
- MVP channel mapping: assume 2-channel Opus; channel 0 is Teacher, channel 1 is Student.
  Only run diarization when the source is mono.

---

## 9) UI Flow Mapping (Frontend Vision Alignment)

1) Filter by student + choose recording
   - Student list from `GET /config/students`
   - Recording list from `GET /recordings?status=...&studentId=...` (or `student` name)
   - Live updates from `/jobs/events` (recording_state_changed)
2) Auto-transcribe (background)
   - UI shows progress via /jobs/events SSE (existing stream)
3) Review transcript
   - GET /recordings/:id/transcript
   - PUT /recordings/:id/transcript (edit)
4) Add notes + build prompt
   - POST /recordings/:id/prompt-package
   - GET /prompt-packages/:id
5) Paste draft + approve
   - POST /prompt-packages/:id/draft
   - Materialize draft to filesystem (e.g., FILESYSTEM_UPLOAD_DIR/drafts/<id>.md)
     and store the path on the job record
   - POST /jobs/:jobId/approve (existing)

---

## 10) API Endpoints (Minimal Set)

### Recordings
- GET /recordings?status=...&studentId=... (or `student` name)
- POST /recordings/sync
- POST /recordings/upload
- GET /recordings/:id
- GET /recordings/:id/transcript
- PUT /recordings/:id/transcript
- POST /recordings/:id/transcribe (manual retry)

### Prompt Packages
- POST /recordings/:id/prompt-package (optional `templateId`, `profileId`)
- GET /prompt-packages/:id

### Drafts
- POST /prompt-packages/:id/draft
- POST /drafts/:id/materialize (returns md_path for /jobs/:jobId/approve)

### Config
- GET /config/students
- GET /config/prompts

Implementation note:
- GET /recordings?status=... and GET /recordings/:id are available; the Phase 2 UI hydrates on load
  and merges `/jobs/events` for live recording status updates.
- Approval jobs created from drafts apply user defaults for preset + TTS strategy, set `upload=auto`,
  and enable TTS when an ElevenLabs key is configured.

---

## 11) Configuration

Transcription:
- DEEPGRAM_API_KEY
- DEEPGRAM_MODEL (default: nova-3)
- DEEPGRAM_LANGUAGE (default: multi)
- TRANSCRIBE_MODE (timeline|stack)
- TRANSCRIBE_MAX_CONCURRENCY
- DEEPGRAM_STORE_RAW_RESPONSE (optional, default: true)

Ingestion:
- RECORDINGS_ROOT (local path)
- RECORDINGS_SCAN_INTERVAL_SEC
- RECORDINGS_GLOB (default: **/*.{opus,mp3,wav,m4a})

Prompt allowlist:
- Templates are scanned from the directory containing `PROMPT_TEMPLATE_PATH`.
- Profiles are scanned from the directory containing `PROMPT_PROFILE_PATH`.
- The UI selects `templateId`/`profileId` from `GET /config/prompts`.

Storage:
- STORAGE_PROVIDER (filesystem|s3)
- FILESYSTEM_UPLOAD_DIR (filesystem base for artifacts + materialized drafts)
- S3_BUCKET + AWS creds (and optional S3_PREFIX/S3_PATH_PREFIX)
- RECORDINGS_RETENTION_DAYS (optional)

Compatibility notes:
- Phase 1 ttdg CLI uses TTDG_RUN_COMMAND/TTDG_RUN_CWD/TTDG_EXTRA_ARGS (see docs/reference/env.md).
- Phase 2+ transcription uses DEEPGRAM_* config and the shared storage adapter settings above.

---

## 12) Migration to S3

Design for URIs from day one. Migration steps:
1) Add S3 adapter in storage service.
2) Copy artifacts to S3.
3) Update URIs in DB to s3://...
4) Enable S3 lifecycle rules (audio retention).

No pipeline code changes required if adapter is isolated.

---

## 13) Open Questions

1) Transcript edit UX (inline editing vs text editor modal)
2) How to handle multiple recordings in the same lesson block?

---

## 14) Done When

Phase 2 Acceptance:
- New recording appears automatically in UI without manual path input (scan mode).
- Transcription runs via queue and produces transcript artifact.
- Transcript can be reviewed and edited.
- Prompt package assembles with correct template + profile + notes + transcript.
- Draft is materialized to filesystem and approved markdown triggers orchestrator + manifest.

---

## 15) Implementation Status (as-built)

Implemented in repo:
- Scan ingestion (`/recordings/sync`) and transcribe queue.
- Upload ingestion (`/recordings/upload`) with optional student association.
- Deepgram worker with multichannel + utterances + punctuation; diarize fallback for mono.
- Transcript read/update endpoints.
- Manual retry endpoint (`POST /recordings/:id/transcribe`) and queue-state UI surfacing.
- Prompt package creation + retrieval.
- Draft save + materialize to `FILESYSTEM_UPLOAD_DIR/drafts/<draftId>.md`.
- Draft materialization auto-creates an awaiting_approval job.
- Recording status SSE via `/jobs/events` and a Phase 2 transcription workspace UI.
- Startup validation for storage + prompt/recordings paths.

Known gaps to reach full Phase 2 acceptance:
- None (prompt allowlists, uploads, and student association are implemented).
