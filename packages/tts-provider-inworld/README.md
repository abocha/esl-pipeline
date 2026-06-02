# @esl-pipeline/tts-provider-inworld

Inworld TTS provider adapter for ESL Pipeline.

## Runtime

- API key: `ESL_TTS_PROVIDER_INWORLD_API_KEY` or `INWORLD_API_KEY`
- Default model: `inworld-tts-2`
- Supported models: `inworld-tts-2`, `inworld-tts-1.5-max`, `inworld-tts-1.5-mini`
- Default voices: `Ashley`, `Dennis`

The adapter uses the official `@inworld/tts` SDK and keeps provider credentials server-side.
For `inworld-tts-2`, neutral speech-performance cues are rendered into capability-tiered Inworld
prompting syntax and SDK controls. Every TTS-2 voice supports metadata instructions, non-verbals,
uppercase emphasis, breaks, and SDK controls. Only voices tagged `steerable` receive free-form
natural-language direction. The 1.5 models intentionally synthesize clean source text with safe SDK
defaults only.

Credentialed voice catalogs retain Inworld locale, description, tags, and source metadata.
Automatic dialogue selection considers English voices only, prefers requested regional accent and
stable speaker-profile hints, treats `steerable` as a ranking bonus, and emits observable fallback
diagnostics. Explicit `voices.yml` mappings and configured default voices remain higher priority.
`Ashley` and `Dennis` are static fallbacks when credentialed English voices are unavailable.
