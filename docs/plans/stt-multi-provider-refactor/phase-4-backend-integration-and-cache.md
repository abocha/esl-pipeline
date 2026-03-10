# Phase 4 - Backend Integration and Cache Policy

## Goals

1. Integrate STT engine into batch-backend transcription worker.
2. Remove provider branching from application layer.

## Deliverables

1. `process-transcribe-job` calls STT engine adapters.
2. Provider/runtime error classification via `@esl-pipeline/provider-runtime`.
3. Recording upload cache compatibility fingerprint hardened to:
   - provider
   - mode
   - model
   - language
4. Route schema and queue payload support for `google` provider.

## Constraints

1. Existing endpoints remain additive/backward-compatible.
2. No behavioral drift for Deepgram/ElevenLabs aside from intended parity fixes.
