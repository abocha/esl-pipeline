# @esl-pipeline/tts-provider-inworld

Inworld TTS provider adapter for ESL Pipeline.

## Runtime

- API key: `ESL_TTS_PROVIDER_INWORLD_API_KEY` or `INWORLD_API_KEY`
- Default model: `inworld-tts-2`
- Supported models: `inworld-tts-2`, `inworld-tts-1.5-max`, `inworld-tts-1.5-mini`
- Default voices: `Ashley`, `Dennis`

The adapter uses the official `@inworld/tts` SDK and keeps provider credentials server-side.
For `inworld-tts-2`, neutral speech-performance cues are rendered into model-scoped Inworld
prompting syntax and SDK controls. Every TTS-2 voice supports metadata instructions, non-verbals,
uppercase emphasis, breaks, and free-form natural-language direction regardless of catalog tags.
Both `inworld-tts-1.5-max` and `inworld-tts-1.5-mini` intentionally synthesize clean source text
with safe SDK defaults only and receive no steering tags.

Credentialed voice catalogs retain the installed SDK's typed display name, name, locale,
description, tags, and source metadata. Locale values are canonicalized to BCP 47 and propagated
through resolved assignments. The installed SDK does not expose typed gender, age-group, category,
or prompt-language fields, so the adapter retains documented display-text heuristics rather than
fabricating those values. Catalog-load failure emits one privacy-safe warning before deterministic
static fallback.
Automatic dialogue selection considers English voices only, prefers requested regional accent and
stable speaker-profile hints, and emits observable fallback diagnostics. Explicit `voices.yml`
mappings and configured default voices remain higher priority.
`Ashley` and `Dennis` are static fallbacks when credentialed English voices are unavailable.
