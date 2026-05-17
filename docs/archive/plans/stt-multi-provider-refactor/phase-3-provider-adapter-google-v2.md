# Phase 3 - Google Cloud STT V2 Adapter

## Goals

1. Add Google as first-class STT provider.
2. Support dual-speaker timeline parity via multichannel-first flow.

## Deliverables

1. `@esl-pipeline/stt-provider-google` adapter with:
   - Google Cloud STT V2 execution
   - multichannel-first mode
   - diarization fallback mode
   - normalized segment ordering/labels
2. Required GCS staging support for non-GCS audio.
3. Startup prerequisite validation hooks consumed by backend.

## Constraints

1. Explicit operator errors when Google credentials or staging bucket are missing.
2. Keep behavior deterministic when channel/speaker metadata is partially missing.
