# @esl-pipeline/tts-provider-google

Google Cloud Text-to-Speech provider adapter for the ESL pipeline.

## Scope

- Implements `TtsProviderAdapter` from `@esl-pipeline/tts-core`.
- Supports model families:
  - `chirp3_hd` (default/primary)
  - `studio`
  - `neural2`
  - `wavenet`
- Owns Google voice catalog loading, speaker assignment, and synthesis behavior.

## Required Environment

- `ESL_TTS_DEFAULT_PROVIDER=google` (when selecting Google by default)
- Google ADC credentials (`GOOGLE_APPLICATION_CREDENTIALS` or workload identity)

Optional provider settings:

- `ESL_TTS_PROVIDER_GOOGLE_MODEL` (default `chirp3_hd`)
- `ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE`
- `ESL_TTS_PROVIDER_GOOGLE_API_ENDPOINT`
- `ESL_TTS_PROVIDER_GOOGLE_LOCATION`
- `ESL_TTS_PROVIDER_GOOGLE_MODEL_NAME`
- `ESL_TTS_PROVIDER_GOOGLE_MAX_BYTES`
- `ESL_TTS_PROVIDER_GOOGLE_VOICE_CHIRP3_HD`
- `ESL_TTS_PROVIDER_GOOGLE_VOICE_STUDIO`
- `ESL_TTS_PROVIDER_GOOGLE_VOICE_NEURAL2`
- `ESL_TTS_PROVIDER_GOOGLE_VOICE_WAVENET`

## Programmatic Registration

```ts
import { registerTtsProvider } from '@esl-pipeline/tts-core';
import { createGoogleTtsProvider } from '@esl-pipeline/tts-provider-google';

registerTtsProvider(createGoogleTtsProvider());
```
