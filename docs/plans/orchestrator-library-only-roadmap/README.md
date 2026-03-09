# Orchestrator Library-Only Roadmap

## Summary

This is a medium-scale staged plan to make `@esl-pipeline/orchestrator` a library-only pipeline engine while keeping `@esl-pipeline/batch-backend` as the operational execution platform.

The roadmap merges three locked directions:

1. Ownership-driven architecture decisions (`Keep`, `Move`, `Extract shared`, `Retire`).
2. Long-road refactor sequencing with compatibility and parity gates.
3. Explicit end-state of removing CLI surface from orchestrator.

## Goal Statement

1. Orchestrator owns canonical pipeline semantics and exports programmatic runtime APIs.
2. Batch-backend owns runtime operations (API, queue, worker/process lifecycle, cancellation relay, retries, environment-specific execution concerns).
3. Shared duplicated helpers are extracted once into shared packages.
4. CLI, wizard, and path-picker surfaces in orchestrator are retired after deprecation and backend cutover gates.

## Scope and Locked Decisions

1. Stage progression is sequence-based only; no date scheduling is part of this plan.
2. Current orchestrator APIs are preserved initially via compatibility adapters.
3. API v2 is additive first, then old surfaces are removed in a dedicated cleanup stage.
4. Batch-backend remains the only operational entrypoint after cutover.
5. Existing in-progress orchestrator refactor artifacts are inputs, not parallel alternatives:
   - `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`
   - `docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`

## Stage Index

1. [stage-1-baseline-and-ownership-lock.md](stage-1-baseline-and-ownership-lock.md)
2. [stage-2-cli-sunset-declaration.md](stage-2-cli-sunset-declaration.md)
3. [stage-3-shared-duplication-extraction.md](stage-3-shared-duplication-extraction.md)
4. [stage-4-orchestrator-core-modularization.md](stage-4-orchestrator-core-modularization.md)
5. [stage-5-api-v2-additive-contract.md](stage-5-api-v2-additive-contract.md)
6. [stage-6-backend-cutover-and-parity.md](stage-6-backend-cutover-and-parity.md)
7. [stage-7-cli-wizard-path-picker-removal.md](stage-7-cli-wizard-path-picker-removal.md)
8. [stage-8-final-cleanup-and-ci-guardrails.md](stage-8-final-cleanup-and-ci-guardrails.md)

## Definition of Done

1. Orchestrator ships as library-only package with no CLI command entrypoint.
2. Canonical pipeline stage semantics and manifest contracts remain stable or intentionally versioned.
3. Batch-backend executes all production workflows against orchestrator programmatic APIs only.
4. Duplicated cross-package helper logic is consolidated into shared implementation.
5. API v2 request/result contract is used by backend and covered by compatibility and regression tests.
6. Docs and SSOT reflect final ownership boundaries and no longer position orchestrator CLI as an operational path.

## Mandatory Test Gates (All Stages)

1. Characterization/parity tests before structural changes.
2. Orchestrator: unit + integration + typecheck.
3. Batch-backend orchestrator integration tests at cutover-sensitive stages.
4. Ownership migration tests for extracted shared helpers.
5. Observability and cancellation parity checks.
6. Docs validation: `pnpm docs:check`.
