# @esl-pipeline/tts-provider-elevenlabs

ElevenLabs-specific TTS provider adapter for the ESL pipeline.

## Scope

- Implements the `TtsProviderAdapter` contract from `@esl-pipeline/tts-core`.
- Owns ElevenLabs voice catalog loading, speaker assignment, and synthesis behavior.
- Intended to be registered by orchestrator/batch services through `tts-core`.
- No standalone CLI surface (TTS runs through orchestrator/batch flows only).

## Required Environment

- `ESL_TTS_PROVIDER_ELEVENLABS_API_KEY`
- Optional provider settings:
  - `ESL_TTS_PROVIDER_ELEVENLABS_MODEL_ID`
  - `ESL_TTS_PROVIDER_ELEVENLABS_OUTPUT_FORMAT`
  - `ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY`
  - `ESL_TTS_PROVIDER_ELEVENLABS_MAX_CHARS`
  - `ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH`

## Programmatic Registration

```ts
import { registerTtsProvider } from '@esl-pipeline/tts-core';
import { createElevenLabsTtsProvider } from '@esl-pipeline/tts-provider-elevenlabs';

registerTtsProvider(createElevenLabsTtsProvider());
```

## Dialogue Input Contract

- Local dialogue synthesis inputs use canonical camelCase `voiceId`.
- Legacy snake_case `voice_id` is retired from local request payloads.

Assignment synthesis accepts typed AssignmentV1 only. Historical Markdown execution and cleanup
are retired. Speech fields and pronunciation text remain plain text, including literal punctuation.
