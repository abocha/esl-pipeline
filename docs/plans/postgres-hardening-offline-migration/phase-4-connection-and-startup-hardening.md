# Phase 4 - Connection and Startup Hardening

## Summary

Harden database runtime behavior by making pool settings explicit and removing schema mutation from request-time connection usage.

## Goals

1. Make pool tuning environment-driven across deployments.
2. Ensure startup behavior is deterministic and observable.
3. Keep retry policy focused on transient operational failures.

## Work Plan

1. Add env-configurable pool parameters:
   - `PG_POOL_MAX`
   - `PG_IDLE_TIMEOUT_MS`
   - `PG_CONNECTION_TIMEOUT_MS`
2. Update config loading and validation for the new variables.
3. Update pool creation to use config values and emit startup telemetry:
   - selected pool parameters
   - migration mode
4. Separate responsibilities:
   - migration runner handles schema evolution
   - normal data access path performs only query work
5. Tighten failure modes:
   - migration failures fail fast
   - transient query failures continue using retry policy

## Deliverables

1. Config schema additions and docs updates.
2. Refactored `createPgPool` and startup logging.
3. Simplified, bounded behavior in `withPgClient`.

## Exit Criteria

1. Pool behavior can be tuned without code changes.
2. Startup log always shows selected DB runtime parameters.
3. No schema patch execution occurs during normal request flow.

## Risks and Mitigations

1. Risk: misconfigured pool values causing starvation or over-connection.  
   Mitigation: sane defaults plus config validation bounds.
2. Risk: hidden reliance on prior auto-patching behavior.  
   Mitigation: migration checks in startup and deployment runbook.

## Dependencies

1. Phase 2 migration mechanism.
2. Environment documentation updates.

