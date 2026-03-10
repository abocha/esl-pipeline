# @esl-pipeline/stt-core

Provider-agnostic STT core contracts and orchestration utilities.

## Scope

- Defines shared STT provider contracts (`SttProviderAdapter`).
- Provides registry + engine helpers for selecting providers.
- Exposes transcript segment normalization and timeline/stack formatting helpers.
- Resolves provider selection from:
  - `ESL_STT_DEFAULT_PROVIDER`
  - `ESL_STT_PROVIDER_ORDER`
