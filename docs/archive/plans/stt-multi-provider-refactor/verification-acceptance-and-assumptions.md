# Verification, Acceptance, and Assumptions

## Verification Matrix

1. STT core package tests pass.
2. Provider adapter package tests pass for deepgram/elevenlabs/google.
3. Batch-backend transcription, cache, migration, and transport tests pass.
4. Batch-frontend STT selection tests pass.
5. Monorepo gates pass: `pnpm check:fast`, `pnpm docs:check`.

## Acceptance Criteria

1. STT provider selection is centralized and contract-driven.
2. Transcript provider identity is persisted explicitly and backfilled.
3. Cache reuse requires provider+mode+model+language compatibility.
4. Google STT V2 is available when prerequisites are configured.
5. Timeline/stack transcript contracts remain stable.

## Assumptions

1. Default STT provider remains `deepgram`.
2. No cross-provider fallback in runtime execution.
3. Historical transcripts are metadata-backfilled only.
4. Release labeling expectation: `release:minor`.
