# Orchestrator API v2 Migration Guide (Cutover Stage)

> Archived historical migration record. The API v2 cutover and compatibility-adapter retirement are
> complete. Use [the orchestrator package README](../../../packages/orchestrator/README.md) for the
> current public API.

## Meta

- Audience: maintainers and implementing agents.
- Read Time: 5 minutes.
- Authority Level: historical migration record.
- Last Verified Against: 2026-09-13 repo state.
- Owner: orchestrator maintainers + automation agents.
- Review Cadence: weekly while migration/cutover notes remain active.
- Status: `archived`.

## Summary

API v2 is the active backend execution contract in this stage.

- v1 functions (`newAssignment`, `rerunAssignment`, `getAssignmentStatus`, `planRerunAssignment`) are unchanged.
- v2 introduces explicit DTO envelopes and stable error/event schemas.
- Batch-backend now executes through v2 APIs only.

## v2 Entry Points

Programmatic v2 operations in `@esl-pipeline/orchestrator`:

1. `executeNewAssignmentV2`
2. `executeRerunAssignmentV2`
3. `executeGetAssignmentStatusV2`
4. `executePlanRerunAssignmentV2`

All return `OrchestratorApiResultV2<T>`:

- success: `{ ok: true, schemaVersion: 'v2', operation, data }`
- failure: `{ ok: false, schemaVersion: 'v2', operation, error }`

## Stable Error Schema

`OrchestratorErrorV2` fields:

1. `schemaVersion: 'v2'`
2. `operation`
3. `category`:
   - `cancelled`
   - `validation`
   - `configuration`
   - `manifest`
   - `infrastructure`
   - `unknown`
4. `code`
5. `message`
6. `retryable`
7. optional `stage`, `causeName`

## Stable Stage-Event Schema

`AssignmentStageEventV2` fields:

1. `schemaVersion: 'v2'`
2. `source: 'orchestrator'`
3. `operation`
4. `emittedAt` (ISO timestamp)
5. optional `runId`
6. `stage`
7. `status`
8. optional `detail`

## Compatibility Status

1. Transitional v2 compatibility adapter exports were removed in Stage 8 cleanup.
2. Callers should use either:
   - v1 runtime functions directly (`newAssignment`, `rerunAssignment`, `getAssignmentStatus`, `planRerunAssignment`), or
   - v2 DTO execution methods (`execute*V2`).

## Backend Cutover Status

Batch-backend runtime is cut over to v2:

1. worker execution uses `executeNewAssignmentV2` / `executeRerunAssignmentV2`.
2. transitional v1/v2 backend switching has been retired.
3. `ESL_ORCHESTRATOR_API_VERSION` is no longer used by batch-backend.

## Deprecation Semantics (Current Stage)

1. v1 orchestrator exports remain available for compatibility callers outside backend cutover.
2. backend execution is standardized on v2 contracts.
3. CLI/wizard/path-picker removals are completed in Stage 7.
4. Stage 8 CI guardrails block orchestrator CLI reintroduction and contract/doc drift.
