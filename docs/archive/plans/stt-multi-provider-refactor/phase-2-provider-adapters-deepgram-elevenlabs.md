# Phase 2 - Deepgram and ElevenLabs Adapters

## Goals

1. Extract provider-specific logic from `process-transcribe-job`.
2. Preserve existing Deepgram/ElevenLabs behavior and fallback semantics.

## Deliverables

1. `@esl-pipeline/stt-provider-deepgram` adapter:
   - multichannel first
   - diarized fallback
   - retry profile aligned with current behavior
2. `@esl-pipeline/stt-provider-elevenlabs` adapter:
   - multichannel first
   - diarized fallback
   - `speakerId`/`speaker_id` + `channelIndex` parsing
   - `scribe_v2` model persistence metadata
3. Adapter-focused unit tests.

## Constraints

1. Timeline/stack formatting parity with current outputs.
2. No cross-provider fallback.
