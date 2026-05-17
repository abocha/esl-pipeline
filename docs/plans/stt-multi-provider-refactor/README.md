# STT Multi-Provider Refactor

## Meta

- Audience: maintainers and speech-runtime agents.
- Authority Level: active staged roadmap.
- Last Verified Against: 2026-05-17 repo state.
- Owner: founder-maintainer + speech-runtime maintainers.
- Review Cadence: after STT provider or transcription pipeline PRs.
- Status: `roadmap`.
- Exit Trigger: archive after STT provider runtime behavior is shipped and captured in package READMEs, env policy, and operations docs.

## Summary

This plan refactors STT into a provider-agnostic architecture parallel to TTS (`core + adapters + registry`), then adds Google Cloud STT V2 as a first-class provider.

Locked decisions:

1. Full architecture parity with TTS-style provider seams.
2. Explicit `transcripts.stt_provider` persistence with historical backfill.
3. Google Cloud STT V2 target.
4. Required GCS staging bucket for Google large-audio path.
5. No cross-provider runtime fallback; provider selection is explicit override or default only.

## Scope

1. New STT core and provider packages.
2. Batch-backend transcription pipeline integration, cache hardening, and startup validation.
3. DB migration + backfill for provider identity.
4. Frontend/provider metadata exposure for STT selector.
5. Operational documentation updates.

## Phase Index

1. [phase-1-core-contracts.md](phase-1-core-contracts.md)
2. [phase-2-provider-adapters-deepgram-elevenlabs.md](phase-2-provider-adapters-deepgram-elevenlabs.md)
3. [phase-3-provider-adapter-google-v2.md](phase-3-provider-adapter-google-v2.md)
4. [phase-4-backend-integration-and-cache.md](phase-4-backend-integration-and-cache.md)
5. [phase-5-schema-backfill-and-cutover.md](phase-5-schema-backfill-and-cutover.md)
6. [phase-6-frontend-docs-and-ops.md](phase-6-frontend-docs-and-ops.md)
7. [verification-acceptance-and-assumptions.md](verification-acceptance-and-assumptions.md)

## Acceptance Gates

1. `pnpm --filter @esl-pipeline/stt-core test`
2. `pnpm --filter @esl-pipeline/stt-provider-deepgram test`
3. `pnpm --filter @esl-pipeline/stt-provider-elevenlabs test`
4. `pnpm --filter @esl-pipeline/stt-provider-google test`
5. `pnpm --filter @esl-pipeline/batch-backend test -- application.process-transcribe-job.test.ts`
6. `pnpm --filter @esl-pipeline/batch-backend test -- transport.extended-routes-provider-cache.test.ts`
7. `pnpm --filter @esl-pipeline/batch-frontend test`
8. `pnpm check:fast`
9. `pnpm docs:check`

## Rollback Notes

1. Runtime rollback path is `STT_PROVIDER=deepgram` while retaining new schema columns.
2. `stt_provider` backfill is additive metadata; no transcript text artifacts are rewritten.
3. If Google STT rollout is blocked, keep provider registered but unavailable until prerequisites validate.
