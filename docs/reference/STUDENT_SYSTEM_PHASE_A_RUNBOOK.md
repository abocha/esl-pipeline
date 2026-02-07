# Student System Phase A Runbook

## Purpose

Operational guide for moving student/profile metadata from filesystem JSON into canonical Postgres tables (`students`, `profiles`, `student_profile_bindings`).

## Prerequisites

- Postgres reachable by `@esl-pipeline/batch-backend` (`PG_ENABLED=true`).
- Local config provider (`ESL_PIPELINE_CONFIG_PROVIDER=local`).
- Existing student JSON source directory (default from orchestrator config, or pass `--students-dir`).

## Rollout Steps

1. Ensure backend schema is current.
   - Run any backend process once (schema auto-ensures), or run a backend check command.
2. Dry-run backfill.
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:backfill:dry`
3. Apply backfill.
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:backfill`
4. Verify canonical data.
   - `GET /students` should match expected roster.
   - Spot-check profile bindings through API behavior (`profileId` on student records).
   - Optional one-off lifecycle verification:
     - `pnpm --filter @esl-pipeline/batch-backend run student-system:verify:oneoff`
5. Enable DB-backed reads.
   - Set `STUDENT_SYSTEM_SOURCE=hybrid` for transition.
   - After confidence, set `STUDENT_SYSTEM_SOURCE=db` and `STUDENT_SYSTEM_FS_FALLBACK=false`.

## Verification Checklist

- Student CRUD works from API/UI after mode switch.
- Prompt package creation still resolves student-selected profile IDs.
- No unexpected drop in `/students` total after switching from `hybrid` to `db`.

## Rollback Strategy

- Immediate runtime rollback:
  - Set `STUDENT_SYSTEM_SOURCE=fs` and redeploy/restart backend.
- Transitional rollback:
  - Set `STUDENT_SYSTEM_SOURCE=hybrid` and keep `STUDENT_SYSTEM_FS_FALLBACK=true`.
- Data rollback:
  - Do not drop new tables during Phase A. If needed, re-run backfill after correcting source JSON.

## Notes

- Backfill is idempotent (`upsert` semantics by deterministic student ID).
- `student_profile_bindings` keeps historical linkage and is updated as student profile assignments change.
