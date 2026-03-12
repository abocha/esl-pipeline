# Phase 1 Canonical Object Map

## Summary

This map defines canonical ownership for schema objects during transition to migration-managed DDL.

Target policy:

1. **Phase 2+ canonical source**: versioned SQL migrations.
2. **Phase 1 selection rule**:
   - runtime-critical semantics from `db.ts` are preserved,
   - active object coverage from `schema.sql` is retained where required,
   - missing active objects from either source are normalized into migration baseline.

## Canonical Object Decisions

## Tables

| Table                        | Current State                                                       | Canonical Decision                                                             | Status          |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------- |
| `users`                      | present in both, constraints differ                                 | Keep single table, merge stronger constraints/checks + triggers via migrations | normalize       |
| `jobs`                       | present in both, columns differ (`auto_publish` vs `source_job_id`) | Keep single superset schema in migrations                                      | normalize       |
| `recordings`                 | present in both, mostly aligned                                     | keep with merged index strategy                                                | normalize       |
| `transcripts`                | present in both                                                     | keep, enforce FK/check parity                                                  | normalize       |
| `prompt_packages`            | present in both, resolved\_\* fields differ                         | keep superset including version/status fields                                  | normalize       |
| `drafts`                     | present in both, `student_id` drift                                 | keep with `student_id` included                                                | normalize       |
| `profile_revisions`          | present in both, lifecycle columns drift                            | keep lifecycle model from runtime patches                                      | normalize       |
| `template_revisions`         | present in both, lifecycle columns drift                            | keep lifecycle model from runtime patches                                      | normalize       |
| `students`                   | present in both                                                     | keep                                                                           | exact_match-ish |
| `profiles`                   | present in both                                                     | keep                                                                           | exact_match-ish |
| `templates`                  | only in `db.ts`, actively used                                      | add to migration baseline                                                      | add             |
| `student_profile_bindings`   | present in both                                                     | keep with full FK/check set                                                    | normalize       |
| `job_action_history`         | only in `db.ts`, actively used                                      | add to migration baseline                                                      | add             |
| `generation_budget_counters` | only in `db.ts`, actively used                                      | add to migration baseline                                                      | add             |
| `user_settings`              | only in `schema.sql`, actively used                                 | add to migration baseline                                                      | add             |
| `uploaded_files`             | only in `schema.sql`, currently not used                            | keep as feature table, classify optional                                       | keep_optional   |

## Columns and Semantics

1. `jobs.auto_publish`: canonical keep.
2. `jobs.source_job_id`: canonical keep.
3. `jobs.transcribe_workdir`, `jobs.transcript_path`, `jobs.prompt_payload`, `jobs.prompt_notes`, `jobs.profile_path`: keep for backwards compatibility unless explicitly deprecated in later phase.
4. `drafts.student_id`: canonical keep.
5. `prompt_packages.resolved_profile_version_label`, `resolved_profile_status`, `resolved_template_version_label`, `resolved_template_status`: canonical keep.
6. Revision lifecycle columns (`status`, `version_number`, `version_label`, `activated_at`, `deprecated_at`): canonical keep.

## Constraints

Canonical baseline includes both:

1. user/job safety checks from `schema.sql`:
   - `users_role_check`, `users_email_check`, `jobs_state_check`, `jobs_mode_check`
2. revision and action constraints from `db.ts`:
   - revision lifecycle checks/FKs
   - `job_action_history_*`
   - `jobs_source_job_id_fkey`

## Indexes

Canonical strategy for Phase 2 baseline:

1. Keep functional indexes required by query paths and constraints.
2. Preserve unique/partial revision indexes from `db.ts`.
3. Preserve users/jobs lookup indexes from `schema.sql`.
4. Keep trigram indexes only if `pg_trgm` extension exists and query workloads need them.
5. Remove duplicate overlapping indexes only after workload validation in later phases.

## Trigger Functions and Triggers

Canonical baseline:

1. Keep `updated_at` triggers for all active tables:
   - jobs, users, recordings, transcripts, prompt_packages, drafts, students, profiles
2. Keep `uploaded_files` and `user_settings` update triggers when those tables are retained.

## Extensions

Canonical extension handling:

1. Keep `uuid-ossp` for compatibility with existing SQL defaults.
2. Keep conditional `pg_trgm` install/index creation with graceful permission fallback.

## Ownership Rules Going Forward

1. `schema.sql` becomes bootstrap/reference only after migration system lands.
2. Runtime `db.ts` no longer mutates schema in request path after Phase 2.
3. All new schema changes must be migration-first and reflected in canonical docs.
