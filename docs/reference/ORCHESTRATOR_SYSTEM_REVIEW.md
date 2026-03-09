# Orchestrator System Review (Current State)

## Meta

- Audience: maintainers and AI agents planning orchestrator refactors.
- Read Time: 10 minutes.
- Authority Level: reference map + implementation baseline.
- Last Verified Against: 2026-03-09 repo state.
- Owner: orchestrator + batch-backend maintainers.
- Review Cadence: monthly and before major refactor slices.
- Status: `active`.

## Purpose

- Provide a concrete current-state map for `@esl-pipeline/orchestrator`.
- Identify overlap and boundary seams with `@esl-pipeline/batch-backend`.
- Support long-term refactor decisions without assuming orchestrator should own every behavior.

## Current-State Architecture Map

### Primary Entry Points

- `packages/orchestrator/src/index.ts`
  - Canonical pipeline runtime (`newAssignment`, `rerunAssignment`, `getAssignmentStatus`, `planRerunAssignment`).
  - Stage semantics and manifest lifecycle are implemented here.
- `packages/orchestrator/src/pipeline.ts`
  - Pipeline construction and dependency wiring (`createPipeline`, config/manifest adapter selection).
- `packages/orchestrator/src/wizard.ts`
  - Interactive settings capture and persistence (`wizard.defaults.json`).
- `packages/orchestrator/bin/cli.ts`
  - Thin command adapter over orchestrator API. CLI is deprecated and retained only for compatibility during staged removal.

### Core Runtime Modules (post-refactor seam extraction)

- `packages/orchestrator/src/runtime/stage-reporter.ts`
  - Stage event logging/metrics/callback emission.
- `packages/orchestrator/src/runtime/audio-artifacts.ts`
  - Manifest artifact normalization and deterministic audio key generation.
- `packages/orchestrator/src/runtime/publish-utils.ts`
  - Markdown audio-link insertion, heading color mapping, title resolution.
- `packages/orchestrator/src/runtime/tts-telemetry.ts`
  - TTS spend summary, provider error categorization, voice telemetry helpers.

### Stage Flow (Canonical)

- `validate` -> `import` -> `colorize` -> `tts` -> `upload` -> `add-audio` -> `manifest`
- `rerun` executes a planner-selected subset of `tts`, `upload`, `add-audio`, then rewrites manifest.

### Stable Contracts

- Public API surface remains centered on `createPipeline` and orchestrator runtime methods.
- Manifest schema and additive evolution rules are defined in `docs/reference/pipeline-manifest.md`.
- Observability event naming for pipeline and stage lifecycle remains contract-sensitive.

## Orchestrator <-> Batch-Backend Overlap Map

### Direct Integration Boundary

- `batch-backend` depends on orchestrator as the pipeline engine via `createPipeline` and runtime methods.
- Batch worker lifecycle, process isolation, cancellation relay, and fallback behavior live in batch-backend worker infrastructure.

### Confirmed Overlaps / Seams

- Markdown publish helpers are implemented in both packages (audio link insertion and heading theme mapping behavior).
- Config path resolution is consumed in batch-backend for profile/config surfaces and by orchestrator itself.
- Observability concerns are split: orchestrator emits stage telemetry; batch-backend maps those events into service logger/metrics systems.

### Boundary Health Snapshot

- Good boundary: canonical stage behavior remains in orchestrator.
- Mixed boundary: markdown preview/publish helper logic has duplication and should be reviewed for extraction.
- Good boundary: worker orchestration concerns are better placed in batch-backend, not orchestrator.

## Refactor Constraints

- Preserve orchestrator stage semantics unless an explicit major contract migration is approved.
- Do not prioritize CLI feature work in current project state.
- Prefer ownership-driven placement over centralization for its own sake.

## Related

- `docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`
- `docs/reference/agents-ssot.md`
- `docs/reference/pipeline-manifest.md`
- `packages/orchestrator/src`
- `packages/batch-backend/src`
