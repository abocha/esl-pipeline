# Orchestrator Ownership Ledger

## Meta

- Audience: maintainers and AI agents making cross-package refactor decisions.
- Read Time: 8 minutes.
- Authority Level: decision ledger for Keep/Move/Extract/Retire outcomes.
- Last Verified Against: 2026-03-09 repo state.
- Owner: orchestrator + batch-backend maintainers.
- Review Cadence: update on every ownership-affecting refactor PR.
- Status: `active`.

## Decision Rubric (Apply To Every Overlap)

Each capability must be scored before deciding ownership:

1. Domain ownership fit.
2. Implementation quality and maintainability.
3. Existing test coverage and observability quality.
4. Operational fit (runtime context, failure handling, scaling model).
5. Coupling and blast radius.
6. Migration and compatibility risk.

Decision outcomes:

- `Keep`: behavior stays where it is.
- `Move`: relocate behavior to the canonical owner.
- `Extract shared`: create/reuse shared package primitive.
- `Retire`: remove obsolete or duplicate behavior.

## Ownership Matrix (2026-03-09)

| Capability | Current Location | Decision | Target | Rationale | Compatibility Impact | Migration Sequence |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical pipeline stages (`validate/import/colorize/tts/upload/add-audio/manifest`) | orchestrator runtime | Keep | orchestrator | This is canonical pipeline domain behavior and already the integration contract. | High if moved. Keep stable. | N/A |
| Manifest lifecycle and rerun planner semantics | orchestrator | Keep | orchestrator | Strong contract coupling with pipeline behavior and existing manifest schema docs/tests. | High if moved. Keep stable. | N/A |
| Stage event schema and stage-level observability emission (`stage.*`, pipeline metrics tags) | orchestrator runtime | Keep | orchestrator | Event semantics describe pipeline behavior and must evolve with stage contracts. | High for downstream integrations if drifted. | N/A |
| Worker process model, IPC cancellation relay, fallback handling | batch-backend worker infra | Keep | batch-backend | Operational concern for backend workers, queue lifecycle, and service runtime isolation. | Medium if moved. Better boundary as-is. | N/A |
| Cancellation relay and job-level cancellation propagation (API -> worker -> pipeline) | batch-backend worker infra + orchestrator cancellation errors | Keep | split by boundary (backend relay, orchestrator stage cancellation) | Relay mechanics are operational/backend-owned, while stage cancellation semantics are pipeline-owned. | Medium if collapsed into one package. | Keep split; enforce via integration tests |
| Config/manifest adapter selection APIs (`createPipeline`, adapter wiring) | orchestrator | Keep | orchestrator | Centralized pipeline construction already consumed by backend; preserves single wiring model. | Medium if moved. | N/A |
| Config-path resolution and metadata option resolution (`resolveConfigPaths`, `resolveJobOptions`) | orchestrator API consumed by backend | Keep | orchestrator | Shared contract used by backend, but semantics remain part of orchestrator public API. | Medium if moved/duplicated. | N/A |
| Markdown publish helper logic (audio-link insertion + heading theme mapping) duplicated in orchestrator and batch-backend | orchestrator + batch-backend | Extract shared | shared-infrastructure (future slice) | Domain-neutral helper behavior duplicated across packages; extraction reduces drift. | Low if additive extraction + compatibility wrappers. | 1) Add shared helper, 2) switch orchestrator, 3) switch backend, 4) remove duplicates |
| CLI/wizard/path-picker operator surfaces | orchestrator CLI + wizard entrypoints | Retire (priority) | N/A | CLI is not currently used operationally; avoid spending refactor budget here and remove obsolete operational paths in later stages. | None if removed after backend cutover gates. | Freeze -> deprecate docs -> remove in dedicated stage |
| Wizard runtime and defaults persistence | orchestrator | Keep | orchestrator | Still part of orchestrator package behavior; can be modularized internally without cross-package move. | Medium if public contract changes. | Internal seam extraction only |

## Stage 1 Baseline Characterization Coverage

The following suites are required to stay green before entering Stage 2:

1. `packages/orchestrator/tests/pipeline.integration.test.ts`
   - Canonical stage sequencing and callback status order for `newAssignment`.
2. `packages/orchestrator/tests/index.test.ts`
   - Manifest write/read behavior, rerun manifest targeting (`manifestMd`), and cancellation behavior.
3. `packages/orchestrator/tests/observability.test.ts`
   - Stage start/success/skipped observability event patterns for `newAssignment` and `rerunAssignment`.
4. `packages/batch-backend/tests/infrastructure.orchestrator-service.test.ts`
   - Backend boundary behavior for orchestrator worker invocation, abort relay, and rerun/new-assignment execution-mode payloads.

## Planned Ownership Migration Queue

### Queue A: Extract Shared Markdown Publish Helpers

- Scope: utility-level extraction only, no stage semantics move.
- Guardrails:
  - Keep orchestrator and backend behavior byte-for-byte equivalent during migration.
  - Add characterization tests in both packages before switch-over.
- Exit criteria:
  - Both packages call the shared implementation.
  - Duplicated implementations are removed.

### Queue B: Public Contract Evolution (Major Only If Needed)

- Scope: explicit request/response DTOs and stable error/event schemas.
- Guardrails:
  - Compatibility adapter layer for existing callers during transition.
  - Release label and migration notes aligned with versioning model.

## Non-Goals

- Moving backend worker/runtime concerns into orchestrator.
- Expanding CLI feature surface.
- Rewriting package boundaries without migration tests.

## Related

- `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`
- `docs/reference/agents-ssot.md`
- `docs/reference/VERSIONING_MODEL.md`
