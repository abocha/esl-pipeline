# PostgreSQL Hardening + Offline Data-Preserving Migration Plan

## Meta

- Audience: maintainers and batch-backend agents.
- Authority Level: active infrastructure roadmap.
- Last Verified Against: 2026-05-17 repo state.
- Owner: founder-maintainer + backend maintainers.
- Review Cadence: after database hardening or migration PRs.
- Status: `roadmap`.
- Exit Trigger: archive after migration governance and Postgres operations are fully represented in runbooks, schema docs, and package READMEs.

## Summary

This plan hardens the batch-backend PostgreSQL implementation without wiping existing real data.

The strategy is:

1. Move from runtime ad-hoc schema patching to versioned migrations.
2. Reconcile schema drift between `packages/batch-backend/schema.sql` and `packages/batch-backend/src/infrastructure/db.ts`.
3. Tune query/index performance for actual repository access patterns.
4. Make connection and startup behavior configurable and deterministic.
5. Prepare fully for Row Level Security (RLS) now, but defer enforcement switch.
6. Add CI guardrails so the same classes of regressions do not reoccur.

## Scope and Locked Decisions

1. Rollout mode: in-place, offline migration.
2. Data policy: preserve existing data; no clean-slate reset.
3. RLS: implement readiness now, delay hard enablement.
4. Schema governance: migrations become source of truth.

## Important Interface and API Additions

### Operational commands

1. `db:migrate`
2. `db:status`
3. `db:verify`

### Environment variables

1. `PG_POOL_MAX` (default `10`)
2. `PG_IDLE_TIMEOUT_MS` (default `30000`)
3. `PG_CONNECTION_TIMEOUT_MS` (default `5000`)
4. `PG_AUTO_MIGRATE_ON_BOOT` (default `false` in production)
5. `PG_MIGRATION_LOCK_KEY` (default constant bigint)

### Schema changes

1. `schema_migrations` table.
2. `jobs.student_id UUID NULL` for query-path denormalization.
3. Migration-owned indexes aligned with repository filters/sorts.
4. RLS policy artifacts and readiness checks (without immediate enforcement).

## Phase Files

1. `docs/plans/postgres-hardening-offline-migration/phase-1-rebaseline-and-drift-elimination.md`
2. `docs/plans/postgres-hardening-offline-migration/phase-2-versioned-migration-system.md`
3. `docs/plans/postgres-hardening-offline-migration/phase-3-query-index-and-data-path-optimization.md`
4. `docs/plans/postgres-hardening-offline-migration/phase-4-connection-and-startup-hardening.md`
5. `docs/plans/postgres-hardening-offline-migration/phase-5-rls-readiness-and-enablement-path.md`
6. `docs/plans/postgres-hardening-offline-migration/phase-6-testing-and-ci-hardening.md`

## Supporting Files

1. `docs/plans/postgres-hardening-offline-migration/offline-data-migration-runbook.md`
2. `docs/plans/postgres-hardening-offline-migration/verification-acceptance-and-assumptions.md`
3. `docs/plans/postgres-hardening-offline-migration/current-state-strengths-weaknesses-roadmap.md`

## Phase 1 Artifacts

1. `docs/plans/postgres-hardening-offline-migration/phase-1-drift-report.md`
2. `docs/plans/postgres-hardening-offline-migration/phase-1-canonical-object-map.md`
3. `docs/plans/postgres-hardening-offline-migration/phase-1-migration-decision-ledger.md`
