# ESL Pipeline

ESL Pipeline automates the workflow from lesson input to published ESL homework.
It supports both CLI usage and service-style programmatic integration.

## Fast Re-Entry

- If you are resuming after context overload, start at `START_HERE.md`.

## What This Repo Is (Current State)

This monorepo currently provides:

- A pipeline orchestrator (`@esl-pipeline/orchestrator`) for validation, publishing, optional TTS, upload, and manifest tracking.
- A CLI (`esl`) for interactive and non-interactive assignment runs.
- A batch backend/frontend system for upload -> transcript -> prompt -> draft -> publish workflows.
- Shared packages for markdown validation, parsing, adapters, contracts, and infrastructure.

Primary integrations:

- Notion (publishing)
- ElevenLabs (TTS)
- AWS/S3 (upload/storage)

## Quick Start (From Source Checkout)

### Prerequisites

- Node `24.11.1+`
- pnpm (`corepack enable`)
- ffmpeg on `PATH` (or set `FFMPEG_PATH`)

### 1) Install + Configure

```bash
corepack enable
pnpm install
cp .env.example .env
```

Fill required credentials as needed (Notion/ElevenLabs/AWS). See `docs/reference/env.md`.

### 2) Build CLI Package

```bash
pnpm --filter @esl-pipeline/orchestrator build
```

### 3) Run First Pipeline Command

Interactive:

```bash
pnpm esl --interactive
```

Non-interactive:

```bash
pnpm esl --md ./lessons/mission.md --preset b1-default --with-tts --upload s3
```

Expected outcome:

- pipeline stages execute
- manifest is written
- status/publish metadata is available for reruns and checks

### Zero-Install Option

```bash
npx @esl-pipeline/orchestrator esl --interactive
```

## Programmatic API In 60 Seconds

```ts
import { createPipeline, loadEnvFiles } from '@esl-pipeline/orchestrator';

loadEnvFiles();

const pipeline = createPipeline({ cwd: process.cwd() });

const result = await pipeline.newAssignment({
  md: './lessons/mission.md',
  preset: 'b1-default',
  withTts: true,
  upload: 's3',
});

console.log(result.steps, result.manifestPath);
```

Key exports:

- `createPipeline`
- `resolveConfigPaths`
- `loadEnvFiles`
- `resolveManifestPath`

For full contracts and behavior rules: `docs/reference/agents-ssot.md`.

## Repository Map

| Package                          | Purpose                             | Read Next                                  |
| -------------------------------- | ----------------------------------- | ------------------------------------------ |
| `packages/orchestrator`          | CLI + pipeline API                  | `packages/orchestrator/README.md`          |
| `packages/md-validator`          | Markdown validation                 | `packages/md-validator/README.md`          |
| `packages/pmd`                   | PMD parsing + study-text extraction | `packages/pmd/README.md`                   |
| `packages/notion-adapter`        | Notion publishing adapter           | `packages/notion-adapter/README.md`        |
| `packages/tts-elevenlabs`        | ElevenLabs integration              | `packages/tts-elevenlabs/README.md`        |
| `packages/storage-uploader`      | Upload/storage adapter              | `packages/storage-uploader/README.md`      |
| `packages/batch-backend`         | Batch API + workers                 | `packages/batch-backend/README.md`         |
| `packages/batch-frontend`        | Batch web UI                        | `packages/batch-frontend/README.md`        |
| `packages/contracts`             | Shared backend/frontend contracts   | `packages/contracts/README.md`             |
| `packages/shared-infrastructure` | Shared infra utilities              | `packages/shared-infrastructure/README.md` |
| `packages/anytype-adapter`       | Anytype adapter support             | `packages/anytype-adapter/README.md`       |

## Documentation Map (By Reader)

Newcomers:

- `START_HERE.md`
- `docs/README.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/QUICK_START.md`

Maintainers / Agents:

- `AGENTS.md` (core bootstrap)
- `docs/reference/agents-ssot.md` (authoritative annex)

Backend/frontend integration work:

- `docs/backend-frontend/BATCH_SYSTEM.md`
- `docs/backend-frontend/backend-frontend-alignment.md`
- `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`

## Development Commands (Minimal)

```bash
pnpm check:fast
pnpm check
```

Core equivalents:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm smoke
```

Useful targeted runs:

```bash
pnpm --filter @esl-pipeline/orchestrator test
pnpm --filter @esl-pipeline/batch-frontend test
pnpm --filter @esl-pipeline/batch-backend test
pnpm dev:batch
```

## Troubleshooting

- ffmpeg not found:
  install ffmpeg and ensure it is on `PATH`, or set `FFMPEG_PATH`.
- Env/credentials issues:
  verify variables in `.env` and `docs/reference/env.md`.
- Node version mismatch:
  run Node `>=24.11.1`.
- Command works in docs but fails locally:
  run package-local build/test commands first, then retry root command.

## Contributing

Before opening a PR:

1. Run `pnpm check` (or `pnpm check:fast` during active iteration).
2. Update docs affected by behavior/status changes.
3. Keep `docs/reference/agents-ssot.md` consistent with code-level contracts.

## Historical Material

Historical design/planning docs live in `docs/archive/` and are non-authoritative.
Use active docs first.
