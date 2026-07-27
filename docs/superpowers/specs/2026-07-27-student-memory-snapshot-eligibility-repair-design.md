# Student-Memory Snapshot Eligibility Repair Design

## Meta

- Date: 2026-07-27
- Status: implemented and validated on branch; production recovery pending
- Scope: repair post-cutover student-memory snapshot eligibility, retry semantics, candidate-refresh
  recovery, and the corresponding canonical-assignment invariant
- Delivery: one focused repair pull request followed by a reviewed production replay
- Release: `release:patch`
- Related issue: GitHub issue #141, implemented by the assignment-step confirmation cutover

## Summary

Profile candidates are not being created for affected production students because their
student-memory snapshot refreshes cannot publish. Migration
`0044_assignment_step_confirmation_contract` correctly retired pre-cutover lesson-memory entries
that lack confirmed-source provenance, but it left ready student-memory snapshots referencing those
retired entries. The incremental snapshot worker still selects those snapshots as parents, carries
their retired lesson-memory IDs forward as covered evidence, and then rejects its own generated
snapshot during finalization.

Candidate refresh is downstream of successful snapshot publication, so this failure appears as a
profile-candidate bug even though candidate generation is healthy. The repair must restore one
consistent definition of a canonical ready snapshot across migration state, repository reads,
worker retries, replay selection, and future assignment-source changes.

The immediate repair stays focused. It does not implement lifetime-canonical assignments or the
new first-profile onboarding flow. It records snapshot eligibility as a required invariant for that
future combined upgrade so the larger redesign cannot recreate this projection gap.

## Confirmed Production Evidence

Read-only inspection of the production VPS established:

- the deployed backend and student-memory worker run release `v10.2.4`;
- the student-memory worker is present and processing lesson, homework, and snapshot jobs;
- affected jobs fail with `StudentMemorySnapshotSourcesChangedError` before candidate refresh;
- 18 ready snapshots across 18 students contain 215 references to lesson-memory entries that are
  missing, no longer ready, or lack confirmed-source provenance;
- eight students have already produced failed snapshot attempts from this condition; and
- candidate creation succeeds for post-cutover students, proving that the candidate worker path,
  generation policy, and candidate persistence remain operational.

The production identifiers used to establish those counts are intentionally omitted from this
document.

## Root Cause

The cutover added `source_storage_uri` and `source_content_hash` to lesson-memory entries, then
changed every pre-cutover pending or ready lesson-memory row without those fields to `superseded`.
That was the correct fail-closed treatment for unproven lesson evidence.

The same migration did not mark dependent student-memory snapshots ineligible. As a result:

```text
pre-cutover lesson memory -> superseded
dependent student-memory snapshot -> still ready
latest-ready lookup -> returns stale snapshot
incremental coverage -> retains superseded lesson IDs
snapshot finalization -> rejects stale IDs
candidate refresh -> never requested
```

The finalization guard added with the confirmation contract is behaving correctly. Removing or
weakening it would allow stale lesson evidence to become current again and is not an acceptable
fix.

## Snapshot Eligibility Contract

A student-memory snapshot is eligible to act as current ready state only when:

1. its status is `ready`;
2. every ID in `lesson_memory_entry_ids` resolves to an existing lesson-memory entry;
3. every referenced lesson-memory entry belongs to the same student as the snapshot;
4. every referenced lesson-memory entry still has status `ready`; and
5. every referenced lesson-memory entry carries non-null confirmed-source provenance.

An empty `lesson_memory_entry_ids` array remains valid for a snapshot based only on canonical
homework memory. This repair does not introduce a new homework-memory provenance rule.

Snapshots that fail this contract remain immutable historical evidence, but their status must not
remain `ready`. They become `superseded` without fabricating a replacement snapshot or a
`superseded_by_id` value.

`student_memory_snapshots.lesson_memory_entry_ids` and `homework_memory_entry_ids` are the canonical
persisted coverage lineage. Matching arrays in `generation_notes` are observability copies and must
not override the columns when a later incremental snapshot inherits coverage. A mismatch is treated
as diagnostic drift; the canonical columns win.

The definition above must be used by migration repair, current-state reads, and inspection reads
that explicitly request ready snapshots. Persisted status is the primary state transition;
read-time eligibility is a defense against future drift and concurrent source replacement.

## Repair Architecture

### 1. Forward-only data repair

Add migration `0045_student_memory_snapshot_eligibility_repair` rather than editing migration
`0044`, which has already run in production.

The migration must:

- find ready or pending student-memory snapshots with at least one lesson-memory reference that
  violates the eligibility contract;
- set those snapshots to `superseded`;
- set `superseded_at` when it is absent;
- leave `superseded_by_id` null because no replacement exists yet;
- leave failed and already-superseded snapshots unchanged; and
- avoid creating jobs, pending rows, profile candidates, or inferred confirmed provenance.

The repair is idempotent by status predicate and safe for databases with no legacy rows.

### 2. Canonical ready-snapshot selection

`getLatestReadyStudentMemorySnapshotByStudentId()` must exclude any snapshot that violates the
eligibility contract even if its stored status is still `ready`.

The snapshot repository must own one runtime SQL eligibility predicate and apply it to:

- `getLatestReadyStudentMemorySnapshotByStudentId()`;
- the guarded latest-parent comparison inside `insertCanonicalReadyStudentMemorySnapshot()`; and
- ready rows returned by `listStudentMemorySnapshots()` when its status filter includes `ready`;
- the bulk ready-snapshot facts consumed by replay/backfill target selection.

Replay selection should delegate its snapshot facts to the repository rather than encode a fourth
application-layer definition of ready state.

The predicate should use a `NOT EXISTS` check over `lesson_memory_entry_ids`. A selector may return
an older eligible ready snapshot when one exists. If no eligible parent exists, normal
lesson/homework-triggered refresh uses `bootstrap_incremental_v1_1` and rebuilds from current
canonical memory. `--selection missing` must likewise treat an invalid-but-stored-ready snapshot as
missing canonical current state.

The finalization transaction continues to lock and revalidate every referenced lesson-memory row.
Read-time filtering reduces stale work; finalization remains the race-closing authority.

Incremental request construction must inherit coverage from the canonical snapshot columns, not
`generation_notes.coveredLessonMemoryEntryIds` or
`generation_notes.coveredHomeworkMemoryEntryIds`. Generation notes continue to report the coverage
used for each attempt, but they are not an alternate lineage authority.

### 3. Explicit stale-source retry semantics

`StudentMemorySnapshotSourcesChangedError` represents input authority changing between request
construction and final publication. The worker must handle it as a retriable stale-input condition,
parallel to `StudentMemorySnapshotParentChangedError`:

- log a distinct structured retry event;
- retain the pending snapshot until BullMQ retry or source-authority invalidation resolves it;
- rebuild the next attempt from a fresh canonical ready-snapshot lookup;
- persist typed final-attempt diagnostics in `generation_notes.failureDetails`; and
- never enqueue candidate refresh for the rejected result.

If source confirmation has already superseded the pending row, the retry exits without another
provider call. If only the stale parent was ineligible, the retry rebuilds from an older eligible
parent or bootstrap context. The worker must not repeatedly send the same retired coverage to the
provider.

The failure metadata adds:

```ts
interface StudentMemorySnapshotSourcesChangedFailureDetails {
  code: 'student_memory_snapshot_sources_changed_before_finalize';
  stage: 'snapshot_ready_finalization';
  message: string;
  unavailableLessonMemoryEntryIds: string[];
}
```

The IDs are internal lineage identifiers, not lesson text or learner content.

### 4. Candidate-refresh recovery

Migration repair deliberately does not start model work. After deployment, the existing snapshot
replay tool is the reviewed recovery boundary.

The operator flow is:

1. run `--selection missing --dry-run` after migration;
2. verify that repaired students are selected only when they have canonical ready lesson or
   homework memory;
3. run `manual_rebuild_v1_1` with an explicit operator reason and `--candidate-refresh` for the
   reviewed target set; and
4. confirm one ready snapshot plus a successfully enqueued candidate-refresh job per processed
   student; and
5. use the candidate-only retry command for any ready snapshot whose candidate enqueue did not
   succeed.

Manual replay with `--candidate-refresh` remains explicit because ordinary manual replay does not
infer candidate intent from hash changes. No lesson-memory, snapshot, or candidate row is edited by
hand.

Candidate decision metadata must distinguish decision from delivery. Extend the internal
`candidateRefresh` generation notes with:

```ts
type StudentMemorySnapshotCandidateRefreshEnqueueStatus =
  | 'not_requested'
  | 'pending'
  | 'enqueued'
  | 'failed';
```

The canonical ready-snapshot insert stores `pending` or `not_requested` atomically with the
candidate decision. The worker then stores `enqueued` after the stable BullMQ job is accepted or
`failed` after an exhausted enqueue attempt. Failure details remain privacy-safe and do not include
lesson or profile content.

Add a focused operator command that accepts an explicit ready snapshot ID, revalidates that the
snapshot is eligible and requested candidate refresh, then reconciles the existing stable
candidate-refresh queue job (including retained failed jobs) and records `enqueued`. It does not regenerate the student-memory
snapshot or infer candidate intent for snapshots whose decision was not requested.

The replay runbook must document the already-supported `--candidate-refresh` flag, the
candidate-only retry command, and the exact post-repair dry-run, execution, and verification
sequence. Recovery is complete only after a `student_profile_candidate_refresh_requested` event
and either a processed job event or a resulting persisted candidate outcome—not merely after
decision metadata says `requested: true`.

## Relationship to Assignment-State Remediation

This defect is a regression from the database cutover used to implement GitHub issue #141. It is
not caused by the July 23 first-profile or canonical-assignment containment patches.

The July 11 assignment-workflow remediation plan is historical and already shipped. Its navigation,
invalidation UX, post-share, and pronunciation changes do not overlap this failure.

The active long-term designs do overlap at the authority boundary. The future
canonical-assignment-state and first-profile onboarding upgrade must preserve these requirements:

- a confirmed Source change atomically makes the previous lesson-memory authority and every
  dependent ready/pending snapshot ineligible;
- current-state queries never expose a snapshot derived from noncanonical lesson evidence;
- inherited snapshot coverage comes only from canonical snapshot lineage columns;
- first-profile enrichment waits for canonical ready lesson memory from the exact confirmed source;
- ongoing profile candidates remain downstream of canonical snapshot publication and in the
  teacher-reviewed Learning-page workflow; and
- historical memory and profile evidence remains inspectable without being treated as current.

This repair is therefore a prerequisite invariant for the future upgrade, not an invitation to
implement that entire upgrade in the patch PR.

## Alternatives Considered

### Migration only

Supersede the 18 currently invalid snapshots and rely on existing application behavior afterward.

This repairs today's rows but leaves canonical reads dependent on perfect historical migrations and
does not stop repeated provider work if a future stale source escapes transactional invalidation.
Rejected.

### Runtime filtering only

Ignore invalid ready snapshots during parent selection and let the next activity bootstrap a new
snapshot.

This unblocks future jobs but leaves the database and operator surfaces claiming that invalid
snapshots are ready. Backfill selection and health inspection can continue to misclassify affected
students. Rejected.

### Combined migration, selector, retry, and replay

Repair persisted state, defend current reads, make the race retry explicit, and restore affected
students through the existing auditable replay tool.

Selected because each layer has one responsibility and the finalization guard remains fail-closed.

## Error Handling and Observability

The repair introduces no tutor-facing controls. Snapshot refresh and candidate generation remain
asynchronous.

Required structured events:

- `student_memory_snapshot_sources_changed_retry` when a non-final attempt detects stale lesson
  sources;
- the existing worker failure event on a final exhausted attempt, with typed failure details; and
- existing snapshot-ready, candidate-refresh-requested, skipped, and processed events for recovery
  verification.

Logs must contain lineage IDs and counts only. They must not add transcript text, lesson content,
profile facts, tutor identity, or student names.

The health surface should naturally report no current ready snapshot after migration until replay
or ordinary activity succeeds. This repair does not add a new health DTO field.

## Test Strategy

### Migration integration

Extend the migration fixture to create:

- a pre-cutover ready lesson-memory entry;
- ready and pending student-memory snapshots referencing it;
- a ready snapshot referencing an otherwise-valid lesson-memory entry owned by another student;
- an unrelated valid homework-only ready snapshot; and
- an already-failed snapshot retained for audit.

After migrations, assert the dependent legacy ready and pending snapshots are superseded, the
cross-student snapshot is superseded, the homework-only snapshot remains ready, failed history
remains failed, and rerunning the repair SQL changes no additional rows.

### PostgreSQL repository

Add database-backed tests proving latest-ready selection:

- ignores a ready snapshot whose lesson entry is superseded;
- ignores a ready snapshot whose lesson entry lacks confirmed-source provenance;
- ignores a snapshot with a missing lesson reference;
- ignores a snapshot whose otherwise-ready lesson entry belongs to another student;
- returns the next older eligible ready snapshot;
- accepts a homework-only snapshot; and
- excludes ineligible ready rows from inspection requests filtered to `ready`;
- uses the same eligible parent for the guarded finalization comparison; and
- still rejects a source that changes under the finalization lock.

### Snapshot worker

Add unit tests proving:

- a sources-changed failure logs the structured retry event and does not request candidates;
- a non-final retry does not mark the pending row failed;
- a final retry persists typed source-change diagnostics;
- a subsequent attempt rebuilds from fresh canonical parent state; and
- mismatched generation-note coverage cannot override canonical coverage columns; and
- successful repaired/bootstrap publication reaches the existing candidate-refresh decision and
  request path.

### Replay and documentation

Add or update tests proving invalid-but-stored-ready snapshots classify as `missing` before data
repair, repaired students still classify as `missing` after their invalid snapshots are superseded,
and `--candidate-refresh` reaches the manual replay request. Candidate-delivery tests must cover
persisted `pending`/`enqueued`/`failed` states, enqueue failure without false success, and successful
idempotent candidate-only retry without another snapshot-generation call. Keep database-backed
tests in the serial PostgreSQL lane.

## Contract, Schema, and Documentation Impact

The repair advances:

- `DB_MIGRATION_HEAD` to `0045_student_memory_snapshot_eligibility_repair`;
- `DB_CONTRACT_VERSION` from `0.23.0` to `0.23.1`; and
- the generated `packages/batch-backend/schema.sql` baseline.

The API contract does not change. No public request or response DTO changes.

Update together:

- `packages/batch-backend/README.md` for the post-cutover eligibility invariant;
- `docs/operations/student-memory-replay-backfill.md` for recovery procedure and
  `--candidate-refresh` plus candidate-only retry;
- `docs/reference/STUDENT_MEMORY_V1_1_DESIGN.md` to replace the obsolete assumption that every
  existing ready snapshot is a valid parent and no eligibility repair migration is needed;
- `docs/backend-frontend/backend-frontend-alignment.md` only if its current memory-status wording
  would otherwise contradict the repaired behavior; and
- the active canonical-assignment and first-profile designs only if a concise cross-reference is
  needed to make this prerequisite discoverable.

## Delivery and Production Boundary

The implementation pull request contains code, migration, tests, contract registry, baseline, and
direct documentation only. It does not mutate production.

After CI and merge:

1. publish the normal release image bundle;
2. deploy the immutable release SHA through the standard production script;
3. verify migration `0045` and service health;
4. run replay dry-run and review the selected scope;
5. execute the approved bounded replay with candidate refresh;
6. retry candidate enqueue only for explicit eligible snapshots that remain in `failed` enqueue
   state; and
7. verify logs and database state read-only.

Deployment and replay require separate explicit operator authorization. Rollback must not restore
invalid snapshots to `ready`; a code rollback may use the previous image only if its database
compatibility is verified against migration `0045`.

## Non-Goals

- Weakening snapshot finalization validation.
- Reconstructing confirmed-source hashes for pre-cutover lesson memory.
- Editing production rows by hand.
- Automatically replaying every student from a migration.
- Changing candidate proposal, deduplication, promotion, or provenance policy.
- Implementing the T8 latest-lesson candidate redesign.
- Implementing lifetime-canonical assignments, atomic prompt/draft generation, or automatic
  first-profile onboarding in this repair.
- Adding a tutor-facing memory refresh button.
- Changing homework-memory eligibility rules.

## Acceptance Criteria

1. No stored ready or pending snapshot references missing, non-ready, or provenance-free lesson
   memory after migration `0045`.
2. Canonical latest-ready lookup never returns an ineligible snapshot even before data repair.
3. Latest-parent comparison and replay selection use the same repository-owned eligibility rule as
   canonical latest-ready lookup.
4. Inspection reads explicitly filtered to ready snapshots never return an ineligible row.
5. Incremental coverage inheritance uses canonical snapshot arrays even when generation notes
   disagree.
6. A stale-source finalization race retries from fresh canonical inputs or exits when its pending
   row has already been superseded.
7. No failed snapshot requests candidate refresh.
8. A successful repaired or bootstrap snapshot records its candidate decision and requests refresh
   when the existing gating policy says it should.
9. Candidate enqueue state distinguishes requested, enqueued, and failed delivery, and an explicit
   candidate-only retry can recover delivery without regenerating a snapshot.
10. Replay dry-run identifies the reviewed affected scope after migration.
11. Reviewed replay restores ready snapshots and candidate processing without manual row edits.
12. Existing post-cutover students and homework-only snapshots remain unaffected.
13. Contract verification, migration integration, PostgreSQL repository tests, worker tests, baseline
    verification, and the broad repository gate pass.
14. The future canonical-assignment/first-profile package treats dependent snapshot invalidation as
    a required source-authority invariant.
