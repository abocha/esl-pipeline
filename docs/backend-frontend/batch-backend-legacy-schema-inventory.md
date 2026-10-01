# Batch Backend Legacy Schema Inventory

## Meta

- Audience: maintainers and implementing agents auditing schema hardening.
- Read Time: 3 minutes.
- Authority Level: supporting migration-parity reference for batch-backend schema hardening.
- Last Verified Against: 2026-04-09 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: after migration or legacy-schema compatibility changes.
- Status: `reference`.

## Purpose

- Map the frozen legacy runtime patch catalog to versioned migration coverage.
- Support reviews that verify migration-first remains the default schema path.
- Preserve the Wave 3 inventory of legacy patch groups in
  `packages/batch-backend/src/infrastructure/db.ts`, mapped to migration parity.

## Inventory Mapping

| Legacy patch group (db.ts)                                                                                                                                                                   | Migration parity                                                                                                                                                            | Status  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `JOBS_*`, `RECORDINGS_*`, `TRANSCRIPTS_*`, `PROMPT_PACKAGES_*`, `DRAFTS_*`, `USERS_TABLE_SQL`, `GENERATION_BUDGET_COUNTERS_*`                                                                | `0002_core_schema_superset.sql`, `0008_jobs_tts_provider_and_google_model.sql`, `0009_user_settings_tts_provider_canonicalization.sql`, `0010_transcripts_stt_provider.sql` | Covered |
| `PROFILE_REVISIONS_*`, `TEMPLATE_REVISIONS_*`, `STUDENTS_*`, `PROFILES_*`, `TEMPLATES_*`, `STUDENT_PROFILE_BINDINGS_*`, `REVISION_PREINDEX_DATA_PATCHES`, `REVISION_VERSIONING_DATA_PATCHES` | `0003_revision_lifecycle_and_backfill.sql`                                                                                                                                  | Covered |
| `TRANSCRIPTION_CONSTRAINT_PATCHES`                                                                                                                                                           | `0004_constraints_unification.sql`, `0010_transcripts_stt_provider.sql`                                                                                                     | Covered |
| `*_INDEX_PATCHES` for revision/profile/template/student/action/transcription surfaces                                                                                                        | `0005_indexes_and_triggers_unification.sql`, `0006_jobs_student_denorm_and_indexes.sql`                                                                                     | Covered |
| `TRANSCRIPTION_TRIGGER_PATCHES`                                                                                                                                                              | `0005_indexes_and_triggers_unification.sql`                                                                                                                                 | Covered |

## Retirement

ABO-12 removes the old runtime DDL catalog because it recreates the retired profile/binding graph.
`ensureJobsSchema` rejects calls even with the former override. This inventory records historical
migration parity; current schema authority is the migration chain and generated baseline.
