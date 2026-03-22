# Phase 1 - Requirements, Contracts, and Schema Boundaries

## Goals

1. Lock the vocabulary and ownership model for the student memory system.
2. Define canonical v1 contracts for lesson memory, homework memory, and student memory snapshots.
3. Freeze authority, confidence, provenance, lifecycle, and compatibility rules before backend
   implementation starts.
4. Identify the prompt-package lineage and read-only API contracts that later phases will implement.

## Deliverables

1. Canonical definitions for:
   - foundational profile
   - lesson memory entry
   - homework memory entry
   - student memory snapshot
2. A canonical schema plan for append-only memory tables.
3. A canonical lifecycle and supersession model for all memory artifacts.
4. A prompt-package lineage contract for memory provenance.
5. A read-only API and DTO plan for inspection surfaces.
6. A compatibility and cutover policy for retiring `transcripts.summary_json.analysis`.

## Locked Decisions

1. Foundational profile remains teacher-authored and versioned through the existing profile revision
   system.
2. Lesson memory, homework memory, and student memory snapshots are DB-canonical backend-owned
   artifacts.
3. Prompt packages snapshot memory state but do not become the source of truth for memory.
4. Memory artifacts use append-only rows. Version 1 does not use mutable current rows or paired
   current/history tables.
5. Homework memory is sourced from published outputs only.
6. Student facts in memory use `authority tier + confidence enum`.
7. Confidence is qualitative only: `low | medium | high`.
8. Memory inspection surfaces are authenticated read-only APIs.
9. API granularity is `aggregate + per-kind routes`.
10. Shared memory lifecycle is `pending | ready | failed | superseded`.
11. `transcripts.summary_json.analysis` is immediately replaced once canonical memory tables are
    live. Version 1 does not dual-write or keep long-lived synchronization with that legacy field.

## Ownership And Authority Rules

### Ownership

1. Foundational profile is the canonical teacher-authored source for durable student identity,
   goals, preferences, and constraints.
2. Lesson memory captures observations derived from lesson transcripts.
3. Homework memory captures assigned work derived from published assignment outputs.
4. Student memory snapshots are derived rollups over canonical lesson and homework memory.

### Authority

1. Foundational profile outranks inferred memory.
2. Current lesson transcript outranks stale older lesson or homework memory when a direct conflict
   exists.
3. Student memory snapshots are derived guidance and must not replace the underlying lesson and
   homework memory records they summarize.
4. Only `teacher_confirmed` facts may be treated as profile-grade truth.
5. `student_stated` and `model_inferred` facts remain memory-layer facts unless deliberately
   promoted in a later workflow.

## Shared Metadata Contract

Every canonical memory artifact must include these shared fields:

1. `id`
2. `studentId`
3. `schemaVersion`
4. `generatedAt`
5. `provider`
6. `model`
7. `status`
8. `sourceKind`
9. `sourceIds`
10. `generationNotes`

Shared field rules:

1. `id` is the unique identifier for this append-only artifact row.
2. `studentId` binds the artifact to one canonical student.
3. `schemaVersion` versions the artifact payload contract.
4. `generatedAt` records when the artifact was generated, not when its source lesson or publish
   event happened.
5. `provider` and `model` record the generator used for the artifact.
6. `status` uses the shared lifecycle defined later in this doc.
7. `sourceKind` identifies the artifact family the row was derived from.
8. `sourceIds` is a structured identifier object keyed by canonical relations for that artifact
   type, not an opaque ordered list.
9. `generationNotes` carries generation-time notes, warnings, or failure details. It may be empty
   for successful generations.

## Canonical V1 Contracts

### `LessonMemoryEntry`

#### Required metadata

1. all shared metadata fields
2. `sourceKind = lesson_transcript`
3. `sourceIds.transcriptId`
4. `sourceIds.recordingId`

#### Required content fields

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

#### Contract rules

1. Transcript and recording linkage is authoritative and must be stored structurally.
2. `lessonSummary` may remain narrative.
3. `topicsDiscussed`, `mistakePatterns`, `grammarReviewed`, `grammarWatchlist`,
   `vocabularyFocus`, `pronunciationFocus`, `studentFacts`, `progressSignals`, and
   `followUpRecommendations` must be stored structurally enough to support rollups and retrieval.
4. `studentFacts` must use the shared `StudentFact` plus `FactEvidence` contracts defined later in
   this doc.
5. `mistakePatterns` must support selective `MistakeEvidence` objects when evidence is available and
   confidence is sufficient.
6. `pronunciationFocus` must support selective `PronunciationEvidence` objects when evidence is
   available and confidence is sufficient.
7. Lesson memory may describe observations and pedagogic implications, but it must not rewrite the
   foundational profile.

### `HomeworkMemoryEntry`

#### Required metadata

1. all shared metadata fields
2. `sourceKind = published_assignment`
3. `sourceIds.jobId`
4. `sourceIds.promptPackageId` when available
5. `sourceIds.draftId` when available
6. `sourceIds.recordingId` when traceable
7. `sourceIds.transcriptId` when traceable

#### Required content fields

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

#### Contract rules

1. Homework memory is created only from published outputs.
2. Published-delivery truth must be stored structurally through `publishedAt`, `publishTargets`, and
   published job lineage.
3. `homeworkSummary` may remain narrative.
4. `grammarTargets`, `vocabularyTargets`, `reviewTargets`, `taskList`, `pronunciationFocus`,
   `studyTextType`, `inputType`, `communicativeOutcome`, and `teacherFollowUpCues` must be stored
   structurally enough to support future retrieval, deduplication, and review continuity.
5. `publishTargets` must support multiple delivery targets for one canonical homework-memory content
   artifact when the published markdown content is identical.
6. Because homework memory is publish-gated, continuity may lag behind draft or materialize stages.
   This is an intentional trust-first tradeoff.

### `StudentMemorySnapshot`

#### Required metadata

1. all shared metadata fields
2. `sourceKind = student_memory_rollup`
3. `sourceIds.lessonMemoryEntryIds`
4. `sourceIds.homeworkMemoryEntryIds`

#### Required content fields

1. `stableStrengths`
2. `recurringIssues`
3. `activeReviewBacklog`
4. `recentProgress`
5. `personalFacts`
6. `recommendedAssignmentDirections`
7. `unresolvedIssues`
8. `snapshotSummary`

#### Contract rules

1. The source lesson-memory and homework-memory version sets must be stored structurally so the
   rollup can be traced back to exact canonical inputs.
2. Rollup-facing fields such as `stableStrengths`, `recurringIssues`, `activeReviewBacklog`,
   `recentProgress`, `personalFacts`, `recommendedAssignmentDirections`, and `unresolvedIssues` must
   be stored structurally.
3. `snapshotSummary` is a compact narrative summary secondary to the structured rollup fields.
4. `unresolvedIssues` must be compact and prompt-ready enough to ship directly into prompt-package
   context when selected.
5. `personalFacts` in the snapshot must preserve authority and confidence from their source memory
   artifacts.

## Student Fact Object Contract

Structured student facts captured in lesson or homework memory must use this object shape:

1. `fact`
2. `category`
3. `authority`
4. `confidence`
5. `sourceArtifactIds`
6. optional `evidence`
7. optional `reviewNeeded`

Locked enums:

1. `authority = teacher_confirmed | student_stated | model_inferred`
2. `confidence = low | medium | high`

Fact handling rules:

1. `teacher_confirmed` facts may be treated as profile-grade truth when intentionally promoted by a
   later workflow.
2. `student_stated` facts remain memory-layer facts unless deliberately promoted later.
3. `model_inferred` facts remain memory-layer facts unless deliberately promoted later.
4. Rollups may summarize non-profile facts, but they must preserve authority tier.
5. Confidence is qualitative only and must not be represented as a numeric score in version 1.

## Fact Evidence Object Contract

Structured evidence attached to student facts must use this object shape:

1. `quote`
2. optional `speakerRole`
3. optional `evidenceNote`
4. optional `transcriptSpan`

Fact-evidence rules:

1. Evidence should be stored only when it materially improves traceability or trust.
2. Evidence may be omitted when transcript quality is weak or support is too noisy.
3. Evidence is supporting provenance, not a replacement for authority or confidence.

## Mistake Evidence Object Contract

Structured evidence attached to lesson mistake patterns must use this object shape:

1. `observedForm`
2. optional `suggestedTarget`
3. optional `evidenceQuote`
4. optional `evidenceNote`
5. optional `confidenceNote`

Mistake-evidence rules:

1. Mistake evidence should only be stored for mistakes the system is reasonably confident are real.
2. Evidence must not treat obvious STT corruption, multilingual artifacts, or transcript noise as
   learner error.
3. `suggestedTarget` is optional because some mistake patterns are classification-first rather than
   correction-first.

## Pronunciation Evidence Object Contract

Structured evidence attached to pronunciation observations must use this object shape:

1. `observedIssue`
2. optional `focusWords`
3. optional `evidenceQuote`
4. optional `evidenceNote`
5. optional `confidenceNote`

Pronunciation-evidence rules:

1. Pronunciation evidence should only be stored when the signal is strong enough to survive noisy
   transcript conditions.
2. `focusWords` may be used to anchor the observation to a compact set of words or sounds.
3. Omission is preferred over low-confidence overclaiming.

## Canonical Schema Plan

Version 1 uses these canonical tables:

1. `lesson_memory_entries`
2. `homework_memory_entries`
3. `student_memory_snapshots`

Schema rules:

1. All three tables are append-only.
2. Older rows are not updated in place to become the new truth.
3. Newer successful rows supersede older canonical rows for the same source or student scope.
4. Queries resolve current state by selecting the latest `ready` non-`superseded` row or row set
   for the relevant source or student policy.

Minimum relational contract for each table:

1. primary identity
2. student lookup
3. source lookup
4. status filtering
5. append-only replay
6. latest-ready retrieval
7. supersession tracking

Phase 1 locks the table model, shared lifecycle vocabulary, and query expectations. It does not yet
specify full SQL migration text.

## Lifecycle And Supersession Rules

Shared statuses:

1. `pending`: generation was requested but has not completed
2. `ready`: canonical successful artifact
3. `failed`: generation completed unsuccessfully or produced an unusable artifact
4. `superseded`: older artifact replaced by a newer canonical artifact

Operational rules:

1. A new successful generation writes a new append-only row.
2. The previously canonical row for the same source or student scope becomes `superseded`.
3. `failed` rows remain queryable for debugging, replay, and backfill workflows.
4. Prompt packaging reads only `ready` rows.

## Prompt Package Provenance Contract

Prompt-package lineage planning must add a `memory` lineage block with:

1. `studentMemorySnapshotId`
2. `studentMemorySnapshotHash`
3. `selectedLessonMemoryIds`
4. `selectedHomeworkMemoryIds`
5. `retrievalPolicyVersion`

Lineage rules:

1. These are snapshot fields, not live joins.
2. Job provenance inherits memory provenance through prompt-package lineage.
3. Memory provenance must be inspectable without recomputing retrieval after the fact.

## Read-Only API And DTO Plan

Version 1 locks the inspection contract plan as authenticated read-only backend surfaces.

Planned routes:

1. `GET /students/:id/memory`
2. `GET /students/:id/lesson-memory`
3. `GET /students/:id/homework-memory`
4. `GET /students/:id/memory-snapshots`
5. `GET /prompt-packages/:id`

Route rules:

1. `GET /students/:id/memory` is the overview route for student-workspace consumers.
2. Per-kind routes exist for pagination, tooling, and debugging.
3. Route auth follows the existing authenticated student workspace model.
4. `GET /prompt-packages/:id` is the canonical assignment-level inspection surface for prompt-package
   memory provenance in version 1.
5. Student-memory routes inspect student state and memory artifacts, but they are not the primary
   home for assignment-specific memory lineage.
6. Phase 1 locks the contract plan only. Frontend shipment remains later-phase work.

DTO planning rules:

1. The overview DTO should bundle:
   - student id
   - latest ready student memory snapshot
   - recent ready lesson memory entries
   - recent ready homework memory entries
2. Per-kind DTOs should support list-style inspection and later pagination.
3. Prompt-package DTOs must expose:
   - `studentMemorySnapshotId`
   - `studentMemorySnapshotHash`
   - `selectedLessonMemoryIds`
   - `selectedHomeworkMemoryIds`
   - `retrievalPolicyVersion`
   - missing-layer markers when expected memory context was absent at generation time
4. DTOs must expose memory status and provenance fields, not only human-readable summaries.

## Compatibility And Cutover

1. Canonical memory lives only in the new memory tables.
2. Existing `transcripts.summary_json.analysis` is not synchronized once the new memory system
   exists.
3. Cutover expectation is immediate replacement, not phased dual-write.
4. Old transcript analysis is legacy-only and removable after backend cutover is complete.

## Constraints

1. Additive schema only in the first pass.
2. Existing profile and template lineage contracts must remain intact.
3. Existing prompt-package behavior must not regress during the transition.
4. Phase 1 must stay aligned with DB-canonical backend ownership, additive schema evolution,
   authenticated inspection routes, and prompt-package lineage explainability.

## Exit Criteria

1. Artifact names, ownership, lifecycle, and versioning are locked.
2. Canonical v1 contracts for lesson memory, homework memory, and student memory snapshots are
   locked.
3. Fact authority and confidence contracts are locked.
4. Published-output-only homework source is locked.
5. Prompt-package memory lineage fields are identified.
6. Read-only API and DTO plans are identified.
7. Immediate replacement of legacy transcript analysis is documented.
