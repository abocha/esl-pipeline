# Phase 4 - Student Rollup and Retrieval Packaging

## Goals

1. Build a durable student-memory rollup over canonical lesson and homework memory.
2. Define deterministic selection rules for what gets sent to the model.
3. Keep the live prompt compact without losing long-term continuity.
4. Preserve current-assignment reliability even when the latest rollup snapshot is missing or
   delayed.

## Locked Decisions

1. Student-memory snapshots are derived from canonical lesson-memory and homework-memory artifacts,
   not from ad-hoc transcript blobs or prompt text.
2. Student-memory snapshots refresh asynchronously whenever new lesson-memory or homework-memory
   rows become `ready`.
3. Prompt packaging proceeds even if the latest student-memory snapshot is missing or delayed.
4. Fallback context in that case is:
   - foundational profile
   - recent ready lesson memory
   - recent ready homework memory
   - latest transcript
5. Version 1 prompt packaging includes:
   - one compact student-memory snapshot
   - compact selected lesson-memory entries
   - compact selected homework-memory entries
   - explicit unresolved-issues block derived from the rollup
   - latest full lesson transcript
6. The current lesson is represented by the raw latest transcript only, not by a duplicated
   current-lesson memory entry in the same prompt package.
7. Retrieval is deterministic and rule-based in version 1.
8. Version 1 default retrieval counts are:
   - `3` lesson-memory entries
   - `2` homework-memory entries
9. Student-memory snapshots are built from all historical `ready` lesson-memory and homework-memory
   artifacts.
10. Unresolved issues are surfaced as an explicit compact block derived from the student-memory
    snapshot, not hidden only inside summary text.

## Why This Phase Depends On Phases 2 And 3

Student-memory rollup is a derived artifact. It must be built from canonical episode memory:

1. lesson memory entries
2. homework memory entries

It must not be built from:

1. raw transcript summary blobs
2. temporary prompt-package text
3. draft-only homework content

## Student Memory Snapshot Responsibilities

The student-memory snapshot must answer:

1. what this student is consistently good at
2. what this student repeatedly struggles with
3. what topics or vocabulary domains keep appearing
4. what pronunciation themes matter
5. what personal facts or preferences matter for personalization
6. what still needs review
7. what kind of assignment would be the best next step

## Canonical Student-Memory Snapshot Content

Each student-memory snapshot must produce:

1. `stableStrengths`
2. `recurringIssues`
3. `activeReviewBacklog`
4. `recentProgress`
5. `personalFacts`
6. `recommendedAssignmentDirections`
7. `unresolvedIssues`
8. `snapshotSummary`

Content rules:

1. Structured rollup fields are canonical.
2. `snapshotSummary` is secondary to the structured fields.
3. `unresolvedIssues` must be explicit and compact enough to be shipped directly into the prompt
   package.
4. `personalFacts` must preserve authority and confidence from source memory artifacts.

## Rollup Input Scope

Student-memory snapshots are built from all historical `ready` lesson-memory and homework-memory
 artifacts.

Scope rules:

1. Version 1 does not limit the rollup to a recent rolling window.
2. The rollup is the system’s wide-angle memory compression layer.
3. Later phases may add optimization or compaction strategies, but version 1 must preserve the
   whole-history semantic view.

## Retrieval Policy Version 1

Retrieval remains backend-owned, deterministic, and bounded.

Version 1 packaging includes:

1. one latest student-memory snapshot
2. the latest `3` ready lesson-memory entries
3. the latest `2` ready homework-memory entries
4. one explicit unresolved-issues block derived from the student-memory snapshot
5. the latest full lesson transcript

Selection rules prefer:

1. recency
2. unresolved review loops
3. repeated issues
4. continuity with the latest homework

Version 1 does not use:

1. LLM-assisted ranking
2. embedding retrieval
3. dynamic per-request retrieval heuristics beyond the fixed deterministic rules

## Prompt Packaging Hierarchy

The retrieval package should preserve this context hierarchy:

1. foundational profile
2. student-memory snapshot
3. selected recent lesson-memory entries
4. selected recent homework-memory entries
5. unresolved-issues block
6. latest full lesson transcript

Hierarchy rules:

1. Foundational profile is stable identity and pedagogy context.
2. Student-memory snapshot is the wide-angle, long-term memory layer.
3. Selected lesson/homework entries provide recent tactical continuity.
4. Unresolved issues make active learning threads explicit.
5. The latest transcript is the immediate source of truth for the current assignment.

## Current Lesson Handling

1. The current lesson must not be duplicated as a lesson-memory entry in the same prompt package.
2. The current lesson is represented by the raw latest transcript.
3. Lesson-memory for the current lesson is for future retrieval and future rollups, not for
   immediate duplication inside the same package.

## Missing Snapshot Fallback

Prompt packaging must proceed even when a fresh student-memory snapshot is unavailable.

Fallback package:

1. foundational profile
2. recent ready lesson-memory entries
3. recent ready homework-memory entries
4. latest transcript

Fallback rules:

1. Missing snapshot state must not block current assignment generation.
2. Prompt-package lineage should still record whether a snapshot was present or absent.
3. Snapshot absence is acceptable temporary eventual-consistency behavior, not a prompt-generation
   failure.

## Token Budget Policy

Version 1 uses one default bounded packaging tier.

Default tier:

1. `1` student-memory snapshot
2. `3` lesson-memory entries
3. `2` homework-memory entries
4. `1` unresolved-issues block
5. current transcript

Future tiering:

1. compact
2. expanded

Those may be introduced later, but version 1 only needs one stable default tier.

## Unresolved Issues Packaging

`unresolvedIssues` must be exposed as an explicit compact block derived from the student-memory
snapshot.

Purpose:

1. make still-open pedagogic threads obvious to the model
2. reduce the chance that the model overlooks persistent issues hidden inside broader rollup text
3. keep assignment generation focused on what still needs reinforcement

Rules:

1. unresolved issues must represent active learning problems, not every historical issue ever seen
2. the block should be compact and prompt-ready
3. the block is derived from rollup semantics, not assembled ad hoc from arbitrary recent entries

## Snapshot Provenance

Prompt packages must snapshot retrieval provenance for memory context:

1. `studentMemorySnapshotId`
2. `studentMemorySnapshotHash`
3. `selectedLessonMemoryIds`
4. `selectedHomeworkMemoryIds`
5. `retrievalPolicyVersion`

Lineage rules:

1. these are snapshot fields, not live joins
2. they enable reproducible prompt-package reconstruction
3. job provenance inherits memory provenance through prompt-package lineage
4. prompt-package inspection must not require recomputing retrieval later

## Query And Packaging Requirements

The backend will need:

1. fetch latest ready student-memory snapshot by student id
2. list recent ready lesson-memory entries by student id
3. list recent ready homework-memory entries by student id
4. assemble a prompt-ready memory context package
5. derive unresolved-issues block from the snapshot
6. snapshot selected ids and retrieval policy into the prompt-package record

## Refresh Model

Student-memory snapshots refresh asynchronously whenever:

1. a new lesson-memory entry becomes `ready`
2. a new homework-memory entry becomes `ready`

Refresh rules:

1. rollup generation is eventually consistent
2. rollup refresh must not block live assignment generation
3. only `ready` lesson/homework memory participate in rollup generation

## What This Phase Unlocks

1. prompt-ready long-term memory without sending the entire student history
2. deterministic and inspectable retrieval
3. explicit carry-forward of unresolved learning issues
4. graceful fallback when the latest rollup is delayed
5. future optimization work without changing the core artifact model

## Exit Criteria

1. Student-memory snapshots can be built from canonical lesson-memory and homework-memory artifacts.
2. Retrieval rules are explicit, deterministic, and bounded.
3. Prompt packaging can proceed with or without a fresh student-memory snapshot.
4. The current lesson is represented by the raw latest transcript only.
5. Unresolved issues are exposed as an explicit compact prompt block.
6. Prompt-package lineage can trace selected memory artifacts and retrieval policy version.
