# TTS Speech Performance System

## Meta

- Audience: maintainers, operators, and AI agents changing TTS behavior.
- Read Time: 7 minutes.
- Authority Level: canonical runtime contract for speech-performance planning and rendering.
- Last Verified Against: 2026-08-04 repo state.
- Owner: founder-maintainer + backend/orchestrator maintainers.
- Review Cadence: after TTS provider, prompt, or manifest contract changes.
- Status: `active`.

## Purpose

Define the provider-neutral speech-performance layer that sits between typed AssignmentV1
study-text input and provider-specific TTS synthesis. This layer keeps pedagogical authoring portable while allowing
capable models such as Inworld TTS-2 to receive expressive delivery guidance.

## Pipeline Contract

The target stage order is:

```text
validate -> import -> colorize -> voice-plan -> speech-plan -> tts -> upload -> add-audio -> manifest
```

`voice-plan` resolves study-text speaker assignments before expressive planning. `speech-plan`
consumes those resolved assignments and emits a durable provider-neutral performance plan.
Pronunciation primary and item synthesis never constructs or receives a speech planner, speech
plan, or performance source context.

The stage is skipped when study-text TTS is disabled, when a rerun is republish-only, or when a
rerun regenerates pronunciation audio without regenerating study-text audio.

## Typed Assignment Contract

`input.studyText.speakers` captures stable semantic cast information in the typed AssignmentV1
shape (illustrative excerpt):

```json
{
  "id": "Maya",
  "displayName": "Maya",
  "role": "Project manager clarifying an unrealistic deadline",
  "persona": null,
  "voiceDirection": "Calm, clear, conversational adult voice",
  "gender": "female",
  "age": null,
  "accent": null
}
```

Every speaker includes the typed camelCase `displayName`, `voiceDirection`, and nullable fields;
`persona`, `age`, and `accent` may be `null` as shown. The orchestrator projects typed speakers
into the internal speech-planning representation. That projection is not a second authoring format.

Provider catalogs do not shape authored content. `role` and optional `persona` are descriptive text.
`gender`, `age`, and regional `accent` remain basic provider-neutral hints. Optional
`voiceDirection` describes the desired vocal qualities without naming provider tags. Placeholder
accents such as `neutral`, `standard`, and `default` are ignored because they describe qualities,
not regions. Provider-specific `voice` and dynamic `style` values do not belong in AssignmentV1.
Operators apply explicit voice overrides through runtime configuration such as
`voices.yml`, job flags, or provider settings.

## Capability Ownership

Capabilities are model-scoped and voice-scoped:

- `tts-core` owns static expressive capability descriptors for each provider model.
- Provider adapters own provider syntax and SDK request mapping.
- Credentialed voice catalogs support runtime cast resolution, per-voice capabilities, and
  diagnostics.
- Draft generation does not receive a merged provider voice-catalog snapshot.

The model descriptor identifies whether speech planning is `identity` or `prompted`, plus supported
controls such as speaking rate, temperature, delivery mode, metadata instructions, SSML breaks,
non-verbal cues, uppercase emphasis, and free-form direction. These capabilities are derived from
the selected model, never inferred from mutable voice tags. `inworld-tts-2` supports the complete
model-scoped expressive set for every selected voice. `inworld-tts-1.5-max` and
`inworld-tts-1.5-mini` are non-steerable identity models: they do not receive metadata,
free-form direction, non-verbals, uppercase emphasis, or delivery modes.

## Neutral Voice Plan

The voice plan is structured JSON resolved before speech planning. It contains:

- schema version, optional `model-scoped-v1` capability-policy provenance, source hash,
  provider/model selection, and plan hash
- a resolution mode: `ranked`, `deterministic`, or `fallback`
- selected speaker assignments with canonical optional language and compact model-derived
  capability snapshots
- optional semantic-ranker provenance and fallback reason
- compact shortlist diagnostics suitable for manifest persistence

The Inworld adapter retains the documented typed SDK voice fields and builds deterministic English
shortlists. Explicit `voices.yml` mappings and configured defaults win first. Automatic selection
uses the ranker workload target owned by [Generation Target Policy](GENERATION_PROVIDER_POLICY.md)
to rank suitable shortlist candidates against stable speaker-profile intent. Capability decisions
do not use voice tags. The current typed SDK catalog
surface provides identifiers, names, language code, description, tags, and source; fields absent
from that surface are not guessed from the raw response.

## Neutral Speech Plan

The speech plan is structured JSON. Two schema variants remain supported:

- Schema v1 retains the original per-segment cue fields and the immutable
  `speech-performance-v1-restrained-natural` and `speech-performance-v2-inworld-tts2` prompt
  policies byte-for-byte.
- Schema v2 uses immutable policy and enhancer version `contextual-bracket-annotation-v1`. Each
  ordered segment keeps canonical authored `text` and separate TTS-only `synthesisText` containing
  optional reserved `<tts-annotation>...</tts-annotation>` spans.
- Both variants retain exact provider/model/source provenance and one segment per prepared
  study-text segment.

The planner must never rewrite learner-visible spoken words. Luna sees the complete assignment as
read-only context, including frontmatter, speaker profiles, roles, personas, voice directions, and
the complete dialogue or monologue. It returns only ordered segment IDs and synthesis text.
Annotations are optional: unchanged output is valid and there is no density target or taxonomy.

Validation is mechanical and atomic. Segment count, order, IDs, speakers, provider/model, source
hash, enhancer version, reserved syntax, and insertion boundaries must match. Removing only the
reserved spans must reconstruct every authored segment byte-for-byte. Any failure rejects the
complete enhancement and uses schema-v1 identity synthesis. Dialogue and monologue share this
complete-context pass; pronunciation never constructs a planner.

Schema-v1 provenance optionally carries the exact immutable policy ID and prompt SHA-256 hash.
Older schema-v1 plans remain valid without those fields and appear as `legacy-unversioned-v1`
without mutating storage.

## Planner Policy

Remote planning runs only for models declaring `prompted` support. `inworld-tts-2` uses immutable
policy `contextual-bracket-annotation-v1` to produce schema-v2 plans. The fixed historical
evaluation baseline continues to exercise the v1/v2 schema-v1 policies without reinterpretation.

Batch backend injects a structured-output planner into the orchestrator. The planner remains
disabled by default. Planner and ranker targets, limits and environment wiring are owned by
[Generation Target Policy](GENERATION_PROVIDER_POLICY.md) and the backend environment reference.
Those LLM workload policies do not govern the independent STT/TTS provider adapters. The planner
remains disabled until explicitly enabled. Provider and model selection follow current workload
policy and environment validation, with `OPENAI_API_KEY` as the LLM credential. RPM, daily
requests, daily tokens, and spend accounting remain separate, and there is no cross-provider
fallback. OpenAI planner calls use strict structured output, high reasoning, low verbosity, and
`store: false`.

Only typed provider timeouts may retry, within the selected provider. Every physical attempt
reserves the provider/model request budget before execution; one successful logical call records
the actual returned usage once. If the planner is disabled, unavailable, over budget, or invalid,
the orchestrator records an identity plan and continues synthesis.

Identity fallback reasons are intentionally specific:

- `planner_disabled`
- `planner_missing_credentials`
- `planner_unavailable`
- `planner_execution_failed`
- `planner_invalid`
- `planner_budget_exceeded`

Annotation bodies accept the existing bounded markup-safe natural-language grammar. Reserved spans
must be well formed, non-empty, and placed only at authored-character boundaries; they cannot split
a word, Unicode code point, or punctuation sequence. The provider boundary revalidates the plan and
exact source restoration before preview hashing, cache lookup, or synthesis.

Planner enablement remains opt-in. After changing planner env values for a Compose deployment,
recreate `batch-backend` and `batch-worker` so both processes load the same configuration.

Successful schema-v2 plans emit a compact `Speech performance planner produced a prompted plan`
log with enhancer version, segment/annotation counts, plan/prompt hashes, and stable issue
codes/counts. Annotation bodies are omitted. Schema-v1 logs retain their historical cue-count shape. For
local development inspection, set
`ESL_TTS_SPEECH_PLANNER_DEBUG_LOG_PLAN=true` and recreate both services. The worker then emits a
`Speech performance planner validated plan debug payload` log containing the complete validated
plan consumed by synthesis. This includes learner text and accepted annotations, so leave the flag disabled outside
short-lived debugging sessions.

Invalid prompted plans continue with identity synthesis. Routine warning logs include only stable
quality issue codes/counts. With `ESL_TTS_SPEECH_PLANNER_DEBUG_LOG_PLAN=true`, the same warning also
includes the rejected parsed output and raw model text. These fields can include learner text.

Voice-plan logs report whether the optional Inworld OpenAI ranker selected voices, skipped ranking,
or fell back to deterministic catalog scoring. Set `ESL_TTS_VOICE_RANKER_DEBUG_LOG_PLAN=true` for
full shortlist diagnostics and ranker failure messages. Inspect the result with:
Malformed structured ranker responses also include the rejected raw model text under this debug
flag. The backend ranker asks only for speaker and voice IDs; free-text model rationales are omitted
to keep the ranker response compact and reliable.

```powershell
docker compose logs batch-worker | Select-String "Speech performance planner|Inworld voice ranker"
```

## Provider Rendering

Provider adapters consume the same neutral plan:

- Inworld TTS-2 schema v2 converts only validated reserved spans into provider-compatible square
  brackets and sends the resulting synthesis text directly. It uses provider-level `BALANCED` and
  omits speaking-rate control. No scene, speaker, turn, pace, pause, emphasis, or delivery layer is
  compiled.
- Inworld TTS-2 schema v1 remains byte-for-byte compatible with the historical compiler.
- Inworld TTS 1.5 Max and Mini keep identity plans, render no steering tags, and retain their
  existing safe numeric SDK behavior, including natural `speakingRate: 1`.
- ElevenLabs and Google initially synthesize clean source text from identity plans.

Inworld automatic dialogue voice selection is credentialed-catalog aware. Explicit `voices.yml`
mappings and configured defaults win first. Automatic selection then considers English voices only,
prefers the requested regional accent plus stable speaker-profile hints, avoids duplicate voices
where possible, and records capability matches or mismatches. Semantic ranking uses catalog tags,
descriptions, and steerability without treating `EN_US` locale as proof of an American accent. If
the requested accent is unavailable, the adapter uses a deterministic English fallback. Static
`Ashley` / `Dennis` voices are reserved for the case where credentialed English voices are
unavailable. Canonical catalog language propagates through the selected assignment into the typed
SDK generation options.

Unsupported cues are ignored by conservative renderers rather than being spoken aloud.

The Inworld SDK reference documents `speakingRate`, `temperature`, and TTS-2-only `deliveryMode`.
Inworld's prompting guide documents TTS-2 natural-language steering.

## Inworld SDK reliability boundary

The Inworld provider retains the official `@inworld/tts` SDK behind one injected adapter. A
registered provider or direct helper creates one client lazily and reuses it for catalog and
synthesis. SDK `maxRetries` is fixed at zero. The application owns the complete logical retry:

- `ESL_TTS_PROVIDER_INWORLD_RETRY_MAX` defaults to three and clamps to zero through three, so the
  total bound is the initial attempt plus at most three retries;
- retry delays use 1000, 2000, and 4000 ms bases with uniform plus or minus 20 percent jitter;
- HTTP 408, 429, 5xx, typed SDK network failures, timeouts, connection resets, and
  provider-originated transient disconnects retry; and
- caller cancellation, expired deadline, auth/permission, invalid request/voice, unsupported
  controls, and other deterministic 4xx failures do not retry.

The shared TTS request-control contract propagates the caller `AbortSignal` and optional deadline
through new-assignment and rerun study text plus pronunciation primary, item, and shadow paths.
Cancellation is checked before calls, before and after retry sleep, and before another attempt.
Concurrent pronunciation calls already started are allowed to settle, while workers launch no new
calls after cancellation. The installed SDK has no per-`generate()` `AbortSignal`, so an in-flight
call cannot be cancelled; `ESL_TTS_PROVIDER_INWORLD_TIMEOUT_MS` or the SDK default timeout remains
its bound.

Routine synthesis events contain provider/model/voice/language, content SHA-256, character count,
attempt bounds, normalized failure/category/status, elapsed milliseconds, output bytes, and final
outcome. Retry exhaustion, catalog fallback, and aggregate cache hit/miss counts are explicit.
These events and thrown provider errors exclude API keys, learner lines, complete rendered
instructions, and raw provider messages/bodies.

The recurring `non-retryable streaming request` message previously observed after
`stage.add-audio.start` remains an unconfirmed separate anomaly. It is not claimed fixed unless a
new adapter/classification test reproduces its cause.

## Student-Facing Audio Export

The orchestrator keeps content hashes as the durable identity for generated audio while publishing
readable MP3 basenames for student-facing primary artifacts:

```text
audio/final/<hash>/<assignment title> - Study Text.mp3
audio/pronunciation/<hash>/<assignment title> - Pronunciation.mp3
```

Before upload, primary MP3 exports receive ID3 `title` metadata matching the readable basename and
ID3 `artist` metadata set to `English with Andrei`. Pronunciation item clips remain hash-addressed
under `audio/pronunciation-item/`; HTML publishing may embed them for interactive practice.

For `shadow_sentence`, the current runtime emits exactly one item-level `Word` clip for each
authored word drill. It does not derive a duplicate `Natural` clip from the shadow sentence. Natural
sentence audio is generated only when the parsed pronunciation focus contains a distinct
`naturalSentence`. Previously published manifests that contain duplicate item clips remain
renderable for backward compatibility; this rule controls newly generated audio rather than
rewriting legacy artifacts.

Telegram sharing exposes the study-text recording and includes `Listen 2: Pronunciation` only when
the assignment has a pronunciation `primaryClip`. Chunk-only pronunciation artifacts must not be
promoted into a standalone Telegram attachment.

## Manifest And Rerun Provenance

Manifest schema `5` historically added:

```text
voicePlans.studyText
audioArtifacts.studyText.voicePlanHash
speechPlans.studyText
audioArtifacts.studyText.speechPlanHash
```

These fields remain part of the current schema `6` manifest; see the
[pipeline manifest reference](pipeline-manifest.md) for the current schema and compatibility rules.
The top-level plans store validated neutral provenance. The audio artifact links to the consumed
voice-plan and speech-plan hashes. New voice plans use the explicit `ranked`, `deterministic`, and
`fallback` modes. Schema-5 manifests written before this clarification may contain `resolved`;
manifest loading normalizes that legacy token to `deterministic`.

Inworld audio caching is derived from already-rendered segment payloads: voice ID, rendered text,
enhancer version, SDK controls, effective language, renderer policy version, effective
inter-segment gaps, encoding, sample rate, and the assembly-margin policy.
Planner and ranker timestamps do not affect audio identity. Any change that affects rendered audio,
including emphasis, pauses, delivery mode, voice selection, or speaker-switch margins, invalidates
the cache.

Study-text assembly inserts deterministic minimum margins before applying optional planner pauses:

- same speaker: `180ms`
- speaker switch: `320ms`

When a rerun regenerates study-text audio, it regenerates the speech plan. When study-text audio is
reused, the existing plan is reused if present. New assignment planning receives the authored
strategy; rerun planning receives the explicitly overridden or persisted effective strategy.
Pronunciation-only reruns skip study-text preparation and the planner. Older manifests without a
speech plan and schema-v1 plans remain readable.

## Prompt Capability Retirement

The former `[VOICE_CAPABILITIES]` draft-generation block is retired. It merged live provider
catalogs too early, coupled authored Markdown to whichever providers happened to be configured, and
mixed stable cast intent with provider routing.

Prompt packages continue to preserve template/profile/memory lineage, but no longer persist merged
voice-capability snapshot provenance.

## Operational Notes

- Planner enablement is opt-in because it adds a billable model call.
- The first Luna schema-v2 envelope functionality proof is retained as historical connectivity
  evidence in
  [`../operations/study-text-performance-v3-luna-evidence-2026-08-01.md`](../operations/study-text-performance-v3-luna-evidence-2026-08-01.md).
  It does not validate replacement bracket-annotation quality.
- The replacement contextual bracket-annotation contract completed a blinded three-assignment
  product trial with two enhancement wins, zero baseline wins, and one tie. The non-private evidence
  is retained in
  [`../operations/contextual-speech-annotation-luna-listening-evidence-2026-08-04.md`](../operations/contextual-speech-annotation-luna-listening-evidence-2026-08-04.md).
- Planner model comparisons use the database-free, fail-closed harness documented in
  [`../operations/speech-planner-evaluation.md`](../operations/speech-planner-evaluation.md). The
  paid matrix contains prompted TTS-2 fixtures only; deterministic TTS 1.5 identity controls use the
  same capability, identity-plan, renderer, and analysis boundaries without a remote planner call.
  Those v1/v2 results are historical evidence, not evidence for schema v2 or Luna. The harness does
  not change the production planner default; only complete ordinary-path listening evidence can
  justify a separate configuration change.
- Identity fallback is expected and observable; it is not a publish blocker.
- Voice catalog refresh remains useful for provider assignment quality and diagnostics.
- Explicit operator overrides remain supported outside authored Markdown.
- Recreate `batch-backend` and `batch-worker` after changing planner env values.

## References

- [Inworld TTS-2 prompting guide](https://docs.inworld.ai/tts/best-practices/prompting-for-tts-2)
- [Inworld TTS models](https://docs.inworld.ai/tts/tts-models)
- [Inworld Node SDK](https://docs.inworld.ai/tts/node-sdk)
