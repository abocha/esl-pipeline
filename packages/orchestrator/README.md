# @esl-pipeline/orchestrator

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and API usage guide.
- Last Verified Against: 2026-07-30 repo state.
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

## Speech Plan Manifest Contract

The orchestrator persists schema-v1 and schema-v2 speech plans without inventing provenance for
legacy manifests. Schema v2 records immutable authored text, validated TTS-only synthesis text,
enhancer version, exact returned planner model, immutable annotation policy, and prompt hash.
Pronunciation-only reruns bypass study-text preparation and planning.

Normal schema-v2 logs contain only annotation/segment counts, hashes, enhancer version, and stable
issue codes. Schema-v1 logs retain their historical cue counts. Learner-bearing annotations and
rejected provider text remain behind explicit debug logging.

See
[`docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`](../../docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md)
and [`docs/reference/pipeline-manifest.md`](../../docs/reference/pipeline-manifest.md).

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
