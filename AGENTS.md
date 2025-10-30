# Agent Handbook

This repo houses the ESL homework pipeline. Below is everything the next agent should know before continuing work.

## 1. Architecture Snapshot

- **Core Flow**: Markdown (`md-validator` → `md-extractor`) → Notion import (`notion-importer` + `notion-colorizer`) → TTS (`tts-elevenlabs`) → S3 upload (`storage-uploader`) → attach audio (`notion-add-audio`).
- **Orchestrator** (`packages/orchestrator`) glues the above into one command. It now exposes:
  - `esl-orchestrator --md <file>`: full run.
    - Add `--interactive` to launch a guided wizard that suggests markdown files, student profiles, presets, TTS/upload settings, and S3 defaults.
    - Incremental flags: `--skip-import`, `--skip-tts`, `--skip-upload`, and `--redo-tts` reuse manifest assets safely.
    - Pass `--json` for structured event logs (pairs nicely with scripting).
  - `esl-orchestrator status --md <file>`: read manifest + hash/audio health.
  - `esl-orchestrator rerun --md <file> --steps tts,upload`: rerun subset using cached manifest.
- **Configs** live in `configs/` (notably `voices.yml`, `elevenlabs.voices.json`, `presets.json`). Student-specific overrides can reside in `configs/students/` (stubbed for now).

## 2. Environment & Secrets

- Copy `.env.example` to `.env` and fill: `NOTION_TOKEN`, `ELEVENLABS_API_KEY`, `AWS_*`.
- Keep ffmpeg installed (`ffmpeg` must be on PATH).
- **Voice Catalog**: refresh with `pnpm exec tsx --eval "import { syncVoices } from './packages/tts-elevenlabs/src/syncVoices.ts'; (async () => { await syncVoices('configs/elevenlabs.voices.json'); })();"` before generating real audio.
- Never commit `.env` or generated media. `.gitignore` already excludes `*.tsbuildinfo` and `configs/voices.json`.

## 3. Tooling Commands

- `pnpm install` (workspace install)
- `pnpm lint` (ESLint v9 flat config + Prettier checks)
- `pnpm build` (tsc on all packages)
- `pnpm test` (Vitest suites, including orchestrator smoke)
- `pnpm smoke` (alias for orchestrator tests)
- Package-specific scripts: `pnpm --filter <pkg> test`, `pnpm --filter <pkg> dev`, etc.

## 4. Testing Expectations

- Unit tests reside in `packages/<pkg>/tests`.
- Orchestrator smoke test mocks Notion/S3/ElevenLabs and verifies manifest + rerun flows.
- Before merging, run lint/build/test locally; CI (see `.github/workflows/ci.yml`) enforces the same.

## 5. Recent Changes (context for follow-up)

- Interactive CLI wizard shipped (`--interactive`) with reusable manifest defaults and guardrails around skip flags.
- Structured logging/summary output landed; `--json` emits machine-friendly transcripts.
- Added status/rerun APIs and CLI commands in orchestrator; manifests now power incremental runs.
- TTS sanitizes Markdown emphasis before hitting ElevenLabs (no more pauses on `**bold**`).
- ElevenLabs integration now resolves friendly voice names using `configs/elevenlabs.voices.json`.
- Markdown validator accepts topic arrays and enforces `--strict` warnings-as-errors.
- Storage uploader keys are path-safe and tests match the options-object API.
- Student profiles now include a built-in `Default` entry for shared presets (accent hint optional) so orchestrator stays consistent even when you skip selecting a learner.
- Docs overhauled (`README.md`, `docs/publishing.md`, `docs/orchestrator-ux.md`); Prettier/ESLint added.

## 6. Pending / Next Work

1. **Orchestrator UX roadmap** (`docs/orchestrator-ux.md`): next tranche is config profiles (`configs/students/*`), richer wizard preview/editing, and log timing metrics.
2. **Release automation**: add CHANGELOG, choose versioning, decide which packages should be public (currently `private: true`).
3. **Smoke coverage**: consider richer integration tests that mock Notion/S3/ElevenLabs with fixtures.
4. **Security**: document IAM scopes, key rotation, and voice catalog update cadence in `docs/publishing.md` or new security doc.
5. **Package docs**: per-package READMEs summarising CLI flags still missing (only root README updated).

## 7. Conventions & Tips

- TypeScript 5.9+, ES modules, 2-space indentation, trailing commas. Types in PascalCase.
- Co-locate helper types in `types.ts` or adjacent modules.
- Use `promises` API (`node:fs/promises`), avoid callback-style.
- For mocks, prefer `vi.importActual` to partially mock modules (see orchestrator smoke test).
- Keep manifest schema backwards compatible; orchestrator relies on `mdHash`, `audio`, `timestamp`, etc.

## 8. Troubleshooting Checklist

- **Validation fails**: run `pnpm md-validate <file> --strict` to inspect exact errors.
- **Notion import**: ensure `NOTION_TOKEN` integration has access to target data sources; `resolveDataSourceId` now lists available names on failure.
- **TTS missing voices**: refresh `configs/elevenlabs.voices.json`; check `voices.yml` for friendly -> voice ID mapping.
- **S3 upload issues**: confirm `AWS_REGION/S3_BUCKET/S3_PREFIX` in `.env`; ACL fallback logs a warning when bucket blocks ACLs.
- **ffmpeg errors**: ensure ffmpeg binary is installed or set `FFMPEG_PATH` env var.

## 9. File Guide

- `configs/elevenlabs.voices.json` – generated voice catalog (committed now for reference).
- `docs/publishing.md` – deployment checklist.
- `docs/orchestrator-ux.md` – UX design for future work.
- `packages/orchestrator/src/index.ts` – now exports `newAssignment`, `getAssignmentStatus`, `rerunAssignment`.

Stay consistent with lint rules (`pnpm lint`). When touching the orchestrator, update smoke test as needed. Good luck!
