# Agent Handbook (v2)

Welcome! This repo now ships a publishable CLI _and_ a reusable pipeline module, so we work as much in npm/package-land as in CLI land. Everything below assumes **Node.js 24.10.0+**, pnpm, and system ffmpeg.

---

## 1. Architecture Snapshot

- **CLI (`packages/orchestrator`)** — the user-facing tool. Entry point commands:
  - `esl --md <file>` (full run, same flags as before).
  - `esl status …`, `esl rerun …`, `esl select …`.
  - `esl --version` now prints the package version.
- **Programmatic API** — `createPipeline`, `resolveConfigPaths`, `loadEnvFiles`, `resolveManifestPath` exported from `@esl-pipeline/orchestrator`. The CLI is a thin adapter around these functions.
- **Adapters (WIP)** — pipeline consumers can supply their own `ConfigProvider`, `ManifestStore`, and `SecretProvider`. Default implementations still use filesystem configs/manifests and `process.env`.
- **Pipeline flow** (unchanged logic):
  1. Validate Markdown (`md-validator`, `md-extractor`)
  2. Import into Notion (`notion-importer`, `notion-colorizer`)
  3. Generate TTS (`tts-elevenlabs`)
  4. Upload to S3 (`storage-uploader`)
  5. Attach audio (`notion-add-audio`)
  6. Persist manifest

---

## 2. Runtime & Dependencies

- **Node**: 24.10.0 or newer. CI targets Node 24 explicitly.
- **pnpm**: 8+ (`corepack enable`).
- **ffmpeg**: must be present on PATH or provided via `FFMPEG_PATH`. We no longer vendor binaries.
- **Env variables**: CLI auto-loads `.env` from CWD + repo root. Programmatic use should call `loadEnvFiles` and/or supply secrets directly.

---

## 3. Key Packages

| Package                          | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `@esl-pipeline/orchestrator`     | CLI & pipeline factory (publishable)          |
| `@esl-pipeline/md-validator`     | Markdown validation                           |
| `@esl-pipeline/md-extractor`     | Study text extraction                         |
| `@esl-pipeline/notion-importer`  | Notion page creation + data source resolution |
| `@esl-pipeline/notion-colorizer` | Heading presets in Notion                     |
| `@esl-pipeline/tts-elevenlabs`   | ElevenLabs integration (system ffmpeg)        |
| `@esl-pipeline/storage-uploader` | S3 uploads                                    |
| `@esl-pipeline/notion-add-audio` | Audio attachment inside Notion                |

The orchestrator package now exports type definitions (e.g. `PipelineNewAssignmentOptions`, `AssignmentManifest`) alongside the runtime API.

---

## 4. Pipeline API Basics

```ts
import { createPipeline, loadEnvFiles } from '@esl-pipeline/orchestrator';

loadEnvFiles(); // optional convenience helper

const pipeline = createPipeline({ cwd: process.cwd() });

const result = await pipeline.newAssignment({
  md: './lessons/mission.md',
  preset: 'b1-default',
  withTts: true,
  upload: 's3',
});
```

- `pipeline.defaults` exposes the resolved presets/voices/outDir paths.
- `pipeline.configPaths` gives you the underlying directories for configs and wizard defaults.
- `pipeline.rerunAssignment` and `pipeline.getAssignmentStatus` mirror the CLI commands.
- The CLI uses the same pipeline under the hood; all new features should land in the pipeline and then be surfaced via CLI flags.

---

## 5. Soon-to-Land Scaffolding (Backend Prep)

A standalone doc `docs/groundwork-for-backend.md` tracks the roadmap. Highlights:

1. **Adapters & abstractions** — pluggable config/manifest/secret providers with filesystem defaults.
2. **Observability** — logger/metric/tracing interfaces so logs can stream to DataDog, etc., without touching business logic.
3. **State storage options** — S3/database manifest stores, configurable via `createPipeline`.
4. **Service skeleton** — Dockerfile, sample HTTP worker, queue hooks.
5. **CI upgrades** — container builds, integration tests with adapters on mock services.

We’ll implement these in phases to avoid rewriting later when the orchestrator becomes part of a bigger ESL platform.

---

## 6. Working with the Repo

- **Install**: `pnpm install`
- **Build**: `pnpm -r build`
- **Lint**: `pnpm lint`
- **Tests**: `pnpm test` or per package (`pnpm --filter @esl-pipeline/orchestrator test`)
- **Smoke**: `pnpm smoke` (orchestrator suite)
- **Publish**: from `packages/orchestrator`, run `npm publish --access public`
- **Zero-install usage**: `npx @esl-pipeline/orchestrator esl --help`

---

## 7. Gotchas & Notes

- Manifests are written alongside the Markdown by default. Using non-filesystem stores will be handled via adapters (see roadmap).
- ElevenLabs, Notion, and S3 dependencies are real—tests use mocks. Provide valid credentials for end-to-end runs.
- The pipeline sets stricter markdown validation (flush-left `:::study-text`). Fixtures and upstream content must comply.
- Only the `esl` binary is exported; the legacy `esl-orchestrator` alias is gone.
- CLI/README instructs users to install ffmpeg themselves; we do not bundle or automatically download it.

---

## 8. FAQ

- **How do I use creation programmatically?** Use `createPipeline` as shown, supply env and config overrides, run `newAssignment`.
- **How do I customize configs?** Override `presetsPath`, `voicesPath`, or `studentsDir` in `createPipeline({ ... })`. More advanced adapters will land soon.
- **How do I add a new CLI flag?** Extend the pipeline API first, then plumb the flag through `bin/cli.ts`.
- **Which Node version is required?** Node **24.10.0** minimum. CI and engines enforce this.
- **How do I handle manifests remotely?** Implement `ManifestStore` per the roadmap (S3/DB). Until then, copy manifests off disk or sync them externally.

---

This handbook should keep future “agents” aligned with the current architecture and the path toward a backend-friendly orchestrator. Keep `docs/groundwork-for-backend.md` in sync as the scaffolding lands. Happy shipping! 🎯
