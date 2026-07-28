# @esl-pipeline/tts-core

Provider-agnostic TTS core contracts and orchestration utilities.

## Scope

- Defines shared TTS input/output contracts.
- Defines provider adapter interfaces (`TtsProviderAdapter`, `VoiceProviderAdapter`).
- Provides registry + engine helpers (`registerTtsProvider`, `buildStudyTextMp3`, etc.).
- Defines neutral speech-performance plans and preparation helpers for expressive adapters.
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

Adapters own provider syntax. Authored Markdown and orchestrator manifests carry neutral speaker
profiles and optional speech-performance plans.

## Speech Policy Compatibility

- Capabilities are selected by provider model. Inworld TTS-2 uses the complete
  `model-scoped-v1` capability set; Inworld TTS 1.5 Max and Mini remain non-steerable identity
  models. Legacy unversioned Inworld voice plans are normalized against the selected model only at
  execution time.
- Schema-v1 speech plans optionally record `speech-performance-v1-restrained-natural` or
  `speech-performance-v2-inworld-tts2` plus the immutable prompt hash. Old schema-v1 plans remain
  readable without invented provenance.
- Cue text is NFKC-normalized and restricted to a bounded markup-safe grammar. Planner pauses are
  capped at `1000` ms and each segment may carry at most one non-verbal cue. Candidate and validated
  plan analyzers expose privacy-safe issue codes.
- Provider adapters receive canonical assignment language. Inworld TTS-2 compiles at most one safe
  instruction tag; both TTS 1.5 models receive none. Renderer policy and effective language are
  part of complete and chunk cache identity.
