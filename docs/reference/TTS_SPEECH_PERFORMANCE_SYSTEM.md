# TTS Speech Performance System

## Meta

- Audience: maintainers, operators, and AI agents changing TTS behavior.
- Read Time: 7 minutes.
- Authority Level: canonical runtime contract for speech-performance planning and rendering.
- Last Verified Against: 2026-07-30 repo state.
- Owner: founder-maintainer + backend/orchestrator maintainers.
- Review Cadence: after TTS provider, prompt, or manifest contract changes.
- Status: `active`.

## Purpose

Define the provider-neutral speech-performance layer that sits between clean lesson Markdown and
provider-specific TTS synthesis. This layer keeps pedagogical authoring portable while allowing
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

## Authored Markdown Contract

Learner-facing Markdown stays clean. `speaker_profiles` captures stable semantic cast information:

```yaml
speaker_profiles:
  - id: Maya
    display_name: Maya
    role: project manager clarifying an unrealistic deadline
    persona: warm, practical, and direct
    gender: female
    age: adult
    accent: american
    voice_direction: calm, neutral, clear, conversational adult voice
```

Provider catalogs do not shape authored content. `role` and optional `persona` are descriptive text.
`gender`, `age`, and regional `accent` remain basic provider-neutral hints. Optional
`voice_direction` describes the desired vocal qualities without naming provider tags. Placeholder
accents such as `neutral`, `standard`, and `default` are ignored because they describe qualities,
not regions. Provider-specific `voice` and dynamic `style` values do not belong in generated
Markdown. Operators apply explicit voice overrides through runtime configuration such as
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
uses `gemma-4-31b-it` by default to rank suitable shortlist candidates against stable
speaker-profile intent. Capability decisions do not use voice tags. The current typed SDK catalog
surface provides identifiers, names, language code, description, tags, and source; fields absent
from that surface are not guessed from the raw response.

## Neutral Speech Plan

The speech plan is structured JSON. It preserves the authored words and stores expressive intent in
separate fields. Two schema variants remain supported:

- Schema v1 retains the original per-segment cue fields and the immutable
  `speech-performance-v1-restrained-natural` and `speech-performance-v2-inworld-tts2` prompt
  policies byte-for-byte.
- Schema v2 adds a resolved `dialogue` or `monologue` mode, decision-relevant performance-context
  hash, overall scene direction, one stable speaker envelope per canonical speaker, and optional
  evidenced turn adjustments and auxiliary controls.
- Both variants retain exact provider/model/source provenance and one immutable segment per
  prepared study-text segment.

The planner must never rewrite learner-visible spoken words. Provider renderers may add supported
delivery instructions around those words. Schema-v1 provenance optionally carries the exact
immutable policy ID and its prompt SHA-256 hash. Older schema-v1 plans remain valid without these
fields and are shown in runtime diagnostics as `legacy-unversioned-v1` without mutating storage.

Study-text strategy resolves performance mode as follows:

| Authored strategy | Resolved performance mode                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `dialogue`        | `dialogue`                                                                                                |
| `tts`             | `monologue`                                                                                               |
| `auto`            | `dialogue` only when parsed study text has at least two distinct authored speakers; otherwise `monologue` |

Explicit monologue input with multiple authored speakers is contradictory and fails before a
planner call. Unlabelled monologue resolves one stable narrator. Schema-v2 plans are invalidated
when resolved mode, canonical speakers, title/topics, matched speaker-profile intent, assignment
language, or capability booleans change. Schema-v1 source identity remains unchanged.

Direction components remain labelled by acoustic dimension until rendering. Within a scope,
duplicate dimensions are invalid. Across scopes, turn replaces speaker and speaker replaces
overall for the same dimension; unrelated dimensions inherit. Metrics count the resulting
effective instruction and controls, not the number of raw planner fields. Absent controls,
`pace: natural`, zero pauses, and `deliveryMode: BALANCED` contribute no effective cue.

Policy v3 bounds stacking against the renderer's 200-code-point free-form limit: at most two
overall components, two speaker-baseline components, and one turn component, each at most 36 code
points. Turn components default empty and the prompt permits adjustments on no more than half of
each speaker's turns, rounded up. `excessive_same_speaker_changes` remains observable and the bounded
Luna proof refuses candidates that emit it.

## Planner Policy

Remote planning runs only for models declaring `prompted` support. `inworld-tts-2` uses the new
immutable `speech-performance-v3-contextual-continuity` policy to produce schema-v2 plans. The
fixed evaluation baseline continues to exercise the historical v1/v2 policies and schema-v1
fixtures without reinterpretation.

Ordinary dialogue should omit `pace` and maintain a natural, consistent conversational tempo across
adjacent segments. `slow`, `measured`, and `brisk` are exceptional cues for a non-natural tempo that
the authored scene or learning goal explicitly justifies; emotion, seriousness, regret, reflection,
or intonation alone do not justify changing pace.

Batch backend injects a structured-output planner into the orchestrator. The planner remains
disabled by default, with OpenAI and exact `gpt-5.6-luna` selected when enabled without overrides:

```text
ESL_TTS_SPEECH_PLANNER_ENABLED=false
ESL_TTS_SPEECH_PLANNER_PROVIDER=openai
ESL_TTS_SPEECH_PLANNER_MODEL=gpt-5.6-luna
ESL_TTS_SPEECH_PLANNER_MAX_OUTPUT_TOKENS=12000
ESL_TTS_SPEECH_PLANNER_DEBUG_LOG_PLAN=false
ESL_TTS_SPEECH_PLANNER_RPM_BUDGET=4
ESL_TTS_SPEECH_PLANNER_DAILY_REQUEST_BUDGET=120

ESL_TTS_VOICE_RANKER_ENABLED=true
ESL_TTS_VOICE_RANKER_MODEL=gemma-4-31b-it
ESL_TTS_VOICE_RANKER_MAX_OUTPUT_TOKENS=1200
ESL_TTS_VOICE_RANKER_RPM_BUDGET=12
ESL_TTS_VOICE_RANKER_DAILY_REQUEST_BUDGET=1000
ESL_TTS_VOICE_RANKER_DEBUG_LOG_PLAN=false
```

The planner remains disabled until explicitly enabled. Its built-in selection is OpenAI plus exact
`gpt-5.6-luna`; alternate compatible providers and models require explicit overrides. Google uses
`GEMINI_API_KEY`; OpenAI uses `OPENAI_API_KEY`. Provider/model
allowlists, RPM, daily requests, daily tokens, and spend accounting remain separate, and there is
no cross-provider fallback. OpenAI planner calls use strict structured output, high reasoning,
low verbosity, and `store: false`.

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

Planner candidate strings accept only a bounded safe cue grammar after NFKC normalization: letters,
numbers, ordinary spaces, and limited punctuation, with control characters, newlines, brackets,
tag delimiters, and other markup syntax rejected. Pause values are capped at `1000` ms and each
segment may contain at most one non-verbal cue. Candidate analysis runs before normalization;
validated-plan analysis runs again before provider synthesis.
The provider boundary also revalidates the plan's provider/model, source hash, segment count, and
ordered segment identity. Authored or rendered lexical text containing provider-control markup
delimiters is rejected before preview hashing, cache lookup, or synthesis.

Planner enablement remains opt-in. After changing planner env values for a Compose deployment,
recreate `batch-backend` and `batch-worker` so both processes load the same configuration.

Successful schema-v2 plans emit a compact `Speech performance planner produced a prompted plan`
log with schema/mode, envelope counts, effective instruction/control counts, plan/prompt hashes,
and stable quality issue codes/counts. Schema-v1 logs retain their historical cue-count shape. For
local development inspection, set
`ESL_TTS_SPEECH_PLANNER_DEBUG_LOG_PLAN=true` and recreate both services. The worker then emits a
`Speech performance planner validated plan debug payload` log containing the complete validated
neutral plan consumed by synthesis. This includes learner text, so leave the flag disabled outside
short-lived debugging sessions.

Invalid prompted plans continue with identity synthesis. Routine warning logs include only stable
quality issue codes/counts. With `ESL_TTS_SPEECH_PLANNER_DEBUG_LOG_PLAN=true`, the same warning also
includes the rejected parsed output and raw model text. These fields can include learner text.
Invalid optional emphasis phrases are discarded at the backend planner boundary before durable-plan
validation. This preserves usable expressive cues when the remote planner paraphrases a phrase
instead of returning an exact authored-text substring.

Voice-plan logs report whether the optional Inworld Gemma ranker selected voices, skipped ranking,
or fell back to deterministic catalog scoring. Set `ESL_TTS_VOICE_RANKER_DEBUG_LOG_PLAN=true` for
full shortlist diagnostics and ranker failure messages. Inspect the result with:
Malformed structured ranker responses also include the rejected raw model text under this debug
flag. The backend ranker asks only for speaker and voice IDs; free-text model rationales are omitted
to keep the Gemma response compact and reliable.

```powershell
docker compose logs batch-worker | Select-String "Speech performance planner|Inworld voice ranker"
```

## Provider Rendering

Provider adapters consume the same neutral plan:

- Inworld TTS-2 schema v2 merges effective scene, speaker, and turn dimensions into at most one
  bounded leading instruction tag. Numeric pace has sole ownership of tempo, so the merged text
  omits tempo whenever a non-natural speaking rate is present. Default/zero controls are omitted.
  Pauses and one non-verbal require validated authored evidence; emphasis may accompany numeric
  pace only when its evidence says learner meaning requires it. Basis, reason, evidence, dimension
  labels, and provider-control prose are never rendered as spoken text.
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

Manifest schema `5` adds:

```text
voicePlans.studyText
audioArtifacts.studyText.voicePlanHash
speechPlans.studyText
audioArtifacts.studyText.speechPlanHash
```

The top-level plans store validated neutral provenance. The audio artifact links to the consumed
voice-plan and speech-plan hashes. New voice plans use the explicit `ranked`, `deterministic`, and
`fallback` modes. Schema-5 manifests written before this clarification may contain `resolved`;
manifest loading normalizes that legacy token to `deterministic`.

Inworld audio caching is derived from already-rendered segment payloads: voice ID, rendered text,
SDK controls, effective language, renderer policy version, effective inter-segment gaps, encoding,
sample rate, and the assembly-margin policy.
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
- The first complete Luna schema-v2 functionality proof is recorded in
  [`../operations/study-text-performance-v3-luna-evidence-2026-08-01.md`](../operations/study-text-performance-v3-luna-evidence-2026-08-01.md).
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
