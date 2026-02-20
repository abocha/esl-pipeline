# Phase 6 - Testing and CI Hardening

## Summary

Make PostgreSQL correctness and migration safety mandatory in CI to prevent recurrence of drift and performance regressions.

## Goals

1. Ensure core Postgres integration tests always run in CI.
2. Add migration correctness, idempotency, and legacy-upgrade coverage.
3. Add planner-regression checks for critical query paths.

## Work Plan

1. Remove optional PG gating for core DB integration suites in CI.
2. Add CI Postgres service and deterministic test setup.
3. Add migration test matrix:
   - fresh database bootstrap
   - legacy snapshot upgrade
   - repeated migration no-op check
4. Add schema consistency tests:
   - expected post-migration schema shape
   - constraints/index presence checks
5. Add targeted plan checks for high-value queries:
   - list jobs
   - readiness metrics
   - student summaries/timeline
6. Add failure diagnostics artifacts in CI:
   - migration logs
   - schema diff output
   - explain plan snapshots

## Deliverables

1. CI workflow updates with mandatory PG suites.
2. Migration integration test files.
3. Query plan regression fixtures and assertions.

## Exit Criteria

1. CI fails on migration drift or missing schema artifacts.
2. CI fails on broken PG integration paths by default.
3. Critical query plans remain inside expected access patterns.

## Risks and Mitigations

1. Risk: CI duration increases materially.  
   Mitigation: split fast and full lanes while keeping migration and core DB suites mandatory.
2. Risk: flaky plan assertions across environments.  
   Mitigation: assert stable plan characteristics rather than exact full text.

## Dependencies

1. Completed migrations and updated repository query paths.
2. Stable CI Postgres provisioning.

