# TTS Speech Performance System

## Meta

- Audience: maintainers, operators, and AI agents changing TTS behavior.
- Read Time: 7 minutes.
- Authority Level: target runtime contract for the speech-performance rollout.
- Last Verified Against: 2026-07-28 repo state.
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
Pronunciation audio remains deterministic and outside these stages in the first rollout.

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
separate cue fields. A plan contains:

- schema version, source hash, provider/model selection, plan mode, and optional planner provenance
- one plan segment for each prepared study-text segment
- optional emotion, intonation, pace, emphasis, pauses, restrained non-verbal cues, delivery mode,
  and steerable-only free-form direction
- an optional fallback reason when the remote planner could not produce a usable plan

The planner must never rewrite learner-visible spoken words. Provider renderers may add supported
delivery instructions around those words. Schema-v1 provenance optionally carries the exact
immutable policy ID and its prompt SHA-256 hash. Older schema-v1 plans remain valid without these
fields and are shown in runtime diagnostics as `legacy-unversioned-v1` without mutating storage.

## Planner Policy

Remote planning runs only for models declaring `prompted` support. The first prompted model is
`inworld-tts-2`. Production uses `speech-performance-v2-inworld-tts2`; the immutable compatibility
fixture remains `speech-performance-v1-restrained-natural`. Both prompt texts are hash-versioned.

Ordinary dialogue should omit `pace` and maintain a natural, consistent conversational tempo across
adjacent segments. `slow`, `measured`, and `brisk` are exceptional cues for a non-natural tempo that
the authored scene or learning goal explicitly justifies; emotion, seriousness, regret, reflection,
or intonation alone do not justify changing pace.

Batch backend injects a structured-output planner into the orchestrator. The default planner model
is `gemini-3.1-flash-lite`, configured with:

```text
ESL_TTS_SPEECH_PLANNER_ENABLED=false
ESL_TTS_SPEECH_PLANNER_MODEL=gemini-3.1-flash-lite
ESL_TTS_SPEECH_PLANNER_MAX_OUTPUT_TOKENS=2400
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

The planner reuses server-side `GEMINI_API_KEY` and existing generation-budget accounting. If the
planner is disabled, unavailable, or invalid, the orchestrator records an identity plan and
continues synthesis.

Identity fallback reasons are intentionally specific:

- `planner_disabled`
- `planner_missing_credentials`
- `planner_unavailable`
- `planner_execution_failed`
- `planner_invalid`

Planner candidate strings accept only a bounded safe cue grammar after NFKC normalization: letters,
numbers, ordinary spaces, and limited punctuation, with control characters, newlines, brackets,
tag delimiters, and other markup syntax rejected. Pause values are capped at `1000` ms and each
segment may contain at most one non-verbal cue. Candidate analysis runs before normalization;
validated-plan analysis runs again before provider synthesis.

Planner enablement remains opt-in. After changing planner env values for a Compose deployment,
recreate `batch-backend` and `batch-worker` so both processes load the same configuration.

Successful prompted plans emit a compact `Speech performance planner produced a prompted plan`
log with the validated plan hash, prompt policy/hash, cue counts, and stable quality issue
codes/counts. For local development inspection, set
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

- Inworld TTS-2 compiles at most one bounded instruction tag. A safe free-form direction is
  authoritative; otherwise emotion/intonation compile to one combined instruction. It also renders
  breaks, at most one restrained non-verbal cue, uppercase emphasis, and `deliveryMode` for every
  voice. Non-natural pace uses only numeric `speakingRate`; `natural` and absent pace use the
  provider default.
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
reused, the existing plan is reused if present. Older manifests without a speech plan remain
readable.

## Prompt Capability Retirement

The former `[VOICE_CAPABILITIES]` draft-generation block is retired. It merged live provider
catalogs too early, coupled authored Markdown to whichever providers happened to be configured, and
mixed stable cast intent with provider routing.

Prompt packages continue to preserve template/profile/memory lineage, but no longer persist merged
voice-capability snapshot provenance.

## Operational Notes

- Planner enablement is opt-in because it adds a billable model call.
- Identity fallback is expected and observable; it is not a publish blocker.
- Voice catalog refresh remains useful for provider assignment quality and diagnostics.
- Explicit operator overrides remain supported outside authored Markdown.
- Recreate `batch-backend` and `batch-worker` after changing planner env values.

## References

- [Inworld TTS-2 prompting guide](https://docs.inworld.ai/tts/best-practices/prompting-for-tts-2)
- [Inworld TTS models](https://docs.inworld.ai/tts/tts-models)
- [Inworld Node SDK](https://docs.inworld.ai/tts/node-sdk)
