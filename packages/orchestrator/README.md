# @esl-pipeline/orchestrator

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and API usage guide.
- Last Verified Against: 2026-06-27 repo state.
- Owner: orchestrator maintainers + automation agents.
- Review Cadence: monthly or after major API/runtime changes.
- Status: `active`.

Library-only ESL pipeline engine for the monorepo.

## Role

`@esl-pipeline/orchestrator` owns canonical pipeline semantics:

- validate
- import/colorize
- tts
- upload
- add-audio
- manifest

Operational execution belongs to `@esl-pipeline/batch-backend`.

## Public API

Primary exports:

- `createPipeline`
- `resolveConfigPaths`
- `loadEnvFiles`
- `resolveManifestPath`
- `newAssignment`
- `rerunAssignment`
- `getAssignmentStatus`
- `planRerunAssignment`

Additive v2 envelopes:

- `executeNewAssignmentV2`
- `executeRerunAssignmentV2`
- `executeGetAssignmentStatusV2`
- `executePlanRerunAssignmentV2`

## Rerun Contract

`rerunAssignment` treats a supplied `preset` as the selected assignment theme and otherwise falls
back to the persisted manifest preset. Batch-backend worker payloads must forward the job preset into
rerun flags so rerun HTML uses the same heading color theme as the original assignment unless the
operator intentionally changes it.

## Read Next

- [`docs/reference/agents-ssot.md`](../../docs/reference/agents-ssot.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../../docs/PIPELINE_INTEGRATION_VISION.md)
- [`docs/reference/env.md`](../../docs/reference/env.md)

## Validation

```bash
pnpm --filter @esl-pipeline/orchestrator build
pnpm --filter @esl-pipeline/orchestrator test
pnpm --filter @esl-pipeline/orchestrator test:integration
```
