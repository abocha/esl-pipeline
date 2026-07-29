# Speech-Planner Live Evaluation Evidence (2026-07-29)

## Meta

- Audience: maintainers deciding how to repair or extend the speech-planner evaluation program.
- Read Time: 7 minutes.
- Authority Level: dated evaluation evidence.
- Last Verified Against: 2026-07-29 repo state at `8a752a314e97d4b4e49dee8568e13f96ba28a885`.
- Owner: backend and TTS maintainers.
- Review Cadence: immutable historical record; supersede with a new dated run rather than rewriting results.
- Status: `evidence`.

## Decision Summary

The first complete public live baseline does **not** justify changing the production planner default.
Keep `gemini-3.1-flash-lite`, the current prompt policy, and current TTS defaults until the harness
fidelity gap is repaired and the corrected matrix plus required listening evidence are complete.

Within the production prompt-policy cell, `gemini-3.5-flash-lite` was faster and more reliable than
3.1 in this bounded sample. However, the aggregate hard gate was red because the live matrix sent an
identity-only Inworld TTS 1.5 fixture through the remote planner. Production does not do that:
`resolveSpeechPerformancePlan()` short-circuits models whose descriptor declares
`planningMode: 'identity'`. The TTS 1.5 failures therefore identify a harness-to-production fidelity
gap, not evidence that production sends those controls to TTS 1.5.

`gpt-5.6-luna` is a later contender. It should enter a provider-neutral comparison only after the
Gemini harness has production-equivalent routing, trustworthy hard gates, and explicit usage/cost
semantics.

## Run Provenance

| Field                        | Recorded value                                                           |
| ---------------------------- | ------------------------------------------------------------------------ |
| Run ID                       | `20260729T102633980Z-baseline`                                           |
| Mode and status              | `live`, `completed`                                                      |
| Source revision              | `8a752a314e97d4b4e49dee8568e13f96ba28a885` (`v10.4.0`)                   |
| Activity window              | 2026-07-29 10:26:33.987Z to 10:55:40.290Z                                |
| Public matrix                | 10 synthetic fixtures x 2 models x 2 prompt policies x 3 repetitions     |
| Attempts/provider calls      | 120/120                                                                  |
| Inworld synthesis calls      | 0                                                                        |
| Postgres constructions/calls | 0                                                                        |
| Local artifact directory     | `tmp/speech-planner-eval/20260729T102633980Z-baseline/` (ignored by Git) |

The exact stable models were `gemini-3.1-flash-lite` and `gemini-3.5-flash-lite`. The prompt policies
were `speech-performance-v1-restrained-natural` and the production pairing
`speech-performance-v2-inworld-tts2`.

The live run used a process-local allowlist override; it did not deploy or change production
configuration. Google AI Studio showed Tier 2 project quotas of 350,000 requests/day for each Flash
Lite model and zero current-day usage before the run. The harness intentionally retained its own
120-request daily ceiling and 4 RPM throttle. Months of earlier 3.1 production use are not
current-day requests and the newly merged 3.5 support had not been deployed or exercised in
production.

## Aggregate Results

| Metric                                         |            Result |
| ---------------------------------------------- | ----------------: |
| Raw parse rate                                 |            99.17% |
| Valid prompted-plan rate                       |            98.33% |
| Identity fallback rate                         |             1.67% |
| Hard-failure count                             |                18 |
| Median / p95 latency                           | 1127 ms / 1675 ms |
| Compatibility successes / failures / skips     |         1 / 0 / 0 |
| Returned-model reported / missing / mismatched |       119 / 1 / 0 |
| Output-token reports                           |        119 of 120 |
| Thinking-token reports                         |          0 of 120 |
| Redundant-instruction warnings                 |                97 |
| High-cue-density warnings                      |                61 |

The aggregate hard gate failed with:

- 2 schema-invalid attempts;
- 17 unsupported-control findings;
- 11 attempts classified as TTS 1.5 steering leakage; and
- 1 provider failure.

Authored-word preservation, instruction-tag limits, planner caps, model compatibility, and
returned-model identity had no failures.

## Cell Results

| Planner / prompt |  Valid | Fallback |     Median / p95 | Hard failures | Important observations                                                                          |
| ---------------- | -----: | -------: | ---------------: | ------------: | ----------------------------------------------------------------------------------------------- |
| Gemini 3.1 / v1  |   100% |       0% |   1154 / 1675 ms |             2 | Both hard failures came from the TTS 1.5 identity fixture.                                      |
| Gemini 3.5 / v1  |   100% |       0% | 1274.5 / 1553 ms |             6 | All hard failures came from the TTS 1.5 identity fixture; cue density was highest in this cell. |
| Gemini 3.1 / v2  | 93.33% |    6.67% |   1179 / 1734 ms |             7 | One transient `UNAVAILABLE`, one `unsafe_cue_text` rejection, and TTS 1.5 fixture failures.     |
| Gemini 3.5 / v2  |   100% |       0% |   1024 / 1243 ms |             3 | All three hard failures came from the TTS 1.5 identity fixture.                                 |

For the current v2 policy, the comparison signal favors 3.5: it had 100% versus 93.33% valid plans,
zero versus 6.67% identity fallback, and lower median and p95 latency. After excluding the
production-inapplicable identity fixture, the 3.5/v2 cell had no observed hard failure. That is a
promising signal, not a default-change decision: the corrected harness must reproduce it before
audio selection and human review.

## Failure Attribution

### Harness fidelity

Every `unsupported_delivery_mode` and `unsupported_metadata_instruction` finding was associated
with the synthetic `tts-1-5-protection` fixture. The live evaluator called the planner for that
fixture even though `inworld-tts-1.5-max` is an identity model. Production instead creates an
identity plan before remote planning. The future harness must preserve the safety assertion while
testing it through the production planning-mode boundary with zero planner calls.

### Gemini 3.1 / v2 anomalies

- `concerned-support`, repetition 1: provider category `UNAVAILABLE`; no returned model or output
  token record.
- `warm-laugh`, repetition 1: parsed output was rejected as `unsafe_cue_text` and correctly fell
  back to identity. Its `intonation` value was 84 code points against the 80-code-point limit; the
  current candidate diagnostic collapses that length violation into generic `unsafe_cue_text`.
  Retain the synthetic raw output as a regression fixture and improve classification without
  weakening the cap or markup defenses.

### Cost accounting

Google returned input and visible candidate token counts but omitted `thoughtsTokenCount` in all
120 responses. The evaluator correctly reported cost as unavailable rather than silently treating
an absent field as zero. A future change may infer zero only if the official provider contract and
captured response relationships prove that inference. Otherwise reports must continue to disclose
the missing component or present a clearly labeled bound instead of an exact cost.

### Warning usefulness

`redundant_instruction_components` appeared 97 times and `high_cue_density` 61 times. Those rates
are too high to treat as isolated model defects. The next investigation must determine whether the
prompt encourages overlapping cues, whether the warning definitions double-count semantically
equivalent controls, or both.

## Evidence Gaps and Closeout State

- Selected audio was intentionally not generated because the recorded aggregate hard gates were
  red.
- No blind human listening judgment exists; none is claimed.
- `Original issue fixture unavailable; record that limitation before closeout.`
- The local raw run remains ignored under `tmp/`; this committed record contains only synthetic,
  non-secret summary evidence.
- Issue #154 must remain open until corrected automatic gates, selected-audio listening, the private
  fixture limitation or result, merge/release/deploy evidence, and the final default decision are
  all recorded.

## Follow-up

Execute the staged remediation in
[`../plans/2026-07-29-speech-planner-evaluation-gap-remediation.md`](../plans/2026-07-29-speech-planner-evaluation-gap-remediation.md).
