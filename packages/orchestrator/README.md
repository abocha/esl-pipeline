# @esl-pipeline/orchestrator

One-command CLI that validates lesson markdown, imports it into Notion, applies color presets, generates ElevenLabs audio, uploads to S3, and attaches the audio block back to the page—while recording a manifest for incremental reruns.

## Prerequisites

- **Node.js 24.10.0+** (the runtime we target and test against)
- **ffmpeg** available on `PATH` (or set `FFMPEG_PATH`). We no longer ship bundled binaries; install via `brew install ffmpeg`, `sudo apt-get install ffmpeg`, or `choco install ffmpeg` as needed.
- **Environment credentials** for Notion, ElevenLabs, and AWS. Copy `.env.example` to `.env` (or export the same variables) before running:
  - `NOTION_TOKEN`, `NOTION_DB_ID`, optional `DATA_SOURCE_ID`
  - `ELEVENLABS_API_KEY` (plus optional model/output overrides)
  - `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

During packaging the CLI ships with default presets, voices, and student templates under `dist/configs/` so a fresh install has sane defaults. You can override them by placing your own `configs/` directory in the working folder.

## Quickstart (published package)

```bash
npx @esl-pipeline/orchestrator new-assignment \
  --md ./lessons/unit1.md \
  --preset b1-default \
  --with-tts \
  --upload s3
```

The `new-assignment` subcommand is optional; running `npx @esl-pipeline/orchestrator --md ...` works as well. Subsequent commands are available under the `esl` binary that the package exposes:

```
esl status --md ./lessons/unit1.md [--json]
esl rerun --md ./lessons/unit1.md --steps tts,upload --upload s3
esl select --file --ext .md
```

## Local workspace (pnpm)

```bash
pnpm install
pnpm build
pnpm esl --interactive --with-tts --upload s3
```

The pnpm script `esl` points to the same compiled CLI (`packages/orchestrator/dist/cli.js`). Use `pnpm esl --help` to view the full option list.

## Path picker (`esl select`)

```
esl select [path] [options]
```

Launch an Enquirer-powered AutoComplete prompt (backed by `globby` and `find-up`) with fuzzy filtering:

- Require directories to end with `.d`: `esl select --dir --suffix .d`
- Require marker files: `esl select --dir --contains input.d`
- Restrict to Markdown: `esl select --file --ext .md`
- Use glob patterns: `esl select --file --glob '**/*.mp3'`
- Choose root discovery: `--root git|pkg|cwd`
- Show absolute paths in prompts/output: `--absolute`
- Include dot-prefixed entries: `--include-dot`
- Limit visible suggestions: `--limit <n>`

Ignore patterns baked into the picker:

```
**/node_modules/**
**/.git/**
**/.next/**
**/.turbo/**
**/dist/**
**/build/**
**/coverage/**
**/.pnpm/**
```

## Manifests

The orchestrator re-exports `manifestPathFor`, `readManifest`, `writeManifest`, and `AssignmentManifest` from `./manifest.js`. Use them to inspect or manage cached pipeline runs from scripts and tests.
