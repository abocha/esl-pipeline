# Agent Handbook (v2)

This document is a concise, human-readable overview for maintainers and “agents” working in this repo.
For authoritative, machine-consumable guidance (contracts, invariants, and workflows), always defer to
[`docs/agents-ssot.md`](docs/agents-ssot.md). If anything here conflicts with that SSOT, the SSOT wins.

Everything below assumes **Node.js 24.10.0+**, pnpm, and system ffmpeg.

---

## 1. Architecture Snapshot (High-Level)

- **CLI (`packages/orchestrator`)**
  - Primary user-facing entry point (`esl` binary).
  - Commands include:
    - `esl --md <file>` — run the full pipeline.
    - `esl status`, `esl rerun`, `esl select`, `esl --version`.
  - Implemented in [`packages/orchestrator/bin/cli.ts`](packages/orchestrator/bin/cli.ts) as a thin adapter over orchestrator APIs.
- **Programmatic API**
  - Exposed from `@esl-pipeline/orchestrator`:
    - [`createPipeline.declaration()`](packages/orchestrator/src/pipeline.ts:129)
    - [`resolveConfigPaths.declaration()`](packages/orchestrator/src/pipeline.ts:34)
    - [`loadEnvFiles.declaration()`](packages/orchestrator/src/index.ts)
    - [`resolveManifestPath.declaration()`](packages/orchestrator/src/pipeline.ts)
  - CLI behavior MUST mirror these core APIs (see SSOT for exact contracts).
- **Core packages**
  - `@esl-pipeline/md-validator` — Markdown validation.
  - `@esl-pipeline/md-extractor` — study-text extraction.
  - `@esl-pipeline/notion-importer` — Notion creation and data source resolution.
  - `@esl-pipeline/notion-colorizer` — Notion heading presets.
  - `@esl-pipeline/tts-elevenlabs` — ElevenLabs integration (requires system `ffmpeg`).
  - `@esl-pipeline/storage-uploader` — S3 uploads.
  - `@esl-pipeline/notion-add-audio` — attach audio inside Notion.
- **Pipeline flow (summary)**
  1. Validate Markdown.
  2. Extract study text.
  3. Create/update Notion page.
  4. Apply heading presets.
  5. Generate TTS (optional, controlled via flags/config).
  6. Upload audio.
  7. Attach audio in Notion.
  8. Persist manifest for reruns.

---

## 2. Runtime & Dependencies (Summary)

- **Node**: 24.10.0 or newer (see repo `.nvmrc` / `package.json`).
- **pnpm**: 8+ (`corepack enable`).
- **ffmpeg**: must be present on PATH or provided via `FFMPEG_PATH`.
- **Env variables**:
  - CLI auto-loads `.env` from repo root + CWD.
  - Programmatic use should call [`loadEnvFiles.declaration()`](packages/orchestrator/src/index.ts) or inject env directly.
- For exhaustive requirements and env contracts, see [`docs/agents-ssot.md`](docs/agents-ssot.md) §§3 and 5.

---

## 3. Key Packages (Pointer Only)

Use this as a quick map; detailed contracts live in the SSOT.

| Package                          | Purpose (high level)                          |
| -------------------------------- | ----------------------------------------------|
| `@esl-pipeline/orchestrator`     | CLI and pipeline factory                      |
| `@esl-pipeline/md-validator`     | Markdown validation                           |
| `@esl-pipeline/md-extractor`     | Study text extraction                         |
| `@esl-pipeline/notion-importer`  | Notion page creation                          |
| `@esl-pipeline/notion-colorizer` | Notion heading presets                        |
| `@esl-pipeline/tts-elevenlabs`   | ElevenLabs integration                        |
| `@esl-pipeline/storage-uploader` | S3 uploads                                    |
| `@esl-pipeline/notion-add-audio` | Attach audio blocks in Notion                 |

For per-package responsibilities, extension points, and invariants:
see [`docs/agents-ssot.md`](docs/agents-ssot.md) §4.

The orchestrator package now exports type definitions (e.g. `PipelineNewAssignmentOptions`, `AssignmentManifest`) alongside the runtime API.

---

## 4. Pipeline API Basics (Quick Reference)

```ts
import { createPipeline, loadEnvFiles } from '@esl-pipeline/orchestrator';

loadEnvFiles(); // convenience helper; see SSOT for exact behavior

const pipeline = createPipeline({ cwd: process.cwd() });

const result = await pipeline.newAssignment({
  md: './lessons/mission.md',
  preset: 'b1-default',
  withTts: true,
  upload: 's3',
});
```

Key points:

- `createPipeline` builds the orchestrator pipeline; CLI uses the same core.
- `pipeline.defaults` / `pipeline.configPaths` expose resolved config locations.
- `pipeline.rerunAssignment` and `pipeline.getAssignmentStatus` mirror CLI subcommands.

For full type signatures, merging rules, and flag semantics (e.g., `withTts` precedence, `wizardDefaultsPath`):
see [`docs/agents-ssot.md`](docs/agents-ssot.md) §§4, 5, and 7.

---

## 5. Backend & Adapters (Pointer)

- Roadmap and backend scaffolding are documented in:
  - [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md)
  - [`docs/agents-ssot.md`](docs/agents-ssot.md) (adapters, manifest store, config provider rules)

Treat this section as directional only; the SSOT and code are the source of truth.

---

## 6. Working with the Repo (Essentials)

- Install: `pnpm install`
- Build: `pnpm -r build`
- Lint: `pnpm lint`
- Test: `pnpm test` or `pnpm --filter @esl-pipeline/orchestrator test`
- Smoke: `pnpm smoke` (orchestrator-focused)
- Zero-install: `npx @esl-pipeline/orchestrator esl --help`

For CI, release, and workflow invariants, follow [`docs/agents-ssot.md`](docs/agents-ssot.md) §§10–12.

---

## 7. Gotchas & Notes (Brief)

- Manifests: by default live next to the Markdown; adapters (e.g. S3) are configured via orchestrator (`createPipeline`) and env vars.
- External deps (Notion, ElevenLabs, AWS/S3) are real; tests use mocks.
- Markdown: validator enforces stricter rules (e.g. flush-left `:::study-text`).
- Binary: `esl` is the canonical CLI; legacy aliases are removed.
- We do not bundle ffmpeg; users must install it.

For exact rules (manifest schema, adapter selection, validation invariants), see [`docs/agents-ssot.md`](docs/agents-ssot.md).

---

## 8. FAQ (Forward-Looking, Defer to SSOT)

- Programmatic usage? See `createPipeline` example above, and details in [`docs/agents-ssot.md`](docs/agents-ssot.md) §7.2.
- Custom configs/adapters? Follow extension rules in [`docs/agents-ssot.md`](docs/agents-ssot.md) §§4–5.
- New CLI flags? Add behavior in orchestrator first, then wire CLI; see [`docs/agents-ssot.md`](docs/agents-ssot.md) §9.6.
- Node version? Node **24.10.0+** (enforced).
- Remote manifests/config? Use documented adapters/env vars; SSOT + `docs/groundwork-for-backend.md` describe the contract.

---

This handbook is intentionally high-level. For any non-trivial change or automation:

- Start here for orientation.
- Then consult [`docs/agents-ssot.md`](docs/agents-ssot.md) as the single source of truth for:
  - Contracts and invariants.
  - Allowed operations and extension points.
  - Cross-file consistency requirements.

Treat deviations from the SSOT as bugs to be fixed. Happy shipping! 🎯
