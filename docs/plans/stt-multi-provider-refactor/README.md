# STT Multi-Provider Refactor

## Meta

- Audience: maintainers and speech-runtime agents.
- Authority Level: active staged roadmap.
- Last Verified Against: 2026-09-01 repo state and the approved ordinary-ingest Goal Contract.
- Owner: founder-maintainer + speech-runtime maintainers.
- Review Cadence: after STT provider or transcription pipeline PRs.
- Status: `roadmap`.
- Exit Trigger: archive after ordinary recording ingest is rollout-proven and captured in package READMEs, environment policy, and operations docs.
- Current Focus: execute the approved ordinary lesson-recording ingest-readiness plan; provider selection and benchmark decisions are closed.

## Summary

The provider refactor is complete enough for the locked production routes. The active work is to make ordinary lesson-recording upload safe and routine without reopening provider comparison.

Current locked decisions:

1. ElevenLabs Scribe v2 owns ordinary `mixed_recording` transcription with exactly two speakers.
2. Deepgram multichannel owns explicitly trusted split-channel transcription.
3. There is no automatic cross-provider fallback.
4. Normal tutors do not need provider or topology knowledge.
5. The active readiness boundary is tenant-safe streaming ingest, deterministic media validation, bounded retry/claiming, truthful states, and audio disposal.

## Scope

1. Workspace-owned recording/transcript/cache operations.
2. Streaming upload and provider submission without whole-file buffers.
3. Deterministic probe and cheap allowlisted video-audio stream copy.
4. One bounded retry/claim/submission state machine.
5. Source-confirmation and TTL-based audio disposal.
6. Truthful normal-user states, errors, and recovery.

## Active Implementation Plan

1. [Ordinary lesson recording ingest readiness](2026-09-01-normal-user-audio-ingest-readiness.md)
   owns the approved Goal Contract, architecture, slice order, migration, validation, rollout, and
   documentation lifecycle for normal-user readiness.

## Historical Trace

Archived phase details remain available for rationale, but this README is the active edit surface.

1. [phase-1-core-contracts.md](../../archive/plans/stt-multi-provider-refactor/phase-1-core-contracts.md)
2. [phase-2-provider-adapters-deepgram-elevenlabs.md](../../archive/plans/stt-multi-provider-refactor/phase-2-provider-adapters-deepgram-elevenlabs.md)
3. [phase-3-provider-adapter-google-v2.md](../../archive/plans/stt-multi-provider-refactor/phase-3-provider-adapter-google-v2.md)
4. [phase-4-backend-integration-and-cache.md](../../archive/plans/stt-multi-provider-refactor/phase-4-backend-integration-and-cache.md)
5. [phase-5-schema-backfill-and-cutover.md](../../archive/plans/stt-multi-provider-refactor/phase-5-schema-backfill-and-cutover.md)
6. [phase-6-frontend-docs-and-ops.md](../../archive/plans/stt-multi-provider-refactor/phase-6-frontend-docs-and-ops.md)
7. [verification-acceptance-and-assumptions.md](../../archive/plans/stt-multi-provider-refactor/verification-acceptance-and-assumptions.md)
8. [ElevenLabs mixed-recording production adoption](../../archive/plans/stt-multi-provider-refactor/2026-08-30-elevenlabs-mixed-production-adoption.md)

## Acceptance Gates

1. The active plan's Goal Contract matrix passes, including tenant, concurrency, retry, media, retention, and refresh/resume boundaries.
2. Provider package, batch-backend, and batch-frontend targeted tests pass.
3. The exact production Docker image passes synthetic FFmpeg probe/copy tests before video is enabled.
4. DB/worker/integration changes pass `pnpm check` and required contract/baseline verification.
5. Active runtime and operations docs pass generated-index, format, hygiene, and docs checks.

## Rollback Notes

1. Retain additive schema/run evidence; do not down-migrate.
2. Never roll back to an API that permits cross-workspace access; pause intake and roll forward.
3. Narrow media acceptance to direct audio if video preparation fails.
4. Pause workers without switching providers or resetting physical-submission counters if retry/submission behavior is unsafe.
5. Disable the cleanup worker while retaining pending rows if deletion behavior is unsafe.
