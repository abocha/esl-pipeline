# Changed-policy AssignmentV1 reevaluation (ESL-31)

## Meta

- Audience: maintainer and the agent executing ESL-31.
- Authority Level: task-specific evaluation procedure.
- Last Verified Against: 2026-10-06 fixed two-call evaluation after ESL-30 and its language-annotation follow-up.
- Owner: founder-maintainer.
- Review Cadence: when this fixed reevaluation changes or concludes.
- Status: `active`.

## Decision and boundary

After ESL-30, does the fixed sample support activating the repaired AssignmentV1 generation policy
for direct learner use without routine manual repair? This is a changed-policy gate, not another
full ESL-28 benchmark. The existing [ESL-28 conclusion](assignment-quality-evaluation.md) remains
CHANGE for v5. This new evaluation is **complete: CHANGE before activation**.

The user explicitly authorized the exact two-call experiment below in the same chat after offline
preparation. Both requests completed once on 2026-10-06. Earlier ESL-28 authorization was not reused.
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

These two commands were executed once, in this order, after explicit authorization. They are
historical execution evidence; do not rerun their completed attempts:

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

## Completed reevaluation outcome

**CHANGE:** the sample resolves the original instructional blockers, but a concrete practice-language
delivery mismatch still prevents recommending activation for direct learner use as-is. Both outputs
completed on `gpt-6.1-sol`, passed fresh v6 admission and emitted native renderer-3 learner HTML.
Exact provider output/transport fidelity, JSON and learner DOM were inspected. Desktop/mobile
handouts and separately opened answer disclosures were reviewed; no document horizontal overflow
was observed. Internal teacher rationale is absent from the whole DOM in both cases.

| Case                | Direct-send verdict                                      | Changed-risk evidence                                                                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `everyday-contrast` | NO for the complete artifact; teaching content is usable | Meaning-led cues preserve independent forms, continuous self-check scope is accurate, labels are economical and comprehension annotations are correct. Eight Russian-led practice cues and their answer-key copies are incorrectly tagged English.                            |
| `beginner-support`  | YES                                                      | Russian scaffolding remains useful; routine/past/agreement retrieval and keyword retelling are coherent; self-checks are scoped; labels remain separate from patterns/examples; Russian comprehension and English target/practice content receive their expected annotations. |

The blocking residual E31-01 is located at `practice[0].items[0..5].prompt` and
`practice[1].items[0..1].prompt` in everyday-contrast. These contain Russian situation/direction text
with English word cues or English error-repair excerpts. `PracticeParts` still puts the live list
under `lang="en"`, and its `Answers` call uses the default English prompt annotation. All eight cue
copies therefore have the same mismatch. Comprehension uses its repaired support-language path and
is correct; target-English answers remain English. This is established from native DOM annotations,
not from a simulated screen-reader or a conjecture based on appearance.

Classification: a generation-policy/rendering language-boundary mismatch exposed by the changed
cue behavior. It is an adjacent regression relevant to direct-send delivery, not evidence of a
schema limitation or a need to redesign rendering. One sample does not establish model variance.

The smallest repair is to clarify the existing field convention: `practice[].items[].prompt` must
be entirely English, including its situation/direction text, while Russian scaffolding belongs in
`practice[].instructions` and explanations. Preserve simple context and bare lexical cues without
supplying the tested form. This fits current English practice rendering without new fields,
translation or a localization framework. Simply marking a mixed Russian/English prompt wholly
Russian would instead mislabel the embedded English skill text. No repair was implemented during
this evaluation and no preserved output was modified.

Original cue/self-check defects did not recur. Form labels in both cases identify their roles
briefly, and useful patterns/examples remain in dedicated fields. All six comprehension questions
and their answer-key copies are Russian in the DOM; the two non-null comprehension explanations
are Russian, and all comprehension answers are English. No obvious teaching progression, mission
or rationale-audience regression was found. The full-cue review distinguishes deliberate error
correction from independent form selection; a faulty form shown for repair is legitimate task
material. Counts are reported to locate affected artifacts, not used as quality proxies.

| Case                | Input tokens | Output tokens | Total tokens | Cached input | Reasoning output |
| ------------------- | -----------: | ------------: | -----------: | -----------: | ---------------: |
| `everyday-contrast` |       26,926 |         4,329 |       31,255 |            0 |              283 |
| `beginner-support`  |       22,423 |         3,623 |       26,046 |        5,872 |              516 |
| Total               |       49,349 |         7,952 |       57,301 |        5,872 |              799 |

Cached and reasoning tokens are subsets, not additional usage. Exact response IDs, raw provider
responses, admitted assignments, learner HTML, native DOM audit, screenshots and seven-row case
assessments remain private under `.tmp/esl-31/`. All 82 ESL-28 evidence files remain unchanged.
Exactly two calls were made, with no retry, extra case, paid evaluator, TTS, activation or deployment.
The fixed evidence is sufficient for this concrete CHANGE decision; no additional paid evidence is
justified merely to strengthen confidence. This conclusion concerns the sampled direct-send gate,
not universal reliability or learner outcomes.

## Bounded E31-01 repair and offline validation

The subsequently authorized local repair makes `practice[].items[].prompt` entirely English,
including situation/direction text, bare lexical cues and error-repair excerpts. Support-language
practice directions belong in `practice[].instructions` and useful support-language explanations
in `practice[].items[].explanation`. Simple English context must preserve the learner's grammatical
decision rather than supplying the tested form. The shipped template and fresh-package policy
checks name these exact fields.

Generation schema name and first-line marker advance together to `assignment_v1_generation_v7`.
AssignmentV1 schema/serialization 1, renderer publication identity 3, renderer implementation and
stored assignments remain unchanged. Old v6 package pins, mismatched marker/schema pins and old
active templates continue to fail before provider dispatch or fresh-package storage.

Focused offline evidence: contracts and learner-handout builds passed; five backend test files
passed (87 tests), covering shipped policy in a fresh package, old-package/template rejection and
adjacent mission/grammar/package behavior. The publication-adapter file passed (20 tests), including
a synthetic fresh Russian-support assignment in preview and publication: Russian part instructions,
practice explanations and comprehension questions/copies/explanations, with entirely English
practice prompts/copies and English target answers. These are mocked/synthetic checks, not newly
generated quality evidence or observed model adherence to v7.

The completed v6 evaluation, its CHANGE decision and private evidence remain unchanged. No paid
call, retry, extra case, activation or deployment is part of this repair. Hosted CI remains unverified.
