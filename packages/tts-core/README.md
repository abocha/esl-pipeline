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
  readable without invented provenance. Schema v2 uses `contextual-bracket-annotation-v1` and
  stores immutable authored `text` separately from validated TTS-only `synthesisText`.
- Luna receives the complete assignment as read-only context for dialogue and monologue. It may
  insert optional reserved annotation spans, but it cannot rewrite or reorder authored characters,
  IDs, speakers, or segments. Pronunciation bypasses enhancement.
- The reserved-span validator rejects malformed placement and proves byte-for-byte authored-text
  restoration. One invalid segment rejects the complete enhancement and selects schema-v1 identity
  fallback.
- Provider synthesis revalidates exact plan selection, source hash, and ordered segment coverage.
  Authored or rendered lexical provider-control markup is rejected before cache or synthesis.
- Inworld TTS-2 converts only validated reserved spans to square-bracket annotations, uses
  `BALANCED`, and omits speaking-rate control. Validated synthesis text and enhancer version are
  part of complete and chunk cache identity; schema-v1 rendering remains compatible.
- Pronunciation input/options never accept a speech planner, performance plan, or performance
  source context.
