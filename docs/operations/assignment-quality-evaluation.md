# Bounded native AssignmentV1 quality evaluation (ESL-28)

## Meta

- Audience: maintainer and the agent executing ESL-28.
- Authority Level: task-specific evaluation procedure.
- Last Verified Against: 2026-10-06 fixed three-call evaluation of ESL-27 commit `5daaf6b2c310856e6c2eb09c425939d38b36f8d8`.
- Owner: founder-maintainer.
- Review Cadence: when this fixed evaluation changes or concludes.
- Status: `active`.

## Decision and boundary

Would a tutor reasonably send the current native AssignmentV1 assignment as-is, without routine
manual repair? Assess the current shipped v5 teaching policy and native learner HTML. Historical
Markdown output is not the quality target. This procedure does not activate templates, deploy,
publish, generate audio, change contracts, or process historical assignments.

**Evaluation is complete: CHANGE before activation.** The user authorized the paid calls in the
same chat, and all three fixed requests completed once on 2026-10-06. The everyday-contrast output
requires instructional repair. See the outcome below and the private `.tmp/esl-28/decision.md` for
exact response IDs, artifact locations and full case assessments. No additional call is authorized
or needed for this decision.

Explicit human authorization must precede live execution. CLI flags record that boundary; they do
not themselves constitute human authorization. The fixed allocation was three generation requests,
one per case, with no automatic retry or paid evaluator.

The separately frozen [ESL-31 changed-policy reevaluation](assignment-quality-reevaluation.md)
prepares two of these real contexts under v6 after ESL-30. It has a separate root and authorization;
this completed v5 experiment and its attempt records remain unchanged.

## Fixed real cases

The complete preserved source-data inputs already available locally cover these distinct decisions:

| Case ID              | Supplied teaching condition                                                                                                                               | Decision this case can change                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `beginner-support`   | A2 training/body context; explicit current Russian instructional guidance; third-person present/past agreement; chunks and keyword retelling              | Does beginner scaffolding remain usable, with Russian support separated from English targets and a controlled-to-independent progression?              |
| `everyday-contrast`  | A2 habits versus temporary routines; independent auxiliary selection; vocabulary activation; risk of over-scripting; no current tutor note                | Do structured forms and paired comparisons teach meaningful choices, and do the full cues and adjacent examples preserve independent retrieval?        |
| `technical-transfer` | B1+ technical reading; simple/continuous aspect and cautious inference; unfamiliar vocabulary; workload constraints and weak independent drill completion | Can dense context yield useful vocabulary/practice and restrained pronunciation without turning the historical issue backlog into compulsory homework? |

Three cases separate explicit beginner language guidance, everyday meaning/auxiliary contrast, and
technical comprehension/workload demands. Do not add cases after inspecting outputs. Pronunciation
may be included or omitted in any case; justify the choice from supplied evidence. A transcript is
not an acoustic diagnosis. Check grammatical accuracy independently even when source teaching
contains an oversimplification.

The real learner mapping, original response IDs/models/timestamps, tutor notes, profiles, memory,
transcripts, and all exact source strings remain private. The retained source requests used
GPT-6.1 Sol or GPT-5.6 Sol. Their outputs are not regenerated, rendered, converted, or used as quality
baselines. No production extraction or fresh provider-log retrieval was necessary.

## Frozen identities and settings

Private root: repository `.tmp/esl-28/` (ignored by Git). Preserve this directory for continuation;
a checkout of committed helper/docs alone cannot reproduce the private inputs.

- Input source: the preserved input items, reproduced **byte-for-byte** by current
  `stitchPromptEnvelope`; all eight source blocks are frozen, including unavailable/no-note values.
  No current database lookup or ambient learner/profile retrieval occurs.
- Template: shipped `hw_prompt_assignment_v1.md` at ESL-27, raw-file SHA-256
  `79a7a8d774cab3295157492f9f58bcd47436dd0ea8cdd247168dbd489de9972e`.
  The assembler uses LF-normalized, trimmed instructions; normalized-template SHA-256
  `380709110a30737352b317de0917520384bdd34638f3c3f32a4f233ab4ef218d` is recorded separately.
- Response schema: strict `assignment_v1_generation_v5`, full schema-object SHA-256
  `51fad46acf1d22251fcd8411a116293f90a6fee3299a3bacb92667896ab76913`.
- Prompt package: a local evaluation envelope, `promptVersion: assignment_v1`, prompt compatibility
  `3.0.0`. Each envelope, validation context and final request has its own hash. This evaluates the
  shipped candidate template without selecting or creating an active production DB revision/package.
- Model: **`gpt-6.1-sol` for every case**, medium reasoning, medium text verbosity, strict JSON schema,
  `max_output_tokens: 12000` (including reasoning), `stream: false`, `store: true`.
- Provider endpoint: `https://api.openai.com/v1/responses`; client timeout 240 seconds; zero retries.
  No tools, previous response, conversation, sampling override, service-tier override, or background
  execution is supplied. These omitted fields use provider defaults; exact provider responses retain
  returned settings and model identity. Server-side model variance remains an evaluation limitation.
- Credential: only `OPENAI_API_KEY` parsed from repository `.env`, without printing or persisting it.
  No ambient model, endpoint, or generation-setting overrides are loaded.
- Source/code/renderer identity: `lock.json` pins the relevant helper, assembly/admission/contracts,
  dependency lock and renderer source/build bytes, including the renderer copy actually imported.
  `lock.sha256` identifies this particular freeze:
  `5f46b8891b4544868f484cd110808ee4a3e102ddef932fda5aee61f8a27a9e0a`.

`verify` refuses input, request, schema, template, helper, dependency-lock, or renderer drift. A later
commit containing only these prepared support files/docs does not invalidate the freeze. If an
effective input changes, stop and explain which decision requires a new freeze; never silently
replace it. This is a standalone evaluation, not production generation/queue execution; usage is
recorded locally and does not mutate production quota counters.

## Commands

Run from the repository root. Existing workspace dependencies are sufficient; no new framework is
installed. Rebuild these package prerequisites before the initial freeze:

```powershell
pnpm --filter @esl-pipeline/contracts build
pnpm --filter @esl-pipeline/learner-handout build
```

The initial preparation command has already run and refuses an existing evaluation directory:

```powershell
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts prepare .tmp/esl-28-source-index.json
```

Offline commands read no credentials and make no network requests:

```powershell
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts verify
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts smoke
```

The smoke uses an existing synthetic grammar fixture with explicit support-language metadata and a
teacher-only sentinel. Its `plumbing-only/` outputs validate fresh admission, HTML capture, language
annotations, teacher exclusion, incomplete-response rejection/raw retention, missing-authorization
refusal, duplicate-dispatch refusal, uncertain-dispatch refusal and unknown-usage refusal. They are
**not learner-quality evidence** and remain separate from the three real cases.

The following three commands were executed once, sequentially, after explicit authorization.
They document the exact execution path; do not rerun attempted cases:

```powershell
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts run beginner-support --live --authorize=ESL-28
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts run everyday-contrast --live --authorize=ESL-28
pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json scripts/evaluation/assignment-quality.ts run technical-transfer --live --authorize=ESL-28
```

Exclusive `attempt.json` creation occurs before dispatch. An attempted case cannot be dispatched
again. HTTP failure, timeout, missing usage or returned-model drift stops subsequent calls; retain
the evidence and resolve that specific uncertainty without an automatic retry. Completed responses
with known usage but invalid assignments remain defects in the fixed sample, not reasons to repair
or regenerate. A failed admission has no learner HTML; record the absence explicitly.

If only local capture needs repeating, `capture <case-id>` reuses that case's saved `response.json`
without a network call. It never edits the provider response or the hand-written assessment.

## Evidence and rubric

For every real case, `cases/<case-id>/` preserves:

- `provenance.json`, exact `input-items.json`, `input.txt`, eight-block `sources.json`, frozen
  `envelope.json`, trusted `context.json`, and complete `request.json`;
- `attempt.json`, exact HTTP `response.raw.json`, parsed raw-provider `response.json`, selected
  transport metadata and provider IDs/usage (including cached/reasoning tokens);
- `output.raw.txt`, admitted pretty-printed `assignment.json`, native `learner.html` and
  `validation.json` with canonical assignment and HTML hashes;
- `assessment.md` with concise evidence per rubric criterion and concrete located defects.

Inspect **every** assignment and the directly emitted HTML at desktop and mobile widths. Read
learner-facing content with the answer disclosure closed, then inspect the answers separately.
Audio is intentionally unavailable; this judges authored pronunciation and visible handout usability,
not synthesized audio quality or production delivery. No upload or published URL is required.

Use the same PASS / REPAIR / justified N/A assessment for all cases:

| Criterion                       | What the assessment must establish                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Instruction/support language    | Selection follows supplied tutor/profile/learner evidence; instructions are correct and understandable. |
| Support versus target English   | Support explanations/glosses do not replace or duplicate the English skill being practised.             |
| Scaffolding                     | The learner can start and progress independently without routinely needing tutor clarification.         |
| Grammar and contrasts           | Forms are accurate and independently useful; paired alternatives explain a real meaning/use choice.     |
| Vocabulary/chunks               | Items help comprehension, practice or the mission; lexical retrieval is taught rather than assumed.     |
| Controlled-practice progression | Practice tests taught decisions and leads toward independent production.                                |
| Pronunciation                   | Inclusion or omission is defensible, useful and restrained; no invented acoustic diagnosis.             |
| Mission scanability             | Core task and supporting preparation, requirements and delivery are easy to locate and follow.          |
| Self-checks                     | The learner can act on the checks; they address meaningful likely errors.                               |
| Learner rationale               | Direct practical learner benefit, without internal teacher diagnosis or policy exposition.              |
| Teacher audience separation     | Teacher reasoning stays in JSON and is absent from the whole learner document.                          |
| Answer leakage                  | Full cues, headings, labels, nearby examples and sample placement do not give away the tested decision. |
| Repetition/filler               | Each part earns its place; no backlog dumping, redundant explanation or schema-filling padding.         |
| Direct-send usability           | Would a tutor send this as-is? Record YES / NO / UNASSESSABLE and the necessary repair, if any.         |

Direct-send judgment controls the outcome; do not average away a blocking defect. No vocabulary,
exercise or grammar-object count, output length, or old-homework similarity is a quality proxy.
Record each defect's artifact location, learner consequence, smallest repair and blocking/minor
severity. Classify it as prompt/policy, suspected model variance, missing context, schema/contract
limitation, renderer issue, or legitimate pedagogical variation. One sample cannot establish model
variance. Reopen contract work only for a demonstrated concrete limitation.

Complete private `decision.md` with the case verdicts and exact evidence:

- **KEEP:** the fixed sample supports direct sending under the current policy, with no routine repair;
  recommend activation for the separately authorized rollout, with the sample's limits stated.
- **CHANGE:** a concrete defect requires repair before activation; identify the smallest policy or
  owning-surface change. Do not implement a redesign as part of this evaluation.
- **DEFER:** a specific missing/invalid input, incomplete response, provider/model mismatch or
  unresolved presentation issue prevents the decision; name exactly what evidence is missing.

Before any additional case or rerun, name the decision it could change and obtain authorization for
the changed experiment. Imperfection or a desire for more confidence alone is insufficient.
Commit only privacy-safe helper/docs and any appropriately anonymized final conclusions. Keep real
learner contexts, raw responses, assignments and handouts ignored. Activation/deployment belongs to
ESL-29 and is outside this evaluation.

## Completed evaluation outcome

**CHANGE:** the fixed evidence does not support activating the current shipped policy as-is.
All three responses completed on the requested model, passed fresh v5 admission and emitted native
renderer-3 learner HTML. Full JSON and learner DOM were inspected, with desktop and 390px mobile
screenshots and a separate answer-key inspection. Teacher rationale is absent from each complete
learner document, including closed disclosures. No mobile document horizontal overflow was observed.

| Case                 | Direct-send assessment               | Concrete residual issue                                                                                                                                                         |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beginner-support`   | Visually sendable with minor defects | Grammar labels repeat their complete patterns/examples; Russian comprehension cues are marked English in HTML. The visual verdict does not certify assistive-language delivery. |
| `everyday-contrast`  | Repair required                      | An independent question cue supplies the target continuous construction; a self-check incorrectly applies the need for be to every new sentence containing -ing.                |
| `technical-transfer` | Sendable with minor clutter          | Grammar labels repeat complete patterns/examples. The teaching sequence and meaning-based mission remain useful.                                                                |

Activation-blocking authored defects in the everyday case are preserved at
`practice[1].items[2].prompt` and `outputTask.selfCheck[1]` (zero-based indices) in its private admitted
JSON and unchanged learner HTML. The cue partially leaks aspect rather than supplying the entire
finished answer. The self-check must refer to intended continuous forms; a sentence such as
`I enjoy swimming` legitimately contains an -ing form without be. These are prompt/policy-quality
defects. One sample does not establish model variance or prove that a particular prompt rewrite
will resolve them.

The duplicated headings in the other two cases are minor authored presentation-policy defects,
not a quality judgment based on output length or item counts. A short label, separate pattern and
separate examples are already expressible; the everyday case demonstrates that under the same
schema/settings. The Russian comprehension language-tag mismatch is a distinct renderer annotation
issue: live questions inherit English from their list, and answer-key copies explicitly receive
English. Resolve the cue-language convention and renderer annotation narrowly; actual screen-reader
audio was not tested. No schema limitation or need to redesign native rendering is demonstrated.

Preserve the useful teaching design. The next bounded work should address full-cue integrity and
semantic scope of self-checks, with label economy and comprehension-language annotation handled by
their owners. This evaluation implements no corrective policy/renderer change. The fixed sample is
sufficient for CHANGE; a later changed-policy evaluation needs its own specific decision and paid
authorization. There were no extra cases, retries, paid evaluators, TTS, activation or deployment.

Exact accounting: **84,020 total tokens**, comprising 72,879 input and 11,141 output. Output includes
931 reported reasoning tokens; 11,148 input tokens were reported cached. This is usage accounting,
not a quality score. Per-case raw responses, usage, artifact hashes, all fourteen rubric dimensions,
screenshots and the decision remain ignored under `.tmp/esl-28/`. Only this privacy-safe conclusion
is committed. The evidence establishes sampled direct-send quality, not learner outcomes or universal
generation reliability.
