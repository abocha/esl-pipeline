# Stage 5: API v2 Additive Contract

## Objective

Introduce explicit API v2 request/result contracts and stable error/event semantics without breaking existing callers yet.

## Ownership Outcomes (Stage Scope)

1. `Keep`: pipeline domain APIs remain orchestrator-owned.
2. `Keep`: backend runtime and transport APIs remain batch-backend-owned.
3. `Extract shared`: shared contract primitives are added only when reused across packages.
4. `Retire`: no removals yet; v1 API remains behind compatibility adapters.

## Tasks

1. Define additive v2 DTOs for core orchestrator operations:
   - new assignment,
   - rerun assignment,
   - status retrieval,
   - rerun planning.
2. Define stable error categorization and stage-event schema for observability consumers.
3. Provide compatibility adapter layer from legacy call shapes to v2 runtime execution.
4. Update backend integration code to support dual-readiness for v1 and v2 during cutover prep.
5. Document migration guidance and deprecation semantics without removing v1 in this stage.

## Dependencies

1. Stage 4 modular seams in place.
2. Ownership ledger and SSOT references updated for contract evolution path.

## Acceptance Criteria

1. v2 DTOs are available and tested while v1 remains functional.
2. Backend integration tests can exercise v2-ready path without production cutover.
3. Observability and error schema parity checks pass.

## Risks and Rollback

1. Risk: type-level additions create confusion or dual-path drift.
2. Mitigation: strict adapter tests and canonical examples for both interfaces.
3. Rollback: keep v2 behind opt-in path while hardening adapters and docs.

## Implementation Notes (Stage 5 Execution)

1. Added orchestrator API v2 DTO/result envelope surface with stable schema:
   - request DTOs for new/rerun/status/plan
   - `OrchestratorApiResultV2<T>` success/failure envelope
   - stable `OrchestratorErrorV2` categories + codes
   - stable `AssignmentStageEventV2` schema
2. Added compatibility adapters from legacy call shapes to v2 execution:
   - `newAssignmentViaV2`
   - `rerunAssignmentViaV2`
   - `getAssignmentStatusViaV2`
   - `planRerunAssignmentViaV2`
3. Added pipeline-level v2 methods on `createPipeline()` return type for dual-readiness.
4. Added backend dual-readiness selector:
   - `ESL_ORCHESTRATOR_API_VERSION` (`v1` default, `v2` opt-in)
   - worker execution honors selected version while preserving v1 default behavior.
5. Added migration guidance doc:
   - `docs/reference/ORCHESTRATOR_API_V2_MIGRATION.md`
