# Changed-policy AssignmentV1 reevaluation (ESL-31)

## Meta

- Audience: maintainer and the agent executing ESL-31.
- Authority Level: task-specific evaluation procedure.
- Last Verified Against: 2026-10-06 offline preparation after ESL-30 and its language-annotation follow-up.
- Owner: founder-maintainer.
- Review Cadence: when this fixed reevaluation changes or concludes.
- Status: `active`.

## Decision and boundary

After ESL-30, does the fixed sample support activating the repaired AssignmentV1 generation policy
for direct learner use without routine manual repair? This is a changed-policy gate, not another
full ESL-28 benchmark. The existing [ESL-28 conclusion](assignment-quality-evaluation.md) remains
CHANGE for v5. This new evaluation is **prepared offline; quality assessment is pending**.

No provider request has been made for ESL-31. Explicit human authorization for the exact two-call
experiment below must precede execution. Earlier ESL-28 authorization does not authorize ESL-31.
No retries, extra cases, paid evaluators, TTS, template activation, publication or deployment.
Production activation belongs to ESL-29 and needs separate authorization.

## Minimum fixed cases

| Case                | Why necessary; activation decision this call can change                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `everyday-contrast` | The same real A2 habits/temporary-situations source exposed both blocking instructional defects; this call can block activation on tested-form leakage or an inaccurate self-check, with surrounding contrast, progression and mission quality inspected. |
| `beginner-support`  | The same real A2 source has explicit Russian tutor guidance; this call can block activation on unusable beginner scaffolding, wrong comprehension-language annotations or repeated pattern/example text in grammar labels.                                |

Execute everyday-contrast first, beginner-support second, each exactly once. Technical-transfer is
excluded: it adds no distinct changed-policy decision beyond these two cases. Do not expand the
set after seeing outputs. No vocabulary, exercise, object count or old-homework similarity is a
quality proxy.

## Frozen identity and parity

The ignored private root is `.tmp/esl-31/`, identity `esl-31-v1`. All 82 existing files under
`.tmp/esl-28/` were hash-checked unchanged during preparation. No previous attempt is copied or
reused. The retained real sources are available locally; no production/log retrieval is needed.

- Policy source: ESL-30 commit `6c07c513a97d44ca00a4fa0ff44cb301aeb0efe4`, plus the committed language
  repair `28c5b63cff344a8ba708ff2a52ea1cadc622db70` on the same branch. The latter preserves English
  questions under Russian support metadata and is included in the renderer freeze.
- Each case's eight source blocks, tutor guidance, learner/profile/memory evidence, transcript,
  original input items, assembled input and trusted validation context match ESL-28 byte-for-byte.
  Nothing depends on the current DB or ambient learner context.
- Template: `hw_prompt_assignment_v1.md`; raw SHA-256
  `0f8c7642bc62351bc3e5220265889209f0bf0b90ddcc9ce93cdd89896386b5e0`;
  normalized instruction SHA-256
  `0c5a52a80bc981d2a86d1701bd2143b373aed48dd805d54ffb581f6272427ec2`.
- Full strict response-schema identity: `assignment_v1_generation_v6`, object SHA-256
  `d1a564043269e99f914b1c695d5395b298dc986c25b97c0da56cffd97cd15973`.
  AssignmentV1 schema/serialization remain 1; prompt compatibility is `3.0.0`, envelope read-format
  is `assignment_v1`. This is a local frozen envelope, not an activated production revision.
- `lock.json` hashes source/contracts/helper/dependency lock, both renderer source and built files,
  the renderer copy actually imported by html-publisher, and every exact input/request file.
  The freshly built handout files match that imported copy. Renderer publication version stays 3.
- Freeze SHA-256 (`lock.sha256`):
  `7b40a59cdd38c4e76cd8b9d16ac224934af9788fff2dd6290c6f94f55dde0069`.
- Private `preflight.json` records parity: the only request changes from ESL-28 are instruction
  text and the response-schema name. Model/settings and schema shape remain constant.

The existing helper refuses code/build, template, schema, input, request or settings drift.
Support/docs-only commits do not invalidate a freeze when its effective bytes remain unchanged.
Do not silently re-freeze. Committed support alone cannot reproduce the private learner inputs.

## Model and exact allocation

**Two OpenAI Responses requests total**, one per fixed case. Preserve ESL-28 settings:

- Model `gpt-6.1-sol`; reasoning `medium`; text verbosity `medium`.
- Strict JSON schema; `max_output_tokens: 12000`, `stream: false`, `store: true`.
- Endpoint `https://api.openai.com/v1/responses`; timeout 240 seconds; retries 0.
- No tools, previous response, conversation, sampling override, service-tier override or background
  override. Omitted provider settings retain provider defaults; responses preserve returned values.
- Reuse the previously authorized repository `.env` credential, only after new live-call
  authorization. It is neither printed nor saved in evidence. No ambient setting overrides.

Exclusive attempt-file creation precedes dispatch. Unknown prior usage, uncertain dispatch,
incomplete/provider-contract failure, model drift or renderer failure stops subsequent calls.
Retain failure evidence and report the specific uncertainty; do not retry. A completed response
with invalid authored AssignmentV1 is assessed as a defect, without repair or regeneration.

## Prepared commands and offline evidence

Run from the repository root. The original helper is reused with an explicit fixed ESL-31 selector;
its default ESL-28 root and historical records remain separate. Preparation has already executed:

```powershell
pnpm --filter @esl-pipeline/contracts build
pnpm --filter @esl-pipeline/learner-handout build
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts prepare .tmp/esl-31-source-index.json --evaluation=ESL-31
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts verify --evaluation=ESL-31
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json --import ./.tmp/esl-31-offline.mjs scripts/evaluation/assignment-quality.ts smoke --evaluation=ESL-31
```

The private offline preload rejects provider fetches. Synthetic artifacts live separately under
`plumbing-only/`; they are not generated quality evidence. Smoke verifies capture/admission,
native HTML, Russian and English comprehension questions/copies under Russian support metadata,
Russian explanations, English target answers/text/practice, teacher exclusion, partial-output
retention, missing/wrong authorization rejection, third-case rejection and no-repeat guards.
Helper typechecking and Biome checks pass. No broader invariant suite or paid evaluation was run.

These commands are **prepared, not authorized or executed**:

```powershell
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts run everyday-contrast --evaluation=ESL-31 --live --authorize=ESL-31
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts run beginner-support --evaluation=ESL-31 --live --authorize=ESL-31
```

Flags record human authorization; they do not constitute it. Stop if the first call creates a
technical uncertainty. Local `capture <case> --evaluation=ESL-31` can reuse a preserved response
without dispatch, checking raw/parsed transport fidelity first.

## Evidence, assessment and closure

Each case preserves provenance, exact sources/input items, envelope, validation context, request,
exclusive attempt ledger, raw HTTP response, parsed response, output text, usage/transport details,
admitted AssignmentV1 JSON, native learner HTML, validation/hashes and a concise assessment.
Inspect actual JSON and directly emitted HTML at desktop/mobile with answers closed, then opened.
Record located defects and their learner consequence, severity, owning surface and smallest repair.

Assess seven focused rows: cue integrity; accurate construction-scoped self-checks; short labels
with separate patterns/examples; correct support/target annotations; surrounding scaffolding,
contrast, progression and mission usability; learner/teacher audience separation; direct-send
usability. Additional ESL-28 dimensions matter only if a concrete regression makes them relevant.

Record each direct-send verdict YES / NO / UNASSESSABLE, then one overall decision:

- **KEEP:** the repaired sample is directly sendable with no blocking changed-risk defect.
- **CHANGE:** a concrete instructional or owning-surface defect still needs repair before activation.
- **DEFER:** a specific execution/evidence problem prevents the activation decision.

Do not average away one blocking defect. Do not infer model variance from one sample or reopen a
contract without a demonstrated limitation. Stop once the fixed evidence supports a decision.
Token accounting must include per-case input/output/total and cached/reasoning tokens when returned.
Private `decision.md` preserves exact evidence; commit only privacy-safe support/conclusions.
