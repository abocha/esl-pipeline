# @esl-pipeline/tts-provider-inworld

Inworld TTS provider adapter for ESL Pipeline.

## Runtime

- API key: `ESL_TTS_PROVIDER_INWORLD_API_KEY` or `INWORLD_API_KEY`
- Default model: `inworld-tts-2`
- Supported models: `inworld-tts-2`, `inworld-tts-1.5-max`, `inworld-tts-1.5-mini`
- Default voices: `Ashley`, `Dennis`

The adapter uses the official `@inworld/tts` SDK and keeps provider credentials server-side.
For `inworld-tts-2`, schema-v2 `synthesisText` contains mechanically validated reserved annotation
spans. The adapter converts only those spans into Inworld square brackets, sends the result with
`BALANCED`, and omits speaking-rate control. Authored text remains the lexical transcript, and
schema-v1 rendering remains compatible.
Both `inworld-tts-1.5-max` and `inworld-tts-1.5-mini` intentionally synthesize clean source text
with safe SDK defaults only and receive no steering tags.

Rendered synthesis text, enhancer version, renderer policy, voice, language, and SDK controls
participate in full and segment cache identity. The provider boundary revalidates exact source
restoration before cache lookup or synthesis. Study-text assembly retains 180 ms same-speaker and
320 ms speaker-switch minimum gaps.

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

## Reliability and diagnostics

The provider retains the official `@inworld/tts` SDK behind an internal adapter. Each registered
provider or direct helper lifecycle creates one client lazily and reuses it for catalog and
synthesis calls. SDK `maxRetries` is fixed at `0`; the application is the only retry owner.

`ESL_TTS_PROVIDER_INWORLD_RETRY_MAX` defaults to `3` and is clamped to `0`-`3`, for at most four
total attempts. Retries use 1, 2, and 4 second exponential bases with uniform bounded jitter of
plus or minus 20 percent. HTTP 408, 429, 5xx, typed SDK network failures, timeouts, connection
resets, and provider-originated transient disconnects are retryable. Caller cancellation, expired
deadlines, authentication/permission failures, invalid requests, invalid voices, and other
deterministic 4xx responses fail without retry.

The caller's `AbortSignal` and optional deadline are checked before provider calls and at every
retry/sleep boundary. The installed SDK does not accept an `AbortSignal` for `generate()`, so an SDK
call already in flight cannot be cancelled; it is allowed to settle and remains bounded by
`ESL_TTS_PROVIDER_INWORLD_TIMEOUT_MS` or the SDK default timeout. No additional call starts after
caller cancellation is observed.

Synthesis events contain provider/model/voice/language, content SHA-256, character count,
attempt/max attempts, normalized failure kind and public category, HTTP status when available,
elapsed milliseconds, output bytes, and outcome. Cache summaries use provider/model plus aggregate
hit/miss counts, and catalog fallback records a normalized failure kind and fallback count. Errors
and routine provider logs never include the API key, learner line, rendered instruction, or raw
provider body.

The previously observed `non-retryable streaming request` message after `stage.add-audio.start`
remains an unconfirmed, separate anomaly. This SDK reliability work does not claim to fix it unless
it is reproduced through the adapter and classification tests.

Assignment synthesis accepts typed AssignmentV1 only. Historical Markdown execution and cleanup
are retired. Speech fields and pronunciation text remain plain text, including literal punctuation.
