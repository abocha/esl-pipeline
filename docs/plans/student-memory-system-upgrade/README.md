# Student Memory System Upgrade

## Summary

This plan upgrades the current `profile + notes + lightweight lesson history + latest transcript`
prompt assembly into a DB-canonical student memory system that can support long-lived,
personalized homework generation without relying on agentic runtime retrieval.

The current repo already has a useful seed:

1. Student profile binding is DB-canonical.
2. Prompt packages are DB-canonical and lineage-aware.
3. Transcript analysis already exists in lightweight form.

This upgrade promotes those beginnings into a durable architecture with explicit memory artifact
types, rollups, retrieval rules, provenance, and a rewritten stateless system prompt.

## Locked Decisions

1. Runtime generation remains backend-orchestrated and deterministic. The live model call does not
   decide which memories to fetch.
2. The final homework generation path remains `one prepared prompt package -> one provider call ->
   one reply`.
3. Student context is split into four layers:
   - foundational profile
   - lesson memory
   - homework memory
   - student memory rollup
4. Foundational profile remains the highest-authority student document. Inferred facts from lessons
   or homework do not auto-promote into it.
5. Memory artifacts are DB-canonical, versioned, and provenance-aware.
6. Prompt packages snapshot the memory state they used, just like they already snapshot profile and
   template lineage.
7. All history may be stored, but only a bounded, selected subset is sent to the live model call.
8. Prompt caching and cached-token accounting are useful optimizations, but the system must not
   depend on provider-specific caching behavior to be viable.
9. The system prompt must be rewritten for stateless execution. It must not assume prior chat turns
   are available to the provider runtime.

## Problem Statement

The current prompt package can include the active profile, teacher notes, the latest transcript, and
an aggregated lesson-history appendix. That is useful, but still too shallow for the product goal:
the model should behave like it has durable, high-quality context about the student across months or
years of lessons and assignments.

The missing pieces are:

1. Rich per-lesson memory, not just a short lesson summary.
2. Rich per-homework memory, so the system knows what has already been assigned and reviewed.
3. A student rollup layer that compresses long history into stable, reusable context.
4. Retrieval and packaging rules that keep prompts bounded, inspectable, and provider-agnostic.
5. A prompt/runtime contract that matches the actual backend execution model instead of pretending
   the model has chat history.

## Goals

1. Produce reusable, structured lesson summaries from all lesson transcripts.
2. Produce reusable, structured homework summaries from canonical homework artifacts.
3. Build a student memory rollup that captures persistent patterns, progress, open loops, and
   pedagogic guidance.
4. Package profile + rollup + recent memory + latest transcript into one stateless prompt package.
5. Preserve provenance, explainability, and deterministic backend ownership.
6. Make the system extensible so future upgrades can add ranking, compacting, and workspace editing
   without reworking the core model.

## Out of Scope

1. Agentic runtime memory retrieval.
2. Embedding search or semantic vector retrieval in the first delivery slice.
3. Automatic mutation of the foundational student profile from inferred lesson data.
4. Cross-provider prompt special-casing beyond bounded, additive runtime optimizations.
5. Shipping a memory-editing UX before the underlying memory contracts are stable.
6. Transcript-format redesign is out of scope for this upgrade, even though it may later improve
   lesson-memory quality and reduce dependence on more expensive LLM reasoning.

## Follow-On Note: Transcript Formatting

Future work should revisit transcript formatting as a separate improvement track after the student
memory system is stable.

Why this matters:

1. clearer speaker-role markers may reduce teacher/student confusion
2. less timestamp noise may make lesson analysis more reliable
3. longer coherent utterance blocks may improve lower-cost LLM extraction quality

Important boundary:

1. this is intentionally not part of the current student-memory upgrade
2. Phase 2 lesson memory must work with the existing transcript representation
3. future transcript-format work should be planned as a separate follow-up once core memory
   contracts and pipelines are implemented

## System Shape

### 1. Foundational Profile

Teacher-authored, versioned, slow-changing student context.

Examples:

1. goals
2. personality and preferences
3. long-running challenges
4. known background facts confirmed by the teacher
5. study constraints and teaching notes

### 2. Lesson Memory Entry

One structured memory artifact per lesson transcript.

Examples:

1. topics discussed
2. mistakes and recurring error patterns
3. grammar reviewed vs. grammar that caused trouble
4. vocabulary themes
5. pronunciation focus or observed pronunciation issues
6. facts about the student inferred or explicitly said during the lesson
7. confidence, fluency, or communication observations
8. suggested follow-up directions

### 3. Homework Memory Entry

One structured memory artifact per canonical homework assignment.

Examples:

1. topic
2. grammar or vocabulary taught/reviewed
3. task types assigned
4. pronunciation focus
5. study-text type and input type
6. review items pulled forward from earlier work
7. intended communicative goal

### 4. Student Memory Snapshot

A derived aggregate over lesson memory and homework memory.

Examples:

1. stable strengths
2. recurring grammar issues
3. repeated vocabulary domains
4. persistent pronunciation themes
5. personal facts and preferences with provenance/confidence handling
6. active review backlog
7. recent progress signals
8. teaching strategies that appear effective for this student

## Runtime Model

### Offline and Async Memory Building

LLMs are used to create or refresh:

1. lesson memory entries
2. homework memory entries
3. student memory snapshots

These are asynchronous, replayable, and backfillable jobs or tools.

### Online Homework Generation

The live homework-generation path stays simple:

1. load foundational profile
2. load current student memory snapshot
3. load selected recent lesson memories
4. load selected recent homework memories
5. load teacher notes
6. load latest transcript
7. build one prompt package
8. send one provider call

The live model never decides what to fetch from storage.

## Retrieval and Packaging Policy

Version 1 retrieval should be deterministic and rule-based.

The live prompt package should include:

1. the active foundational profile
2. one latest student memory snapshot
3. the latest `3` lesson memory entries
4. the latest `2` homework memory entries
5. one explicit unresolved-issues block derived from the rollup
6. teacher notes when available
7. the latest lesson transcript in full

Locked version 1 defaults:

1. lessons: `3`
2. homework summaries: `2`
3. one compact all-time rollup

Selection rules should prefer:

1. recency
2. unresolved issues
3. repeated patterns
4. review continuity

Selection rules should not depend on embeddings or free-form model reasoning in the first version.

## Prompt Architecture Direction

The system prompt should be rewritten around explicit packaged context blocks instead of fictional
"previous chat memory".

Target conceptual order:

1. system instructions
2. foundational profile
3. student memory snapshot
4. recent lesson memory
5. recent homework memory
6. explicit unresolved-issues block
7. teacher notes
8. latest transcript

The prompt should explicitly instruct the model:

1. use the latest transcript for immediate lesson-specific signals
2. use student memory for continuity and personalization
3. use homework memory to avoid repetition and build intelligent review
4. trust current evidence over stale older memories when they conflict
5. never invent student facts not supported by supplied context

## Execution Order

This is the required build order and why it exists.

1. Phase 1 first:
   - lock terms, contracts, schemas, and provenance boundaries before creating new tables or jobs
2. Phase 2 second:
   - build lesson memory first because transcript analysis is already partially present and is the
     cleanest existing foundation
3. Phase 3 third:
   - build homework memory after lesson memory so both episode-level artifact types follow the same
     storage and provenance pattern
4. Phase 4 fourth:
   - build student rollups and deterministic retrieval only after lesson/homework memories exist as
     canonical inputs
5. Phase 5 fifth:
   - rewrite prompt assembly and provider runtime only after the memory package contract is stable
6. Phase 6 last:
   - add UI, ops, backfill polish, and rollout verification after the core backend model is
     trustworthy

## Phase Index

1. [phase-1-requirements-contracts-and-schema-boundaries.md](phase-1-requirements-contracts-and-schema-boundaries.md)
2. [phase-2-lesson-memory-pipeline.md](phase-2-lesson-memory-pipeline.md)
3. [phase-3-homework-memory-pipeline.md](phase-3-homework-memory-pipeline.md)
4. [phase-4-student-rollup-and-retrieval-packaging.md](phase-4-student-rollup-and-retrieval-packaging.md)
5. [phase-5-prompt-template-and-provider-runtime.md](phase-5-prompt-template-and-provider-runtime.md)
6. [phase-6-frontend-ops-backfill-and-rollout.md](phase-6-frontend-ops-backfill-and-rollout.md)
7. [verification-acceptance-and-assumptions.md](verification-acceptance-and-assumptions.md)

## Acceptance Gates

1. Additive schema and contracts are locked before extraction work starts.
2. Lesson memory can be built from both new transcripts and historical backfill.
3. Homework memory can be built from canonical homework artifacts with stable provenance.
4. Student memory snapshots are reproducible and refreshable.
5. Prompt packages persist the exact memory snapshot state used during generation.
6. System prompt and prompt assembly become stateless and context-package driven.
7. Student workspace and operational tooling can inspect memory outputs after core backend delivery.

## Rollback Notes

1. The new memory system should be additive at the schema level.
2. Existing prompt package generation can temporarily continue using the old lightweight lesson
   history path while canonical artifacts are being built and verified before direct cutover.
3. Existing transcript analysis under `transcripts.summary_json` may remain as legacy compatibility
   data during migration, but it is not canonical once the new memory tables are live.
4. Version 1 cutover should remain direct once verification is complete; rollback, if needed,
   happens through normal code/version rollback rather than long-lived parallel prompt paths.
