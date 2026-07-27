# Student-Memory Snapshot Eligibility Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore profile-candidate creation for students whose stored ready student-memory
snapshots reference lesson memory retired by the assignment confirmation cutover, and prevent the
same projection gap from recurring.

**Architecture:** Keep the existing fail-closed snapshot finalization guard. Repair invalid stored
state with one idempotent data migration, make the snapshot repository own a reusable SQL
eligibility predicate, and use it at every ready-snapshot read boundary. Preserve canonical source
arrays as coverage authority, expose source-change retries explicitly, persist candidate enqueue
delivery state, and add one candidate-only retry command. Production recovery remains a separately
reviewed post-deploy operation.

**Tech Stack:** TypeScript 6, Node.js, PostgreSQL, Redis/BullMQ, Vitest, pnpm.

## Global Constraints

- Implement the approved design in
  `docs/superpowers/specs/2026-07-27-student-memory-snapshot-eligibility-repair-design.md`.
- Deliver one focused `release:patch` pull request.
- Do not weaken `StudentMemorySnapshotSourcesChangedError` or accept retired/unproven lesson
  evidence.
- Do not implement lifetime-canonical assignments or first-profile onboarding in this repair.
- Do not change profile-candidate generation, approval, promotion, or deduplication policy.
- Keep empty `lesson_memory_entry_ids` eligible; do not add homework provenance requirements.
- Keep eligibility derived from existing relational state; do not add an eligibility column.
- Treat canonical snapshot source arrays as coverage authority. Generation notes are diagnostics.
- Every runtime change follows RED-GREEN TDD and receives a focused commit.
- Do not mutate production or run replay/retry commands against the VPS during implementation.

---

### Task 1: Repair invalid stored snapshots at the cutover boundary

**Files:**

- Create: `packages/batch-backend/migrations/0045_student_memory_snapshot_eligibility_repair.sql`
- Modify: `packages/batch-backend/tests/integration.migrations.test.ts`

**Interfaces:**

- Produces: an idempotent data migration that changes invalid `ready` and `pending`
  `student_memory_snapshots` to `superseded`.
- Preserves: valid ready snapshots, homework-only snapshots, failed snapshots, and all source
  records.
- Clears: `superseded_by_id` on repaired rows because no replacement snapshot is known yet.

- [ ] **Step 1: Add the failing migration fixture**

Extend the 0044 cutover fixture so it creates, before 0045 is applied:

- a ready snapshot referencing a lesson row made `superseded` by 0044;
- a pending snapshot referencing a missing lesson ID;
- a ready snapshot referencing a provenance-bearing ready lesson owned by another student;
- a valid ready snapshot with a same-student provenance-bearing ready lesson;
- a valid ready snapshot with an empty lesson ID array; and
- a failed snapshot with an invalid reference.

Assert that the first three become `superseded` with non-null `superseded_at` and
`superseded_by_id IS NULL`, while the final three retain their original statuses. Execute the 0045
SQL twice and assert the same final state and timestamps.

- [ ] **Step 2: Run the migration regression and verify RED**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend test:db:migrations
```

Expected: FAIL because migration 0045 does not exist and the invalid snapshot rows remain current.

- [ ] **Step 3: Add the idempotent repair migration**

Use one update shaped as follows:

```sql
UPDATE student_memory_snapshots AS snapshot
SET status = 'superseded',
    superseded_at = COALESCE(snapshot.superseded_at, NOW()),
    superseded_by_id = NULL,
    updated_at = NOW()
WHERE snapshot.status IN ('pending', 'ready')
  AND EXISTS (
    SELECT 1
    FROM unnest(snapshot.lesson_memory_entry_ids) AS source(lesson_memory_entry_id)
    LEFT JOIN lesson_memory_entries AS lesson
      ON lesson.id = source.lesson_memory_entry_id
     AND lesson.student_id = snapshot.student_id
     AND lesson.status = 'ready'
     AND lesson.source_content_hash IS NOT NULL
    WHERE lesson.id IS NULL
  );
```

Do not delete snapshots or lesson memory. Do not supersede an empty lesson array.

- [ ] **Step 4: Re-run the migration regression and verify GREEN**

Run the command from Step 2. Expected: PASS, including the second execution.

- [ ] **Step 5: Commit the data-repair slice**

```bash
git add packages/batch-backend/migrations/0045_student_memory_snapshot_eligibility_repair.sql \
  packages/batch-backend/tests/integration.migrations.test.ts
git commit -m "fix(memory): supersede ineligible snapshots"
```

### Task 2: Make the repository own snapshot eligibility

**Files:**

- Modify: `packages/batch-backend/src/domain/student-memory-snapshot-repository.ts`
- Modify: `packages/batch-backend/tests/domain.student-memory-snapshot-repository.test.ts`

**Interfaces:**

- Produces: `buildEligibleStudentMemorySnapshotLineageSqlPredicate(snapshotAlias)`.
- Produces: `getEligibleReadyStudentMemorySnapshotById(id)` for explicit recovery commands.
- Changes: latest-ready lookup, guarded-parent lookup, and ready-filtered inspection all enforce the
  same relational eligibility contract.

- [ ] **Step 1: Add failing PostgreSQL repository regressions**

Cover each disqualifier independently: missing lesson, cross-student lesson, non-ready lesson, and
null `source_content_hash`. Also cover a valid same-student ready lesson and an empty lesson array.

Assert:

```ts
expect(await getLatestReadyStudentMemorySnapshotByStudentId(studentId)).toMatchObject({
  id: validSnapshotId,
});
expect(await getEligibleReadyStudentMemorySnapshotById(invalidSnapshotId)).toBeNull();
```

Add guarded-parent coverage proving `insertCanonicalReadyStudentMemorySnapshot()` treats an
ineligible expected parent as changed. Add list coverage proving `listStudentMemorySnapshots()`
omits ineligible ready rows when `statuses` contains `ready`, while preserving explicitly requested
non-ready statuses.

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/domain.student-memory-snapshot-repository.test.ts
```

Expected: FAIL because stored status alone currently defines ready selection.

- [ ] **Step 3: Add one repository-owned SQL predicate**

Add an internal alias validator and export a predicate that excludes the status check:

```ts
export function buildEligibleStudentMemorySnapshotLineageSqlPredicate(
  snapshotAlias: string,
): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(snapshotAlias)) {
    throw new Error('Invalid student-memory snapshot SQL alias');
  }

  return `NOT EXISTS (
    SELECT 1
    FROM unnest(${snapshotAlias}.lesson_memory_entry_ids) AS source(lesson_memory_entry_id)
    LEFT JOIN lesson_memory_entries AS lesson
      ON lesson.id = source.lesson_memory_entry_id
     AND lesson.student_id = ${snapshotAlias}.student_id
     AND lesson.status = 'ready'
     AND lesson.source_content_hash IS NOT NULL
    WHERE lesson.id IS NULL
  )`;
}
```

Use `status = 'ready' AND <predicate>` in latest-ready selection, explicit ready-by-ID selection,
and guarded-parent selection. For `listStudentMemorySnapshots()`, add:

```sql
AND (snapshot.status <> 'ready' OR <predicate>)
```

only when the requested status set includes `ready`.

- [ ] **Step 4: Re-run the repository test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the canonical-read slice**

```bash
git add packages/batch-backend/src/domain/student-memory-snapshot-repository.ts \
  packages/batch-backend/tests/domain.student-memory-snapshot-repository.test.ts
git commit -m "fix(memory): enforce ready snapshot eligibility"
```

### Task 3: Make canonical arrays authoritative and expose retryable source changes

**Files:**

- Modify: `packages/batch-backend/src/application/process-student-memory-snapshot-job.ts`
- Modify: `packages/batch-backend/tests/application.process-student-memory-snapshot-job.test.ts`

**Interfaces:**

- Changes: incremental coverage always comes from snapshot columns, never stale generation notes.
- Produces: a specific worker retry branch for `StudentMemorySnapshotSourcesChangedError` with
  typed failure details and a warning suitable for operator diagnosis.

- [ ] **Step 1: Add failing worker regressions**

Create a parent whose canonical arrays disagree with `generation_notes.coveredLessonMemoryEntryIds`
and assert the generator request follows the arrays:

```ts
expect(generateSnapshot).toHaveBeenCalledWith(
  expect.objectContaining({
    request: expect.objectContaining({
      lessonMemoryEntryIds: parent.lessonMemoryEntryIds,
      homeworkMemoryEntryIds: parent.homeworkMemoryEntryIds,
    }),
  }),
);
```

Add separate non-final and final-attempt race tests that throw
`StudentMemorySnapshotSourcesChangedError`. On a non-final attempt, assert the job rejects for
BullMQ retry, the pending row remains pending, no final failure metadata is persisted, and no
candidate refresh is requested. On the final attempt, assert typed diagnostics are persisted as:

```ts
{
  code: 'student_memory_snapshot_sources_changed_before_finalize',
  stage: 'snapshot_ready_finalization',
  message: expect.any(String),
  unavailableLessonMemoryEntryIds,
}
```

In both cases, assert the warning names the student and snapshot without logging source content.

- [ ] **Step 2: Run the worker test and verify RED**

Run:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/application.process-student-memory-snapshot-job.test.ts
```

Expected: FAIL because diagnostic generation notes currently override the canonical arrays and the
source-change error falls through the generic failure branch.

- [ ] **Step 3: Correct coverage and retry diagnostics**

Replace `resolvePreviousSnapshotCoverage()` with direct array reads:

```ts
return snapshot
  ? {
      lessonMemoryEntryIds: snapshot.lessonMemoryEntryIds,
      homeworkMemoryEntryIds: snapshot.homeworkMemoryEntryIds,
    }
  : { lessonMemoryEntryIds: [], homeworkMemoryEntryIds: [] };
```

Import and branch on `StudentMemorySnapshotSourcesChangedError` beside the existing parent-change
branch. Preserve the thrown error so BullMQ retries normally, but persist structured failure
metadata and log the reason as a retryable source race.

- [ ] **Step 4: Re-run the worker test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the retry-correctness slice**

```bash
git add packages/batch-backend/src/application/process-student-memory-snapshot-job.ts \
  packages/batch-backend/tests/application.process-student-memory-snapshot-job.test.ts
git commit -m "fix(memory): retry canonical source changes"
```

### Task 4: Persist candidate-refresh delivery state

**Files:**

- Modify: `packages/batch-backend/src/application/student-memory-snapshot-generation-notes.ts`
- Modify: `packages/batch-backend/src/application/process-student-memory-snapshot-job.ts`
- Modify: `packages/batch-backend/tests/application.process-student-memory-snapshot-job.test.ts`
- Modify: `packages/batch-backend/tests/application.student-memory-inspection.test.ts`

**Interfaces:**

- Produces: `StudentMemorySnapshotCandidateRefreshEnqueueStatus` with
  `not_requested | pending | enqueued | failed`.
- Persists: the initial `candidateRefresh.enqueueStatus` atomically with the ready snapshot.
- Preserves: current behavior in which candidate enqueue failure does not invalidate a published
  snapshot.

- [ ] **Step 1: Add failing enqueue-state regressions**

Cover three paths:

- no candidate requested -> ready insert contains `enqueueStatus: 'not_requested'`;
- requested and enqueue succeeds -> ready insert contains `pending`, then metadata becomes `enqueued`;
- requested and enqueue throws -> ready insert contains `pending`, then metadata becomes `failed`,
  warning emitted, snapshot remains ready.

Update inspection assertions so the typed enqueue status remains visible in snapshot diagnostics.

- [ ] **Step 2: Run the focused unit tests and verify RED**

Run:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/application.process-student-memory-snapshot-job.test.ts \
  packages/batch-backend/tests/application.student-memory-inspection.test.ts
```

Expected: FAIL because candidate metadata records the decision but not delivery state.

- [ ] **Step 3: Add the typed state machine and persistence transitions**

Define:

```ts
export type StudentMemorySnapshotCandidateRefreshEnqueueStatus =
  | 'not_requested'
  | 'pending'
  | 'enqueued'
  | 'failed';
```

Build the initial candidate metadata with `pending` when requested and `not_requested` otherwise,
and finalize those notes before the canonical ready insert. After `requestRefresh()` resolves,
write the complete nested candidate object with `enqueued`.
When it rejects, write `failed`, log the exception, and retain the ready snapshot. Never replace the
whole `generation_notes` object with only the candidate fragment.

- [ ] **Step 4: Re-run the focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the delivery-state slice**

```bash
git add packages/batch-backend/src/application/student-memory-snapshot-generation-notes.ts \
  packages/batch-backend/src/application/process-student-memory-snapshot-job.ts \
  packages/batch-backend/tests/application.process-student-memory-snapshot-job.test.ts \
  packages/batch-backend/tests/application.student-memory-inspection.test.ts
git commit -m "fix(memory): track candidate refresh delivery"
```

### Task 5: Add an idempotent candidate-only recovery command

**Files:**

- Create: `packages/batch-backend/src/application/retry-student-profile-candidate-refresh.ts`
- Create: `packages/batch-backend/src/tools/retry-student-profile-candidate-refresh.ts`
- Create: `packages/batch-backend/tests/application.retry-student-profile-candidate-refresh.test.ts`
- Modify: `packages/batch-backend/package.json`

**Interfaces:**

- Produces: `retryStudentProfileCandidateRefreshForSnapshot({ snapshotId })`.
- Produces: `pnpm --filter @esl-pipeline/batch-backend student-profile-candidate:retry -- \
--snapshot-id <uuid>`.
- Returns: `enqueued` or `already_enqueued`; throws for missing, non-ready, ineligible, or
  not-requested snapshots.

- [ ] **Step 1: Add failing application-service regressions**

Inject the snapshot lookup, enqueue request, and notes update. Cover:

- eligible ready snapshot with `pending` or `failed` state -> enqueue once and persist `enqueued`;
- eligible legacy snapshot with `requested: true` and no enqueue status -> treat as pending;
- `enqueued` -> return `already_enqueued` without another request;
- `requested: false` or absent decision -> reject;
- missing or ineligible ready snapshot -> reject;
- enqueue failure -> persist `failed` and rethrow so the CLI exits nonzero.

Assert the request preserves the stable idempotency inputs:

```ts
expect(requestRefresh).toHaveBeenCalledWith({
  params: {
    studentId,
    sourceSnapshotId: snapshotId,
    trigger: 'manual-replay',
  },
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/application.retry-student-profile-candidate-refresh.test.ts
```

Expected: FAIL because the recovery service does not exist.

- [ ] **Step 3: Implement the application service**

Load through `getEligibleReadyStudentMemorySnapshotById()`. Require a recorded requested decision.
Return early for `enqueued`. For recoverable states, persist `pending`, call the existing
`requestStudentProfileCandidateRefresh()`, then persist `enqueued`. On enqueue failure, persist
`failed` and rethrow. Reuse the existing full generation-notes merge/update path.

- [ ] **Step 4: Implement the thin CLI and package script**

The CLI must accept exactly one required `--snapshot-id`, reject invalid/missing UUIDs before any
database or Redis call, load normal backend configuration, print the snapshot ID and outcome, and
set a nonzero exit code on failure. Ensure the normal backend TypeScript build emits
`dist/tools/retry-student-profile-candidate-refresh.js`. Do not add a broad student selector or
candidate-generation logic.

- [ ] **Step 5: Re-run the test and typecheck**

Run:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/application.retry-student-profile-candidate-refresh.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
pnpm --filter @esl-pipeline/batch-backend build
test -f packages/batch-backend/dist/tools/retry-student-profile-candidate-refresh.js
```

Expected: PASS and the compiled production tool exists. On PowerShell, use
`Test-Path packages/batch-backend/dist/tools/retry-student-profile-candidate-refresh.js` for the
final assertion.

- [ ] **Step 6: Commit the candidate recovery slice**

```bash
git add packages/batch-backend/src/application/retry-student-profile-candidate-refresh.ts \
  packages/batch-backend/src/tools/retry-student-profile-candidate-refresh.ts \
  packages/batch-backend/tests/application.retry-student-profile-candidate-refresh.test.ts \
  packages/batch-backend/package.json
git commit -m "fix(memory): add candidate enqueue recovery"
```

### Task 6: Align bounded replay selection with canonical eligibility

**Files:**

- Modify: `packages/batch-backend/src/application/student-memory-snapshot-backfill.ts`
- Modify: `packages/batch-backend/src/tools/refresh-student-memory-snapshots.ts`
- Modify: `packages/batch-backend/tests/domain.student-memory-snapshot-repository.test.ts`
- Modify: `docs/operations/student-memory-replay-backfill.md`

**Interfaces:**

- Changes: `missing`, `failed`, and `all` replay selection count only eligible ready snapshots.
- Documents: the already-supported `--candidate-refresh` switch and the candidate-only retry
  command.

- [ ] **Step 1: Add a failing replay-selection regression**

In the existing PostgreSQL-backed repository test, seed one student with only an ineligible stored
ready snapshot and another with an eligible ready snapshot. Call
`listStudentMemorySnapshotBackfillTargets({ selection: 'missing' })` and assert only the first is a
target. Add the corresponding failed-selection assertion where applicable.

- [ ] **Step 2: Run the PostgreSQL test and verify RED**

Run:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/domain.student-memory-snapshot-repository.test.ts
```

Expected: FAIL because the backfill query currently counts every stored ready row.

- [ ] **Step 3: Reuse the repository predicate in replay SQL**

Import `buildEligibleStudentMemorySnapshotLineageSqlPredicate()`, build it once for the explicit
base-table alias `snapshot_row`, and apply it to both ready facts in the snapshot CTE:

```sql
SELECT
  snapshot_row.student_id,
  BOOL_OR(
    snapshot_row.status = 'ready'
    AND <repository-owned eligibility predicate for snapshot_row>
  ) AS has_ready_snapshot,
  BOOL_OR(snapshot_row.status = 'failed') AS has_failed_snapshot,
  MAX(snapshot_row.generated_at) FILTER (
    WHERE snapshot_row.status = 'ready'
      AND <repository-owned eligibility predicate for snapshot_row>
  ) AS latest_ready_snapshot_at
FROM student_memory_snapshots AS snapshot_row
GROUP BY snapshot_row.student_id
```

Interpolate the same repository-produced predicate string in both marked positions. Do not use the
CTE name `snapshot` as the base-table alias, and do not copy a fourth hand-written eligibility
definition into the application query. Preserve existing limit, student filter, strategy, and
dry-run semantics.

- [ ] **Step 4: Re-run the PostgreSQL test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Complete the operator-facing CLI output and runbook**

Ensure dry-run and enqueue summaries print whether candidate refresh was requested. Document:

- detection/dry-run first;
- bounded `--selection missing --candidate-refresh` replay after deployment;
- the explicit snapshot-ID candidate-only retry command;
- the production container invocation
  `node dist/tools/retry-student-profile-candidate-refresh.js --snapshot-id <uuid>`;
- verification of snapshot readiness, eligibility, enqueue status, and candidate creation; and
- the stop condition requiring operator review before any production command.

- [ ] **Step 6: Commit the replay slice**

```bash
git add packages/batch-backend/src/application/student-memory-snapshot-backfill.ts \
  packages/batch-backend/src/tools/refresh-student-memory-snapshots.ts \
  packages/batch-backend/tests/domain.student-memory-snapshot-repository.test.ts \
  docs/operations/student-memory-replay-backfill.md
git commit -m "fix(memory): align replay with snapshot eligibility"
```

### Task 7: Advance the database contract and synchronize design docs

**Files:**

- Modify: `packages/contracts/src/contract-versions.ts`
- Modify: `packages/batch-backend/tests/contracts.assignment-confirmation-version.test.ts`
- Modify: `packages/batch-backend/tests/contracts.db-contract-version.test.ts`
- Modify: `packages/batch-backend/tests/contracts.manual-transcript-versions.test.ts`
- Regenerate: `packages/batch-backend/schema.sql`
- Modify: `packages/batch-backend/README.md`
- Modify: `docs/reference/STUDENT_MEMORY_V1_1_DESIGN.md`
- Modify: `docs/design/CANONICAL_ASSIGNMENT_STATE.md`
- Modify: `docs/design/FIRST_PROFILE_ONBOARDING.md`
- Modify: `docs/backend-frontend/backend-frontend-alignment.md`
- Modify: `docs/superpowers/specs/2026-07-27-student-memory-snapshot-eligibility-repair-design.md`

**Interfaces:**

- Advances: database contract `0.23.0` -> `0.23.1` and migration head -> 0045.
- Records: eligible-ready snapshot semantics, canonical source arrays as authority, candidate
  delivery recovery, and the invariant inherited by future assignment/profile work.

- [ ] **Step 1: Update the contract pins and observe the expected baseline failure**

Change only `DB_CONTRACT_VERSION` and the database migration head; keep API contract `4.1.0`.
Update the three hard-coded contract assertions to `0.23.1` and 0045. Run:

```bash
pnpm release:verify:contracts
pnpm --filter @esl-pipeline/batch-backend db:verify-baseline
```

Expected: contract verification passes; baseline verification reports the new migration ledger
until regeneration.

- [ ] **Step 2: Regenerate and verify the schema baseline**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend db:generate-baseline
pnpm --filter @esl-pipeline/batch-backend db:verify-baseline
```

Do not hand-edit `schema.sql`. Expected: PASS after regeneration.

- [ ] **Step 3: Synchronize behavior documentation**

Document the same five-part lesson-source eligibility rule in the backend README and v1.1 design.
State that snapshot columns, not generation notes, own covered source IDs. Document enqueue status
and candidate-only recovery.

In canonical assignment and first-profile docs, add the future invariant: any source retirement or
replacement must invalidate dependent memory projections atomically or make all canonical readers
derive ineligibility immediately. Update backend/frontend alignment so “latest ready snapshot” means
latest eligible ready snapshot. Mark the implementation checklist in the approved repair design as
implemented only after the corresponding code/tests exist.

- [ ] **Step 4: Run focused contract and docs checks**

Run:

```bash
pnpm release:verify:contracts
pnpm --filter @esl-pipeline/batch-backend db:verify-baseline
pnpm docs:generate:indexes
pnpm docs:check:core
pnpm docs:check:non-core
```

Expected: PASS. If full `pnpm docs:check` still reports only the four pre-existing issue-#25 stale
operations documents, record that exact evidence without editing those unrelated files.

- [ ] **Step 5: Commit the contract and documentation slice**

```bash
git add packages/contracts/src/contract-versions.ts \
  packages/batch-backend/tests/contracts.assignment-confirmation-version.test.ts \
  packages/batch-backend/tests/contracts.db-contract-version.test.ts \
  packages/batch-backend/tests/contracts.manual-transcript-versions.test.ts \
  packages/batch-backend/schema.sql packages/batch-backend/README.md \
  docs/reference/STUDENT_MEMORY_V1_1_DESIGN.md \
  docs/design/CANONICAL_ASSIGNMENT_STATE.md docs/design/FIRST_PROFILE_ONBOARDING.md \
  docs/backend-frontend/backend-frontend-alignment.md \
  docs/superpowers/specs/2026-07-27-student-memory-snapshot-eligibility-repair-design.md \
  docs/generated
git commit -m "docs(memory): define eligible snapshot recovery"
```

### Task 8: Run the broad gate and prepare the repair PR

**Files:**

- Verify: all files changed by Tasks 1-7
- Create locally, do not commit: PR body under `tmp/`

- [ ] **Step 1: Run focused database and worker validation**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend test:db:migrations
pnpm --filter @esl-pipeline/batch-backend test:db:postgres
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/application.process-student-memory-snapshot-job.test.ts \
  packages/batch-backend/tests/application.retry-student-profile-candidate-refresh.test.ts \
  packages/batch-backend/tests/application.student-memory-inspection.test.ts
pnpm release:verify:contracts
pnpm --filter @esl-pipeline/batch-backend db:verify-baseline
```

Expected: PASS.

- [ ] **Step 2: Run repository-wide validation**

Run:

```bash
pnpm format:write
pnpm format
pnpm run lint:repo-hygiene
pnpm check
git diff --check
```

Use `pnpm check` directly because this change includes a migration, worker behavior, and PostgreSQL
integration coverage. Inspect reported `tmp/check-logs` artifacts before rerunning any raw failing
lane.

- [ ] **Step 3: Perform a focused correctness review**

Review the final diff against every acceptance criterion in the approved spec. Confirm:

- migration/runtime predicates match for missing, cross-student, non-ready, and provenance-free
  lessons;
- no read path still treats stored `ready` alone as canonical current state;
- no generation-notes coverage field drives source ownership;
- enqueue failure is both recoverable and visible;
- the candidate-only command cannot generate from an ineligible snapshot; and
- no production/deployment state has been changed.

- [ ] **Step 4: Prepare and publish the PR only when authorized**

Use the repository PR template sections exactly and list only commands actually run. Set exactly
one label, `release:patch`. If publication is authorized:

```bash
git push -u origin codex/student-memory-snapshot-eligibility-repair-spec
gh pr create --base main \
  --head codex/student-memory-snapshot-eligibility-repair-spec \
  --title "Fix student-memory snapshot eligibility recovery" \
  --body-file tmp/student-memory-snapshot-eligibility-repair-pr.md \
  --label release:patch
gh pr view --json number,url,title,isDraft,labels
```

Do not deploy, run migration commands manually, or enqueue production replay in this task.

## Post-Merge Production Recovery Boundary

This section is an operator checklist, not implementation authorization.

1. Deploy the merged SHA through the normal pull-based production workflow; migration 0045 must run
   through the normal release startup path.
2. Re-run the read-only eligibility audit and confirm invalid stored `ready`/`pending` snapshots are
   now `superseded`.
3. Dry-run bounded replay selection and compare the student count with the pre-deploy audit.
4. Obtain explicit approval for the exact replay command and bound.
5. Execute the approved replay with `--selection missing --candidate-refresh`.
6. Verify each affected student receives an eligible ready snapshot and candidate enqueue state is
   `enqueued` or `not_requested` for a documented policy reason.
7. Use the candidate-only snapshot-ID command only for ready eligible snapshots whose enqueue state
   is `pending`, `failed`, or legacy-requested-without-status.
8. Confirm candidate rows/jobs exist and no new source-change retry loop remains before declaring
   recovery complete.
