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
- Uses live Google `listVoices` catalog ingestion with in-process caching (15m TTL).
- Restricts auto-assignment catalog to English locales (`en-*`).
- Enforces strict selected-model-family validation for explicit voice mappings.

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

## Voice Selection Behavior

Google assignment now follows the same precedence model as ElevenLabs:

1. `speaker_profiles[].voice`
2. per-speaker value in `voices.yml`
3. `voices.yml.default`
4. automatic profile-aware picker (gender + accent/locale heuristics)

When `ttsModel` (or `ESL_TTS_PROVIDER_GOOGLE_MODEL`) is selected, explicit voices must belong
to that model family. For example, `en-US-Studio-O` is rejected when model family is `chirp3_hd`.

## `voices.yml` Examples

Chirp 3 HD:

```yaml
auto: true
default: en-US-Chirp3-HD-Charon
Narrator: en-GB-Chirp3-HD-Gacrux
Alex: en-US-Chirp3-HD-Charon
Yulia: en-US-Chirp3-HD-Aoede
```

Studio:

```yaml
auto: true
default: en-US-Studio-O
Narrator: en-US-Studio-O
Alex: en-US-Studio-Q
```

## Programmatic Registration

```ts
import { registerTtsProvider } from '@esl-pipeline/tts-core';
import { createGoogleTtsProvider } from '@esl-pipeline/tts-provider-google';

registerTtsProvider(createGoogleTtsProvider());
```
