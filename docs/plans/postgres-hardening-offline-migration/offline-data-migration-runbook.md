# Offline Data Migration Runbook

## Summary

This runbook executes the PostgreSQL overhaul while preserving existing real data.

## Preconditions

1. Application and workers can be taken offline.
2. Production database credentials are available.
3. Migration commands (`db:migrate`, `db:status`, `db:verify`) are in place.

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
4. Run backend smoke tests:
   - list jobs
   - get job summary
   - student timeline/summary endpoints
5. Compare pre/post row counts and key aggregates.

## Step 3 - Production Offline Migration

1. Stop API and worker services.
2. Take final backup snapshot.
3. Run migration status check:
   - `db:status`
4. Run migrations:
   - `db:migrate`
5. Run verification:
   - `db:verify`
6. Perform targeted SQL sanity checks:
   - no null/invalid state in critical columns
   - expected new indexes present
   - expected migration versions recorded
7. Start API and workers.

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

## Success Criteria

1. No data loss.
2. No functional regressions on critical endpoints.
3. Migration history and verification checks clean.
