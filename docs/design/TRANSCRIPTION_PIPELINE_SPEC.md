# Transcription Pipeline Spec (Active)

## Meta

- Audience: AI agents touching recording/transcript/prompt/draft flow.
- Read Time: 8 minutes.
- Authority Level: Active design spec.
- Last Verified Against: 2026-09-09 recording-ingest closeout state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after artifact-model changes.
- Status: `spec`.

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

- Bounded upload-based ingestion and durable run/queue-backed transcription are active.
- Transcript review/edit, prompt package generation, draft save, and materialize+approve are active.
- Prompt template/profile selection is DB-canonical (active revisions in Postgres).
- STT execution is provider-agnostic (`stt-core` + provider adapters) with active providers:
  - `deepgram`
  - `elevenlabs` (Scribe v2)
  - `google` (Cloud STT V2 with required GCS staging for non-`gs://` inputs)
- Historical staged manual is archived.

## Artifact Model

- `recording`: workspace-owned media lineage, canonical product/run projection, and zero or one
  recording-owned retained-audio object. Cache hits use `not_retained`; physical deletion uses the
  separate `pending`/`deleting`/`delete_failed`/`deleted` lifecycle.
- `transcript`: text artifact + optional raw model response metadata.
  - canonical provider identity is persisted on each row (`transcripts.stt_provider`).
- `transcription run`: durable claim, submission-reservation, outcome, latency, and terminal state.
- `recording upload operation`: workspace-scoped browser operation UUID plus immutable physical
  candidates; candidate reconciliation is distinct from recording-owned retained-audio cleanup.
- `prompt package`: template/profile/notes/transcript assembly output.
- `draft`: user-provided markdown artifact prior to approval.
- `job`: orchestrator handoff and publish lifecycle.

## Core Invariants

- Users interact with artifact IDs, not file paths.
- Transient, ambiguous, and provider/adapter-malformed outcomes recover automatically within three
  durable provider reservations where their existing policy permits. A response successfully received
  and normalized but rejected by worker deterministic structural validation terminalizes without another
  automatic paid provider submission. BullMQ delivery attempts are not provider reservations.
- Normal users cannot retry active or successful transcription; terminal recovery is a new or
  replacement recording upload.
- Runtime provider selection is explicit (`request override` or configured default); no cross-provider fallback.
- All recording, transcript, cache, retry, retrieval, and deletion authority is workspace scoped.
- Source confirmation makes retained audio unavailable in the same transaction and requests physical
  deletion; failed and abandoned unconfirmed audio expires after seven days by default. Text lineage
  remains durable.
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
  - `/recordings/:id/audio`
  - `/recordings/:id/transcribe` (backend-only failed-recording recovery seam; not normal-user UI)
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
- 2 GiB source guard, 10 GiB temp-disk reserve, and 100-minute duration enforcement
- corrupt, no-audio, multiple-audio-stream, or unsupported container/codec rejection
- missing FFmpeg/ffprobe or failed stream-copy/re-probe
- provider outages (Deepgram, Notion, TTS, S3)
- STT provider credential/prerequisite drift (Deepgram token, ElevenLabs key, Google project/staging bucket)
- stale run claims, ambiguous provider outcomes, and exhausted submission reservations
- retained-audio deletion permission or ownership failures
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

## Mixed and trusted recording topology

Ordinary uploads persist `mixed_recording` and route to the versioned
`mixed-recording-elevenlabs-scribe-v2-v1` profile. Initial diarized labels are anonymous; Source
confirmation requires a tutor-confirmed Teacher/Student mapping. An explicit
`trusted_split_channels` declaration retains Deepgram multichannel channel 0 tutor / channel 1
student semantics and fails closed if that two-channel contract is not returned. Cache reuse also
matches persisted topology and exact request-profile ID.

Ordinary direct audio supports MP3, PCM16 WAV, AAC/M4A, Ogg/Opus, and WebM/Opus. A single audio
stream may be copied from MP4/AAC, MOV/AAC, or WebM/Opus video; the source video is removed before
remote retention and the audio codec/channels are not changed. Other source families remain
uncertified until representative exports are probed in the production image.

For S3-backed ElevenLabs submissions, storage creates a fresh short-lived presigned URL and the SDK
serializes `sourceUrl` as `source_url`. Filesystem media remains file-backed with its probed MIME and
filename. Neither path collects the whole file into a Buffer; provider SDK retries are disabled.

`STT_PROVIDER` is an all-topology emergency rollback override, not a per-topology selection. In the
current topology set only `deepgram` is valid; per-request support overrides remain topology-scoped.
