# Orchestrator API v2 Migration Guide (Cutover Stage)

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

## Compatibility Adapters

v1-shaped callers can execute through v2 adapters without changing payload shape:

1. `newAssignmentViaV2`
2. `rerunAssignmentViaV2`
3. `getAssignmentStatusViaV2`
4. `planRerunAssignmentViaV2`

These preserve legacy call styles while running through v2 execution envelopes.

## Backend Cutover Status

Batch-backend runtime is cut over to v2:

1. worker execution uses `executeNewAssignmentV2` / `executeRerunAssignmentV2`.
2. transitional v1/v2 backend switching has been retired.
3. `ESL_ORCHESTRATOR_API_VERSION` is no longer used by batch-backend.

## Deprecation Semantics (Current Stage)

1. v1 orchestrator exports remain available for compatibility callers outside backend cutover.
2. backend execution is standardized on v2 contracts.
3. CLI/wizard/path-picker removals remain deferred to later dedicated stages.
