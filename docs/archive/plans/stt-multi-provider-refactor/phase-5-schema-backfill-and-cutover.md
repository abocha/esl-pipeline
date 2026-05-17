# Phase 5 - Schema, Backfill, and Cutover

## Goals

1. Make provider identity first-class in transcript persistence.
2. Remove heuristic dependence for runtime decisions.

## Deliverables

1. Migration adding `transcripts.stt_provider`.
2. Repository/model updates for read/write.
3. Backfill strategy precedence:
   - `summary_json.provider`
   - model inference
   - conservative default (`deepgram`)
4. Post-migration constraints for canonical provider values.

## Constraints

1. No transcript text rewrites.
2. Backfill must be deterministic and idempotent.
