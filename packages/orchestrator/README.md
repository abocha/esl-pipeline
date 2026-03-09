# @esl-pipeline/orchestrator

Library-first pipeline engine for ESL assignment workflows: validates markdown lessons, imports/publishes content, generates optional TTS, uploads artifacts, and tracks manifest-based reruns.

The CLI/wizard/path-picker surface in this package is deprecated and on a staged removal path. Use `@esl-pipeline/batch-backend` as the operational runtime entrypoint.

## Quick Start

Operational (recommended):

```bash
pnpm dev:batch
```

Legacy CLI compatibility (deprecated):

```bash
pnpm esl --interactive
```

## Prerequisites

### Runtime & Tools

- **Node.js 24.11.1+** (LTS release)
- **pnpm** (use `corepack enable` if not installed)
- **ffmpeg** on `PATH` (or set `FFMPEG_PATH`)
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - Windows: `choco install ffmpeg`

### Environment Credentials

Create a `.env` file in the workspace root or export these variables:

```bash
# Notion
NOTION_TOKEN=secret_...
NOTION_DB_ID=...
# Optional: DATA_SOURCE_ID for Notion search integration

# TTS providers
ESL_TTS_DEFAULT_PROVIDER=elevenlabs
ESL_TTS_PROVIDER_ELEVENLABS_API_KEY=...

# AWS S3
AWS_REGION=us-east-1
S3_BUCKET=your-bucket-name
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

The orchestrator will load `.env` from the workspace root and the current directory automatically via the shared CLI env loader.

## Interactive Workflow

### Running the Wizard

```bash
# Start the interactive wizard
pnpm esl --interactive
```

**What happens:**

1. You select a markdown file (or provide `--md` to skip this step)
2. The wizard loads student profiles from `packages/orchestrator/configs/students/`
3. Saved defaults from `packages/orchestrator/configs/wizard.defaults.json` are applied
4. You're prompted for missing settings (preset, TTS mode, upload options, etc.)
5. The pipeline executes with real-time progress feedback
6. Your selections are saved for next time

### Managing Saved Defaults

The wizard automatically persists your choices to `packages/orchestrator/configs/wizard.defaults.json`. You can:

- **Review saved settings** at the start of each wizard run
- **Update defaults** by choosing "Update and continue"
- **Clear defaults** by choosing "Clear saved defaults"
- **Keep defaults** by choosing "Keep saved defaults"

### Student Profiles

Place student-specific configurations in `packages/orchestrator/configs/students/*.json`:

```json
{
  "student": "alex",
  "dbId": "abc123...",
  "colorPreset": "b1-default",
  "accentPreference": "american"
}
```

When you select a student in the wizard, their settings are automatically applied.
If no student is selected, the orchestrator falls back to the `Default` profile when present.

### TTS Configuration

The wizard guides you through TTS options:

- **Strategy**: `auto` (best-effort), `dialogue` (Text-to-Dialogue), `tts` (Text-to-Speech)
- **Language**: ISO 639-1 code (e.g., `en`, `es`, `fr`)
- **Voices**: Path to voices configuration file
- **Stability, Seed**: Advanced dialogue generation options

You can also set environment variables to skip TTS prompts:

```bash
ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY=dialogue
ESL_TTS_PROVIDER_ELEVENLABS_DIALOGUE_LANGUAGE=en
ESL_TTS_PROVIDER_ELEVENLABS_DIALOGUE_STABILITY=0.75
ESL_TTS_PROVIDER_ELEVENLABS_DIALOGUE_SEED=42
```

## Command-Line Usage

For automation or CI/CD, use non-interactive mode:

```bash
# Process a specific file with all options
pnpm esl \
  --md ./lessons/unit1.md \
  --student alex \
  --preset b1-default \
  --accent american \
  --with-tts \
  --upload s3 \
  --prefix lessons/2025/

# Check assignment status
pnpm esl status --md ./lessons/unit1.md

# Rerun full audio pipeline (regenerate, upload, reattach)
pnpm esl rerun \
  --md ./lessons/unit1.md \
  --audio \
  --upload s3 \
  --voice-id JBFqnCBsd6RMkjVDRZzb
```

### Available Commands

| Command                                 | Description                                    |
| --------------------------------------- | ---------------------------------------------- |
| `esl [options]`                         | Run the pipeline (default: interactive wizard) |
| `esl status --md <file>`                | Show manifest status for an assignment         |
| `esl rerun --md <file> [options]`       | Plan and rerun specific pipeline steps         |
| `esl select [path] [options]`           | Interactive file/directory picker              |

Rerun defaults:

- `esl rerun --md <file>` defaults to `upload,add-audio` and auto-applies `--upload s3`.
- Use `--audio` to run `tts,upload,add-audio` in one command.
- Use `--from <stage> --to <stage>` to run a contiguous range (for example: `--from upload --to add-audio`).
- Use `--plan` to preview the computed rerun plan and validation requirements without executing stages.
- Planner precedence: `--steps` > `--audio` > `--from/--to` > default.

### Common Options

| Option             | Description                                       |
| ------------------ | ------------------------------------------------- |
| `--interactive`    | Launch the interactive wizard                     |
| `--md <file>`      | Path to markdown file                             |
| `--student <name>` | Student profile name                              |
| `--preset <name>`  | Notion color preset                               |
| `--accent <name>`  | Voice accent preference (american, british, etc.) |
| `--with-tts`       | Generate ElevenLabs audio                         |
| `--audio`          | Rerun full audio steps (`tts,upload,add-audio`)  |
| `--from <stage>`   | Rerun range start (`tts`, `upload`, `add-audio`) |
| `--to <stage>`     | Rerun range end (`tts`, `upload`, `add-audio`)   |
| `--plan`           | Print rerun plan without executing                |
| `--upload s3`      | Upload audio to S3                                |
| `--dry-run`        | Preview actions without executing                 |
| `--force`          | Force regeneration even if cached                 |
| `--json`           | Output structured JSON logs                       |

## Path Picker

The `esl select` command provides an interactive file/directory picker with fuzzy search:

```bash
# Select a markdown file
pnpm esl select --file --ext .md

# Select a directory containing a specific file
pnpm esl select --dir --contains package.json

# Use glob patterns
pnpm esl select --file --glob '**/*.mp3'

# Choose root strategy (git, pkg, or cwd)
pnpm esl select --file --ext .md --root git

# Validate an existing path
pnpm esl select ./lessons/unit1.md --file --ext .md
```

**Picker Options:**

- `--file` / `--dir`: Restrict to files or directories
- `--ext <extensions>`: Filter by file extensions
- `--glob <patterns>`: Match glob patterns
- `--suffix <suffix>`: Require directory name suffix
- `--contains <files>`: Require files inside directories
- `--root <strategy>`: Root detection (git, pkg, or cwd)
- `--absolute`: Show absolute paths
- `--include-dot`: Include dot-prefixed entries
- `--limit <n>`: Limit visible suggestions
- `--verbose`: Print metadata with the result

The picker automatically ignores common directories:
`node_modules`, `.git`, `.next`, `.turbo`, `dist`, `build`, `coverage`, `.pnpm`

## Advanced Usage

### Programmatic API

Import `createPipeline` to integrate the orchestrator into your own applications:

```typescript
import { createPipeline } from '@esl-pipeline/orchestrator';

const pipeline = createPipeline({
  logger: myCustomLogger,
  metrics: myMetricsCollector,
});

const result = await pipeline.newAssignment({
  md: './lessons/unit1.md',
  preset: 'b1-default',
  withTts: true,
  upload: 's3',
});

console.log('Page URL:', result.pageUrl);
console.log('Audio URL:', result.audio?.url);
```

See `examples/service/` for a complete Fastify-based HTTP worker example.

### Configuration Paths

The orchestrator looks for configuration in these locations:

```
packages/orchestrator/configs/  # Package-scoped defaults in this repo
<dist>/configs/         # Bundled defaults for published package
```

**Configuration files:**

- `presets.json`: Notion color presets
- `voices.yml`: ElevenLabs voice configurations
- `students/*.json`: Student profiles
- `wizard.defaults.json`: Saved wizard preferences

### Manifest System

The orchestrator uses manifests to track pipeline state and enable incremental reruns:

```typescript
import { manifestPathFor, readManifest } from '@esl-pipeline/orchestrator';

const manifestPath = manifestPathFor('./lessons/unit1.md');
const manifest = await readManifest(manifestPath);

console.log('Notion Page:', manifest.pageUrl);
console.log('Audio URL:', manifest.audio?.url);
console.log('MD Hash:', manifest.mdHash);
```

**Manifest location:** The manifest is stored alongside the markdown file at `<file>.manifest.json`.

**Rerun logic:** The orchestrator compares the current markdown hash with the manifest to detect changes and intelligently skip or re-execute steps.

## Environment Variables Reference

### Core Credentials

| Variable                | Required           | Description              |
| ----------------------- | ------------------ | ------------------------ |
| `NOTION_TOKEN`          | Yes                | Notion integration token |
| `ESL_TTS_DEFAULT_PROVIDER` | No             | Default TTS provider (`elevenlabs`/`google`) |
| `ESL_TTS_PROVIDER_ELEVENLABS_API_KEY` | Yes (if provider=`elevenlabs`) | ElevenLabs API key |
| `AWS_ACCESS_KEY_ID`     | Yes (if using S3)  | AWS access key           |
| `AWS_SECRET_ACCESS_KEY` | Yes (if using S3)  | AWS secret key           |
| `AWS_REGION`            | Yes (if using S3)  | AWS region               |
| `S3_BUCKET`             | Yes (if using S3)  | S3 bucket name           |

### Database Configuration

| Variable         | Description                  |
| ---------------- | ---------------------------- |
| `NOTION_DB_ID`   | Default Notion database ID   |
| `DATA_SOURCE_ID` | Notion search data source ID |

### TTS Configuration

| Variable                        | Default | Description                        |
| ------------------------------- | ------- | ---------------------------------- |
| `ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY`       | `auto`  | TTS strategy (auto, dialogue, tts) |
| `ESL_TTS_PROVIDER_ELEVENLABS_DIALOGUE_LANGUAGE`  | -       | ISO 639-1 language code            |
| `ESL_TTS_PROVIDER_ELEVENLABS_DIALOGUE_STABILITY` | -       | Voice stability (0.0-1.0)          |
| `ESL_TTS_PROVIDER_ELEVENLABS_DIALOGUE_SEED`      | -       | Seed for reproducible generation   |

### Upload Configuration

| Variable    | Description               |
| ----------- | ------------------------- |
| `S3_PREFIX` | S3 key prefix for uploads |

### Development

| Variable                     | Description                          |
| ---------------------------- | ------------------------------------ |
| `ORCHESTRATOR_DEBUG_SECRETS` | Set to `true` to log unmasked tokens |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the CLI in development mode
pnpm dev:orchestrator

# Run tests
pnpm --filter @esl-pipeline/orchestrator test

# Type check
pnpm --filter @esl-pipeline/orchestrator typecheck

# Build Docker image
pnpm --filter @esl-pipeline/orchestrator docker:build

# Run Docker container
pnpm --filter @esl-pipeline/orchestrator docker:run
```

## Publishing

This package is published to npm as `@esl-pipeline/orchestrator`:

```bash
# Published package usage
npx @esl-pipeline/orchestrator --interactive

# Or install globally
npm install -g @esl-pipeline/orchestrator
esl --interactive
```

## License

UNLICENSED
