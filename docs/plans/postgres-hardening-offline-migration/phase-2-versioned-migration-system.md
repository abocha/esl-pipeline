# Phase 2 Execution Plan - Versioned Migration System

## Summary

Implement a migration framework for @esl-pipeline/batch-backend that replaces request-path schema mutation (ensureJobsSchema) with explicit, versioned migrations and operational commands.
This phase delivers:

1. migration runner (db:migrate),
2. status/reporting (db:status),
3. verification (db:verify),
4. runtime switch from implicit schema patching to migration-gated operation.

The implementation is aligned to Phase 1 ledger steps MIG-001 through MIG-011.

## Scope

In scope:

1. Migration infra (directory, table, checksums, advisory locking, runner).
2. First migration set covering baseline reconciliation from Phase 1 decisions.
3. Refactor DB runtime so normal queries no longer run DDL patches.
4. New config/env flags and package scripts.
5. Documentation updates for operators.

Out of scope:

1. jobs.student_id denormalization and query rewrites (Phase 3).
2. Pool sizing hardening (PG_POOL_MAX, etc.) beyond minimal compatibility stubs (Phase 4 owns full behavior).
3. RLS policy rollout/enforcement (Phase 5).
4. CI mandatory PG integration policy changes (Phase 6).

## Important API / Interface / Type Changes

1. New package scripts in packages/batch-backend/package.json:
  - db:migrate: run pending migrations.
  - db:status: show applied/pending migrations and checksum integrity.
  - db:verify: run structural verification checks against canonical object expectations.
2. New env variables in packages/batch-backend/src/config/env.ts:
  - PG_AUTO_MIGRATE_ON_BOOT (boolean, default false in production, true in development/test).
  - PG_MIGRATION_LOCK_KEY (string/number parsed to bigint, default fixed constant).
  - PG_MIGRATIONS_DIR (optional, default packages/batch-backend/migrations from cwd resolution).
3. New migration metadata table:
  - schema_migrations:
	  - id TEXT PRIMARY KEY
	  - checksum TEXT NOT NULL
	  - applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	  - execution_ms INTEGER NOT NULL
	  - tool_version TEXT NOT NULL
4. Runtime DB interface changes in packages/batch-backend/src/infrastructure/db.ts:
  - withPgClient no longer calls ensureJobsSchema.
  - New exported helper runMigrationsIfConfigured() (used by server/worker startup).
  - createPgPool remains source of connection pool creation.

## File-by-File Implementation Plan

## A) Add Migration Infrastructure

1. Add directory:
  - packages/batch-backend/migrations/
2. Add migration runner module:
  - packages/batch-backend/src/infrastructure/migrations.ts
  - Responsibilities:
	  - discover .sql files with strict prefix NNNN_description.sql
	  - compute SHA-256 checksum of each file
	  - create schema_migrations table if missing
	  - acquire transaction-level advisory lock (pg_advisory_lock) using configured key
	  - compare applied records vs filesystem
	  - fail on checksum mismatch for already-applied migration
	  - apply pending migrations in lexical order
	  - record migration metadata row per migration
	  - release lock in finally
3. Add migration CLI tool:
  - packages/batch-backend/src/tools/migrate-db.ts
  - subcommands:
	  - migrate
	  - status
	  - verify
  - Uses loadBatchBackendEnv(...) for env loading consistency.
4. Add verification module:
  - packages/batch-backend/src/infrastructure/migration-verify.ts
  - checks:
	  - required tables exist (canonical set from Phase 1 object map)
	  - required constraints/indexes exist (key subset from Phase 1 ledger)
	  - no duplicate migration ids
	  - no checksum divergence

## B) Create Phase 2 Migration SQL Set

Use these files (exact names):

1. packages/batch-backend/migrations/0001_migration_control_plane.sql
  - create schema_migrations (if not exists)
  - create helper index on applied_at
2. packages/batch-backend/migrations/0002_core_schema_superset.sql
  - apply MIG-002, MIG-003, MIG-004, MIG-006:
	  - normalize jobs superset (add missing columns: auto_publish, source_job_id, legacy compatibility columns as needed)
	  - create/align templates, job_action_history, generation_budget_counters
	  - create/align user_settings, uploaded_files
	  - ensure drafts.student_id and prompt-package extended resolved fields exist
  - additive-only DDL in this step
3. packages/batch-backend/migrations/0003_revision_lifecycle_and_backfill.sql
  - apply MIG-005:
	  - add lifecycle fields to profile_revisions/template_revisions
	  - deterministic data normalization/backfill (lift logic currently in REVISION_PREINDEX_DATA_PATCHES + REVISION_VERSIONING_DATA_PATCHES)
	  - create unique/partial indexes for revision lifecycle invariants
4. packages/batch-backend/migrations/0004_constraints_unification.sql
  - apply MIG-007:
	  - user/job checks from schema (users_role_check, users_email_check, jobs_state_check, jobs_mode_check)
	  - action/history and revision FKs/checks from runtime patch logic
	  - reconcile names with one canonical constraint set
5. packages/batch-backend/migrations/0005_indexes_and_triggers_unification.sql
  - apply MIG-008 + MIG-009 + MIG-010:
	  - canonical index set from object map
	  - trigger functions and triggers for all canonical updated_at tables
	  - extension normalization (uuid-ossp; conditional pg_trgm block + trigram indexes)

Notes for SQL authoring:

1. Keep migrations idempotent where practical (IF NOT EXISTS, guarded DO $$ blocks).
2. Keep data-changing statements isolated from non-transaction-safe DDL.
3. Preserve existing data and avoid destructive changes in Phase 2.

## C) Refactor Runtime DB Behavior

1. In packages/batch-backend/src/infrastructure/db.ts:
  - remove schemaReadyPromise + ensureJobsSchema(...) call chain from withPgClient.
  - keep retry logic intact for transient query errors.
  - keep createPgPool stable for now.
2. Add startup migration hook:
  - runMigrationsIfConfigured():
	  - if PG_AUTO_MIGRATE_ON_BOOT=true, run migrate once on process start.
	  - if false, skip and log explicit warning if pending migrations exist (status check).
  - call from:
	  - packages/batch-backend/src/transport/http-server.ts
	  - packages/batch-backend/src/transport/worker-runner.ts
  - execute before serving traffic / processing jobs.

## D) Config and Scripts

1. Update packages/batch-backend/src/config/env.ts:
  - extend config type with pg.migrations section:
	  - autoMigrateOnBoot
	  - migrationLockKey
	  - migrationsDir
  - parse defaults:
	  - production: auto migrate off
	  - non-production: auto migrate on
2. Update packages/batch-backend/package.json scripts:
  - "db:migrate": "tsx src/tools/migrate-db.ts migrate"
  - "db:status": "tsx src/tools/migrate-db.ts status"
  - "db:verify": "tsx src/tools/migrate-db.ts verify"

## E) Documentation Updates

1. packages/batch-backend/README.md
  - replace “backend auto-creates tables on startup” wording
  - document migration commands and expected production workflow
2. docs/backend-frontend/DEPLOYMENT.md
3. docs/plans/postgres-hardening-offline-migration/phase-2-versioned-migration-system.md

## Implementation Order (Strict)

1. Add migration runner modules and CLI tool.
2. Add 0001..0005 migration files.
3. Add config variables and package scripts.
4. Refactor db.ts to remove runtime schema patching.
5. Wire startup migration hook in API/worker entrypoints.
6. Update docs.
7. Run verification/test sequence.

## Test Cases and Scenarios

1. Fresh DB bootstrap:
  - db:migrate applies all migrations, db:status shows none pending.
2. Existing legacy DB upgrade:
  - db:migrate succeeds with no data loss and normalized constraints/indexes.
3. Idempotency:
  - second db:migrate run is no-op.
4. Checksum integrity:
  - modify applied migration file => db:status/db:migrate fails with checksum mismatch.
5. Runtime no-DDL guarantee:
  - app endpoints operate without invoking schema patch statements through withPgClient.
6. Startup gating:
  - with auto-migrate off + pending migrations, startup logs actionable warning and respects configured policy.
7. Verify command:
  - missing canonical object in DB causes db:verify failure with specific object name.

## Rollout and Monitoring

1. Offline rollout sequence:
  - backup DB
  - run db:status
  - run db:migrate
  - run db:verify
  - start API/worker
2. Monitor:
  - migration logs with per-step duration
  - startup logs indicating migration mode
  - error logs for checksum/verification failures

## Assumptions and Defaults

1. Database remains offline during migration execution window.
2. Existing data must be preserved; no clean-slate reset.
3. Migration framework is custom in-repo (no third-party migration library) to match current architecture and minimize dependency surface.
4. schema.sql remains present as reference/bootstrap aid during transition, but authoritative evolution moves to versioned migrations.
5. If PG_AUTO_MIGRATE_ON_BOOT is false in production and pending migrations exist, deployment procedure is responsible for running db:migrate first.