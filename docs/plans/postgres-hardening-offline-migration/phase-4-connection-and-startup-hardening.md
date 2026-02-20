# Phase 4 - Connection and Startup Hardening

## Summary

Harden PostgreSQL runtime behavior by making pool tuning explicit via env/config, adding deterministic startup telemetry, and preserving fail-fast migration startup semantics.

## Goals

1. Make pool tuning environment-driven across deployments.
2. Ensure startup behavior is deterministic and observable.
3. Keep retry policy focused on transient operational failures.

## Scope

In scope:

1. Add and validate `PG_POOL_MAX`, `PG_IDLE_TIMEOUT_MS`, `PG_CONNECTION_TIMEOUT_MS`.
2. Wire pool settings into `createPgPool()`.
3. Add startup telemetry for API + worker + transcribe-worker.
4. Improve migration mode observability in startup flow.
5. Update docs and env templates.

Out of scope:

1. New DB schema migrations.
2. RLS enablement (Phase 5).
3. CI policy hardening (Phase 6).

## Work Plan

1. Extend `BatchBackendConfig.pg` with:
   - `poolMax`
   - `idleTimeoutMs`
   - `connectionTimeoutMs`
2. Parse and validate pool env vars:
   - `PG_POOL_MAX` default `10`, range `1..100`
   - `PG_IDLE_TIMEOUT_MS` default `30000`, range `1000..600000`
   - `PG_CONNECTION_TIMEOUT_MS` default `5000`, range `100..120000`
3. Update pool creation:
   - `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` now sourced from config.
4. Add pool initialization telemetry:
   - `event: pg_pool_initialized`
   - includes selected pool settings + endpoint mode (connection string vs host/port).
5. Add startup telemetry before migration checks in all service entrypoints:
   - `event: startup_configuration`
   - includes `pgEnabled`, `autoMigrateOnBoot`, pool settings.
6. Add migration mode telemetry in `runMigrationsIfConfigured()`:
   - disabled/manual/auto mode info logs.
7. Update docs and examples:
   - `packages/batch-backend/README.md`
   - `docs/backend-frontend/DEPLOYMENT.md`
   - `docs/reference/env.md`
   - `.env.batch-backend.example`
8. Add tests:
   - config parsing/validation coverage for new env vars.
   - unit coverage that `createPgPool()` forwards configured pool settings.

## Deliverables

1. Config schema additions + validation for PG pool tuning.
2. Refactored `createPgPool()` with config-driven settings.
3. Startup telemetry in all PG-using entrypoints.
4. Migration mode observability logs.
5. Updated operator docs + env templates.
6. Added test coverage for config and pool wiring.

## Exit Criteria

1. Pool behavior can be tuned without code changes.
2. Startup logs always show selected DB runtime parameters.
3. Migration mode is explicit in startup logs.
4. No schema patch execution occurs during normal request flow.

## Risks and Mitigations

1. Risk: misconfigured pool values cause starvation/over-connection.
   Mitigation: bounded validation and sane defaults.
2. Risk: hidden reliance on old auto-patching behavior.
   Mitigation: migration checks/logging remain enforced at startup.

## Dependencies

1. Phase 2 migration framework.
2. Phase 3 query/index changes already landed.
