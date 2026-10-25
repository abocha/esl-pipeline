# AssignmentV1 quality evaluation method

## Meta

- Audience: maintainers and authorized evaluators.
- Authority Level: reusable evaluation procedure.
- Source Review: 2026-10-13; live provider and deployment state not checked.
- Owner: founder-maintainer.
- Status: `active`.

## Purpose and authorization

Use this method to assess whether a fixed, source-bound AssignmentV1 sample is suitable for direct
learner use under a named generation policy. Dated outcomes are immutable evidence, not a current
quality guarantee. The completed [ESL-28 evaluation](../archive/operations/assignment-quality-evaluation-esl-28.md)
and [ESL-31 reevaluation](../archive/operations/assignment-quality-reevaluation-esl-31.md)
record their own samples, outcomes and limits.

Offline preparation, verification and synthetic smoke checks do not authorize provider calls.
Before any paid/live request, obtain explicit human authorization for the exact evaluation, cases,
model/configuration and total request allocation. A CLI `--authorize` flag records a boundary; it is
not authorization by itself. Use no automatic retries. Persist an exclusive attempt record before
dispatch; uncertain dispatch, missing usage, incomplete response or provider/model drift stops the
run. Do not rerun attempted cases or expand the sample without a new decision and authorization.
Activation, publication, deployment and production changes have separate authorization boundaries.

## Fixed-sample method

1. State the learner-facing decision the sample can change, its fixed source cases, policy identity,
   sample limits and exact allocation. Exclude cases that add no distinct decision.
2. Freeze source items, trusted learner context, request, schema, template, helper, dependencies and
   renderer identities. Verify the freeze before dispatch; stop on effective-input drift.
3. Keep synthetic plumbing checks separate from real learner-quality evidence. They may exercise
   fresh admission, rendering and refusal boundaries but cannot establish learner quality.
4. Preserve privacy-safe provenance, exact request/response and usage metadata, admitted output,
   emitted learner HTML, hashes and a located assessment. Keep learner contexts, raw responses and
   learner artifacts in ignored private storage.
5. Inspect every assignment and emitted HTML at desktop and mobile widths, with answer disclosure
   closed first and answers inspected separately. Do not infer audio quality from authored text.
6. Assess each case with PASS, REPAIR or justified N/A across support/target language, scaffolding,
   grammar, vocabulary, practice progression, pronunciation, mission clarity, self-checks, rationale
   audience, answer leakage, repetition and direct-send usability.
7. Record each defect's location, learner consequence, smallest repair and severity. Distinguish
   prompt/policy, model variance, missing context, schema/contract, renderer and legitimate variation.
   One sample cannot establish model variance; counts and output length are not quality proxies.
8. Decide KEEP only when the fixed sample supports direct sending without routine repair; CHANGE
   for a concrete blocking defect; or DEFER when named evidence is missing or invalid. State the
   sample's limits and keep activation a separate decision.

See the archived evaluations for detailed historical rubrics and examples. Their outcomes and
attempt records must not be edited or replayed. The current
[`assignment-quality.ts` helper](../../scripts/evaluation/assignment-quality.ts) only supports the
fixed ESL-28 and ESL-31 identities and their locked cases; both are complete. This reusable rubric
does not make that helper a generic live-evaluation CLI. A future evaluation needs its own named
decision, explicit authorization, fixed inputs/allocation and approved execution/tooling work before
any provider call.
