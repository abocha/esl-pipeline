# @esl-pipeline/stt-core

Provider-agnostic STT core contracts and orchestration utilities.

## Scope

- Defines shared STT provider contracts (`SttProviderAdapter`).
- Defines lazy URL-backed or file-backed submission sources so adapters do not require whole-file
  buffering.
- Provides registry + engine helpers for selecting providers.
- Exposes transcript segment normalization and timeline/stack formatting helpers.
- Transcript segments may carry `kind: 'non_speech'` for non-lexical provider annotations; omitted
  kind remains the backward-compatible lexical speech shape.
- Exposes provider IDs for configured routing. The batch backend owns production topology routing:
  ordinary mixed recordings use ElevenLabs Scribe v2, while explicitly trusted split-channel
  recordings use Deepgram. There is no automatic cross-provider fallback.
