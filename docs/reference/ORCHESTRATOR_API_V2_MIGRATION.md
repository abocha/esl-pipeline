# Orchestrator API v2 Migration Guide (Additive Stage)

## Summary

API v2 is additive in this stage. v1 remains fully supported.

- v1 functions (`newAssignment`, `rerunAssignment`, `getAssignmentStatus`, `planRerunAssignment`) are unchanged.
- v2 introduces explicit DTO envelopes and stable error/event schemas.
- Batch-backend can opt into v2 runtime execution using `ESL_ORCHESTRATOR_API_VERSION=v2`.

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

## Backend Dual-Readiness

Batch-backend supports dual readiness:

1. default: `ESL_ORCHESTRATOR_API_VERSION=v1`
2. opt-in: `ESL_ORCHESTRATOR_API_VERSION=v2`

This enables incremental v2 verification in backend environments without production cutover.

## Deprecation Semantics (Current Stage)

1. v1 is supported and not removed in this stage.
2. v2 is the additive contract for cutover preparation.
3. Removals (if any) are deferred to later major-impact stages after parity validation.
