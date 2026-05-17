# Phase 3 Execution Spec: Query, Index, and Data Path Optimization

## Summary

Phase 1/2 outcomes are sufficient to begin Phase 3.
The concrete target is to denormalize student identity onto jobs.student_id, rewire hot queries to use it, and add composite indexes that match actual predicates/sort order, while keeping a temporary
fallback path for null legacy rows during one compatibility window.

Guidance basis used for this spec:

1. supabase-postgres-best-practices (missing indexes, composite indexes, partial index strategy).
2. pg-aiguide Postgres docs (B-tree ordering and multicolumn index behavior with ORDER BY + LIMIT/OFFSET).

## Important API / Interface / Type Changes

1. Schema:

- Add jobs.student_id UUID NULL.

2. Migrations:

- Add packages/batch-backend/migrations/0006_jobs_student_denorm_and_indexes.sql.

3. Runtime query behavior:

- job-repository primary student filtering/path uses jobs.student_id.
- Compatibility fallback join path retained only where studentId filtering is requested and jobs.student_id IS NULL.

4. Verification:

- Extend db:verify checks to require new indexes and jobs.student_id column presence.

5. External API:

- No HTTP contract changes.

## Implementation Plan (Decision-Complete)

1. Add migration 0006_jobs_student_denorm_and_indexes.sql.

- ALTER TABLE jobs ADD COLUMN IF NOT EXISTS student_id UUID NULL;
- Backfill in deterministic priority:
  1.  existing jobs.student_id (if already present),
  2.  recordings.student_id,
  3.  prompt_packages.student_id,
  4.  prompt-package recording student (rp.student_id),
  5.  drafts.student_id,
  6.  draft->prompt-package student (pd.student_id),
  7.  draft->prompt-package->recording student (rd.student_id),
  8.  source-job inherited student (src.student_id via jobs.source_job_id).
- Create maintenance trigger function on jobs:
  - recompute NEW.student_id on insert and on updates touching recording_id, prompt_package_id, draft_id, or source_job_id.
  - trigger name: set_jobs_student_id.
- Create Phase 3 composite indexes (additive, no drops):
  - idx_jobs_student_created_at_id on (student_id, created_at DESC, id DESC)
  - idx_jobs_created_at_id on (created_at DESC, id DESC)
  - idx_jobs_user_created_at_id on (user_id, created_at DESC, id DESC)
  - idx_jobs_publish_target_state_created_at on (publish_target, state, created_at DESC)

2. Refactor packages/batch-backend/src/domain/job-repository.ts.

- For non-student-filtered list/count/summary queries:
  - remove unnecessary student join chain.
  - select j.student_id directly.
- For student-filtered queries (listJobs, countJobs, getJobSummary, getStudentJobSummaries):
  - primary predicate: j.student_id = $n.
  - compatibility fallback branch: include old COALESCE join path only when j.student_id IS NULL.
- Keep response mapping unchanged (studentId field preserved).

3. Refactor packages/batch-backend/src/application/student-timeline.ts.

- For jobs and job_action_history timeline branches:
  - primary filter uses j.student_id = $1.
  - retain fallback predicate for j.student_id IS NULL with existing COALESCE chain for one compatibility window.
- Keep event payload/output unchanged.

4. Extend verification in packages/batch-backend/src/infrastructure/migration-verify.ts.

- Add required indexes:
  - idx_jobs_student_created_at_id
  - idx_jobs_created_at_id
  - idx_jobs_user_created_at_id
  - idx_jobs_publish_target_state_created_at
- Add required column check:
  - jobs.student_id exists.

5. Update docs.

- Update docs/plans/postgres-hardening-offline-migration/phase-3-query-index-and-data-path-optimization.md with executed details and fallback-window rule.
- Add Phase 3 reconciliation SQL snippet to docs/plans/postgres-hardening-offline-migration/offline-data-migration-runbook.md.

## Compatibility Window Rule (Locked)

1. Duration: one release cycle after Phase 3 deploy.
2. During window:

- fallback join path remains only for student-filtered queries where jobs.student_id IS NULL.

3. Exit condition to remove fallback in next phase:

- reconciliation query returns 0 rows where student can be derived but jobs.student_id is null.

## Reconciliation / Acceptance SQL (must be documented and run)

1. Null-but-derivable check:

- count jobs where jobs.student_id IS NULL and legacy COALESCE path resolves non-null.

2. Drift check:

- count jobs where jobs.student_id IS DISTINCT FROM derived legacy student.

3. Phase acceptance requires both counts = 0 after migration + smoke traffic.

## Test Cases and Scenarios

1. Migration apply/idempotency:

- db:migrate applies 0006 once, rerun is no-op.

2. Repository behavior:

- listJobs/countJobs/getJobSummary return unchanged functional results with student filter.

3. Student timeline behavior:

- timeline items/count unchanged for seeded student data.

4. Backfill correctness:

- seeded legacy rows (student only on recording/prompt/draft/source_job) are populated into jobs.student_id.

5. Trigger maintenance:

- updating job.draft_id / job.prompt_package_id / job.recording_id updates jobs.student_id automatically.

6. Verify command:

- fails if required Phase 3 indexes/column are missing.

7. Plan evidence:

- collect EXPLAIN (ANALYZE, BUFFERS) for:
  - user-scoped list query with order/limit,
  - student-scoped list query with order/limit,
  - job summary by publish/state window.

## Assumptions and Defaults

1. In-place, data-preserving migration remains the strategy (no clean-slate reset).
2. Index drops are deferred; Phase 3 is additive to minimize rollback risk.
3. No new env flags are introduced for Phase 3.
4. Compatibility fallback removal is intentionally deferred until post-release reconciliation passes.
