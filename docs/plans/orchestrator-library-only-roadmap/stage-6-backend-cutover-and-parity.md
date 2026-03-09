# Stage 6: Backend Cutover and Parity

## Objective

Cut batch-backend to orchestrator API v2 and prove runtime parity before any CLI-surface removal.

## Ownership Outcomes (Stage Scope)

1. `Keep`: orchestrator remains pipeline engine library.
2. `Keep`: batch-backend remains operational execution platform.
3. `Extract shared`: no new extraction unless needed to complete parity.
4. `Retire`: temporary backend dual-path support is removed once parity is proven.

## Tasks

1. Switch backend orchestrator integration calls to v2 DTOs.
2. Remove transitional dual-call paths after parity validation.
3. Run full backend orchestrator integration suite for:
   - stage progression,
   - rerun flows,
   - cancellation propagation,
   - manifest write/read semantics,
   - observability event and metric parity.
4. Validate operational workflows (job submission to final artifact states) through backend surfaces only.

## Dependencies

1. Stage 5 v2 additive contract and adapters are complete.
2. Baseline and regression suites are green pre-cutover.

## Acceptance Criteria

1. Batch-backend runs fully on orchestrator v2 API path.
2. No behavior regressions versus Stage 1 baseline in critical workflows.
3. Backend integration suites and orchestrator suites both pass.

## Risks and Rollback

1. Risk: cutover exposes hidden coupling assumptions from legacy call shapes.
2. Mitigation: keep short-lived rollback branch with adapter fallback until parity is signed off.
3. Rollback: temporarily re-enable compatibility path while fixing contract mismatches.
