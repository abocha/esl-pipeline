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

This is a near-final Phase 2+ draft intended to be implemented with minimal ambiguity.

Implementation manual (step-by-step with review gates):
- docs/design/TRANSCRIPTION_PIPELINE_IMPLEMENTATION_MANUAL.md

---

## 1) Scope and Non-Goals

### Scope (Phase 2 MVP)
- Auto-ingest recordings from a local folder (scan mode) and enqueue transcription jobs.
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
- Upload ingestion (UI uploads backed by S3) in the Phase 2 MVP.

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
   - Local storage now, S3 later.
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
  - Upload mode (future): accepts UI uploads into storage (likely S3).
  - Creates Recording rows and enqueues transcription jobs.
  - Manual sync endpoint triggers an immediate scan.

- Transcriber service
  - Deepgram adapter, `transcribe(recordingId)` API.
  - Writes transcript artifacts to storage + DB.

- Prompt assembly service
  - Uses template + profile + notes + transcript.
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
- student_id (nullable, future)
- source_path (text, original path for audit, nullable)
- storage_uri (text, canonical)
- sha256 (text, optional but recommended)
- bytes (int)
- duration_sec (int, nullable)
- channels (int, nullable)
- status (enum: "ingested" | "queued" | "transcribing" | "transcribed" | "failed")
- error (text, nullable)
- created_at, updated_at

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
- profile_id or profile_path (nullable)
- template_version (text)
- notes (text, nullable)
- storage_uri (text)  // assembled prompt payload
- created_at, updated_at

### drafts
- id (uuid, pk)
- prompt_package_id (fk)
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

### S3 (later)
- URI format: s3://bucket/prefix/...
- Retention via S3 lifecycle rule.

---

## 7) Ingestion Flow (Auto + Manual)

### Auto Scan
- Interval (e.g. every 1-2 minutes) scans configured root.
- Find new files by extension and optional glob (opus/mp3/wav/m4a).
- Deduplicate by sha256 or (path + mtime + size).
- For each new file:
  - store audio in storage adapter
  - create Recording row
  - enqueue transcription job

### Manual Sync
- POST /recordings/sync (admin)
- triggers a scan immediately
- returns count of new recordings discovered

### Upload Ingestion (future)
- UI uploads create Recording rows with source="upload".
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

---

## 9) UI Flow Mapping (Frontend Vision Alignment)

1) Select student (future) + choose recording
   - GET /recordings?status=ingested|transcribed
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
- GET /recordings?status=...
- POST /recordings/sync
- GET /recordings/:id
- GET /recordings/:id/transcript
- PUT /recordings/:id/transcript
- POST /recordings/:id/transcribe (optional manual retry)

### Prompt Packages
- POST /recordings/:id/prompt-package
- GET /prompt-packages/:id

### Drafts
- POST /prompt-packages/:id/draft
- POST /drafts/:id/materialize (returns md_path for /jobs/:jobId/approve)

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

1) Student association (auto-detect from folder vs manual UI selection)
2) Transcript edit UX (inline editing vs text editor modal)
3) How to handle multiple recordings in the same lesson block?

---

## 14) Done When

Phase 2 Acceptance:
- New recording appears automatically in UI without manual path input (scan mode).
- Transcription runs via queue and produces transcript artifact.
- Transcript can be reviewed and edited.
- Prompt package assembles with correct template + profile + notes + transcript.
- Draft is materialized to filesystem and approved markdown triggers orchestrator + manifest.
