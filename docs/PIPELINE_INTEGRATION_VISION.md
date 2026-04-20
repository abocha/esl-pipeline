# Pipeline Integration Runbook (Active)

## Meta

- Audience: AI agents working on transcription/publish flow.
- Read Time: 5 minutes.
- Authority Level: Operational runbook.
- Last Verified Against: 2026-03-13 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after transcription/publish workflow changes.
- Status: `runbook`.

## Purpose

- Define the active end-to-end flow from recording upload to published assignment.
- Capture operational invariants and failure points.

## When To Read

- Backend/frontend tasks touching recording, transcript, draft, or approval path.

## Canonical Sources

1. `docs/reference/agents-ssot.md`
2. `docs/backend-frontend/backend-frontend-alignment.md`
3. `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`

## Current State

- Active path is Phase 2+ native transcription flow.
- Draft materialization feeds approval jobs; approval triggers orchestrator pipeline.
- Prompt options/defaults are resolved from DB-canonical prompt assets.
- Historical phased manuals are archived under `docs/archive/pipeline/2026-02/`.

## Active Flow

1. Upload recording in frontend.
2. Backend ingests recording and queues transcription.
3. Worker writes transcript artifacts and status.
4. User reviews and optionally edits transcript.
5. User generates prompt package from template/profile/transcript.
6. User saves draft markdown.
7. Backend materializes draft and creates/updates approval job.
8. User approves job; orchestrator runs publish pipeline.

## Operational Invariants

- Recording/transcript/prompt/draft are artifact entities, not user-managed file paths.
- Retries should be explicit (`POST /recordings/:id/transcribe`) and status-visible.
- Approval is the handoff boundary between content prep and pipeline execution.
- SSE can be supplemented by polling/refresh paths during interruptions.

## Known Risk Areas

- Large recording limits (`RECORDINGS_MAX_FILE_SIZE`).
- Storage path/root configuration mismatch.
- Student ID churn when naming conventions change.
- External provider availability (Deepgram/TTS/S3).

## Do / Don't

- Do validate current status in alignment doc before implementation.
- Do treat this file as runbook, not roadmap.
- Don't duplicate endpoint contracts here if already canonical elsewhere.

## Related

- `docs/backend-frontend/BATCH_SYSTEM.md`
- `docs/backend-frontend/backend-frontend-alignment.md`
- `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`
