# @esl-pipeline/orchestrator

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: Package entrypoint and API usage guide.
- Last Verified Against: 2026-03-09 repo state.
- Owner: orchestrator maintainers + automation agents.
- Review Cadence: monthly or after major API/runtime changes.
- Status: `active`.

Library-only ESL pipeline engine for the monorepo.

`@esl-pipeline/orchestrator` owns canonical pipeline semantics:

- `validate`
- `import`
- `colorize`
- `tts`
- `upload`
- `add-audio`
- `manifest`

Operational execution is owned by `@esl-pipeline/batch-backend`.

## Status

- Library-only package.
- No CLI/wizard/path-picker runtime surface.
- Batch-backend is the only operational entrypoint.

## Programmatic API

Primary exports:

- `createPipeline`
- `resolveConfigPaths`
- `loadEnvFiles`
- `loadEnvFilesWithSummary`
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

## Quick Start

```ts
import { createPipeline } from '@esl-pipeline/orchestrator';

const pipeline = createPipeline({ cwd: process.cwd() });

const result = await pipeline.executeNewAssignmentV2(
  {
    assignment: {
      md: 'docs/templates/example.md',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
    },
  },
  {
    dependencies: {
      runId: 'example-run-id',
    },
  },
);

if (!result.ok) {
  throw new Error(result.error.message);
}

console.log(result.data.manifestPath);
```

## Configuration

Default config files are resolved from `packages/orchestrator/configs`:

- `presets.json`
- `voices.yml`
- `students/*.json`

Programmatic resolution:

- Use `resolveConfigPaths()` for concrete resolved paths.
- Use `createPipeline({ configProviderConfig, manifestStoreConfig })` for adapter-driven configuration.

## Contracts

- Orchestrator remains the canonical pipeline contract.
- Batch-backend remains the operational runtime contract.
- Changes to stage semantics, manifest behavior, or public API must be contract-aware and covered by regression tests.

## Development

```bash
pnpm --filter @esl-pipeline/orchestrator build
pnpm --filter @esl-pipeline/orchestrator test
pnpm --filter @esl-pipeline/orchestrator test:integration
pnpm --filter @esl-pipeline/orchestrator typecheck
```
