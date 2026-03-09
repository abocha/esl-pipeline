# Stage 1: Baseline and Ownership Lock

## Objective

Create a trusted baseline for behavior and lock ownership decisions before any high-impact structural changes.

## Ownership Outcomes (Stage Scope)

1. `Keep`: canonical pipeline stages and manifest semantics in orchestrator.
2. `Keep`: worker/process lifecycle behavior in batch-backend.
3. `Extract shared`: duplicated markdown/publish helper candidates are marked for extraction, not moved ad hoc.
4. `Retire`: CLI/wizard/path-picker remain active for now but are explicitly marked as retirement targets.

## Tasks

1. Consolidate current-state map and decision ledger as active references.
2. Enumerate overlapping capabilities with owner, rationale, and migration direction.
3. Add or tighten characterization tests for:
   - stage sequencing,
   - manifest read/write/rerun behavior,
   - cancellation and observability event patterns,
   - backend integration boundary calls into orchestrator.
4. Record non-negotiable invariants in docs to prevent boundary drift during later stages.

## Dependencies

1. Existing orchestrator and batch-backend integration tests must be executable in local CI lanes.
2. Ownership ledger and review docs must be present and linked from routing docs.

## Acceptance Criteria

1. Baseline behavior is captured by characterization tests and can be replayed on demand.
2. Every overlapping capability has an explicit ownership decision in the ledger.
3. SSOT references ownership rules and migration constraints.

## Risks and Rollback

1. Risk: incomplete baseline allows accidental regressions later.
2. Mitigation: block entry to Stage 2+ until baseline suite is green.
3. Rollback: pause further refactor and extend characterization coverage until gaps are closed.

## Implementation Notes (Stage 1 Execution)

1. Ownership ledger expanded with explicit decisions for:
   - stage event schema ownership,
   - cancellation relay split ownership,
   - config/options boundary ownership,
   - CLI/wizard/path-picker retirement target.
2. Characterization coverage tightened:
   - orchestrator stage callback terminal order assertions (`pipeline.integration.test.ts`),
   - rerun manifest lifecycle assertions (`index.test.ts`),
   - backend worker boundary execution-mode assertions (`infrastructure.orchestrator-service.test.ts`).
3. SSOT now contains a mandatory Stage 1 baseline lock section that gates entry to Stage 2+.
