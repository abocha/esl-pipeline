# @esl-pipeline/tts-core

Provider-agnostic TTS core contracts and orchestration utilities.

## Scope

- Defines shared TTS input/output contracts.
- Defines provider adapter interfaces (`TtsProviderAdapter`, `VoiceProviderAdapter`).
- Provides registry + engine helpers (`registerTtsProvider`, `buildStudyTextMp3`, etc.).
- Resolves provider selection using:
  - `ESL_TTS_DEFAULT_PROVIDER`
  - `ESL_TTS_PROVIDER_ORDER`

## Typical Usage

```ts
import { buildStudyTextMp3, registerTtsProvider } from '@esl-pipeline/tts-core';
import { createElevenLabsTtsProvider } from '@esl-pipeline/tts-provider-elevenlabs';
import { createGoogleTtsProvider } from '@esl-pipeline/tts-provider-google';

registerTtsProvider(createElevenLabsTtsProvider());
registerTtsProvider(createGoogleTtsProvider());

await buildStudyTextMp3({ context, mdPath }, { voiceMapPath, outPath, ttsProvider: 'google' });
```
