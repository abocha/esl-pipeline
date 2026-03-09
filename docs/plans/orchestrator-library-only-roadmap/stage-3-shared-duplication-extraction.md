# Stage 3: Shared Duplication Extraction

## Objective

Eliminate drift by extracting duplicated domain-neutral helper logic into a shared package and adopting it from both orchestrator and batch-backend.

## Ownership Outcomes (Stage Scope)

1. `Keep`: pipeline stage orchestration and manifest semantics stay in orchestrator.
2. `Keep`: worker/process orchestration stays in batch-backend.
3. `Extract shared`: duplicated markdown/publish helpers are moved to shared-infrastructure (or approved shared package).
4. `Retire`: duplicate local helper implementations are removed after parity validation.

## Tasks

1. Identify exact duplicated helper set and freeze behavior with characterization tests in both packages.
2. Implement shared helper module with parity-focused unit tests.
3. Switch orchestrator to shared helper implementation with compatibility wrappers where needed.
4. Switch batch-backend to shared helper implementation with compatibility wrappers where needed.
5. Remove duplicate legacy helper implementations once both package suites pass.

## Dependencies

1. Stage 1 baseline tests for affected helper behavior.
2. Clear ownership ledger entries marking these helpers as `Extract shared`.

## Acceptance Criteria

1. One canonical helper implementation is used by both packages.
2. Behavior parity tests pass in both orchestrator and batch-backend.
3. Duplicate helper code paths are removed or gated behind short-lived compatibility shims.

## Risks and Rollback

1. Risk: subtle markdown rendering or insertion regressions.
2. Mitigation: before/after golden fixtures and integration assertions in both packages.
3. Rollback: revert consumer switch-over while keeping shared module isolated for further hardening.
