# @esl-pipeline/tts-provider-gemini

Google Cloud Gemini TTS adapter for AssignmentV1. This is independent of the existing `google`
Chirp/Cloud Text-to-Speech adapter and of the retired Google AI Studio LLM lane.

## Configuration

- Select provider `gemini` through the existing TTS selection surface. This package does not change
  the repository-wide default provider.
- Set `ESL_TTS_PROVIDER_GEMINI_PROJECT_ID` to the Cloud project receiving the requests and charges.
- Authentication uses Google Application Default Credentials: `GOOGLE_APPLICATION_CREDENTIALS`,
  workload identity, or local ADC configured with `gcloud auth application-default login`. The
  ordinary `gcloud auth login` credential store alone is not ADC. The adapter never shells out to
  `gcloud`, uses AI Studio keys, or copies credentials into artifacts.
- Optional `ESL_TTS_PROVIDER_GEMINI_MODEL`: `gemini-3.8-flash-lite-tts` (default) or
  `gemini-3.8-flash-tts`.
- Optional `ESL_TTS_PROVIDER_GEMINI_TIMEOUT_MS`: 1000–300000 ms; default 180000 ms. This bounds
  ADC acquisition plus the HTTP request/response. Caller cancellation and an earlier deadline win.
- FFmpeg must be on `PATH`, in `FFMPEG_PATH`, or provided through the existing `ffmpegPath` option.
- Optional `BATCH_TTS_CACHE_DIR` uses the existing disposable TTS cache location. Otherwise the
  adapter uses `.tts-cache` below the output directory. Gemini entries live in a `gemini` subfolder.

The Cloud project must enable `aiplatform.googleapis.com`, have billing attached and grant the ADC
principal access to model inference. Requests use the fixed global Google Cloud endpoint; no custom
endpoint or Developer API fallback is supported.

## Speech and voice behavior

Study text uses one unary `generateContent` request. AssignmentV1's authored study-text form is
authoritative: dialogue remains dialogue and monologue remains monologue, even when a legacy
`ttsStrategy` flag conflicts. Native dialogue requires exactly two distinct speakers. Monologue
joins the authored turn text without reading speaker labels. Other speaker counts in dialogue fail
before authentication or synthesis; use an authored monologue or another provider instead.

The package exposes the 30 supported prebuilt voices as a static catalog, so catalog lookup needs
no credentials. Plain authored words are sent without delivery prompts, inline annotations or an
external speech planner/voice ranker. Default voices are Puck then Kore for dialogue and Kore for
monologue. A validated prepared voice plan takes precedence; otherwise explicit speaker-profile
voices, `voices.yml` speaker mappings, `voices.yml.default`/operator default voice, then deterministic
defaults apply. Unknown, custom and other-provider voice IDs fail explicitly. Example:

```yaml
auto: true
Alex: Puck
Maya: Kore
```

Pronunciation text and shadow sentences use the same plain single-speaker transport and explicit
selected voice. Gemini is English-focused in this initial Pipeline integration; the adapter does not
promise that a fixed prebuilt voice matches an authored regional-accent preference.

## Integrity, cache and failures

The unary response must finish with `STOP` and contain one complete `audio/wav` PCM16 mono 24 kHz
file. Truncated RIFF/data chunks, blocked/incomplete output and `MAX_TOKENS` fail before encoding.
Valid audio is converted into MP3; temporary files and atomic renames keep interrupted conversions
out of the cache. The authored text is not silently split, retargeted or retried.

Cache identity contains provider, selected model, Cloud project, full request text/speaker/voice
mapping, synthesis kind and the MP3 rendering policy. Output-directory changes can reuse the same
cache; changed model, project, voice or text cannot. `force` bypasses reuse. Preview, static catalog
lookup and successful cache hits never discover credentials or make inference calls. Cache data is
disposable; no persistent assignment/manifest authority is stored there.

The local request payload ceiling is 32 KiB, and the response ceiling is 48 MiB. These are memory
limits, **not** token estimates. Cloud model token limits still apply and rejected/partial output is
an explicit failure. Long-form chunking, streaming, custom voices and Batch are outside this slice.

There are no automatic synthesis retries: an ambiguous timeout might already have generated billed
audio. HTTP 429 is classified as `provider_rate_limit`; request timeout/transient server/network
failure as `provider_timeout`; malformed output and deterministic HTTP failures as
`provider_contract_error`. Caller cancellation remains the shared `TtsSynthesisCancelledError`.
Errors and diagnostics omit bearer tokens, transcript text and raw provider response bodies.

Safe completion diagnostics include model, duration, bytes, elapsed time, reported AUDIO output
tokens and text input tokens. The combined candidate count is never mislabeled as audio usage.
Cloud Billing remains authoritative for charges and trial-credit application.

## Validation

```powershell
pnpm --filter @esl-pipeline/tts-provider-gemini test:unit
pnpm --filter @esl-pipeline/tts-provider-gemini build
```

Tests use the real provider/request/parser/cache boundaries with mocked ADC, fetch and MP3 encoding;
they do not use live credentials. The orchestration-level synthetic live smoke owns verification of
real Cloud access, real FFmpeg encoding and the complete learner handout publication path.
