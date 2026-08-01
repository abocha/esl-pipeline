# Contextual Speech Annotation Implementation Plan

> **For the primary implementation agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreleased contextual speech-planning architecture with a minimal Luna
enhancer that inserts optional, mechanically validated bracket annotations into immutable authored
speech before Inworld synthesis.

**Architecture:** First remove the branch-local schema-v2 envelopes, acoustic controls, evidence,
and density machinery and restore a buildable released schema-v1/identity baseline. Then introduce
a new schema-v2 plan containing only authored `text`, internally annotated `synthesisText`, an
immutable enhancer version, and existing provenance. Validate source restoration atomically and
convert reserved annotation spans directly to Inworld brackets at render time.

**Tech Stack:** TypeScript 6, Vitest, OpenAI Responses structured output with `gpt-5.6-luna`,
Inworld TTS-2, pnpm workspaces.

## Global Constraints

- Authored segment bytes, IDs, speakers, and ordering are immutable.
- Annotations are optional; there is no target density, quota, taxonomy, evidence model, or score.
- One invalid segment rejects the complete enhancement and uses schema-v1 identity fallback.
- Learner-visible assignment content, subtitles, and exports never receive synthesis annotations.
- Dialogue and monologue use the same complete-context pass; pronunciation bypasses it.
- Inworld uses stable voice assignments, `BALANCED`, and no `speakingRate`.
- Preserve released schema-v1 reading/fallback plus PR1/PR2 cancellation, retry, cache, and privacy
  contracts.
- Rewrite unreleased schema v2 directly: no migration, adapter, alias, dual schema, compatibility
  shim, or transitional abstraction.
- Preserve historical PR3 evaluation evidence and unrelated post-`v10.4.0` work.
- Do not add Realtime API integration, monologue rechunking, provider tuning, text rewriting, or a
  new evaluation harness.

---

### Task 1: Remove the superseded contextual-v3 architecture

**Files:**

- Delete: `packages/tts-core/src/speech-plan-direction.ts`
- Modify: `packages/tts-core/src/types.ts`
- Modify: `packages/tts-core/src/speech-plan.ts`
- Modify: `packages/tts-core/src/speech-plan-analysis.ts`
- Modify: `packages/tts-core/src/voice-plan.ts`
- Modify: `packages/tts-core/src/index.ts`
- Modify: `packages/tts-core/tests/speech-plan.test.ts`
- Modify: `packages/batch-backend/src/application/speech-performance-prompt.ts`
- Modify: `packages/batch-backend/src/application/speech-performance-planner.ts`
- Modify: `packages/batch-backend/src/application/speech-planner-evaluator.ts`
- Modify: `packages/batch-backend/src/application/speech-planner-eval-report.ts`
- Modify: `packages/batch-backend/src/application/speech-planner-listening-report.ts`
- Modify: `packages/batch-backend/tests/application.speech-performance-planner.test.ts`
- Modify: `packages/batch-backend/tests/application.speech-planner-evaluator.test.ts`
- Modify: `packages/batch-backend/tests/application.speech-planner-listening-report.test.ts`
- Modify: `packages/orchestrator/src/runtime/speech-performance.ts`
- Modify: `packages/orchestrator/src/manifest.ts`
- Modify: `packages/orchestrator/tests/index.test.ts`
- Modify: `packages/orchestrator/tests/manifest.test.ts`
- Modify: `packages/orchestrator/tests/runtime.speech-performance.test.ts`
- Modify: `packages/tts-provider-inworld/src/rendering.ts`
- Modify: `packages/tts-provider-inworld/tests/index.test.ts`

**Interfaces:**

- Consumes: released schema-v1 speech-plan behavior at tag `v10.4.0` and branch-local OpenAI/Luna
  provider support.
- Produces: a compiling schema-v1/identity subsystem with no contextual-v3 structures, while keeping
  Luna/provider work that the replacement will reuse.

- [ ] **Step 1: Remove the discarded schema-v2 implementation and restore the coherent baseline**

Use `git diff v10.4.0...HEAD -- <file>` as the deletion boundary. Remove:

```text
SpeechDirectionDimension / SpeechDirectionEnvelope / SpeechSpeakerEnvelope
SpeechTurnEvidence / SpeechControlEvidence / SpeechTurnAdjustment
SpeechPerformancePlanV2 and its old segment subtype
performanceMode / performanceSpeakers / performanceSource / performanceContextHash
resolveEffectiveSpeechDirection and speech-plan-direction.ts
SPEECH_PLAN_V3_RESPONSE_SCHEMA and contextual-continuity prompt lines
mergePlannerOutputV2 and schema-v2 candidate analysis
contextual cue-density, stacking, basis, and continuity metrics
schema-v2 Inworld scene/speaker/turn composition
schema-v2 manifest sanitization and logging fields
```

Retain the current OpenAI structured executor, Luna model allowlisting/default selection, exact
returned-model validation, budget accounting, cancellation, privacy-safe logging, and schema-v1
prompt policies. Until Task 3 adds the replacement policy, make the disabled-by-default backend
planner select the released `speech-performance-v2-inworld-tts2` policy so the intermediate commit
is executable rather than intentionally broken.

- [ ] **Step 2: Remove only tests and fixture assertions dedicated to the discarded structures**

Delete envelope, basis, evidence, turn-adjustment, effective-density, and contextual renderer
cases. Keep or restore tests for:

```text
schema-v1 identity and prompted plan reading
immutable schema-v1 segment text
planner failure -> complete identity fallback
provider/model/source-hash validation
OpenAI/Luna request and returned-model behavior
budget/retry/cancellation/privacy behavior
PR3 compatibility preflight and historical offline fixtures
pronunciation bypass
```

Do not delete `docs/operations/speech-planner-evaluation-evidence-2026-07-29.md`, the checked-in PR3
corpus/offline fixtures, or the retained Luna trial evidence.

- [ ] **Step 3: Prove the cleanup baseline builds and tests independently**

Run:

```powershell
pnpm --filter @esl-pipeline/tts-core test:unit
pnpm --filter @esl-pipeline/tts-provider-inworld test:unit
pnpm --filter @esl-pipeline/orchestrator test:unit
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.speech-performance-planner.test.ts tests/application.speech-planner-evaluator.test.ts tests/application.speech-planner-listening-report.test.ts
pnpm --filter @esl-pipeline/tts-core build
pnpm --filter @esl-pipeline/tts-provider-inworld build
pnpm --filter @esl-pipeline/orchestrator build
pnpm --filter @esl-pipeline/batch-backend build
```

Expected: all commands pass with schema v1 as the only runtime speech-plan shape. No import or test
mentions `performanceContext`, `speakerEnvelopes`, `turnAdjustment`, `controlEvidence`, or
`high_cue_density` for the removed architecture.

- [ ] **Step 4: Commit the cleanup baseline**

```powershell
git add packages/tts-core packages/tts-provider-inworld packages/orchestrator packages/batch-backend
git commit -m "refactor(tts): remove contextual speech-plan architecture"
```

---

### Task 2: Add the immutable-source annotation contract and validator

**Files:**

- Create: `packages/tts-core/src/speech-annotation.ts`
- Modify: `packages/tts-core/src/types.ts`
- Modify: `packages/tts-core/src/speech-plan.ts`
- Modify: `packages/tts-core/src/index.ts`
- Modify: `packages/tts-core/tests/speech-plan.test.ts`

**Interfaces:**

- Consumes: schema-v1 identity plans and prepared authored segments from Task 1.
- Produces:
  - `CONTEXTUAL_SPEECH_ANNOTATION_VERSION = 'contextual-bracket-annotation-v1'`
  - `SPEECH_ANNOTATION_OPEN = '<tts-annotation>'`
  - `SPEECH_ANNOTATION_CLOSE = '</tts-annotation>'`
  - `validateSpeechAnnotationText(sourceText, synthesisText)`
  - the replacement `SpeechPerformancePlanV2`.

- [ ] **Step 1: Write failing contract tests**

Add cases proving:

```ts
expect(
  validateSpeechAnnotationText(
    'I thought we agreed on Friday.',
    '<tts-annotation>Trying not to sound accusatory</tts-annotation>I thought we agreed on Friday.',
  ),
).toEqual({
  synthesisText:
    '<tts-annotation>Trying not to sound accusatory</tts-annotation>I thought we agreed on Friday.',
  annotationCount: 1,
});

expect(
  validateSpeechAnnotationText(
    "You're right. I completely forgot.",
    "You're right.<tts-annotation>sighs</tts-annotation> I completely forgot.",
  ),
).toMatchObject({ annotationCount: 1 });

expect(validateSpeechAnnotationText('Use [A] here.', 'Use [A] here.')).toMatchObject({
  annotationCount: 0,
});
```

Also assert rejection for one changed character, capitalization, punctuation, or whitespace;
missing/nested/empty markers; a word-splitting insertion; insertion inside `?!`; duplicate,
missing, unknown, or reordered segment IDs; and any source containing a reserved delimiter.

- [ ] **Step 2: Run the new tests and inspect the fresh failure**

```powershell
pnpm --filter @esl-pipeline/tts-core exec vitest run tests/speech-plan.test.ts
```

Expected: FAIL because the annotation constants, validator, and replacement schema-v2 types do not
exist.

- [ ] **Step 3: Implement the minimal reserved-span parser**

Create `speech-annotation.ts` with a single left-to-right parser. Its essential boundary rule is:

```ts
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}'’_-]/u;
const PUNCTUATION_OR_SYMBOL = /[\p{P}\p{S}]/u;

function isValidInsertionBoundary(left?: string, right?: string): boolean {
  if (left === undefined || right === undefined) return true;
  if (WORD_CHARACTER.test(left) && WORD_CHARACTER.test(right)) return false;
  if (PUNCTUATION_OR_SYMBOL.test(left) && PUNCTUATION_OR_SYMBOL.test(right)) return false;
  return true;
}
```

The parser must reject malformed or nested markers, validate annotation bodies with the existing
bounded safe cue-text grammar, concatenate only authored parts, compare that reconstruction to
`sourceText` with strict `===`, and return a canonical internally annotated string plus count. It
must not judge whether an annotation is emotionally appropriate.

- [ ] **Step 4: Define the replacement schema-v2 plan and assignment context**

Add the minimal types:

```ts
export type SpeechEnhancementVersion = 'contextual-bracket-annotation-v1';

export interface SpeechPerformancePlanSegmentV2 {
  id: string;
  speaker?: string;
  text: string;
  synthesisText: string;
}

export interface SpeechPerformancePlanV2 {
  schemaVersion: 2;
  mode: 'prompted';
  provider: TtsProviderId;
  model: TtsModelId;
  sourceHash: string;
  enhancerVersion: SpeechEnhancementVersion;
  planner: SpeechPerformancePlannerMetadata;
  segments: SpeechPerformancePlanSegmentV2[];
}
```

Add `assignmentMarkdown: string` to prepared enhancement context, sourced from
`input.context.rawMarkdown`. Do not persist the complete assignment in the plan or log it. Update
`validateSpeechPerformancePlan()` so schema v2 mechanically validates selection, source hash,
enhancer version, exact ordered coverage, speaker identity, and each `synthesisText`. Keep schema-v1
validation unchanged.

- [ ] **Step 5: Run the focused contract tests**

```powershell
pnpm --filter @esl-pipeline/tts-core exec vitest run tests/speech-plan.test.ts
pnpm --filter @esl-pipeline/tts-core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the contract**

```powershell
git add packages/tts-core
git commit -m "feat(tts): add contextual annotation contract"
```

---

### Task 3: Replace the Luna prompt and planner merge

**Files:**

- Modify: `packages/batch-backend/src/application/speech-performance-prompt.ts`
- Modify: `packages/batch-backend/src/application/speech-performance-planner.ts`
- Modify: `packages/batch-backend/tests/application.speech-performance-planner.test.ts`
- Modify: `packages/batch-backend/tests/application.generation-providers.structured-output.test.ts`

**Interfaces:**

- Consumes: Task 2 annotation constants, prepared `assignmentMarkdown`, ordered authored segments,
  and existing OpenAI structured execution.
- Produces: strict `{ segments: Array<{ id: string; synthesisText: string }> }` Luna output merged
  into the new atomic schema-v2 plan.

- [ ] **Step 1: Write failing prompt and merge tests**

Assert that the request:

```ts
expect(request.responseSchema.schema.properties.segments.items.required).toEqual([
  'id',
  'synthesisText',
]);
expect(request.prompt).toContain(prepared.enhancementContext.assignmentMarkdown);
expect(request.prompt).toContain('<tts-annotation>');
expect(request.prompt).not.toContain('speakerEnvelopes');
expect(request.prompt).not.toContain('turnAdjustment');
```

Test a completely unchanged candidate, leading direction, inline nonverbal, and a candidate where
only the final segment changes one punctuation mark. The last case must return no plan and
`planner_invalid`; it must never retain the valid preceding segments.

- [ ] **Step 2: Run the focused test and inspect the fresh failure**

```powershell
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.speech-performance-planner.test.ts
```

Expected: FAIL because the replacement response schema and merge do not exist.

- [ ] **Step 3: Implement the immutable Luna policy**

Replace the old contextual policy with immutable policy ID
`contextual-bracket-annotation-v1`. The structured schema contains only:

```ts
{
  type: 'object',
  additionalProperties: false,
  required: ['segments'],
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'synthesisText'],
        properties: {
          id: { type: 'string' },
          synthesisText: { type: 'string' },
        },
      },
    },
  },
}
```

The prompt must state that the assignment is read-only context, output contains spoken segments
only, authored characters are immutable, annotations are optional, ordinary square brackets are
authored text, and only reserved delimiters identify insertions. It may suggest playable leading
directions and inline natural-language nonverbals but must not request a minimum count or acoustic
fields.

- [ ] **Step 4: Implement atomic merge and preflight refusal**

Before the provider call, if any source segment contains a reserved delimiter, return/raise the
existing invalid-plan path so orchestration selects identity without spending a provider request.
After parsing, require exact array length and order; do not build a map that silently tolerates
reordering or duplicates. Construct the complete schema-v2 plan and call the Task 2 validator once.
Do not sanitize, canonicalize, or partially merge invalid output.

Keep current Luna request settings, provider budgets, returned-model validation, usage recording,
and privacy behavior. Raw output remains available only through the existing explicit debug path.

- [ ] **Step 5: Run focused planner/provider tests**

```powershell
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.speech-performance-planner.test.ts tests/application.generation-providers.structured-output.test.ts tests/application.openai-responses-contract.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the enhancer**

```powershell
git add packages/batch-backend packages/tts-core
git commit -m "feat(speech-planner): enhance immutable speech text"
```

---

### Task 4: Render annotations directly and preserve atomic fallback

**Files:**

- Modify: `packages/tts-provider-inworld/src/rendering.ts`
- Modify: `packages/tts-provider-inworld/src/index.ts`
- Modify: `packages/tts-provider-inworld/tests/index.test.ts`
- Modify: `packages/orchestrator/src/runtime/speech-performance.ts`
- Modify: `packages/orchestrator/src/manifest.ts`
- Modify: `packages/orchestrator/tests/runtime.speech-performance.test.ts`
- Modify: `packages/orchestrator/tests/manifest.test.ts`
- Modify: `packages/orchestrator/tests/index.test.ts`

**Interfaces:**

- Consumes: validated schema-v2 `synthesisText` and enhancer version.
- Produces: direct Inworld bracket text, explicit `BALANCED`, no `speakingRate`, versioned cache
  identity, manifest observability, and assignment-wide identity fallback.

- [ ] **Step 1: Write failing renderer, cache, manifest, and fallback tests**

Cover:

```ts
expect(rendered.text).toBe('[Trying not to sound accusatory] I thought we agreed on Friday.');
expect(rendered.deliveryMode).toBe('BALANCED');
expect(rendered.speakingRate).toBeUndefined();
expect(rendered.lexicalText).toBe('I thought we agreed on Friday.');
```

Also prove inline conversion produces `You're right. [sighs] I completely forgot.`, existing
authored `[Friday]` remains untouched, v1 rendering is unchanged, and chunk hashes differ when only
`synthesisText` or enhancer version differs. Manifest round-trip must retain accepted annotations
and version. A malformed final segment must make orchestration return a complete schema-v1 identity
plan.

- [ ] **Step 2: Run the focused tests and inspect the fresh failures**

```powershell
pnpm --filter @esl-pipeline/tts-provider-inworld exec vitest run tests/index.test.ts
pnpm --filter @esl-pipeline/orchestrator exec vitest run tests/runtime.speech-performance.test.ts tests/manifest.test.ts tests/index.test.ts
```

Expected: FAIL at the new schema-v2 rendering and persistence assertions.

- [ ] **Step 3: Implement trivial schema-v2 Inworld rendering**

For schema v2, bypass `cleanSpeechText`, legacy cue compilation, uppercase emphasis, SSML breaks,
structured nonverbals, pace mapping, and per-segment delivery overrides. Convert only reserved spans
to `[annotation]`. Add a separator space before or after the bracket only when its neighboring
authored character is non-whitespace; do not mutate authored characters.

Return:

```ts
{
  text: convertedSynthesisText,
  lexicalText: segment.text,
  leadingInstructionTagCount,
  deliveryMode: 'BALANCED',
  enhancerVersion: plan.enhancerVersion,
}
```

Pass no `speakingRate`. Keep the released schema-v1 renderer exactly as its compatibility path.

- [ ] **Step 4: Include synthesis text and enhancer version in cache identity**

Add `enhancerVersion?: string` to the rendered segment and `buildInworldChunkHash()` input. Include
both the actual rendered `text` and enhancer version in chunk and complete-output hash inputs. Keep
the renderer policy version and existing provider/model/voice/audio fields.

- [ ] **Step 5: Simplify observability and manifest sanitization**

Schema-v2 success logs contain hashes, segment count, enhancer version, annotated segment count,
and total annotation count. They do not contain assignment text or annotation bodies unless the
existing explicit debug-plan flag is enabled. Allow the new immutable policy ID through manifest
sanitization and remove the discarded contextual ID. Persist schema v2 without converting or
inventing schema-v1 metadata.

- [ ] **Step 6: Prove pronunciation still bypasses enhancement**

Retain the existing orchestrator regression test that pronunciation-only reruns construct no speech
planner and make no Luna call. Do not route pronunciation main/chunk text through the annotation
validator or renderer.

- [ ] **Step 7: Run the focused runtime tests**

```powershell
pnpm --filter @esl-pipeline/tts-provider-inworld test:unit
pnpm --filter @esl-pipeline/orchestrator test:unit
pnpm --filter @esl-pipeline/tts-core test:unit
```

Expected: PASS.

- [ ] **Step 8: Commit rendering and orchestration**

```powershell
git add packages/tts-provider-inworld packages/orchestrator packages/tts-core
git commit -m "feat(inworld): render contextual speech annotations"
```

---

### Task 5: Synchronize contracts and concise operational documentation

**Files:**

- Modify: `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`
- Modify: `docs/reference/pipeline-manifest.md`
- Modify: `packages/tts-core/README.md`
- Modify: `packages/tts-provider-inworld/README.md`
- Modify: `packages/orchestrator/README.md`
- Modify: `packages/batch-backend/README.md`
- Modify: `docs/operations/study-text-performance-v3-luna-evidence-2026-08-01.md`
- Modify: `packages/contracts/src/contract-versions.ts` only if the existing unreleased schema-v2
  contract bump needs wording/version alignment.
- Modify generated docs indexes using the repository generator.

**Interfaces:**

- Consumes: the completed enhancer behavior.
- Produces: one current SSOT description, accurate manifest contract, and historical evidence clearly
  labeled as evidence for the discarded implementation rather than the replacement.

- [ ] **Step 1: Replace contextual-v3 documentation with the annotation contract**

Document only:

```text
complete assignment context -> optional reserved annotations -> mechanical restoration proof
-> schema-v2 accepted plan -> Inworld brackets
```

State authored/synthesis separation, atomic identity fallback, manifest/cache observability,
dialogue/monologue routing, pronunciation bypass, `BALANCED`, and omitted speaking rate. Remove
envelope, evidence, density, pace/pause/emphasis, and acoustic ownership descriptions.

- [ ] **Step 2: Preserve and relabel historical evidence**

Add a short notice to `study-text-performance-v3-luna-evidence-2026-08-01.md` that its run proves
Luna/provider execution for the discarded envelope schema and is retained as historical evidence;
it does not validate contextual bracket annotation quality. Do not delete or rewrite the recorded
run results.

- [ ] **Step 3: Regenerate indexes and run docs/contract checks**

```powershell
pnpm docs:generate:indexes
pnpm docs:check
pnpm release:verify:contracts
pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline
```

Expected: PASS. The DB baseline command is required because the branch already changes the contract
registry; it is verification only and must not start local services.

- [ ] **Step 4: Commit documentation**

```powershell
git add docs packages/tts-core/README.md packages/tts-provider-inworld/README.md packages/orchestrator/README.md packages/batch-backend/README.md packages/contracts/src/contract-versions.ts
git commit -m "docs(tts): document contextual speech annotation"
```

---

### Task 6: Run canonical validation and the small product comparison

**Files:**

- No permanent harness or fixture files.
- Ignored artifacts only: `tmp/contextual-speech-annotation-trial/**`.

**Interfaces:**

- Consumes: completed implementation and three existing representative assignment Markdown files.
- Produces: canonical local validation plus 6–12 ignored audio clips and a concise manual decision
  record.

- [ ] **Step 1: Run routing and focused package validation**

```powershell
pnpm test:check-routing
pnpm --filter @esl-pipeline/tts-core test:unit
pnpm --filter @esl-pipeline/tts-provider-inworld test:unit
pnpm --filter @esl-pipeline/orchestrator test:unit
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.speech-performance-planner.test.ts tests/application.generation-providers.structured-output.test.ts tests/application.openai-responses-contract.test.ts tests/application.process-transcribe-job.test.ts tests/config.env.test.ts
```

Expected: PASS. The backend suites remain pure and construct no PostgreSQL or Redis adapter.

- [ ] **Step 2: Run formatting, hygiene, builds, typechecks, and the broad gate**

```powershell
pnpm format:write
pnpm format
pnpm run lint:repo-hygiene
pnpm docs:check
pnpm --filter @esl-pipeline/tts-core build
pnpm --filter @esl-pipeline/tts-provider-inworld build
pnpm --filter @esl-pipeline/orchestrator build
pnpm --filter @esl-pipeline/batch-backend build
pnpm --filter @esl-pipeline/tts-core typecheck
pnpm --filter @esl-pipeline/tts-provider-inworld typecheck
pnpm --filter @esl-pipeline/orchestrator typecheck
pnpm --filter @esl-pipeline/batch-backend typecheck
pnpm check:pre-pr
```

Read the aggregate `check:pre-pr` summary and cited artifacts before any diagnostic rerun. Allow at
most one isolated rerun per unchanged failure. Classify a clean local run as
`PASS_WITH_CI_REQUIREMENTS` when the routing summary assigns PostgreSQL/Redis lanes to hosted CI.

- [ ] **Step 3: Select the three product examples without adding fixtures**

Choose existing assignment files that meet these observable criteria:

```text
1. dialogue, two speakers, restrained everyday stakes, no authored dramatic event
2. dialogue, two speakers, one genuine change in emotional understanding or stakes
3. monologue, one speaker, at least one clear change of thought or attitude
```

Copy only the selected working files into the ignored trial directory if isolation is necessary.
Do not commit learner content, provider output, keys, logs, or audio.

- [ ] **Step 4: Generate one baseline/enhanced pair per assignment through the normal pipeline**

For each assignment, first run the ordinary study-text synthesis path with
`ESL_TTS_SPEECH_PLANNER_ENABLED=false`, then with the same voice/model and
`ESL_TTS_SPEECH_PLANNER_ENABLED=true`. Keep `inworld-tts-2`, `BALANCED`, native pace, and identical
voice assignments. Save the six clips and accepted schema-v2 plans under
`tmp/contextual-speech-annotation-trial/`.

Do not add a runner, scoring code, blind-key generator, corpus entry, or evaluation report module.
If one stochastic pair is genuinely ambiguous, repeat only that pair; stop at twelve clips total.

- [ ] **Step 5: Inspect annotations before listening, then record the product result**

For each accepted plan, verify manually that annotations are optional, contextual, and do not alter
the event or characterization. Then compare baseline/enhanced audio for naturalness, emotional
honesty, conversational responsiveness, stable character, and spoken annotation leakage. Record
plain observations without claiming statistical superiority.

If any plan structurally falls back, inspect the existing privacy-safe validation reason and fix the
contract defect before listening. Do not waive atomic fallback or edit authored text to make a
candidate pass.

- [ ] **Step 6: Final implementation commit if formatting or evidence docs changed**

```powershell
git status --short
git add <only tracked implementation, test, and documentation files>
git commit -m "test(tts): validate contextual speech annotation"
```

Do not add anything under `tmp/`.

## Self-Review Results

- Spec coverage: cleanup-first sequence, immutable source, reserved representation, atomic
  validation/fallback, direct Inworld rendering, cache identity, observability, modes, deferrals,
  and small product comparison are each assigned to a task.
- Placeholder scan: no `TBD`, compatibility migration, future adapter, semantic validator, or new
  harness step remains.
- Type consistency: `contextual-bracket-annotation-v1`, `synthesisText`, reserved delimiter names,
  schema-v2 shape, and cache field names are consistent across Tasks 2–5.
