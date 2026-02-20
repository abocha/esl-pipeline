# Verification, Acceptance Criteria, and Assumptions

## Acceptance Criteria

1. Data preservation:
   - no unexpected row loss in key domain tables.
2. Schema governance:
   - schema changes are migration-driven, not request-driven.
3. Drift closure:
   - canonical schema artifacts are present and consistent post-migration.
4. Performance:
   - targeted repository queries use expected index paths.
5. Runtime stability:
   - pool behavior is configurable and startup behavior deterministic.
6. CI protections:
   - migration and core PostgreSQL integration checks are mandatory.
7. RLS readiness:
   - policy and index prerequisites exist, enablement path documented.

## Test Cases and Scenarios

1. Legacy schema upgrade with real-like data.
2. Fresh schema bootstrap from migrations.
3. Idempotent re-run of all migrations.
4. Job list filtering by user/state/date with expected plan behavior.
5. Student summary query correctness before and after denormalized `jobs.student_id`.
6. Startup with migration disabled vs enabled behavior.
7. Controlled failure of migration command with clear operator signal.
8. RLS readiness audit check pass/fail paths.
9. Phase 6 CI gate pass:
   - `postgres-tests` and `worker-integration` jobs both green.

## Required Verification Artifacts

1. Migration logs.
2. `db:status` and `db:verify` outputs.
3. Table count comparison snapshots.
4. Explain plan snapshots for critical queries.
5. Post-migration smoke test checklist results.

## Assumptions and Defaults

1. Production DB can be offline during migration window.
2. Existing DB data must be preserved.
3. RLS is a near-future requirement, but enforcement may be staged.
4. SQL migrations become canonical schema authority.
5. Any ambiguous data conflict should fail migration and trigger rollback, not silent lossy transformation.
6. Live DB migration starts only after Phase 6 CI gates pass on `main`.

## Deferred but Explicitly Planned

1. Full RLS enforcement (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) after session-context plumbing is validated end-to-end.
2. Removal of temporary fallback query paths once denormalized data path has passed one stable release cycle.

## Maturity Snapshot (2026-02-20)

1. Overall posture: strong pre-migration hardening, not yet post-migration excellent.
2. Strength highlights:
   - migration governance and verification commands are in place.
   - CI now includes blocking Postgres + worker integration gates.
   - RLS readiness artifacts and audit command are implemented.
3. Remaining gaps:
   - live migration still pending.
   - RLS enforcement is intentionally deferred.
   - newly hardened CI gates still need stability history on `main`.
4. Detailed assessment and roadmap:
   - `docs/plans/postgres-hardening-offline-migration/current-state-strengths-weaknesses-roadmap.md`

## Next Gate to Excellent

1. Demonstrate sustained green DB CI gates on `main`.
2. Execute offline migration rehearsal and production migration window.
3. Stage RLS enforcement with explicit deny-path tests.
4. Retire legacy runtime schema patching paths after stable migration validation.
