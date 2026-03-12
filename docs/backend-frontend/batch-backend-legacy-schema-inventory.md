# Batch Backend Legacy Schema Inventory

Purpose: Wave 3 inventory of legacy runtime schema patch groups in
`packages/batch-backend/src/infrastructure/db.ts`, mapped to migration parity.

## Inventory Mapping

| Legacy patch group (db.ts) | Migration parity | Status |
| --- | --- | --- |
| `JOBS_*`, `RECORDINGS_*`, `TRANSCRIPTS_*`, `PROMPT_PACKAGES_*`, `DRAFTS_*`, `USERS_TABLE_SQL`, `GENERATION_BUDGET_COUNTERS_*` | `0002_core_schema_superset.sql`, `0008_jobs_tts_provider_and_google_model.sql`, `0009_user_settings_tts_provider_canonicalization.sql`, `0010_transcripts_stt_provider.sql` | Covered |
| `PROFILE_REVISIONS_*`, `TEMPLATE_REVISIONS_*`, `STUDENTS_*`, `PROFILES_*`, `TEMPLATES_*`, `STUDENT_PROFILE_BINDINGS_*`, `REVISION_PREINDEX_DATA_PATCHES`, `REVISION_VERSIONING_DATA_PATCHES` | `0003_revision_lifecycle_and_backfill.sql` | Covered |
| `TRANSCRIPTION_CONSTRAINT_PATCHES` | `0004_constraints_unification.sql`, `0010_transcripts_stt_provider.sql` | Covered |
| `*_INDEX_PATCHES` for revision/profile/template/student/action/transcription surfaces | `0005_indexes_and_triggers_unification.sql`, `0006_jobs_student_denorm_and_indexes.sql` | Covered |
| `TRANSCRIPTION_TRIGGER_PATCHES` | `0005_indexes_and_triggers_unification.sql` | Covered |

## Temporary Exception

The runtime legacy patch catalog is retained only as emergency compatibility code
behind explicit override:

- `PG_ENABLE_LEGACY_SCHEMA_PATCHES=true`
- Entry point: `ensureJobsSchema(...)`

Default mode is migration-first (`db:migrate`, `db:status`, `db:verify`), and CI
keeps the legacy patch catalog frozen to block new ad-hoc runtime schema changes.
