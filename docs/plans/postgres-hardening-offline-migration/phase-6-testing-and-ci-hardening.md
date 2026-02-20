# Phase 6 Plan: Testing and CI Hardening (Postgres + Redis
Blocking)

## Summary

This phase will make Postgres hardening verifiable and non-
regressible by turning currently skippable DB/integration
coverage into deterministic, blocking CI gates. We will add
migration-path integration tests (fresh bootstrap, legacy
upgrade, idempotency), query/index regression checks, and CI
jobs that always run with provisioned Postgres and Redis
services.
Given current repo state, this phase is the final pre-live-
migration quality gate. Live DB migration should happen only
after this phase passes on main.

## Scope

1. Convert DB-dependent suites from optional/skip behavior to
 required CI execution.
2. Add explicit migration integration test matrix.
3. Add stable query-plan/index usage regression assertions for
 critical read paths.
4. Harden CI workflow with Postgres+Redis services and
 deterministic test env setup.
5. Add diagnostics artifacts for failures (migration logs,
 schema snapshot, explain output).
6. Remove ambiguity in local developer execution with clear
 scripts and env contracts.

## Out of Scope

1. New schema/business logic changes beyond what is needed to
 test/harden existing phases 1–5.
2. Production migration execution itself.
3. Performance tuning that requires production traffic replay.

## Current-State Constraints Incorporated

1. CI currently has no Postgres/Redis service containers.
2. DB integration tests are currently skippable via env/
 probing.
3. No migration integration matrix exists yet.
4. No explicit EXPLAIN/assertion regression suite exists yet.
5. User preference: PG+Redis all blocking.

## Implementation Plan (Decision-Complete)

### Workstream 1: Test command topology and contracts

1. Add/normalize batch-backend scripts:
  - test:unit for non-DB suites.
  - test:db:postgres for Postgres-required suites.
  - test:db:migrations for migration matrix.
  - test:integration:worker for PG+Redis worker integration.
  - test:ci as ordered aggregator for CI gate.
2. Keep test for developer convenience, but CI must call
 test:ci.
3. Standardize required env vars for DB tests:
  - BATCH_BACKEND_TEST_PG
  - BATCH_BACKEND_TEST_REDIS
4. Standardize optional tuning vars:
  - BATCH_BACKEND_TEST_TIMEOUT_MS
  - BATCH_BACKEND_TEST_LOG_LEVEL

### Workstream 2: Remove skip-based silent pass behavior

1. Refactor DB test gating in:
  - packages/batch-backend/tests/domain.job-
	repository.test.ts
  - packages/batch-backend/tests/application.student-
	timeline.test.ts
  - packages/batch-backend/tests/transport.worker-
	runner.integration.test.ts
2. Replace describe.skip/runtime probing patterns with:
  - explicit preflight assertion that required env endpoints
	exist.
  - explicit failure when CI contract is broken.
3. Preserve local ergonomics by scoping suites through scripts,
 not skip logic.

### Workstream 3: Migration integration matrix

1. Add new migration integration suite under packages/batch-
 backend/tests/integration/migrations/ with 3 scenarios:
  - Fresh bootstrap: empty DB -> run migrations -> verify
	status/verify script green.
  - Legacy upgrade: seed schema at pre-hardening baseline ->
	run migrations -> verify no drift.
  - Idempotency: run migrations twice -> second run is no-op
	and verification remains green.
2. For legacy baseline, use SQL fixture representing last pre-
 phase-1 production-compatible schema.
3. For each scenario assert:
  - applied migration IDs as expected.
  - required indexes present.
  - optional pg_trgm behavior correct when extension exists.
  - db:verify equivalent programmatic checks pass.
4. Persist failure artifacts to temp files for CI upload.

### Workstream 4: Query/index/data-path regression tests

1. Add focused regression tests for critical paths:
  - job listing/readiness queries.
  - student summary/timeline reads.
2. Use EXPLAIN (FORMAT JSON) assertions with stable rules:
  - assert index name presence or node type usage (Index
	Scan, Bitmap Index Scan) where contractually expected.
  - do not assert exact costs/row estimates.
3. Seed deterministic fixture data volumes sufficient to force
 index choice.
4. Run ANALYZE in test setup where needed to stabilize plan
 selection.
5. Emit explain JSON on failure for artifact capture.

### Workstream 5: CI hardening and blocking gates

1. Update .github/workflows/ci.yml into explicit jobs:
  - static-checks (build/typecheck/lint/unit-only)
  - postgres-tests (PG service; db + migration suites)
  - worker-integration (PG + Redis services; worker suite)
2. Make both DB jobs required for merge.
3. Service config defaults:
  - Postgres 18 image, health checks, deterministic
	db/user/pass.
  - Redis 8 with health checks.
4. CI step order in DB jobs:
  - install deps
  - wait-for-service health
  - run migration preflight (db:migrate + db:status +
	db:verify)
  - run respective test suite
5. Upload artifacts on failure:
  - migration logs
  - schema dump (pg_dump --schema-only)
  - explain regression outputs
  - test output logs

### Workstream 6: Flake hardening surfaced during validation

1. Address timeout instability seen in student-profiles-
 store.remote-cache tests:
  - increase deterministic timeout for that suite or
	eliminate timer race in setup.
2. Ensure no suite relies on wall-clock-sensitive defaults in
 CI.
3. Add retry policy only as last resort; prioritize
 deterministic fixes.

### Workstream 7: Documentation and operational readiness

1. Expand docs/plans/postgres-hardening-offline-migration/
 phase-6-testing-and-ci-hardening.md with:
  - final test matrix
  - exact CI gates
  - local runbook commands
  - failure triage flow
2. Update verification checklist doc to include phase-6
 acceptance gate.
3. Record migration trigger point:
  - execute live migration after phase-6 CI is green on main
	and before final rollout closeout.

## Important Public Interface / Contract Changes

1. packages/batch-backend/package.json scripts will add/rename
 CI-oriented test entrypoints (test:ci, test:db:migrations,
 etc.).
2. CI contract now requires BATCH_BACKEND_TEST_PG and
 BATCH_BACKEND_TEST_REDIS for DB/integration jobs.
3. DB/integration suites no longer silently skip in CI
 contexts; missing infra becomes explicit failure.
4. No external API payload/type contract changes expected.

## Test Cases and Scenarios

### Unit/Static

1. pnpm --filter @esl-pipeline/batch-backend lint
2. pnpm --filter @esl-pipeline/batch-backend typecheck
3. unit-only Vitest/Jest subset remains green.

### Postgres Integration

1. Fresh DB bootstrap migration test passes.
2. Legacy upgrade migration test passes.
3. Migration idempotency test passes.
4. Repository and timeline integration suites run without skip
 and pass.
5. db:status shows fully applied migrations.
6. db:verify passes with and without pg_trgm extension path
 coverage.

### Worker Integration

1. Worker runner suite executes against real Redis + Postgres
 services.
2. Queue/job lifecycle assertions pass end-to-end.
3. No runtime skip allowed in CI.

### Query/Plan Regression

3. Regression test fails if query path drops to sequential scan
### CI Validation

1. All three jobs pass in GitHub Actions.
2. Any DB service startup issue fails fast with clear
 diagnostics.
3. Failure artifacts are uploaded and actionable.

## Rollout Sequence

1. Implement scripts + test gating refactor.
2. Add migration matrix tests.
3. Add query-plan regression tests.
4. Update CI workflow and required jobs.
5. Stabilize flaky suite(s).
6. Update docs/runbooks and acceptance checklist.
7. Merge once full CI is green.
8. Trigger live DB migration window immediately after this
 phase success gate.

## Acceptance Criteria (Phase Complete When All True)

1. CI has separate blocking jobs for Postgres and worker
 integration.
2. No DB/integration suite is skipped in CI.
3. Migration matrix (fresh/legacy/idempotent) exists and
 passes.
4. Query/index regression tests exist for critical paths and
 pass.
5. Failure artifacts are available in CI for DB-related
 failures.
6. Phase-6 plan doc reflects implemented reality and
 operational commands.
7. Team can run one deterministic local command to reproduce CI
 DB gates.

## Assumptions and Defaults

1. GitHub Actions runners can run Postgres and Redis service
 containers.
2. Postgres extension setup for optional pg_trgm can be
 controlled in test fixtures.
3. Existing live DB has not changed since hardening began (as
 stated).
4. Live migration is preferred over reset and remains
 technically valid if phase-6 gates pass.
5. No additional schema-breaking changes are introduced during
 phase-6 work.

## Implemented CI Gate Matrix

1. `static-checks`:
 - dependency audit, build, typecheck, lint, unit tests.
2. `postgres-tests`:
 - Postgres service container.
 - migration preflight: `db:migrate`, `db:status`, `db:verify`.
 - blocking suites: `test:db:migrations`, `test:db:postgres`.
 - artifacts: migration logs, schema snapshot on failure, explain and migration test artifacts.
3. `worker-integration`:
 - Postgres + Redis service containers.
 - migration preflight: `db:migrate`, `db:status`, `db:verify`.
 - blocking suite: `test:integration:worker`.
 - artifacts: migration logs, worker test logs, schema snapshot on failure.

## Local Reproduction Commands

1. Unit-only baseline:
 - `pnpm --filter @esl-pipeline/batch-backend test:unit`
2. Migration matrix:
 - `BATCH_BACKEND_TEST_PG=<postgres-url> pnpm --filter @esl-pipeline/batch-backend test:db:migrations`
3. Postgres repository/query plan:
 - `BATCH_BACKEND_TEST_PG=<postgres-url> pnpm --filter @esl-pipeline/batch-backend test:db:postgres`
4. Worker integration:
 - `BATCH_BACKEND_TEST_PG=<postgres-url> BATCH_BACKEND_TEST_REDIS=<redis-url> pnpm --filter @esl-pipeline/batch-backend test:integration:worker`
5. Full backend CI parity:
 - `BATCH_BACKEND_TEST_PG=<postgres-url> BATCH_BACKEND_TEST_REDIS=<redis-url> pnpm --filter @esl-pipeline/batch-backend test:ci`

## Failure Triage Flow

1. Check migration preflight logs first (`db-migrate.log`, `db-status.log`, `db-verify.log`).
2. If migration matrix fails, inspect `migrations-*.json` artifacts for pending/checksum/verification errors.
3. If query plan regression fails, inspect `query-plan-*.json` artifacts for scan/index node changes.
4. If worker integration fails, inspect worker test logs and verify Redis/Postgres readiness in CI job output.
5. Use schema snapshot artifact (`schema.sql`) to compare actual CI schema to expected migration output.

## Post-Implementation Assessment (2026-02-20)

1. Phase 6 goals are implemented in code and CI wiring.
2. Current standing:
   - stronger than "so-so"; operationally "alright/trending strong".
   - still short of "excellent" until live migration and RLS enforcement milestones are complete.
3. Main strengths after this phase:
   - DB/integration gates are no longer silently skippable.
   - migration and query-path regressions are explicitly tested.
   - artifact capture materially improves incident triage speed.
4. Main weaknesses after this phase:
   - no production migration execution evidence yet.
   - no longitudinal CI stability history yet.
   - RLS remains readiness-only by design.
5. Follow-on roadmap to excellent:
   - `docs/plans/postgres-hardening-offline-migration/current-state-strengths-weaknesses-roadmap.md`
