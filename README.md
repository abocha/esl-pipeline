# ESL Pipeline · Orchestrator & Pipeline API

This repository powers the ESL homework pipeline end-to-end. It can be used either as:

1. A **CLI** (`esl`) that validates Markdown, imports pages into Notion, generates ElevenLabs audio, uploads to S3, and attaches the audio to the page.
2. A **programmatic pipeline** (`createPipeline`) you can embed in your own service or job runner.

> **Runtime requirements**
> - Node **24.10.0** or newer (enforced by `engines` and CI).
> - `pnpm` 8+ (use `corepack enable`).
> - ffmpeg available on PATH or supplied via `FFMPEG_PATH`.

---

## Quick Start (CLI)

Install dependencies and copy the env template:

```bash
pnpm install
cp .env.example .env
# fill in NOTION_TOKEN, ELEVENLABS_API_KEY, AWS_* credentials
```

Run the interactive workflow:

```bash
pnpm esl --interactive
```

Or run non-interactively:

```bash
pnpm esl --md ./lessons/mission.md \
  --preset b1-default \
  --with-tts \
  --upload s3
```

Other commands:

```bash
pnpm esl status --md ./lessons/mission.md
pnpm esl rerun --md ./lessons/mission.md --steps upload,add-audio --upload s3
pnpm esl select --file --ext .md
pnpm esl --version
```

Zero-install usage (downloads the package on demand):

```bash
npx @esl-pipeline/orchestrator esl --interactive
```

---

## Programmatic Usage

```ts
import { createPipeline, loadEnvFiles } from '@esl-pipeline/orchestrator';

loadEnvFiles(); // loads .env and merges into process.env

const pipeline = createPipeline({ cwd: process.cwd() });

const result = await pipeline.newAssignment({
  md: './lessons/mission.md',
  preset: 'b1-default',
  withTts: true,
  upload: 's3',
});

console.log(result.steps, result.manifestPath);
```

Useful exports:

- `createPipeline(options)` — builds a pipeline with configurable config/manifest providers.
- `resolveConfigPaths(options)` — returns the resolved presets/voices/students directories.
- `loadEnvFiles(options)` — convenience helper for loading `.env` files without mutating `process.env` (set `assignToProcess: false` to opt out).
- `resolveManifestPath(mdPath)` — deterministic manifest location for a given Markdown file.

Types such as `PipelineNewAssignmentOptions`, `PipelineRerunOptions`, and `AssignmentManifest` are exported for TypeScript consumers.

---

## Configuration & Secrets

| Setting              | Source / Default                        | Notes                                         |
|----------------------|------------------------------------------|----------------------------------------------|
| Notion token         | `NOTION_TOKEN` env variable              | Required                                      |
| Notion DB / data source | `NOTION_DB_ID`, overrides via CLI flags | Student profiles can pin defaults            |
| ElevenLabs API key   | `ELEVENLABS_API_KEY` env variable        | Required if `--with-tts`                     |
| AWS credentials      | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | Needed for `--upload s3`                     |
| Voices mapping       | `configs/voices.yml` (override with `--voices`) | `createPipeline` exposes resolved path       |
| Presets              | `configs/presets.json` (override with `--presets-path`) | Pipeline resolves absolute path              |
| Student profiles     | `configs/students/*.json`                | Optional per-student defaults                 |
| ffmpeg               | system install or `FFMPEG_PATH`         | We do not vendor binaries                     |

`loadEnvFiles()` mirrors the CLI’s behaviour: it checks `.env` in the working directory and the repo root. Pass `files: [...]` to load custom locations.

---

## Project Layout

```
packages/
  orchestrator/          # CLI + pipeline (publishable)
  md-validator/          # Markdown linting
  md-extractor/          # Study text extraction
  notion-importer/       # Notion page creation
  notion-colorizer/      # Heading presets
  tts-elevenlabs/        # ElevenLabs integration (system ffmpeg)
  storage-uploader/      # S3 uploads
  notion-add-audio/      # Attach audio blocks
configs/                 # Sample presets, voices, students
docs/groundwork-for-backend.md # Backend scaffolding roadmap
AGENTS.md                # Maintainer guide (v2)
```

All packages target ESM (`"type": "module"`), and CLI builds run through `tsup` + `tsc` for declarations.

---

## Development Workflow

```bash
# Type-check & build everything
pnpm build

# Lint (ESLint + Prettier checks)
pnpm lint

# Test all packages (Vitest)
pnpm test

# Orchestrator-only smoke tests
pnpm smoke

# Publish orchestrator (from packages/orchestrator)
npm publish --access public
```

CI (`.github/workflows/ci.yml`) runs on Node 24.10.0 and executes build, lint, tests, and the smoke suite.

---

## Backend Groundwork

The orchestrator is now consumable from other Node projects, but we’re actively adding scaffolding to make it backend-ready: pluggable storage adapters, observability hooks, Docker image, etc. See [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md) for the detailed plan and progress.

Key takeaways:
- `createPipeline` will become the primary integration point for API/queue services.
- Logger/metrics/tracing interfaces will keep business logic agnostic of the host environment.
- Manifest/config storage is being abstracted so you can swap JSON files for S3 or a database without touching the pipeline core.

---

## Troubleshooting

- **`ffmpeg` not found** — install via `brew install ffmpeg`, `sudo apt install ffmpeg`, or `choco install ffmpeg`, then ensure it’s on PATH or set `FFMPEG_PATH`.
- **Validation fails** — run `pnpm md-validate <file> --strict` to inspect exact Markdown errors. The validator enforces flush-left `:::study-text` blocks and the canonical ESL section order.
- **Environment missing** — CLI warns when tokens/keys are not set. Use `loadEnvFiles({ assignToProcess: false })` if you want to load env files without polluting `process.env`.
- **npx command fails** — make sure you invoke the `esl` binary: `npx @esl-pipeline/orchestrator esl --help`.
- **Node version mismatch** — ensure your environment is running Node ≥ 24.10.0 (`node --version`).

---

## Contributing / Release Checklist

1. Work against Node 24.10.0 (`nvm use 24.10.0` or `.tool-versions`).
2. Run `pnpm lint`, `pnpm test`, `pnpm --filter @esl-pipeline/orchestrator build`.
3. Update `AGENTS.md` and `docs/groundwork-for-backend.md` if behaviour changes.
4. Bump `packages/orchestrator/package.json` version, update `CHANGELOG.md`.
5. Publish: `npm publish --access public` (from `packages/orchestrator`).
6. Tag release: `git tag vX.Y.Z && git push origin vX.Y.Z`.

---

## Community & Support

At the moment this is a two-person project. Questions / ideas / issues:
- Open GitHub issues or pull requests.
- Keep discussions grounded in the Node 24 + ffmpeg + npm publish workflow described above.

Happy shipping! 🎧📝🎯
