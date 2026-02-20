# Phase 1 Drift Report

## Summary

This report inventories PostgreSQL schema drift between:

1. `packages/batch-backend/schema.sql`
2. `packages/batch-backend/src/infrastructure/db.ts`

It also cross-checks drift against active repository/runtime usage in `packages/batch-backend/src`.

## Method

1. Extract tables, indexes, constraints, trigger functions, and triggers from both sources.
2. Compare object sets and names.
3. Validate object relevance against code usage (repositories, application modules, transport routes, tests).

## Inventory Snapshot

### Tables

- `schema.sql` tables: 13
- `db.ts` tables: 14

Only in `schema.sql`:

1. `uploaded_files`
2. `user_settings`

Only in `db.ts`:

1. `templates`
2. `job_action_history`
3. `generation_budget_counters`

### Indexes

- `schema.sql` indexes: 37
- `db.ts` indexes: 42

Only in `schema.sql` (not exhaustive categories):

1. `idx_jobs_user_id`, `idx_jobs_recording_id`, `idx_jobs_transcript_id`, `idx_jobs_prompt_package_id`, `idx_jobs_draft_id`
2. `idx_jobs_state`, `idx_jobs_created_at`
3. `idx_users_email`, `idx_users_role`
4. `idx_uploaded_files_*`, `idx_user_settings_user_id`

Only in `db.ts` (not exhaustive categories):

1. `idx_jobs_state_created_at`, `idx_jobs_source_job_id`
2. `idx_recordings_source`, `idx_recordings_student_id`, trigram indexes
3. `idx_drafts_student_id`
4. `idx_profile_revisions_profile_version`, `idx_profile_revisions_single_active`
5. `idx_template_revisions_template_version`, `idx_template_revisions_single_active`
6. `idx_templates_label`, `idx_templates_active_revision_id`
7. `idx_job_action_history_*`, `idx_generation_budget_counters_*`

### Constraints

- Named constraints in `schema.sql`: 14
- Named constraints referenced/managed in `db.ts`: 33

Only in `schema.sql`:

1. `jobs_mode_check`, `jobs_state_check`, `jobs_user_id_fkey`
2. `users_role_check`, `users_email_check`
3. `uploaded_files_*` checks
4. `user_settings_*` checks

Only in `db.ts`:

1. `jobs_source_job_id_fkey`
2. `job_action_history_*`
3. `profile_revisions_*` lifecycle checks/FKs
4. `template_revisions_*` lifecycle checks/FKs
5. `transcripts_recording_id_fkey` (managed via patch)
6. `student_profile_bindings_*` FKs beyond window check

### Trigger Functions / Triggers

`schema.sql` defines:

1. `set_jobs_updated_at`, `set_users_updated_at`
2. `set_uploaded_files_updated_at`, `set_user_settings_updated_at`
3. common update triggers for domain tables

`db.ts` defines only subset:

1. recordings/transcripts/prompt_packages/drafts/students/profiles updated_at triggers
2. no jobs/users/uploaded_files/user_settings trigger setup

### Extensions

`schema.sql`:

1. `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`

`db.ts`:

1. conditional `pg_trgm` creation and trigram indexes
2. no `uuid-ossp` handling

## High-Risk Drift Findings

1. **`jobs.auto_publish` drift (critical correctness risk).**  
   - `schema.sql` includes `auto_publish` in `jobs` table definition.  
   - `db.ts` `JOBS_TABLE_SQL` does not include `auto_publish`, and `JOBS_SCHEMA_PATCHES` do not add it.  
   - repository code reads/writes `auto_publish` (`packages/batch-backend/src/domain/job-repository.ts`).

2. **`user_settings` is used by runtime but absent from `db.ts` schema bootstrap (critical runtime risk).**  
   - `settings-repository` and extended routes query `user_settings`.  
   - `db.ts` does not create/patch `user_settings`.

3. **`templates` is used by runtime but absent from `schema.sql` (critical fresh-init risk).**  
   - `template-repository` and routes depend on `templates`.  
   - `schema.sql` does not define `templates`, while `db.ts` does.

4. **`job_action_history` and `generation_budget_counters` are in active runtime paths but absent from `schema.sql` (high risk).**

5. **Revision lifecycle model drift (high risk).**  
   - `db.ts` adds `status/version_number/version_label/activated_at/deprecated_at` + unique partial indexes.  
   - `schema.sql` base definitions are older and do not fully reflect this model.

6. **Users/jobs governance constraints differ (medium-high).**  
   - `schema.sql` applies `users_role_check`, `users_email_check`, `jobs_state_check`, `jobs_mode_check`;  
   - `db.ts` currently does not enforce these.

7. **Jobs indexing model diverges (medium-high).**  
   - `schema.sql`: mostly single-column indexes for joins/filtering.  
   - `db.ts`: composite `(state, created_at)` and `source_job_id`.  
   - current query patterns require explicit canonical index policy.

8. **Feature table asymmetry (medium).**  
   - `uploaded_files` exists in `schema.sql` only and appears currently unused in runtime code.

9. **Extension handling asymmetry (medium).**  
   - UUID extension setup only in `schema.sql`; trigram extension setup only in `db.ts`.

## Drift Classification Matrix (Phase 1 Outcome)

1. `exact_match`: 8 core tables with partial parity.
2. `same_name_diff_definition`: `jobs`, `drafts`, `prompt_packages`, `profile_revisions`, `template_revisions`, `users`.
3. `only_in_schema_sql`: `uploaded_files`, `user_settings`.
4. `only_in_db_ts`: `templates`, `job_action_history`, `generation_budget_counters`.
5. `implicit_in_code`: `auto_publish`, `source_job_id`, revision lifecycle fields.

## Pre-Migration SQL Prechecks (for Phase 2)

Run these against the offline clone before applying Phase 2 migrations:

```sql
-- 1) Detect jobs rows that would violate future strict checks
SELECT mode, COUNT(*) FROM jobs GROUP BY mode;
SELECT state, COUNT(*) FROM jobs GROUP BY state;

-- 2) Detect revision duplicate version keys before unique indexes
SELECT profile_id, version_number, COUNT(*)
FROM profile_revisions
GROUP BY profile_id, version_number
HAVING COUNT(*) > 1;

SELECT template_id, version_number, COUNT(*)
FROM template_revisions
GROUP BY template_id, version_number
HAVING COUNT(*) > 1;

-- 3) Detect multiple active revisions before partial unique indexes
SELECT profile_id, COUNT(*)
FROM profile_revisions
WHERE status = 'active'
GROUP BY profile_id
HAVING COUNT(*) > 1;

SELECT template_id, COUNT(*)
FROM template_revisions
WHERE status = 'active'
GROUP BY template_id
HAVING COUNT(*) > 1;

-- 4) Detect FK-orphan risks
SELECT COUNT(*) AS orphans
FROM drafts d
LEFT JOIN prompt_packages p ON p.id = d.prompt_package_id
WHERE p.id IS NULL;
```

## Exit Status

Phase 1 drift discovery is complete and decision-ready.
All unresolved items are moved into the canonical object map and migration decision ledger.

