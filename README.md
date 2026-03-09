# ESL Pipeline

ESL Pipeline automates the flow from lesson input to published ESL homework.
The operational path is backend-first (`batch-backend` + `batch-frontend`) with orchestrator as the canonical pipeline library engine.

## Fast Re-Entry

- If you are resuming after context overload, start at [`START_HERE.md`](START_HERE.md).

## What This Repo Is (Current State)

This monorepo currently provides:

- A pipeline orchestrator (`@esl-pipeline/orchestrator`) for validation, publishing, optional TTS, upload, and manifest tracking.
- A batch backend/frontend system for upload -> transcript -> prompt -> draft -> publish workflows.
- Shared packages for markdown validation, parsing, rendering, provider runtime, adapters, contracts, and infrastructure.

Primary integrations:

- Notion (publishing)
- ElevenLabs (TTS)
- AWS/S3 (upload/storage)
- Google GenAI and OpenRouter (generation providers in batch flow)

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
cp .env.batch-backend.example .env.batch-backend
```

Fill required credentials as needed. See [`docs/reference/env.md`](docs/reference/env.md).

### 2) Start Operational Batch Stack (Primary)

```bash
pnpm dev:batch
```

### 3) Validate Core Lanes

```bash
pnpm check:fast
pnpm docs:check
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

## Repository Map

| Package                          | Purpose                             | Read Next                                  |
| -------------------------------- | ----------------------------------- | ------------------------------------------ |
| `packages/orchestrator`          | Pipeline library API                | `packages/orchestrator/README.md`          |
| `packages/md-validator`          | Markdown validation                 | `packages/md-validator/README.md`          |
| `packages/pmd`                   | PMD parsing + study-text extraction | `packages/pmd/README.md`                   |
| `packages/notion-adapter`        | Notion publishing adapter           | `packages/notion-adapter/README.md`        |
| `packages/tts-core`              | TTS core contracts/registry         | `packages/tts-core/README.md`              |
| `packages/tts-provider-elevenlabs` | ElevenLabs TTS provider adapter  | `packages/tts-provider-elevenlabs/README.md` |
| `packages/tts-provider-google`   | Google Cloud TTS provider adapter   | `packages/tts-provider-google/README.md`   |
| `packages/storage-uploader`      | Upload/storage adapter              | `packages/storage-uploader/README.md`      |
| `packages/html-publisher`        | Markdown/HTML rendering and publish | `packages/html-publisher/README.md`        |
| `packages/provider-runtime`      | Provider runtime policy utilities   | `packages/provider-runtime/README.md`      |
| `packages/batch-backend`         | Batch API + workers                 | `packages/batch-backend/README.md`         |
| `packages/batch-frontend`        | Batch web UI                        | `packages/batch-frontend/README.md`        |
| `packages/contracts`             | Shared backend/frontend contracts   | `packages/contracts/README.md`             |
| `packages/shared-infrastructure` | Shared infra utilities              | `packages/shared-infrastructure/README.md` |
| `packages/anytype-adapter`       | Anytype adapter support             | `packages/anytype-adapter/README.md`       |

## Documentation Path (Agents + Maintainers)

Start here for docs routing:

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/README.md`](docs/README.md)
3. [`docs/reference/DOCS_IA_MAP.md`](docs/reference/DOCS_IA_MAP.md)
4. [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md)

Operational runbooks:

- [`docs/operations/docker-host-paths.md`](docs/operations/docker-host-paths.md)
- [`docs/operations/postgres-backup-restore.md`](docs/operations/postgres-backup-restore.md)
- [`docs/operations/postgres-backup-s3.md`](docs/operations/postgres-backup-s3.md)
- [`docs/operations/postgres-ops-health.md`](docs/operations/postgres-ops-health.md)
- [`docs/operations/prompt-gallery-bootstrap.md`](docs/operations/prompt-gallery-bootstrap.md)

## Development Commands (Minimal)

```bash
pnpm check:fast
pnpm check
pnpm docs:check
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

## Historical Material

Historical design/planning docs live in `docs/archive/` and are non-authoritative.
Use active docs first.
