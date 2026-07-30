# Study-Text Performance v3 Design

## Meta

- Audience: maintainers and AI agents changing study-text speech planning or Inworld synthesis.
- Authority Level: approved design for the next speech-performance implementation batch.
- Last Verified Against: 2026-07-30 repo state at `df350471`.
- Owner: founder-maintainer + backend/orchestrator maintainers.
- Review Cadence: after implementation, provider-guidance changes, or materially different listening
  evidence.
- Status: `spec`.

## Goal

Build the next study-text performance iteration as one coordinated change across planning context,
the neutral speech-plan contract, provider selection, cue analysis, Inworld rendering, and manual
acceptance. The system should keep each participant recognizable over the turns of one dialogue,
allow natural evidence-based variation from turn to turn, give a monologue a coherent through-line,
and avoid redundant controls that make otherwise good audio sound mechanical.

The implementation introduces `speech-performance-v3-contextual-continuity` as a new immutable
planner policy and adds `gpt-5.6-luna` as an opt-in planner contender. Neither capability changes the
production planner default merely by becoming available. Gemini 3.1 remains the default until a
bounded, matched listening comparison supplies enough evidence for a separate activation decision.

## Non-goals

- Do not build a second evaluation harness or an automated dialogue-coherence score.
- Do not change pronunciation-practice synthesis, its voice-line shape, or its cost profile.
- Do not change the authored study-text strategy values or rename their public contract.
- Do not change the fixed Inworld assembly gaps without timestamp-level evidence.
- Do not migrate Inworld away from its supported SDK or revisit its retry ownership.
- Do not invent acoustic numbers from speaker descriptions.
- Do not treat planner intelligence, model price, or a small listening sample as proof of superiority.
- Do not put provider tags, dynamic styles, or planner controls into authored learner Markdown.

## Evidence Behind the Design

### Corrected public evaluation

The corrected public run is the ignored local artifact
`tmp/speech-planner-eval/20260730T131646722Z-baseline`. It completed all 120 planned provider
attempts plus the compatibility control and passed the harness hard gates. The artifact remains
uncommitted; this document records only non-private conclusions.

One reviewer completed the four blocked listening comparisons:

| Block                | Preferred candidate    | Result                                                 |
| -------------------- | ---------------------- | ------------------------------------------------------ |
| `block-c0e23b2fe90c` | Gemini 3.5 + policy v2 | Best neutral dialogue; no clear flaw                   |
| `block-a61622705165` | Gemini 3.1 + policy v2 | Clear and natural at a useful speed                    |
| `block-f85bc20f97c6` | Gemini 3.1 + policy v1 | Most natural; competing non-verbal sounded like a sigh |
| `block-8b9c9af7b90d` | Gemini 3.1 + policy v2 | Clear winner; avoided the recurring bad pause          |

Gemini 3.1 won three of four blocks and policy v2 won three of four blocks. Gemini 3.5 with policy
v1 won none. This is directional evidence, not a population-level ranking: it uses four synthetic
blocks, one listener, and no private issue fixture.

The useful failure pattern is more specific than "use fewer cues":

- In both brisk examples, the preferred Gemini 3.1 + v2 result omitted uppercase emphasis. Several
  losing candidates emphasized `QUICKLY` or `CLEAR` while also steering pace or delivery, producing
  an unnatural internal pause or overly fast delivery.
- Some bad pauses occurred without an explicit SSML break before the affected word. The likely
  source is provider response to overlapping emphasis and delivery controls, not a literal inserted
  pause.
- In the concerned-support example, the simple Gemini 3.1 + v1 plan had no warnings and won. A
  competing `[breath]` was perceived as a sigh, showing that a syntactically valid non-verbal can
  still contradict the scene.
- The neutral dialogue needed positive direction: Gemini 3.1 + v1 sounded flat, while Gemini 3.5 +
  v2 won. Removing expressive control indiscriminately would reproduce that failure.
- No listener reported spoken control text.

The private issue fixture was unavailable and was not run. No private learner text, raw provider
output, credentials, or environment dump may be added to the repository to fill that gap.

### Current implementation gap

The current system already provides important continuity foundations:

- one selected voice is retained per speaker;
- the planner receives the whole ordered study text and resolved voice assignments;
- dialogue audio is assembled with fixed 180 ms same-speaker and 320 ms speaker-switch gaps; and
- learner-visible words are immutable through the plan and rendering contracts.

It does not yet model performance continuity explicitly. Speaker `role`, `persona`, and
`voice_direction` help select a voice but are not carried into speech planning. The planner emits
independent per-segment cues, and Inworld synthesizes each segment independently without prior-turn
audio context. The existing `dialogueStability` behavior belongs to the ElevenLabs dialogue API and
does not solve Inworld continuity.

### Inworld guidance

This design follows, rather than rejects, Inworld's steering guidance:

- put one descriptive instruction tag at the start of an input;
- write the instruction in English, keep it punctuation-light, and avoid uppercase instruction text;
- combine compatible expressive dimensions in that one instruction and avoid conflicting requests;
- make the direction fit the spoken content;
- use uppercase spoken words when emphasis is genuinely required; and
- use SSML breaks only for deliberate pauses at precise locations.

Inworld's `BALANCED` delivery mode is the default, and SDK `speakingRate` supports deliberate values
from 0.5 through 1.5. The problem exposed by the evaluation is not richness within one coherent
instruction. It is duplicate ownership of the same acoustic dimension across free-form direction,
numeric speed, uppercase emphasis, pause markup, and a default delivery mode.

References:

- [Inworld steering](https://docs.inworld.ai/tts/capabilities/steering)
- [Inworld speech-generation best practices](https://docs.inworld.ai/tts/best-practices/generating-speech)
- [Inworld Node SDK](https://docs.inworld.ai/tts/node-sdk)

## Mode Routing and Scope

The existing authored setup contract remains stable:

| Authored strategy        | Resolved performance mode | Planner behavior                                        |
| ------------------------ | ------------------------- | ------------------------------------------------------- |
| `dialogue`               | `dialogue`                | Build scene and per-speaker continuity envelopes        |
| `tts`                    | `monologue`               | Build one through-line and one speaker envelope         |
| `auto`                   | `dialogue` or `monologue` | Resolve from study-text type and distinct speaker count |
| pronunciation main/chunk | not applicable            | Bypass speech planning completely                       |

The implementation documents `tts` as the existing public value whose study-text performance
semantics are monologue. It does not rename or migrate stored setup data.

`auto` must resolve deterministically from already-authored structure. Two or more distinct speakers
resolve to dialogue; a single speaker resolves to monologue. The exact decision is persisted in the
plan so rendering never guesses again.

Pronunciation practice remains deliberately outside this architecture. Its main line and optional
chunks require only isolated pronunciation rendering. They create no continuity envelope, make no
Gemini or Luna planner request, receive no steering direction from this feature, and incur no new
planner cost. Regression tests must prove this separation.

## Plan Contract

### Schema evolution

Introduce a backward-compatible `SpeechPerformancePlan` schema version 2. Existing schema-v1 plans
remain readable, renderable, and diagnosable without mutation. Prompt-policy v3 produces schema-v2
plans; schema version and prompt-policy version are separate concepts.

Conceptually, a schema-v2 plan contains:

```text
SpeechPerformancePlan v2
  resolvedPerformanceMode: dialogue | monologue
  performanceContext
    overallDirection
      components[] { dimension, direction }
      basis[] { source, reference }
    speakerEnvelopes[]
      speaker
      baselineDirection
        components[] { dimension, direction }
        basis[] { source, reference }
  segments[]
    existing immutable segment identity and words
    optional turnAdjustment
      components[] { dimension, direction }
      reason
      evidence
    sparse auxiliary controls
  existing source/provider/model/planner provenance and hashes
```

Names and exact serialization details may follow current `tts-core` conventions, but the semantic
contract above is required. Schema-v2 validation additionally requires:

- exactly one envelope for every speaker referenced by a segment;
- no envelope for an unknown speaker;
- a single-speaker envelope in monologue mode;
- ordered segment identity and words equal to the prepared study text;
- direction dimensions drawn from a bounded provider-neutral vocabulary;
- every overall or speaker basis reference resolving to supplied scene, profile, or segment input;
- a turn adjustment whose evidence references either an exact authored substring or a specific
  adjacent turn; and
- every string to satisfy the existing bounded safe-cue grammar.

Direction must remain structurally separable by acoustic dimension until rendering. A single opaque
planner string would force deterministic code to guess whether two phrases both control tempo,
emotion, or articulation. Dimension-labelled components let the validator apply explicit scope and
precedence while the provider renderer still emits one natural-language instruction.

### Decision-relevant planner input

The planner receives enough information to make grounded performance decisions:

- the full ordered study text;
- resolved dialogue or monologue mode;
- stable speaker identifiers and turn ownership;
- authored `role`, optional `persona`, and optional `voice_direction`;
- relevant scene, topic, and study-text context already available to the orchestrator;
- selected voice language and model-scoped capabilities;
- adjacent and following turns;
- the immutable spoken words; and
- the renderer's supported control vocabulary.

It must not receive irrelevant student memory, credentials, environment values, raw provider
catalog noise, or other data merely because it is nearby in the generation pipeline. Prompt and
debug logging continue to obey the existing privacy boundary.

### Dialogue envelopes

`overallDirection` describes the scene-level performance relationship: conversational energy,
formality, natural tempo, and how the participants should relate to each other. Its components are
concise prose, not invented acoustic telemetry. Its basis references the scene, topic, or authored
turns that justify the direction.

Each speaker envelope defines a stable baseline grounded in the authored speaker profile and that
speaker's turns. It preserves recognizable character across the dialogue without forcing identical
delivery. Because each Inworld segment is an independent request, the renderer repeats the same
speaker baseline for every turn by that speaker. The envelope basis identifies the profile fields
and speaker-owned turns that support the baseline; it does not duplicate raw input unnecessarily.

A segment may add a turn adjustment only when its words or an adjacent reply justify a meaningful
departure. The adjustment includes:

- a concise natural-language direction;
- a bounded reason; and
- an exact authored evidence substring or an adjacent-turn reference.

No evidence means no adjustment. Deterministic code verifies the provenance, segment relationship,
and control boundaries; it does not infer an emotion or assign a numeric personality value.

### Monologue envelopes

Monologue uses the same hierarchy instead of a separate clever system:

- one overall direction defines the through-line;
- one speaker baseline maintains character and natural tempo; and
- sparse, evidenced segment adjustments respond to real rhetorical transitions.

This permits natural development across a longer passage without letting every sentence become an
independent performance. The evidence rules and cue-ownership rules are identical to dialogue.

## Prompt Policy v3

`speech-performance-v3-contextual-continuity` is immutable once checked in. Its exact prompt text and
SHA-256 hash are persisted using the current policy provenance contract. Prior v1 and v2 prompt text
must not be rewritten.

Policy v3 instructs either supported planner to:

1. understand the whole scene or monologue before assigning controls;
2. produce the overall and speaker envelopes first;
3. inherit a speaker baseline by default;
4. add a turn adjustment only with authored evidence;
5. preserve every spoken word exactly; and
6. use sparse auxiliary controls under the ownership rules below.

The planner emits provider-neutral intent. It does not emit Inworld tags, SSML markup, SDK enums, or
provider-specific request objects.

## Acoustic-Dimension Ownership

Each effective acoustic dimension has one owner:

| Dimension                                | Owner                                           | Rule                                                                   |
| ---------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| emotion, intonation, articulation, style | combined baseline plus optional turn adjustment | Renderer emits one instruction tag                                     |
| deliberate non-natural speed             | numeric SDK `speakingRate`                      | Instruction must not restate speed when pace is present                |
| lexical emphasis                         | uppercase spoken words                          | Omit when numeric pace is present unless learner meaning requires both |
| deliberate silence                       | positive SSML break                             | Require a precise location and purpose                                 |
| non-verbal vocalization                  | bounded non-verbal control                      | Require direct contextual justification; at most one                   |
| stochastic delivery mode                 | non-default delivery mode                       | `BALANCED` is omitted as the provider default                          |

Compatible qualities can coexist inside the single instruction tag. That is one coherent steering
control, not several cues. Dimension labels are provider-neutral planning metadata and are never
spoken. During composition, the closest evidenced scope owns a dimension: a valid turn component
temporarily replaces the same speaker-baseline component, while unrelated baseline dimensions are
inherited. Scene components supply only dimensions that remain unowned at the closer scopes.
Redundant representations are rejected or canonicalized before rendering.

The renderer deterministically merges the scene, stable speaker baseline, and any evidenced turn
adjustment into exactly one punctuation-light Inworld instruction tag. It never stacks independent
baseline, emotion, intonation, and free-form tags. When numeric pace owns speed, the merge omits the
dimension-labelled tempo component instead of trying to edit arbitrary prose. When a turn does not
require a change, the instruction contains the applicable scene and speaker components only.

The existing 180 ms and 320 ms assembly gaps remain unchanged. They are deterministic audio-layout
policy, not planner expression controls, and current evidence does not support changing them.

## Canonicalization and Effective-Control Density

Candidate output is canonicalized before durable-plan validation. Canonicalization removes:

- empty optional values;
- zero-duration pauses;
- explicit `BALANCED` delivery mode;
- direction components shadowed by a closer evidenced scope;
- shadowed legacy emotion or intonation fields when the combined instruction already owns them; and
- a dimension-labelled tempo component when numeric `speakingRate` owns speed.

Canonicalization is a deterministic normalization step, not an opportunity to rewrite the model's
intent or mutate an old immutable prompt.

The current `high_cue_density` warning counts raw fields and therefore overstates effective load. It
can count emotion, intonation, and free-form direction even though rendering selects one direction;
it also counts zero pauses and the default `BALANCED` mode. The v3 analyzer instead counts what the
provider will actually receive:

- one combined rendered instruction;
- one non-natural numeric pace control;
- each uppercase emphasis phrase;
- each positive pause;
- one non-verbal control; and
- one non-default delivery mode.

It excludes envelope metadata, zero pauses, default `BALANCED`, shadowed fields, and multiple
compatible qualities inside one combined instruction.

Effective density remains a quality warning, not a production hard gate. Additional stable warning
codes cover:

- numeric pace combined with emphasis;
- repeated ownership of an acoustic dimension;
- a turn adjustment without valid evidence;
- an abrupt pace change across adjacent turns;
- excessive changes across one speaker's consecutive appearances; and
- a non-verbal without authored justification.

Hard validation remains limited to contractual failures: changed words, invalid provenance,
unknown or missing speakers/envelopes, unsafe markup, unsupported controls, invalid ordering, or
provider/model/source mismatch.

## Planner Provider Boundary

### Explicit provider selection

Add a speech-planner provider setting alongside the existing model setting:

```text
ESL_TTS_SPEECH_PLANNER_PROVIDER=google_ai_studio|openai
ESL_TTS_SPEECH_PLANNER_MODEL=<provider-supported-model>
```

The built-in production default remains Google AI Studio with `gemini-3.1-flash-lite`. Provider and
model are validated as a compatible pair. Allowlisting or testing Luna cannot silently reroute
production.

Both adapters feed one provider-neutral candidate parser, schema-v2 validator, canonicalizer,
analyzer, and Inworld renderer. Returned-model identity and token usage remain observable.

### Google adapter

The current Google structured-output execution, retries, timeout, quota accounting, and returned
model validation remain authoritative. Gemini 3.5 stays allowlisted but is not made the default.

### OpenAI adapter and Luna contender

The OpenAI planner adapter reuses the repository's Responses API contract and structured-generation
executor. The contender configuration is:

- model: `gpt-5.6-luna`;
- reasoning effort: `medium`;
- text verbosity: `low`;
- strict structured output;
- standard request mode; and
- no tools, persisted reasoning, or multi-turn API state.

The adapter reuses existing credential, timeout, retry, usage, returned-model, and budget machinery.
It does not create a second generic OpenAI client stack.

Official model documentation confirms Responses API, reasoning, and structured-output support:

- [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI latest-model guide](https://developers.openai.com/api/docs/guides/latest-model)

The 2026-07-30 public list price is $1 per million input tokens, $0.10 per million cached input
tokens, and $6 per million output tokens. That is inexpensive in absolute terms but roughly four
times the stored Gemini 3.1 input/output rates used by the current evaluation cost snapshot. Cost
and expected intelligence are hypotheses to test, not activation evidence.

### Budget separation

Google and OpenAI have separate current-day usage, request-rate, and spend preflights. Google quota
never authorizes OpenAI calls, and the existing 120-request Gemini evaluation allowance is not an
OpenAI allowance. Provider-specific accounting must fail closed before a live planner request.

## Privacy, Artifacts, and Diagnostics

Production diagnostics remain privacy-safe by default:

- normal logs contain stable policy/provider/model identifiers, hashes, counts, durations, usage,
  and issue codes;
- complete plans or raw model output appear only under the existing explicit local debug boundary;
- no credentials, environment dumps, or raw learner text enter normal logs; and
- manifests retain only the contractually required plan and provenance already needed for replay.

Manual comparison artifacts live only under ignored `tmp/` paths. The repository may record
non-private run identifiers, aggregate usage, selected candidate mappings, and listening conclusions,
but not private fixture contents or raw private learner text.

## Compatibility and Failure Behavior

- Schema-v1 plans continue to render exactly under their existing semantics.
- Existing v1 and v2 prompt policies remain immutable and available for historical replay and
  evaluation fixtures.
- Schema-v2 is additive; no manifest or DTO field disappears silently.
- A disabled, unavailable, over-budget, invalid, or incompatible planner retains the current
  explicit identity fallback behavior.
- A schema-v2 plan that fails envelope, evidence, text, or provider-boundary validation is never
  partially rendered.
- Provider selection is explicit and fail closed; it does not try the other provider implicitly.
- Pronunciation synthesis remains planner-free even when the study-text planner is enabled.

## Implementation and Validation Boundaries

Implementation is one coordinated batch because these surfaces share a contract:

1. schema-v2 types, parsing, hashing, compatibility, and focused failing tests;
2. mode resolution and decision-relevant context plumbing through the orchestrator;
3. immutable policy-v3 prompt and provider-neutral candidate conversion;
4. canonicalization, evidence validation, continuity warnings, and effective density;
5. one-tag Inworld rendering with cue ownership;
6. explicit Google/OpenAI planner adapters and Luna configuration;
7. pronunciation bypass regressions;
8. active runtime, environment, provider-policy, and package documentation; and
9. deterministic validation followed by bounded manual application-path trials.

Tests must cover at least:

- schema-v1 compatibility and schema-v2 round trips;
- dialogue and monologue mode resolution, including `auto`;
- complete and unique speaker envelopes;
- exact-word preservation and turn-evidence provenance;
- canonical removal of zero pauses and `BALANCED`;
- effective rather than raw density accounting;
- dimension-ownership conflicts and stable warning codes;
- one Inworld instruction tag per independently synthesized segment;
- tempo-component removal when numeric pace owns speed;
- no accidental emphasis/pause stacking;
- provider/model allowlist and default separation;
- OpenAI Responses envelope, strict schema, usage, retry, timeout, and budget behavior;
- explicit failure rather than cross-provider fallback; and
- zero planner construction or calls on pronunciation paths.

Validation follows current test routing: focused failures first, `test:check-routing` before canonical
unit execution, then affected package builds/typechecks and the broad pre-PR gate because the change
crosses runtime configuration, orchestrator, neutral contracts, and provider rendering. Selected
PostgreSQL/Redis lanes remain CI-owned unless the actual diff changes their routing requirements.

## Bounded Manual Acceptance

Do not extend the evaluation harness with a dialogue-coherence subsystem. After deterministic tests
pass, exercise the ordinary application path with:

- one representative alternating dialogue;
- one representative multi-segment monologue;
- Gemini 3.1 + policy v3 and Luna + policy v3;
- two generations per model and mode; and
- identical text, selected voices, Inworld model, renderer, and assembly policy.

This produces eight full study-text listening candidates and uses eight accounted planner calls.
The number of Inworld segment requests is the sum of the segments in those candidates, not eight.
Artifacts stay in ignored `tmp/` storage. Listening checks:

- each dialogue speaker remains recognizable across turns;
- turn delivery responds naturally to the adjacent speaker;
- variation is justified rather than random or flat;
- pace and pauses avoid the emphasis-related failures in the corrected evaluation;
- the monologue has a stable character and coherent through-line;
- non-verbals fit the authored situation; and
- no provider-control or instruction text is spoken.

Human results must be recorded as human judgments, never inferred from automated metrics. A small
mixed result retains Gemini 3.1 and the current production defaults.

## Rollout and Decision Gates

The implementation may land the new schema, policy, provider adapter, and opt-in configuration in
one backward-compatible `release:minor` change. Availability is not activation.

The final implementation step performs the matched manual trial before recommending a new default:

- If Luna clearly improves contextual coherence and naturalness without unacceptable latency,
  reliability, or cost, document the evidence and propose an explicit provider/default activation.
- If Gemini 3.1 remains better, keep it.
- If results are mixed, incomplete, or lack human judgment, keep Gemini 3.1 and the existing
  production defaults.

No merge, deployment, or production enablement is implied by this design. Deployment remains a
separate operator decision after PR validation and release evidence.

## Success Criteria

The design is successfully implemented when:

- dialogue and monologue plans carry grounded overall and speaker continuity envelopes;
- turns inherit stable character and vary only with explicit authored evidence;
- Inworld receives one coherent instruction plus only non-overlapping auxiliary controls;
- effective-density warnings describe rendered controls rather than raw planner fields;
- pronunciation remains unchanged and planner-free;
- Gemini and Luna use a shared neutral contract with separate fail-closed budgets;
- old plans and prompt policies remain replay-compatible;
- deterministic tests and current repo gates pass; and
- the bounded listening trial reports honest non-private evidence without silently changing the
  production default.
