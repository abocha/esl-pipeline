# Inworld Numeric-Only Pace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. All production edits must be performed inline in the primary task; subagents are review-only.

**Goal:** Stop Inworld TTS-2 from applying planner pace through both semantic steering and `speakingRate`, while preserving deliberate non-natural pace through the numeric SDK control.

**Architecture:** Keep `SpeechPerformancePlan.pace` provider-neutral and unchanged. At the Inworld adapter boundary, omit pace from bracketed metadata, map `slow`, `measured`, and `brisk` to one numeric `speakingRate`, and treat `natural` like absent pace by relying on the provider default. Improve the backend planner prompt so ordinary dialogue omits pace and adjacent turns retain a stable conversational tempo.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, Inworld TTS adapter.

## Global Constraints

- Preserve the manifest, speech-plan schema, synthesis forwarding, and provider capability contracts.
- Preserve emotion, intonation, emphasis, pauses, non-verbal cues, delivery mode, and free-form direction behavior.
- Do not add the eval harness, immutable run history, pause normalization, or provider/model changes.
- Follow red-green-refactor: no production code changes before the targeted regression test fails for the expected reason.
- Use focused tests plus `pnpm --silent run check:fast:agent`; do not run `pnpm check` for this bounded change. If affected routing identifies unexpected broad risk, stop and report it.

---

### Task 1: Enforce one Inworld pace channel

**Files:**

- Modify: `packages/tts-provider-inworld/tests/index.test.ts`
- Modify: `packages/tts-provider-inworld/src/rendering.ts`

**Interfaces:**

- Consumes: `SpeechPerformancePlanSegment.pace` values `slow | measured | natural | brisk`.
- Produces: `RenderedInworldSpeechSegment` with no semantic pace metadata and at most one numeric `speakingRate`.

- [ ] **Step 1: Write failing renderer tests**

Change the existing TTS-2 cue expectation so its text contains only emotion and intonation metadata while retaining `speakingRate: 0.95`. Add a table-driven test with hand-derived expectations:

```ts
it.each([
  [undefined, undefined],
  ['natural', undefined],
  ['slow', 0.85],
  ['measured', 0.95],
  ['brisk', 1.1],
] as const)('renders pace %s through only the numeric SDK control', (pace, speakingRate) => {
  const rendered = renderInworldSpeechSegment({
    model: 'inworld-tts-2',
    segment: { id: 'segment-1', text: 'Keep a steady tempo.', ...(pace ? { pace } : {}) },
  });

  expect(rendered.text).toBe('Keep a steady tempo.');
  expect(rendered.speakingRate).toBe(speakingRate);
});
```

Extend the existing preview-cache test so `pace: 'measured'` changes the hash while `pace: 'natural'` does not change the baseline hash.

Extend the TTS 1.5 renderer regression so `pace: 'natural'` still produces `speakingRate: 1`; the natural-pace omission is intentionally TTS-2-specific.

- [ ] **Step 2: Run the focused provider test and verify RED**

Run:

```powershell
pnpm --filter @esl-pipeline/tts-provider-inworld exec vitest run tests/index.test.ts
```

Expected: failures show that TTS-2 text still includes `pace: ...` and TTS-2 `natural` still emits `speakingRate: 1`.

- [ ] **Step 3: Implement the minimal renderer change**

Remove the pace entry from `metadataInstructions`. In the TTS-2 return path only, omit `speakingRate` when pace is `natural`; leave the shared `resolveSpeakingRate()` mappings, the TTS 1.5 branch, and synthesis forwarding unchanged.

- [ ] **Step 4: Run the focused provider test and verify GREEN**

Run the same focused Vitest command and require zero failures.

### Task 2: Make ordinary planner pace sparse and stable

**Files:**

- Modify: `packages/batch-backend/tests/application.speech-performance-planner.test.ts`
- Modify: `packages/batch-backend/src/application/speech-performance-planner.ts`

**Interfaces:**

- Consumes: prepared immutable study-text segments and selected voice assignments.
- Produces: the same strict speech-plan response schema, with stronger natural-tempo policy in the model prompt.

- [ ] **Step 1: Write a failing prompt-boundary test**

Capture the real request passed to the existing fake structured executor and assert that its prompt communicates these behavioral rules:

```text
Maintain a natural, consistent conversational tempo across adjacent segments.
Omit pace for ordinary dialogue.
Use slow, measured, or brisk only when a non-natural tempo is explicitly justified by the authored scene or learning goal.
Do not use pace merely to reinforce emotion, seriousness, regret, reflection, or intonation.
```

Use four `toContain` assertions on the emitted request prompt; do not test source text or implementation-private constants.

- [ ] **Step 2: Run the focused backend test and verify RED**

Run:

```powershell
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.speech-performance-planner.test.ts
```

Expected: the request-prompt assertions fail because the current planner prompt contains none of the stable-tempo policy.

- [ ] **Step 3: Implement the minimal prompt policy**

Add the four reviewed policy sentences to `buildSpeechPlannerPrompt()` before the serialized input. Do not normalize model output or alter the response schema.

- [ ] **Step 4: Run the focused backend test and verify GREEN**

Run the same focused Vitest command and require zero failures.

### Task 3: Align active documentation and validate the bounded change

**Files:**

- Modify: `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`

**Interfaces:**

- Documents the unchanged neutral-plan contract and the updated provider-specific rendering policy.

- [ ] **Step 1: Update the active SSOT**

Document that ordinary planner output should omit pace, non-natural pace is exceptional, and Inworld TTS-2 renders pace only as a numeric SDK control. State that `natural` and absent pace use the provider default.

- [ ] **Step 2: Run focused package verification**

```powershell
pnpm --filter @esl-pipeline/tts-provider-inworld test:unit
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.speech-performance-planner.test.ts
pnpm --filter @esl-pipeline/tts-provider-inworld typecheck
pnpm --filter @esl-pipeline/batch-backend typecheck
```

- [ ] **Step 3: Run the normal affected gate**

```powershell
pnpm --silent run check:fast:agent
```

Inspect any reported artifact before rerunning a raw lane. If affected routing identifies unexpected broad risk, stop and report it; do not escalate to `pnpm check` in this task.

- [ ] **Step 4: Review the final diff against scope**

Confirm only the renderer, its provider tests, the planner prompt, its focused test, this plan, and the active TTS SSOT changed. Record that audio naturalness still requires a controlled regeneration/listening comparison before issue #154 is closed.

- [ ] **Step 5: Record the live acceptance boundary**

Do not close issue #154 from unit evidence alone. A controlled rerun of the affected production input must separately confirm both:

- the resulting ordinary dialogue plan does not populate pace on every segment and avoids unjustified adjacent tempo changes;
- blind or direct A/B listening no longer finds an isolated conspicuously slow line.

If the affected private input or a safe live planner environment is unavailable in this task, report those two checks as explicit remaining acceptance work rather than enabling persistent full-plan production logging or adding the deferred eval harness.
