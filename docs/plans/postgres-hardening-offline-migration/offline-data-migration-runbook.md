# Offline Data Migration Runbook

## Summary

This runbook executes the PostgreSQL overhaul while preserving existing real data.

## Go / No-Go Gate

Proceed to live migration only when all of the following are true:

1. `main` is green for:
   - `static-checks`
   - `postgres-tests`
   - `worker-integration`
2. Local CI-parity pass has been run at least once with real Postgres + Redis:
   - `BATCH_BACKEND_TEST_PG=<postgres-url> BATCH_BACKEND_TEST_REDIS=<redis-url> pnpm --filter @esl-pipeline/batch-backend test:ci`
3. Dress rehearsal on a production-like clone completed with:
   - `db:migrate`
   - `db:status`
   - `db:verify`
   - `db:rls-audit`
4. Rollback drill (restore from backup) was validated on the rehearsal environment.
5. Migration operator, DB owner, and release owner are assigned and available during the migration window.

## Preconditions

1. Application and workers can be taken offline.
2. Production database credentials are available.
3. Migration commands (`db:migrate`, `db:status`, `db:verify`) are in place.
4. `db:rls-audit` command is available and should be run as part of readiness checks.

## Testing Plan Before Live Cutover

### T-7 to T-3 days: Stability and rehearsal prep

1. Confirm recent `main` CI history shows stable green for DB jobs.
2. Confirm migration chain is unchanged between rehearsal and planned cutover commit.
3. Build migration checklist packet:
   - environment variables
   - runbook commands
   - owner contacts
   - rollback command list

### T-2 to T-1 days: Rehearsal on clone

1. Restore a fresh clone from production backup.
2. Run migration and readiness commands:
   - `pnpm --filter @esl-pipeline/batch-backend db:migrate`
   - `pnpm --filter @esl-pipeline/batch-backend db:status`
   - `pnpm --filter @esl-pipeline/batch-backend db:verify`
   - `pnpm --filter @esl-pipeline/batch-backend db:rls-audit`
3. Run backend validation/smoke flows.
4. Capture execution timings, failures, and recovery notes.
5. Run restore drill from pre-migration backup and confirm service health.
6. If running on a dev laptop with existing workers attached to Redis, isolate worker-integration test queue names to avoid contention:
   - `BATCH_JOBS_QUEUE_NAME='esl-jobs-test-isolated'`
   - `TRANSCRIBE_QUEUE_NAME='transcribe-queue-test-isolated'`

### T-0 day: Live cutover

1. Freeze deploys and stop API/worker traffic.
2. Take final backups.
3. Execute migration + verification.
4. Run focused smoke and SQL checks.
5. Resume traffic only after checks are green.

## Step 1 - Pre-migration Backups

1. Create full backup:
   - `pg_dump -Fc ... > pre_migration_full.dump`
2. Create schema-only backup:
   - `pg_dump --schema-only ... > pre_migration_schema.sql`
3. Capture baseline table counts for key tables:
   - `jobs`, `recordings`, `transcripts`, `prompt_packages`, `drafts`, `students`, `profiles`, `users`
4. Save baseline integrity checks:
   - foreign key validity checks
   - duplicate key risk checks for upcoming constraints

## Step 2 - Dress Rehearsal on Clone

1. Restore backup into staging clone.
2. Run `db:migrate`.
3. Run `db:verify`.
4. Run `db:rls-audit`.
5. Run backend smoke tests:
   - list jobs
   - get job summary
   - student timeline/summary endpoints
6. Compare pre/post row counts and key aggregates.
7. Record migration runtime and any lock/contention observations.

## Step 3 - Production Offline Migration

1. Stop API and worker services.
2. Take final backup snapshot.
3. Run migration status check:
   - `db:status`
4. Run migrations:
   - `db:migrate`
5. Run verification:
   - `db:verify`
6. Run readiness audit:
   - `db:rls-audit`
7. Perform targeted SQL sanity checks:
   - no null/invalid state in critical columns
   - expected new indexes present
   - expected migration versions recorded
8. Start API and workers.

## Step 4 - Post-migration Validation

1. Execute API functional checks:
   - submit/read/list/status job paths
   - readiness metrics
   - student summary and timeline
2. Validate monitoring:
   - DB errors
   - migration warnings
   - pool exhaustion symptoms
3. Compare pre/post count and aggregate snapshots.
4. Run Phase 3 reconciliation checks:
   - null-but-derivable rows should be `0`:

```sql
SELECT COUNT(*)::bigint AS null_but_derivable
FROM jobs j
LEFT JOIN recordings r ON r.id = j.recording_id
LEFT JOIN prompt_packages p ON p.id = j.prompt_package_id
LEFT JOIN recordings rp ON rp.id = p.recording_id
LEFT JOIN drafts d ON d.id = j.draft_id
LEFT JOIN prompt_packages pd ON pd.id = d.prompt_package_id
LEFT JOIN recordings rd ON rd.id = pd.recording_id
WHERE j.student_id IS NULL
  AND COALESCE(r.student_id, p.student_id, rp.student_id, d.student_id, pd.student_id, rd.student_id) IS NOT NULL;
```

   - drift rows should be `0`:

```sql
SELECT COUNT(*)::bigint AS denorm_drift_rows
FROM jobs j
LEFT JOIN recordings r ON r.id = j.recording_id
LEFT JOIN prompt_packages p ON p.id = j.prompt_package_id
LEFT JOIN recordings rp ON rp.id = p.recording_id
LEFT JOIN drafts d ON d.id = j.draft_id
LEFT JOIN prompt_packages pd ON pd.id = d.prompt_package_id
LEFT JOIN recordings rd ON rd.id = pd.recording_id
WHERE j.student_id IS NOT NULL
  AND j.student_id IS DISTINCT FROM COALESCE(
    r.student_id,
    p.student_id,
    rp.student_id,
    d.student_id,
    pd.student_id,
    rd.student_id
  );
```

## Step 5 - Rollback Procedure

1. Stop API and workers.
2. Restore pre-migration full backup.
3. Redeploy previous backend version if needed.
4. Re-run minimal smoke checks to confirm restored behavior.
5. Keep migration/verification logs and SQL snapshots for incident review.

## Success Criteria

1. No data loss.
2. No functional regressions on critical endpoints.
3. Migration history and verification checks clean.
4. RLS readiness audit reports expected readiness state.

## Operator Inputs Needed From Team

These are required to execute safely:

1. Production migration window:
   - date/time, expected downtime budget, rollback decision deadline.
2. Access and credentials:
   - production Postgres endpoint/user/secret delivery mechanism.
   - confirmation of least-privilege account or approved elevated migration account.
3. Ownership:
   - named migration operator.
   - named DB approver.
   - named release/on-call approver.
4. Environment details:
   - exact prod-like clone target for rehearsal.
   - backup storage location and retention policy.
5. Go-live controls:
   - deploy freeze confirmation.
   - communication channel for live status updates.

## Command Pack (Copy/Paste)

Set environment first:

1. `export PG_ENABLED=true`
2. `export PG_CONNECTION_STRING='<postgres-url>'`
3. `export PG_AUTO_MIGRATE_ON_BOOT=false`

Rehearsal/live command order:

1. `pnpm --filter @esl-pipeline/batch-backend db:status`
2. `pnpm --filter @esl-pipeline/batch-backend db:migrate`
3. `pnpm --filter @esl-pipeline/batch-backend db:status`
4. `pnpm --filter @esl-pipeline/batch-backend db:verify`
5. `pnpm --filter @esl-pipeline/batch-backend db:rls-audit`

Local worker integration test (only if local workers are already running):

1. `BATCH_JOBS_QUEUE_NAME='esl-jobs-test-isolated' TRANSCRIBE_QUEUE_NAME='transcribe-queue-test-isolated' pnpm --filter @esl-pipeline/batch-backend test:integration:worker`
