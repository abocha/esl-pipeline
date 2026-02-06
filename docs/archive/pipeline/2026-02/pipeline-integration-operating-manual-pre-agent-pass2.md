# Pipeline Integration Operating Manual

This is the active operational manual for the end-to-end transcription and assignment publishing flow.

## 1. Current Operating Status

Phase 2+ native transcription is the active path and is implemented end-to-end.

Implemented capabilities:
- Recording upload ingestion (`POST /recordings/upload`)
- Queue-backed transcription with Deepgram
- Transcript read/edit APIs and frontend workflow
- Prompt package creation from template/profile/transcript
- Draft creation and materialization
- Approval handoff into orchestrator pipeline

Historical phased manuals are archived under:
- `docs/archive/pipeline/2026-02/`

## 2. End-to-End Flow

1. Upload recording through UI.
2. Ingestion creates recording artifact and enqueues transcription.
3. Worker writes transcript artifacts and status.
4. User reviews and edits transcript.
5. User generates prompt package text.
6. User saves draft markdown.
7. Draft materialization creates or updates approval job.
8. Approval runs orchestrator publish pipeline.

## 3. Core Packages

- `packages/batch-frontend`
- `packages/batch-backend`
- `packages/orchestrator`

## 4. Prompt And Profile Assets

- Prompt templates: `docs/templates/`
- Example profile: `docs/templates/PROFILE_2025-11-16.md`
- Profile creation prompt: `docs/templates/NEW PROFILE.txt`

Canonical prompt assembly order:
1. Template base
2. Replace `INSERT PROFILE HERE` with profile text
3. Append `[NOTES]`
4. Append `[TRANSCRIPT]`

## 5. Runbook

Prerequisites:
- Backend services are up
- `DEEPGRAM_API_KEY` configured
- Extended API enabled on backend

Operational steps:
1. Upload audio in frontend.
2. Wait for transcript readiness.
3. Review/edit transcript.
4. Generate prompt package.
5. Save draft.
6. Materialize and approve.
7. Monitor job status until publish completes.

## 6. Configuration Notes

Primary env references:
- `docs/reference/env.md`

Common settings for this flow:
- Deepgram model/language settings
- transcription queue settings
- prompt template/profile path settings
- storage adapter settings

## 7. Known Risks

- Large recordings require `RECORDINGS_MAX_FILE_SIZE` tuning.
- Prompt/profile path constraints must match configured roots.
- Student IDs derived from normalized names can fork history after renames.
- SSE interruptions may require manual refresh/polling fallback.

## 8. Related Active Docs

- System guide: `docs/backend-frontend/BATCH_SYSTEM.md`
- API status tracker: `docs/backend-frontend/backend-frontend-alignment.md`
- Transcription spec: `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`
- SSOT contracts: `docs/reference/agents-ssot.md`
