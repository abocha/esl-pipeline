# ESL Pipeline Monorepo

Automates the ESL homework flow end-to-end:

1. **Validate** Markdown exported from the lesson authoring prompt.
2. **Import** the assignment into Notion (with heading styling).
3. **Generate** study-text audio with ElevenLabs and upload to S3.
4. **Attach** the audio file back to the Notion page.

All functionality lives in pnpm workspaces under `packages/`.

---

## At a Glance

| Package                          | Responsibility                                                     | CLI                            |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| `@esl-pipeline/md-validator`     | Validates Markdown frontmatter, section order, study-text rules    | `md-validate`                  |
| `@esl-pipeline/md-extractor`     | Pulls structured data (study text, answer key, etc.) from Markdown | —                              |
| `@esl-pipeline/notion-importer`  | Creates/updates Notion pages from validated Markdown with full rich-text fidelity | `notion-importer`              |
| `@esl-pipeline/notion-colorizer` | Applies heading color presets in Notion                            | `notion-colorizer`             |
| `@esl-pipeline/tts-elevenlabs`   | Generates MP3 from study text via ElevenLabs                       | `tts-elevenlabs`, `tts-voices` |
| `@esl-pipeline/storage-uploader` | Uploads generated audio to S3                                      | `storage-uploader`             |
| `@esl-pipeline/notion-add-audio` | Places the study-text audio block above the toggle (add/replace)   | —                              |
| `@esl-pipeline/orchestrator`     | “One command” pipeline composition                                 | `esl-orchestrator`             |

---

## What's New in v1.0.0

- **Markdown → Notion fidelity.** Bold, italic, inline code (rendered in red), and strike-through now map directly to Notion annotations. Nested bullet hierarchies, indented paragraphs, and headings inside toggles survive the import, while YAML frontmatter is automatically stripped.
- **Smarter toggles.** Toggle bodies reuse the full Markdown parser, so inner `###` headings get colored by the Notion preset and inner lists stay nested. Toggle titles themselves are tinted without recoloring the content.
- **Audio placement.** ElevenLabs audio blocks are inserted as siblings immediately above the `study-text` toggle. Existing audio is replaced safely when `--redo-tts` / `--replace` is requested; otherwise it is left untouched.
- **Release discipline.** The repo ships with a canonical publishing checklist and changelog so future tags can be cut repeatably (`docs/publishing.md`, `CHANGELOG.md`).

These upgrades land together with the interactive `esl-orchestrator --interactive` wizard, manifest-driven reruns, and JSON logging added over the last development cycle.

---

## Requirements

- Node.js 22.x (use `nvm use` if available)
- pnpm 8+
- ffmpeg (available on `PATH`; used for MP3 concatenation)
- Access to:
  - Notion Integration token
  - ElevenLabs API key
  - AWS IAM credentials for the target S3 bucket

---

## Quick Start

```bash
pnpm install
cp .env.example .env
# populate .env with Notion, ElevenLabs, and AWS credentials

pnpm build           # type-check and compile all packages
pnpm test            # run all vitest suites
pnpm lint            # optional: verify style rules
```

To process an assignment end-to-end (dry-run):

```bash
pnpm esl-orchestrator --interactive
```

The wizard suggests markdown files, student profiles, presets, Notion database (defaulting to `NOTION_DB_ID`), ElevenLabs settings, and upload options. Accept the defaults or override fields inline, then re-run without `--dry-run` when you’re ready to publish. If you prefer a non-interactive run, pass the equivalent flags manually (see below).

---

## Environment Configuration

Copy `.env.example` to `.env` and fill the values:

```dotenv
NOTION_TOKEN=secret_xxx
NOTION_DB_ID=<default notion database id>
STUDENTS_DB_ID=<optional students data source id>

ELEVENLABS_API_KEY=<your api key>
ELEVENLABS_MODEL_ID=eleven_multilingual_v2   # override if desired
ELEVENLABS_OUTPUT_FORMAT=mp3_22050_32

AWS_REGION=ap-southeast-1
S3_BUCKET=esl-notion-tts
S3_PREFIX=audio/assignments
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

Environment variables are consumed through `dotenv` (`set -a && source .env` before running CLIs).

### Voice Catalog

Fetch the latest ElevenLabs voice metadata so friendly names (e.g., “Liam”) resolve automatically:

```bash
pnpm exec tsx --eval "import { syncVoices } from './packages/tts-elevenlabs/src/syncVoices.ts'; (async () => {
  await syncVoices('configs/elevenlabs.voices.json');
})();"
```

### Notion Targets

- Database/Data Source IDs live in the environment or in per-student config files under `configs/students/`.
- The importer resolves the data source automatically when passed `--db-id/--data-source` or `--data-source-id`.
- The `--interactive` wizard defaults to `NOTION_DB_ID` when no student profile is chosen, and you can override it inline.

---

## Important Commands

```bash
# Validate Markdown before doing anything else
pnpm md-validate ./out/anna-2025-10-21.md --strict

# Import into Notion (dry-run adds previews of properties/blocks)
pnpm notion-importer --md ./out/anna-2025-10-21.md --db-id <ID> --dry-run

# Generate study-text audio only
pnpm tts-elevenlabs --md ./out/anna-2025-10-21.md --voice-map configs/voices.yml --out ./out/audio

# Upload an MP3 to S3
pnpm storage-uploader --file ./out/audio/file.mp3 --prefix audio/assignments --public-read

# Inspect or rerun orchestrator steps
pnpm esl-orchestrator status --md ./fixtures/sample-assignment.md
pnpm esl-orchestrator rerun --md ./fixtures/sample-assignment.md --steps upload,add-audio --upload s3

# Guided run with interactive wizard & JSON logs
pnpm esl-orchestrator --interactive --with-tts --upload s3 --json
```

Use `--skip-import`, `--skip-tts`, `--skip-upload`, and `--redo-tts` to reuse assets from the existing manifest when iterating.

If your S3 bucket is private, the plain `https://bucket.s3.amazonaws.com/...` URL will 403. Either pass `--public-read` (and ensure the bucket allows ACLs / public access) or configure a CloudFront/static-hosting policy that grants read access to uploaded objects.

Check each package README for additional flags (e.g., Notion color presets).

### Release Checklist

Before publishing a new version, follow the steps in [`docs/publishing.md`](docs/publishing.md) to ensure lint/build/test pass, voice catalogs are in sync, and package metadata is bumped correctly.

---

## Development Workflow

| Task                   | Command             |
| ---------------------- | ------------------- |
| Type check & build     | `pnpm build`        |
| Unit/Integration tests | `pnpm test`         |
| Watch tests            | `pnpm test:watch`   |
| Lint                   | `pnpm lint`         |
| Prettier check         | `pnpm format`       |
| Auto-format            | `pnpm format:write` |

### Testing Philosophy

- Each package owns its own Vitest suite (`packages/<name>/tests`).
- Unit tests mock external APIs (Notion, S3, ElevenLabs).
- The orchestrator suite exercises the end-to-end composition via stubs.

---

## Project Structure

```
configs/                Shared presets (voices, color schemes, students)
packages/
  <pkg>/src/            TypeScript sources
  <pkg>/tests/          Vitest suites
  <pkg>/bin/            CLI entrypoints compiled to dist/bin
```

`tsconfig.base.json` defines the shared TypeScript settings. Each package references it via `extends`.

---

## Roadmap & UX

Current focus is on polishing the 1.0 workflow (Markdown fidelity, audio placement, manifest-powered reruns). Next up:

- Student profile presets (`configs/students/*`) and richer interactive previews.
- Release automation (version bump tooling, GitHub Release templates, npm packaging decisions).
- Broader smoke coverage that exercises mocked Notion/S3/ElevenLabs fixtures.
- Security documentation for IAM scopes, key rotation, and voice catalog refresh cadence.
- Per-package READMEs that enumerate CLI flags and examples.

Contributions and feedback are welcome—file an issue or PR with context and reproduction steps.
