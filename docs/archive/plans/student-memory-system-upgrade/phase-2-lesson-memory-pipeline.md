# Phase 2 - Lesson Memory Pipeline

## Goals

1. Turn lesson transcript analysis into a first-class canonical lesson-memory pipeline.
2. Make lesson memory asynchronous and non-blocking for the live homework-generation flow.
3. Support replay, retry, and future batch-cost optimization without changing the canonical lesson
   memory contract.
4. Replace the legacy transcript-analysis path with canonical lesson-memory artifacts.

## Explicit Out Of Scope

1. Transcript-formatting improvements are not part of this upgrade phase.
2. Phase 2 may reference future transcript-formatting improvements as a possible quality or cost
   optimization path, but lesson-memory implementation must not depend on transcript-format
   redesign.
3. The canonical input for this phase is the existing lesson transcript output plus supporting
   context, not a newly redesigned transcript representation.

## Locked Decisions

1. Lesson memory is generated from the full lesson as a whole entity.
2. Student-only transcript extraction remains a supporting helper, not the canonical primary input.
3. Teacher notes are included as supporting context when available.
4. The current homework assignment must not depend on lesson-memory generation finishing first.
5. Lesson-memory generation is eventually consistent and asynchronous.
6. The safe trigger point is when the teacher first uses the transcript for assignment generation
   context, not when transcription merely completes and not only after publish succeeds.
7. Version 1 stores rich structured lesson memory plus one compact human-readable summary.
8. Version 1 allows explicit facts plus moderate tagged inference.
9. Evidence snippets are stored when available for facts, mistakes, and pronunciation observations.
10. Evidence must be selective and confidence-aware because STT output may contain noise.
11. Failure handling is bounded automatic retries, then `failed` status for operator/backfill
    replay.
12. The pipeline must be queueable and batch-friendly for future cost optimization, but version 1
    does not require provider batch APIs.

## Why This Phase Comes First

The repo already has usable lesson-analysis building blocks:

1. transcript storage and transcript metadata
2. existing transcript-analysis helpers
3. the existing refresh tool for transcript-derived history

That makes lesson memory the cleanest episode-level artifact to formalize first.

## Canonical Inputs

### Primary input bundle

Lesson memory is generated from:

1. full lesson transcript text
2. transcript metadata
3. recording metadata
4. student id and student binding context
5. teacher notes for that lesson when available

### Supporting helper inputs

These may be used to improve extraction quality, but they are not the canonical primary input:

1. student-only extracted transcript
2. speaker-track transcript artifacts
3. transcript-side metadata already present in legacy summary payloads

## Input Handling Rules

1. The full lesson is the canonical unit of analysis.
2. Lesson memory should not be generated from student-only transcript text alone.
3. Student-only extraction may be used as an auxiliary signal for fact extraction, error analysis,
   or speaker disambiguation.
4. Teacher notes may add pedagogic intent, correction context, or nuance absent from raw transcript
   text and should be included when available.
5. Phase 2 should leave room for transcript-formatting improvements that make the lesson transcript
   more LLM-friendly:
   - clearer speaker markers
   - less timestamp noise
   - longer coherent utterance blocks
6. Those transcript-formatting improvements are explicitly out of scope for Phase 2 and must not be
   treated as implementation prerequisites.

## Canonical Lesson Memory Output

Each lesson memory entry must produce:

1. `lessonSummary`
2. `topicsDiscussed`
3. `mistakePatterns`
4. `grammarReviewed`
5. `grammarWatchlist`
6. `vocabularyFocus`
7. `pronunciationFocus`
8. `studentFacts`
9. `progressSignals`
10. `followUpRecommendations`

Output shape rules:

1. Structured fields are the canonical payload.
2. `lessonSummary` is a compact human-readable summary and is secondary to the structured payload.
3. The lesson-memory artifact must be usable both for future pipeline retrieval and for future
   human-facing lesson-history UI.

## Fact And Evidence Rules

1. Explicit student facts should always be extracted when clearly present.
2. Moderate inference is allowed when tagged as `model_inferred`.
3. Facts must preserve authority and confidence from the Phase 1 fact contract.
4. Evidence snippets should be stored when available for:
   - facts
   - mistake patterns
   - pronunciation observations
5. Evidence snippets must be confidence-aware and selective. The system must not treat STT noise,
   corrupted tokens, or obvious multilingual recognition artifacts as reliable evidence of student
   mistakes.
6. Version 1 should prefer omission over low-confidence overclaiming.

## Trigger Model

### Canonical trigger

The lesson-memory job is created when the teacher first uses the transcript for assignment
generation context.

Practical trigger points:

1. prompt-package creation
2. first draft-generation attempt using that prompt package lineage

### Explicit non-triggers

1. transcription completion alone is too early
2. publish success alone is too late

### Why this trigger is canonical

1. It avoids eagerly creating memory for obviously wrong uploads or abandoned transcripts.
2. It matches the real workflow where the teacher edits and validates the current lesson transcript
   while preparing the assignment.
3. It creates lesson memory early enough to support later continuity without making live generation
   fragile.

## Runtime Model

### Non-blocking generation

1. The current assignment flow uses the raw latest transcript directly.
2. Lesson-memory generation runs asynchronously and must not block prompt-package creation or draft
   generation.
3. Newly generated lesson memory is mainly for future retrieval, rollups, and human-facing history.

### Eventual consistency

1. Lesson memory is eventually consistent.
2. Only `ready` lesson memory is eligible for future rollups and retrieval.
3. Missing lesson memory for the current lesson must not prevent current assignment generation.

## Lifecycle And Failure Model

Lesson-memory artifacts use the shared Phase 1 lifecycle:

1. `pending`
2. `ready`
3. `failed`
4. `superseded`

Lesson-memory rules:

1. Newly queued work starts as `pending`.
2. Successful generation writes a new append-only `ready` row.
3. Older canonical rows for the same transcript scope become `superseded`.
4. Generation failures become `failed` after bounded retries.
5. `failed` rows remain inspectable and replayable.

## Transcript Edit Handling

1. Transcript edits are supported but are not the core design center for Phase 2.
2. Teachers are expected to edit the transcript of the current lesson while preparing the current
   assignment, not routinely revisit old lesson transcripts.
3. For edited historical transcripts, lesson-memory refresh should be operator-triggered or
   replay-driven rather than aggressively automatic.
4. Phase 2 must account for correction and replay, but it should not optimize the whole system
   around frequent historical transcript edits.

## Queueing, Replay, And Batch-Friendliness

The lesson-memory pipeline must support:

1. async queueing
2. bounded automatic retries
3. targeted replay for one transcript or student
4. historical backfill sweeps
5. future batch-provider submission

Batch-friendliness rules:

1. The artifact contract must not assume one-by-one execution forever.
2. The queue model should allow pending lesson-memory work to be processed later in grouped batches.
3. Provider-specific batch APIs are an optimization path, not a version-1 dependency.
4. Cost optimization must not change canonical lesson-memory output shape or lifecycle semantics.

## Backfill And Replay

The existing refresh tooling should be evolved rather than discarded.

Version 1 backfill and replay expectations:

1. discover transcripts missing canonical lesson memory
2. process in bounded batches
3. write canonical lesson-memory artifacts
4. support `dry-run`
5. support provider override
6. support model override
7. support bounded limits
8. support replay of failed or operator-selected transcripts

## Repository And Query Requirements

The backend will need lesson-memory operations for:

1. insert lesson-memory entry
2. list lesson memory for one student
3. fetch latest ready lesson memory by transcript id
4. fetch recent ready lesson memory for prompt packaging
5. list pending or failed lesson-memory work for ops/backfill
6. supersede older canonical lesson memory for the same transcript scope

## Compatibility And Cutover

1. Canonical lesson memory lives in the new lesson-memory table, not in
   `transcripts.summary_json.analysis`.
2. The old transcript-analysis path is not synchronized once canonical lesson memory exists.
3. Existing helper logic in the current transcript-analysis code may be reused during implementation,
   but the canonical output must be the new lesson-memory artifact.
4. The aggregated text-style lesson-history appendix should eventually be rebuilt from canonical
   lesson-memory entries rather than legacy transcript summary blobs.

## What This Phase Unlocks

1. deterministic per-lesson memory inspection
2. historical lesson-memory backfill
3. stable inputs for student-memory rollup generation
4. future batch-cost optimization without changing the memory contract
5. richer future retrieval than the current lightweight aggregated appendix

## Exit Criteria

1. Canonical lesson-memory rows exist for newly used transcripts.
2. Lesson-memory generation is asynchronous and non-blocking for live homework generation.
3. The canonical trigger is locked to first assignment-generation use of the transcript.
4. Historical backfill and replay paths are defined.
5. Transcript edit handling is accounted for without becoming the design center.
6. Legacy transcript analysis is no longer treated as canonical storage.
