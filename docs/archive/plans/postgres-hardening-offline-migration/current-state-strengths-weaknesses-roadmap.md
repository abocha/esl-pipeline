# PostgreSQL Hardening Status Snapshot (2026-02-20)

## Purpose

This document captures where PostgreSQL hardening stands today, what is working well, what is still risky, and what work remains to reach an "excellent" operational state.

## Current State

1. Phase 1 through Phase 6 implementation work is now present in the repo.
2. Versioned migrations are the canonical schema path, currently through:
   - `packages/batch-backend/migrations/0007_rls_readiness_artifacts.sql`
3. Operator commands are in place:
   - `db:migrate`, `db:status`, `db:verify`, `db:rls-audit`
4. CI has explicit blocking jobs for database and integration coverage:
   - `static-checks`
   - `postgres-tests`
   - `worker-integration`
5. New hardening tests are in place:
   - migration matrix (`fresh`, `legacy-upgrade`, `idempotency`)
   - query plan/index regression assertions
   - worker integration with real Postgres + Redis services in CI
6. RLS readiness artifacts and audit checks are implemented, while enforcement remains intentionally deferred.
7. Live production migration execution is still pending and remains gated on stable CI on `main`.

## Strengths

1. Schema governance is materially stronger:
   - migration versioning and status/verify commands reduce drift and ad-hoc schema mutation risk.
2. Safety checks are broader and more explicit:
   - checksum mismatch and missing-file checks
   - migration verification of tables/constraints/indexes/extensions/columns
   - RLS readiness audit path
3. CI coverage now blocks on previously skippable DB paths.
4. Failure diagnostics are practical:
   - migration logs, schema snapshots, and explain artifacts are captured for triage.
5. Test environment safety was hardened:
   - DB test helper now forces `PG_CONNECTION_STRING` from `BATCH_BACKEND_TEST_PG` to avoid silent target drift.

## Weaknesses and Remaining Risk

1. Live migration has not yet been executed in production, so operational unknowns remain.
2. RLS is readiness-only today; hard enforcement is not active yet.
3. Legacy runtime schema patching code still exists in the runtime adapter and should be retired after migration confidence is high.
4. CI hardening is newly introduced and still needs stability history (consecutive green runs) to prove low flake risk.
5. Hardening posture is strong for pre-migration, but not yet at post-migration steady-state excellence.

## Path to "Excellent" (Prioritized)

1. Prove CI reliability:
   - require a sustained run of green `postgres-tests` + `worker-integration` on `main`.
2. Complete migration rehearsal and execution:
   - run full offline rehearsal using the runbook with backup/restore drill and rollback checkpoints.
   - execute live migration window only after rehearsal confidence is established.
3. Move from RLS readiness to staged enforcement:
   - enable RLS table-by-table behind validated session-context plumbing.
   - add deny-by-default and negative-access integration tests for each enabled table.
4. Remove legacy schema patch path:
   - after one stable release cycle post-migration, remove runtime schema patching fallback paths that overlap migration authority.
5. Strengthen operational posture:
   - define DB hardening SLOs (migration success, verify/audit pass rate, CI gate stability).
   - add periodic drift and RLS-audit checks as routine release criteria.

## Practical Definition of "Excellent"

PostgreSQL hardening can be considered "excellent" when all of the following are true:

1. Live migration completed without data integrity regression.
2. CI DB gates are stable over time with low/no flakes.
3. RLS is actively enforced on user-scoped tables with comprehensive test coverage.
4. Legacy runtime schema patching is removed or strictly quarantined from normal startup paths.
5. On-call/operator runbooks are exercised and produce predictable recovery outcomes.
