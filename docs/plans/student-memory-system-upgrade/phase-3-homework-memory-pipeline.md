# Phase 3 - Homework Memory Pipeline

## Goals

1. Introduce a canonical homework-memory artifact for published assignments.
2. Capture what the student was actually assigned, not just what was discussed in class.
3. Preserve continuity across assignments without making homework memory depend on presentation
   formatting or rendering-target details.
4. Keep publish success independent from homework-memory extraction success.

## Locked Decisions

1. Homework memory is sourced from published outputs only.
2. The canonical source is the published markdown content linked to the successful published job,
   regardless of publish target.
3. Homework memory is generated asynchronously after publish succeeds and must not block publish
   completion.
4. A new homework-memory entry is created only when the published markdown content changed.
5. Multiple publish targets for the same markdown produce one homework-memory content artifact, with
   publish-target metadata attached.
6. Homework memory summarizes the student-facing assignment and pedagogic targets, not the full
   answer-key body.
7. Teacher follow-up plan is included only as compact structured continuity cues.
8. Extraction should normalize away formatting fluff wherever that can be done safely in the
   backend.
9. Homework memory stores explicit review targets only when the assignment clearly includes them.
10. Homework memory does not store the full study text; it stores study-text type plus semantic
    summary and targets.
11. If publish succeeds but homework-memory extraction fails, publish remains successful and
    homework memory is marked failed for retry.

## Why This Phase Follows Lesson Memory

Homework memory reuses the same architectural model established for lesson memory:

1. canonical append-only memory artifact
2. explicit provenance
3. replay/backfill support
4. shared lifecycle semantics

It should be built on those same rules rather than inventing a separate artifact model.

## Canonical Source Of Homework Truth

Homework memory is derived from the canonical published markdown associated with a successful
published job.

Source-truth rules:

1. The markdown content linked to the successful published job is the primary truth.
2. Rendered targets such as Notion, HTML, or Anytype are delivery surfaces, not the canonical
   semantic source.
3. Publish-target metadata should be retained structurally, but it does not define a separate
   homework-memory artifact when the content is identical.

## Trigger Model

### Canonical trigger

Homework-memory generation is triggered asynchronously after publish succeeds.

### Runtime rules

1. Publish success is the safe point for homework truth.
2. Homework-memory generation must not block successful publish completion.
3. Homework-memory generation is eventually consistent.
4. Homework-memory creation may lag publish completion, but that lag is acceptable because version 1
   prioritizes trust over immediate availability.

## Versioning And Change Detection

1. A new homework-memory entry is created only when the canonical published markdown content
   changed.
2. Republishing the same markdown to the same or additional targets does not create a new
   homework-memory content artifact.
3. Changed published markdown creates a new append-only homework-memory row and supersedes the
   previously canonical row for that published assignment lineage.

## Canonical Homework Memory Output

Each homework-memory entry must produce:

1. `homeworkSummary`
2. `topic`
3. `grammarTargets`
4. `vocabularyTargets`
5. `reviewTargets`
6. `taskList`
7. `pronunciationFocus`
8. `studyTextType`
9. `inputType`
10. `communicativeOutcome`
11. `teacherFollowUpCues`
12. `publishedAt`
13. `publishTargets`

Output rules:

1. Structured fields are the canonical payload.
2. `homeworkSummary` is a compact human-readable summary secondary to the structured payload.
3. Teacher follow-up material must be reduced to compact continuity cues, not preserved as a full
   narrative block.
4. Homework memory must be useful for future assignment continuity, review avoidance, and rollup
   generation.
5. `publishTargets` must be structured plural delivery metadata, not a singular render-target field.

## Content Boundary Rules

### Included

Homework memory should capture:

1. the student-facing assignment intent
2. pedagogic targets
3. task and practice shape
4. review targets when clearly present
5. pronunciation focus
6. study-text type
7. communicative outcome
8. compact teacher follow-up cues

### Excluded

Homework memory should not store:

1. the entire answer key body
2. the full teacher follow-up plan text
3. full study text
4. decorative markdown formatting or presentation-only layout details

## Extraction Strategy

Homework memory should use a hybrid parser plus LLM extraction pipeline.

### Backend-first normalization

The backend should first extract stable semantic structure from the published markdown:

1. front matter
2. known section headings
3. known pedagogic regions such as:
   - grammar focus
   - vocabulary focus
   - practice/task sections
   - pronunciation focus
   - teacher follow-up cues

### LLM second pass

The LLM should then summarize the reduced semantic payload into the canonical homework-memory
structure.

Extraction rules:

1. backend parsing should remove formatting fluff wherever possible
2. the LLM should operate on semantic content, not presentation fidelity
3. this reduces tokens, improves stability, and avoids teaching the memory system to care about
   markdown decoration

## Review Target Rules

1. `reviewTargets` should be stored only when the assignment clearly includes them.
2. Version 1 should not aggressively infer review targets from vague overlap or broad topic
   similarity.
3. Stronger review-target continuity can be hardened later in prompt/runtime behavior rather than
   overcomplicating homework-memory extraction.

## Study Text Rules

1. Homework memory stores `studyTextType` and semantic summary/targets.
2. Homework memory does not store the full study text.
3. If study text matters for continuity, the memory artifact should capture its pedagogic role, not
   reproduce the full content.

## Runtime And Failure Model

Homework-memory artifacts use the shared Phase 1 lifecycle:

1. `pending`
2. `ready`
3. `failed`
4. `superseded`

Runtime rules:

1. A successful publish may enqueue homework-memory work in `pending`.
2. Successful extraction creates a new append-only `ready` row.
3. Older canonical rows for the same published assignment lineage become `superseded`.
4. Homework-memory extraction failure becomes `failed` after bounded retries.
5. Publish success is not downgraded when homework-memory extraction fails.
6. `failed` homework-memory rows remain replayable and inspectable.

## Publish-Target Handling

1. Homework memory is content-centric, not render-target-centric.
2. A single published markdown artifact may have multiple publish targets.
3. Publish targets should be recorded as metadata on the homework-memory artifact or lineage, but
   identical content must not create duplicate homework-memory content rows.

## Queueing, Replay, And Backfill

The homework-memory pipeline must support:

1. async queueing after publish success
2. bounded automatic retries
3. targeted replay for one published assignment or one student
4. historical backfill of published assignments
5. dry-run inspection

Version 1 backfill and replay expectations:

1. discover published jobs with missing canonical homework memory
2. process in bounded batches
3. write canonical homework-memory artifacts
4. support replay of failed or operator-selected homework-memory work

## Repository And Query Requirements

The backend will need homework-memory operations for:

1. insert homework-memory entry
2. list homework memory for one student
3. fetch latest ready homework memory by published assignment lineage
4. fetch recent ready homework memory for prompt packaging
5. list pending or failed homework-memory work for ops/backfill
6. supersede older canonical homework memory for the same published assignment lineage

## Compatibility And Cutover

1. Canonical homework memory begins only at successful publish.
2. Drafts, materialized markdown, and prompt packages remain important provenance inputs, but they
   are not themselves canonical homework-memory truth in version 1.
3. Homework continuity may lag because homework memory is publish-gated. This is an intentional
   trust-first tradeoff.
4. Prompt/runtime phases may later harden how review continuity is used, but Phase 3 only needs to
   store the homework-memory artifact correctly.

## What This Phase Unlocks

1. assignment continuity grounded in published truth
2. review-aware retrieval based on explicit homework targets
3. duplicate-task avoidance across published assignments
4. stronger future rollups that distinguish assigned work from lesson observations
5. lower-token semantic memory extraction by stripping formatting noise before LLM summarization

## Exit Criteria

1. Canonical homework-memory rows exist for newly published assignments.
2. Homework-memory generation is asynchronous and non-blocking for publish completion.
3. Canonical source truth is locked to published markdown content, not rendered targets.
4. New homework-memory rows are created only when published markdown content changes.
5. Homework-memory extraction uses semantic normalization rather than raw formatting fidelity.
6. Publish success remains independent from homework-memory extraction success.
