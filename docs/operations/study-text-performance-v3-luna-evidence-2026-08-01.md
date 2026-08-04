# Study-Text Performance v3 Luna Evidence (2026-08-01)

## Meta

- Audience: founder-maintainer, backend/TTS maintainers, and reviewers.
- Authority Level: retained non-private live-trial evidence.
- Source Run: `20260801T133028792Z`.
- Status: automatic proof complete; blind human listening pending.

> Historical notice: this run validated Luna/provider execution for the discarded contextual
> envelope schema. It is retained as evidence of provider and ordinary-pipeline connectivity, but
> it does not validate the replacement contextual bracket-annotation contract or its audio quality.

## Decision Context

The founder selected disabled-by-default `openai` plus exact `gpt-5.6-luna` for the then-current
schema-v2 study-text performance design. This trial proved that the ordinary planner, validator,
orchestrator, Inworld renderer, and audio assembly path worked for Luna under that discarded
design. It is not a Gemini model comparison and does not claim human audio preference.

The organization opted into the OpenAI
[API input/output sharing program](https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai).
The operator supplied the current Tier 1 complimentary-token ceiling of 2.5 million daily tokens
for the shared Luna/Terra group. The trial used synthetic content only, retained the local $5 spend
stop, and recorded $0 current-day OpenAI cost at preflight. Offer eligibility remains external
operator state rather than an application entitlement.

## Fail-Closed Findings and Corrections

The live proof exposed four concrete harness/contract gaps before the successful run:

1. the ignored trial runner still forced a 2,400-token planner ceiling, truncating high-reasoning
   output even after repository defaults changed;
2. the response schema permitted free-form grounding prose instead of exact basis tokens;
3. complete plans could stack enough scene, speaker, and turn direction to exceed the renderer's
   200-code-point free-form limit; and
4. the trial runner compared top-level Inworld synthesis provenance with OpenAI planner provenance.

The retained correction uses a 12,000-token planner ceiling, exact context-derived basis enums, and
an effective-density budget derived from the renderer limit: at most two overall components, two
speaker-baseline components, one turn component, and 36 code points per component. Turn adjustments
default empty and are limited by prompt policy to half of each speaker's turns, rounded up. The
trial fails if `excessive_same_speaker_changes` is reported.

## Successful Automatic Evidence

Preflight accounted for four Luna planner calls, four complete Inworld audio candidates, and 36
Inworld segment requests. Conservative current-day inputs were 13 OpenAI requests, 168,132 tokens,
$0 spend, a 2.5 million-token ceiling, and a $5 spend ceiling.

| Candidate         | Plan        | Planner provenance        | Turn adjustments | Quality issues | Audio bytes |
| ----------------- | ----------- | ------------------------- | ---------------: | -------------: | ----------: |
| dialogue-luna-r1  | v2 prompted | `openai` / `gpt-5.6-luna` |                2 |              0 |     652,461 |
| dialogue-luna-r2  | v2 prompted | `openai` / `gpt-5.6-luna` |                1 |              0 |     645,549 |
| monologue-luna-r1 | v2 prompted | `openai` / `gpt-5.6-luna` |                3 |              0 |   1,322,925 |
| monologue-luna-r2 | v2 prompted | `openai` / `gpt-5.6-luna` |                5 |              0 |   1,324,845 |

All four manifests retained top-level `inworld` / `inworld-tts-2` synthesis provenance and nested
`openai` / `gpt-5.6-luna` planner provenance. Returned model identity was exact
`gpt-5.6-luna`. Every candidate had zero automatic quality issues and passed the same-speaker
turn-density refusal boundary.

The successful process exited zero after writing all artifacts. It then printed the separately
tracked `non-retryable streaming request` message. This trial does not claim that anomaly fixed;
artifact completeness and exit status show it did not invalidate this run.

## Local Artifacts and Remaining Evidence

Ignored local evidence is under:

```text
tmp/study-text-performance-v3-trial/runs/20260801T133028792Z/
```

Each candidate directory contains its complete manifest, audio, and `planner-events.json` with the
validated neutral plan. Blind audio is in `listening/index.html`; do not open `listening/key.json`
until ratings are recorded.

Automatic functionality is proven. Human listening remains required before making claims about
continuity, responsiveness, natural variation, pause/pace quality, monologue through-line, or
spoken-control leakage. Live audio, raw planner output, keys, and synthetic run artifacts remain
ignored and must not be committed.
