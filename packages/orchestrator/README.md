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

## Environment Variables

### TTS Configuration

Set these environment variables to configure TTS behavior without wizard prompts:

- `ELEVENLABS_TTS_MODE`: TTS mode selection
  - `auto`: Auto-detect dialogue vs monologue (default)
  - `dialogue`: Force Text-to-Dialogue API
  - `monologue`: Force Text-to-Speech API

- `ELEVENLABS_DIALOGUE_LANGUAGE`: ISO 639-1 language code for dialogue mode
  - Examples: `en`, `es`, `fr`, `de`

- `ELEVENLABS_DIALOGUE_STABILITY`: Voice stability for dialogue mode (0.0-1.0)
  - Example: `0.75`

- `ELEVENLABS_DIALOGUE_SEED`: Integer seed for reproducible dialogue generation
  - Example: `42`

### Database

- `NOTION_DB_ID`: Notion database ID
- `STUDENTS_DB_ID`: Alternative Notion database ID

### Upload

- `S3_PREFIX`: S3 key prefix for audio uploads

### Core Credentials

- `NOTION_TOKEN`: Notion API token
- `ELEVENLABS_API_KEY`: ElevenLabs API key
- `AWS_REGION`: AWS region
- `S3_BUCKET`: S3 bucket name
- `AWS_ACCESS_KEY_ID`: AWS access key
- `AWS_SECRET_ACCESS_KEY`: AWS secret key

## Migration from v1.x to v2.x

The v2.0 update adds TTS mode selection while maintaining full backward compatibility.

### What Changed

- Added new TTS mode options: `auto`, `dialogue`, `monologue`
- New environment variables: `ELEVENLABS_TTS_MODE`, `ELEVENLABS_DIALOGUE_LANGUAGE`, `ELEVENLABS_DIALOGUE_STABILITY`, `ELEVENLABS_DIALOGUE_SEED`
- Enhanced wizard TTS configuration

### What's Unchanged

- Existing CLI usage continues to work
- Existing configurations are automatically migrated
- Default behavior is 'auto' mode (best for most users)

### For Existing Users

1. **CLI Scripts**: No changes needed. Scripts work as before.
2. **Wizard Defaults**: Automatically migrated to include `ttsMode: 'auto'`
3. **Environment Variables**: Optional - can be set for fine-grained control
4. **Voice Mappings**: No changes needed

### Migration Recommendations

To take advantage of the new features:
- Use the interactive wizard to configure TTS modes
- Set `ELEVENLABS_TTS_MODE=auto` in your environment for consistent behavior
- Use dialogue mode for conversation lessons with multiple speakers


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
pnpm --filter @esl-pipeline/orchestrator docker:build
pnpm --filter @esl-pipeline/orchestrator docker:run
# Manual invocation for quick checks:
docker run --rm esl-pipeline/orchestrator:local --version
```

## Service skeleton

See `examples/service/` for a Fastify-based HTTP worker that wraps `createPipeline`. It demonstrates:

- Injecting custom `ConfigProvider`/`ManifestStore` via environment
- Forwarding jobs with queue-provided IDs
- Streaming pipeline telemetry into your logger/metrics sinks
- Running the pipeline in dry-run mode for smoke tests

Run `pnpm --filter @esl-pipeline/orchestrator examples/service vitest run` to execute the example
smoke test.

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
