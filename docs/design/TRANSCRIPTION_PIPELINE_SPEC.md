# Transcription Pipeline Spec (Active)

## Meta

- Audience: AI agents touching recording/transcript/prompt/draft flow.
- Read Time: 8 minutes.
- Authority Level: Active design spec.
- Last Verified Against: 2026-03-10 repo state.

## Purpose

- Define active artifact model, flow invariants, and integration boundaries for transcription.
- Support implementation decisions without requiring immediate code deep-dive.

## When To Read

- Before editing transcription ingest, transcript handling, prompt assembly, or draft materialization.

## Canonical Sources

1. `docs/reference/agents-ssot.md`
2. `docs/backend-frontend/backend-frontend-alignment.md`
3. `docs/PIPELINE_INTEGRATION_VISION.md`

## Current State

- Upload-based ingestion and queue-backed transcription are active.
- Transcript review/edit, prompt package generation, draft save, and materialize+approve are active.
- Prompt template/profile selection is DB-canonical (active revisions in Postgres).
- STT execution is provider-agnostic (`stt-core` + provider adapters) with active providers:
  - `deepgram`
  - `elevenlabs` (Scribe v2)
  - `google` (Cloud STT V2 with required GCS staging for non-`gs://` inputs)
- Historical staged manual is archived.

## Artifact Model

- `recording`: uploaded audio artifact + status metadata.
- `transcript`: text artifact + optional raw model response metadata.
  - canonical provider identity is persisted on each row (`transcripts.stt_provider`).
- `prompt package`: template/profile/notes/transcript assembly output.
- `draft`: user-provided markdown artifact prior to approval.
- `job`: orchestrator handoff and publish lifecycle.

## Core Invariants

- Users interact with artifact IDs, not file paths.
- Re-transcription is explicit, not implicit.
- Runtime provider selection is explicit (`request override` or configured default); no cross-provider fallback.
- Draft materialization is the handoff boundary to approval/publish flow.
- Prompt assembly order is deterministic:
  1. template
  2. profile injection
  3. notes block
  4. transcript block

## Active Endpoint Surface

- Recording ingest/status/transcript:
  - `/recordings/upload`
  - `/recordings/:id`
  - `/recordings/:id/transcript` (GET/PUT)
  - `/recordings/:id/transcribe`
- Prompt and draft:
  - `/config/prompts`
  - `/recordings/:id/prompt-package`
  - `/prompt-packages/:id/draft`
  - `/drafts/:id/materialize`
- Publish handoff:
  - `/jobs/:jobId/approve`
  - `/jobs/:jobId`
  - `/jobs/events`

## Failure Modes To Watch

- storage adapter/config mismatch
- large recording limits
- provider outages (Deepgram, Notion, TTS, S3)
- STT provider credential/prerequisite drift (Deepgram token, ElevenLabs key, Google project/staging bucket)
- SSE interruptions requiring polling fallback

## Do / Don't

- Do keep this doc focused on invariants and active interfaces.
- Do move detailed implementation narratives to archive.
- Don't duplicate endpoint status tables from alignment doc.

## Historical Detail

Archived detailed version:

- `docs/archive/pipeline/2026-02/transcription-pipeline-spec-pre-agent-pass2.md`

## Related

- `docs/PIPELINE_INTEGRATION_VISION.md`
- `docs/backend-frontend/BATCH_SYSTEM.md`
- `docs/backend-frontend/backend-frontend-alignment.md`
