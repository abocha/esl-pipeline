# @esl-pipeline/tts-elevenlabs

ElevenLabs integration for ESL Pipeline audio generation.

## What It Does

- Reads `:::study-text` content from lesson markdown.
- Resolves speaker-to-voice assignments from `voices.yml` + optional speaker profiles.
- Generates MP3 output via ElevenLabs Text-to-Speech or Text-to-Dialogue.
- Uses ffmpeg for stitching/metadata.

## Requirements

- Node.js `24.11.1+`
- `ELEVENLABS_API_KEY` set in environment
- `ffmpeg` on `PATH` (or `FFMPEG_PATH`)

## CLI

### `tts-elevenlabs`

```bash
tts-elevenlabs \
  --md lesson.md \
  --voice-map ./packages/orchestrator/configs/voices.yml \
  --out ./out \
  --tts-strategy auto
```

Options:

- `--preview`
- `--force`
- `--tts-strategy auto|dialogue|tts`
- `--dialogue-language <code>`
- `--dialogue-stability <0..1>`
- `--dialogue-seed <int>`

### `tts-voices`

Syncs allowed voices from ElevenLabs into the catalog used by orchestrator/batch-backend:

```bash
pnpm --filter @esl-pipeline/tts-elevenlabs build
pnpm --filter @esl-pipeline/tts-elevenlabs run voices:sync
```

Explicit destination:

```bash
pnpm --filter @esl-pipeline/tts-elevenlabs exec node dist/bin/voices.js \
  --out /absolute/path/to/packages/orchestrator/configs/elevenlabs.voices.json
```

## Programmatic API

```ts
import { buildStudyTextMp3 } from '@esl-pipeline/tts-elevenlabs';

const result = await buildStudyTextMp3('/abs/path/lesson.md', {
  voiceMapPath: '/abs/path/packages/orchestrator/configs/voices.yml',
  outPath: '/abs/path/out',
  ttsStrategy: 'auto',
  force: false,
});
```

### `BuildStudyTextOptions`

- `voiceMapPath: string`
- `outPath: string`
- `preview?: boolean`
- `force?: boolean`
- `defaultAccent?: string`
- `defaultVoiceId?: string`
- `ffmpegPath?: string`
- `outputFormat?: string`
- `ttsStrategy?: 'auto' | 'tts' | 'dialogue'`
- `dialogueLanguage?: string`
- `dialogueStability?: number`
- `dialogueSeed?: number`

### `BuildStudyTextResult`

- `path: string`
- `duration?: number`
- `hash: string`
- `voices: Array<{ speaker; voiceId; source; score?; voiceName?; gender?; accent?; useCase? }>`
- `voiceAssignments?: Record<string, string>`
