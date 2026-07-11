# Assignment Workflow Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assignment navigation user-driven, move teacher-note invalidation to explicit commit actions, provide a meaningful final action, expose post-share operations outside diagnostics, align their controls with Calm Studio, and stop generating duplicate `Natural` shadow-item audio.

**Architecture:** Keep the five-step workflow and `MinimalAssignment.tsx` controller root. Put pure navigation and dirty-input decisions in `assignment-workflow.ts`, hydrate the visible step once per resumed session, and expose optional continue/completion footer actions through `AssignmentWorkflow`. Keep operational rerun wiring in Advanced actions, diagnostic data in `AssignmentSupport`, and pronunciation clip semantics in the orchestrator.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, Testing Library, CSS, ESL Pipeline orchestrator, HTML publisher, pnpm workspaces.

## Global Constraints

- Deliver one pull request with two review-gated slices and one later manual deployment.
- Do not begin Slice 2 until Slice 1 tests, typecheck, and reviewer gate pass.
- After initial hydration, only progress clicks, Back, Confirm and continue, and explicit completion may change the visible step.
- Never auto-select, auto-scroll, or auto-focus a step after async state changes.
- Typing teacher notes must never open a confirmation dialog.
- Keep the five primary steps unchanged.
- Keep ordinary rerun operations outside Support details; reserve Support details for diagnostics.
- Do not change DTOs, database schema, manifest schema, provider defaults, or rerun payloads.
- Do not deploy production from this plan.

---

## File Structure

### Slice 1

- `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts`: pure hydration and teacher-note decisions.
- `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx`: optional continue/completion footer.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`: user-owned navigation, note commit, final reset.
- Existing assignment workflow, prompt/draft, and workflow UI tests: focused regressions.

### Slice 2

- `AssignmentSupport.tsx`, `MinimalAssignment.tsx`, and `MinimalAssignment.advanced.tsx`: operational/diagnostic separation.
- `MinimalAssignment.css` and `AssignmentWorkflow.css`: Calm Studio post-share controls.
- `pronunciation-audio.ts`: one generated item clip per shadow drill.
- Frontend, orchestrator, and publisher tests plus current README/reference docs.

---

### Task 1: Add Pure Workflow Decisions

**Slice:** 1

**Files:**

- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts`

**Interfaces:**

- Produces: `resolveInitialAssignmentStep(stage, input): AssignmentStepId`.
- Produces: `getTeacherNotesCommitDecision(input): 'unchanged' | 'commit' | 'confirm-and-invalidate'`.

- [ ] **Step 1: Write failing unit tests**

Add these cases and update the old mapper import:

```ts
expect(resolveInitialAssignmentStep('assignment', readyInput)).toBe('create');

expect(
  getTeacherNotesCommitDecision({
    currentNotes: ' Focus on articles. ',
    committedNotes: 'Focus on articles.',
    hasDownstreamAssignment: true,
  }),
).toBe('unchanged');

expect(
  getTeacherNotesCommitDecision({
    currentNotes: 'Focus on articles.',
    committedNotes: '',
    hasDownstreamAssignment: false,
  }),
).toBe('commit');

expect(
  getTeacherNotesCommitDecision({
    currentNotes: 'Focus on articles.',
    committedNotes: 'Focus on stress.',
    hasDownstreamAssignment: true,
  }),
).toBe('confirm-and-invalidate');
```

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/assignment-workflow.test.ts
```

Expected: FAIL because both helpers are missing.

- [ ] **Step 3: Implement the helpers**

```ts
export function resolveInitialAssignmentStep(
  stage: AssignmentSessionStage,
  input: AssignmentWorkflowInput,
): AssignmentStepId {
  if (stage === 'source') return input.selectedStudent ? 'source' : 'student';
  if (stage === 'context') return 'context';
  if (stage === 'assignment') return 'create';
  return 'review';
}

export interface TeacherNotesCommitInput {
  currentNotes: string;
  committedNotes: string;
  hasDownstreamAssignment: boolean;
}

export function getTeacherNotesCommitDecision({
  currentNotes,
  committedNotes,
  hasDownstreamAssignment,
}: TeacherNotesCommitInput): 'unchanged' | 'commit' | 'confirm-and-invalidate' {
  if (currentNotes.trim() === committedNotes.trim()) return 'unchanged';
  return hasDownstreamAssignment ? 'confirm-and-invalidate' : 'commit';
}
```

- [ ] **Step 4: Rerun the test and commit**

Expected: PASS.

```bash
git add packages/batch-frontend/src/ui/assignments/assignment-workflow.ts packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts
git commit -m "refactor(frontend): centralize assignment workflow decisions"
```

---

### Task 2: Make Navigation User-Owned

**Slice:** 1

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`

**Interfaces:**

- Consumes: `resolveInitialAssignmentStep` and existing explicit navigation callbacks.
- Produces: one hydration per session ID and no derived-state navigation effect.

- [ ] **Step 1: Add failing integration regressions**

Add one resumed-assignment test that clicks Teaching context, lets session/readiness mocks update, and still finds the Learner context heading. Add one new-assignment test that spies on `HTMLElement.prototype.scrollIntoView`, completes upload, and asserts no call and no step change.

```tsx
await user.click(screen.getByRole('button', { name: /Teaching context/i }));
expect(screen.getByRole('heading', { name: /Learner context/i })).toBeTruthy();
await waitFor(() => expect(api.listAssignmentSessions).toHaveBeenCalled());
expect(screen.getByRole('heading', { name: /Learner context/i })).toBeTruthy();
```

Use the actual session API mock exported by the harness if its name differs; the observed event must be asynchronous.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
```

Expected: FAIL because the mapping effect reselects a step or the legacy guided effect scrolls.

- [ ] **Step 3: Guard hydration by session ID**

Add:

```ts
const activeStepHydrationKeyRef = useRef<string | null>(null);
```

Replace the repeated mapper effect with:

```ts
useEffect(() => {
  if (!activeAssignmentSession) {
    activeStepHydrationKeyRef.current = null;
    return;
  }
  if (activeStepHydrationKeyRef.current === activeAssignmentSession.id) return;
  activeStepHydrationKeyRef.current = activeAssignmentSession.id;
  setActiveStep(
    resolveInitialAssignmentStep(activeAssignmentSession.currentStage, focusedWorkflowInput),
  );
}, [activeAssignmentSession, focusedWorkflowInput]);
```

- [ ] **Step 4: Delete legacy actionable-stage movement**

Delete `actionableStageId`, its effect that calls `scrollIntoView` and delayed `focus`, and `guidedStageIdsRef` writes used only by it. Preserve focus/scroll calls directly invoked by user buttons.

- [ ] **Step 5: Verify and commit**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
git commit -m "fix(frontend): keep assignment navigation user owned"
```

Expected: PASS.

---

### Task 3: Confirm Teacher-Note Invalidation on Commit

**Slice:** 1

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`

**Interfaces:**

- Produces: `commitTeacherNotes(): Promise<boolean>`.
- Uses: current notes, committed-note baseline, `resetAuthoring`, and session persistence.

- [ ] **Step 1: Add failing interaction tests**

For a resumed draft, spy on `globalThis.confirm`, clear/type the notes, and assert zero calls until Confirm and continue. Then assert exactly one call with the existing consequence copy. Add a cancellation test asserting the edited value and Teaching context remain.

```tsx
await user.clear(notes);
await user.type(notes, 'Focus on articles.');
expect(confirmSpy).not.toHaveBeenCalled();
await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
expect(confirmSpy).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx
```

Expected: FAIL because confirmation occurs during typing.

- [ ] **Step 3: Track the committed baseline**

Add `const committedTeacherNotesRef = useRef('');`. Set it on new-flow reset, snapshot/session hydration, and successful commit using the same normalized value supplied to persistence.

- [ ] **Step 4: Implement a single commit callback**

```ts
const commitTeacherNotes = useCallback(async (): Promise<boolean> => {
  const decision = getTeacherNotesCommitDecision({
    currentNotes: teacherNotes,
    committedNotes: committedTeacherNotesRef.current,
    hasDownstreamAssignment: hasAssignmentContent,
  });
  if (decision === 'unchanged') return true;
  if (
    decision === 'confirm-and-invalidate' &&
    !globalThis.confirm(
      'This will require a new assignment draft. Your lesson source and transcript will stay saved.',
    )
  )
    return false;
  if (decision === 'confirm-and-invalidate') {
    invalidateAuthoringGeneration();
    resetAuthoring();
    setJobStatusState(null);
  }
  const saved = await saveAssignmentSessionProgress({
    teacherNotes: teacherNotes.trim() || null,
    currentStage: 'assignment',
  });
  if (!saved) return false;
  committedTeacherNotesRef.current = teacherNotes.trim();
  return true;
}, [
  hasAssignmentContent,
  invalidateAuthoringGeneration,
  resetAuthoring,
  saveAssignmentSessionProgress,
  teacherNotes,
]);
```

- [ ] **Step 5: Route explicit consumption through the callback**

Call it before leaving Teaching context and before any direct generation path consuming dirty notes. Replace the textarea handler with only `markAssignmentUserEdit(); setTeacherNotes(value);`. Prevent the debounced session-settings effect from persisting uncommitted notes; persist them there only when they equal `committedTeacherNotesRef.current`.

- [ ] **Step 6: Verify and commit**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/assignment-workflow.test.ts src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
git commit -m "fix(frontend): confirm context invalidation on commit"
```

Expected: PASS; cancellation preserves notes and step.

---

### Task 4: Replace the Dead Final Footer Action

**Slice:** 1

**Files:**

- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`

**Interfaces:**

- Adds optional `onContinue`, `continueLabel`, `onComplete`, and `completionLabel` props.

- [ ] **Step 1: Add failing tests**

Assert Review without publish has no `Assignment ready`. Render `completionLabel="Start another assignment"`, click it, and assert `onComplete` once. In the integrated published flow, click Start another assignment and assert Student/start controls return and the published link disappears.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/AssignmentWorkflow.navigation.test.tsx src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
```

- [ ] **Step 3: Make footer actions optional**

```tsx
{
  onComplete && completionLabel ? (
    <ProductButton onClick={onComplete}>{completionLabel}</ProductButton>
  ) : onContinue && continueLabel ? (
    <ProductButton onClick={onContinue} disabled={continueDisabled}>
      {continueLabel}
    </ProductButton>
  ) : null;
}
```

Pass continue props only outside Review. On `activeStep === 'review' && jobReady`, pass `completionLabel="Start another assignment"` and `onComplete={handleStartNewAssignmentWithSessionReset}`. Delete the permanent Review disabled branch and `Assignment ready` label.

- [ ] **Step 4: Verify and commit**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/AssignmentWorkflow.test.tsx src/ui/assignments/AssignmentWorkflow.navigation.test.tsx src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
git add packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
git commit -m "fix(frontend): add explicit assignment completion action"
```

Expected: PASS.

---

### Task 5: Slice 1 Reviewer Gate

**Slice:** 1 gate; do not begin Task 6 before acceptance.

- [ ] **Step 1: Run the full Slice 1 target suite**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/assignment-workflow.test.ts src/ui/assignments/AssignmentWorkflow.test.tsx src/ui/assignments/AssignmentWorkflow.navigation.test.tsx src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
```

- [ ] **Step 2: Review the Slice 1 diff**

```bash
git diff 81c157e2..HEAD -- packages/batch-frontend/src/ui/assignments packages/batch-frontend/src/ui/minimal
```

Reviewer must confirm every `setActiveStep` is initial hydration or an explicit user callback; no derived effect scrolls/focuses; typing does not confirm/reset; cancellation preserves state; final completion has a real transition.

- [ ] **Step 3: Fix valid findings test-first and rerun Step 1**

Commit each focused correction separately. Record the accepted reviewer result and exact commands in the execution notes before Task 6.

---

### Task 6: Separate Advanced Actions from Diagnostics

**Slice:** 2

**Files:**

- Modify: `AssignmentSupport.tsx`, `MinimalAssignment.tsx`, `MinimalAssignment.advanced.tsx`
- Modify: workflow UI and publish-action tests.

**Interfaces:**

- Produces: visible post-share Advanced actions and separate diagnostic Support details.

- [ ] **Step 1: Replace superseded tests**

Assert Quick reruns and Custom rerun are descendants of the Advanced actions section but not of the `details` containing Support details. Preserve payload assertions.

```tsx
const support = screen.getByText(/^Support details$/i).closest('details')!;
expect(within(support).queryByRole('region', { name: /Quick reruns/i })).toBeNull();
expect(within(support).queryByRole('button', { name: /^Custom rerun$/i })).toBeNull();
```

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx
```

- [ ] **Step 3: Separate rendering**

Render `AdvancedActionsStage` after Review when `jobReady`. Extract and export an `AssignmentDiagnostics` component from `MinimalAssignment.advanced.tsx`, then pass that component inside `AssignmentSupport` through `AssignmentWorkflow.support`. Change its copy to: `Provider, quota, provenance, identifiers, and diagnostic details for this assignment.` Delete the outer Show/Hide advanced-actions gate; retain Custom rerun disclosure.

- [ ] **Step 4: Verify and commit**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
git add packages/batch-frontend/src/ui/assignments/AssignmentSupport.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.advanced.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx
git commit -m "fix(frontend): expose assignment rerun actions"
```

---

### Task 7: Migrate Post-Share Controls to Calm Studio

**Slice:** 2

**Files:**

- Modify: `MinimalAssignment.advanced.tsx`, `MinimalAssignment.css`, `AssignmentWorkflow.css`
- Modify: workflow UI and responsive tests.

- [ ] **Step 1: Add failing vocabulary assertions**

Within Advanced actions, assert buttons do not contain `minimal-primary` or `minimal-secondary`; retain disabled/busy assertions and require `aria-busy="true"` on the active operation.

- [ ] **Step 2: Replace legacy buttons**

Use `ProductButton` for quick reruns, refresh, Custom rerun, queue, republish, cancellation, and completion. Use the existing quiet/secondary variant for low-emphasis controls. If no danger variant exists, extend `ProductButton` and its test using semantic danger tokens.

- [ ] **Step 3: Add focused layout CSS**

```css
.assignment-advanced-actions {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
  padding: clamp(1rem, 2.5vw, 1.5rem);
  border: 1px solid var(--cs-border);
  border-radius: var(--cs-radius-surface);
  background: var(--cs-surface);
}
.assignment-advanced-actions__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.assignment-advanced-actions :is(input, select) {
  border-radius: var(--cs-radius-control);
}
```

Delete post-share-only pill and decorative-gradient rules. Do not globally delete legacy classes still used elsewhere.

- [ ] **Step 4: Verify and commit**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx src/ui/assignments/AssignmentWorkflow.responsive.test.tsx
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.advanced.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.css packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
git commit -m "refactor(frontend): align post-share controls"
```

---

### Task 8: Remove Duplicate Natural Shadow Clips

**Slice:** 2

**Files:**

- Modify: `packages/orchestrator/src/runtime/pronunciation-audio.ts`
- Modify: `packages/orchestrator/tests/runtime.pronunciation-audio.test.ts`
- Test without modification: `packages/html-publisher/tests/rendering.pronunciation-behavior.test.ts` (legacy-manifest compatibility).

- [ ] **Step 1: Add a failing orchestrator regression**

For `asks me to` and `a natural workplace phrase`, assert two `word_item` clips labelled Word, no Natural label, and two synthesis calls. Preserve/add a test proving distinct `naturalSentence` primary audio remains for connected speech or sentence-level modes.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm --filter @esl-pipeline/orchestrator exec vitest run tests/runtime.pronunciation-audio.test.ts
```

- [ ] **Step 3: Remove duplicate generation**

Delete `isLongShadowDrill` and the block that pushes `shadow-word-${index + 1}-natural` with identical `normalizedWord`. Do not change `resolvePrimaryText` handling of real `focus.naturalSentence` values.

- [ ] **Step 4: Verify and commit**

```bash
corepack pnpm --filter @esl-pipeline/orchestrator exec vitest run tests/runtime.pronunciation-audio.test.ts
corepack pnpm --filter @esl-pipeline/html-publisher exec vitest run tests/rendering.pronunciation-behavior.test.ts
corepack pnpm --filter @esl-pipeline/orchestrator typecheck
git add packages/orchestrator/src/runtime/pronunciation-audio.ts packages/orchestrator/tests/runtime.pronunciation-audio.test.ts
git commit -m "fix(orchestrator): remove duplicate natural shadow clips"
```

Keep publisher fixtures that intentionally prove legacy manifests still render; stage that test only if it changes.

---

### Task 9: Align Current Documentation

**Slice:** 2

**Files:**

- Modify: `packages/batch-frontend/README.md`
- Modify: `docs/backend-frontend/backend-frontend-alignment.md`
- Modify: `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`

- [ ] **Step 1: Document live workflow behavior**

State user-owned navigation, explicit Start another assignment completion, Advanced actions as post-share operations, and Support details as diagnostics.

- [ ] **Step 2: Document pronunciation semantics**

Add: `shadow_sentence` produces one item-level Word clip per authored drill; Natural sentence audio requires a distinct parsed `naturalSentence`; legacy manifests with duplicate clips remain renderable.

- [ ] **Step 3: Format, validate, and commit**

```bash
corepack pnpm exec prettier --write packages/batch-frontend/README.md docs/backend-frontend/backend-frontend-alignment.md docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md
corepack pnpm docs:generate:indexes
corepack pnpm format
corepack pnpm docs:check
git add packages/batch-frontend/README.md docs/backend-frontend/backend-frontend-alignment.md docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md docs/generated
git commit -m "docs(assignments): align workflow and audio behavior"
```

Stage generated files only when changed.

---

### Task 10: Slice 2 Review, Combined Validation, and One PR

**Slice:** 2 gate and PR readiness

- [ ] **Step 1: Run all targeted tests**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/assignment-workflow.test.ts src/ui/assignments/AssignmentWorkflow.test.tsx src/ui/assignments/AssignmentWorkflow.navigation.test.tsx src/ui/assignments/AssignmentWorkflow.responsive.test.tsx src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx
corepack pnpm --filter @esl-pipeline/orchestrator exec vitest run tests/runtime.pronunciation-audio.test.ts
corepack pnpm --filter @esl-pipeline/html-publisher exec vitest run tests/rendering.pronunciation-behavior.test.ts
```

- [ ] **Step 2: Run typechecks and broad gates**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
corepack pnpm --filter @esl-pipeline/orchestrator typecheck
corepack pnpm --filter @esl-pipeline/html-publisher typecheck
corepack pnpm --silent run check:fast:agent
corepack pnpm check:pre-pr
```

Read reported `tmp/check-logs/...` artifacts before rerunning raw commands.

- [ ] **Step 3: Perform browser smoke**

Run the mock-auth sandbox and verify desktop plus narrow widths: no typing dialog; one commit dialog; cancellation preserves notes/step; async operations never move or scroll; no pre-publish Assignment ready; post-publish Start another assignment resets; Advanced actions is outside Support details; controls have Calm Studio geometry and keyboard states; regenerated shadow items show one Word control and no identical Natural control.

- [ ] **Step 4: Review the combined diff**

```bash
git diff 81c157e2..HEAD --stat
git diff 81c157e2..HEAD -- packages/batch-frontend packages/orchestrator packages/html-publisher docs
```

Confirm Slice 1 remains intact, action payloads/defaults are unchanged, legacy manifests render, no schema/DTO change exists, and documentation describes live behavior. Fix valid findings test-first and rerun Steps 1-2.

- [ ] **Step 5: Push one branch and create one PR**

Use `release:patch` because this is a bugfix/UX correction without contract expansion. Fill `.github/pull_request_template.md` sections `Summary`, `Validation`, `Risk Notes`, and `Checklist` with actual evidence.

```bash
git push -u origin codex/assignment-workflow-remediation-plan
gh pr create --base main --head codex/assignment-workflow-remediation-plan --title "fix(frontend): repair assignment workflow interactions" --body-file .github/pull_request_template.md --label release:patch
gh pr view --json url,labels
```

Verify exactly one release label. Stop after PR readiness; do not deploy.

---

## Plan Self-Review

- All six reports map to Tasks 2-4 and 6-8.
- Task 5 is a hard reviewer gate before Slice 2; Task 10 reviews the integrated branch.
- One branch, one PR, and one future manual deployment are explicit.
- Helper and prop names are defined before consumption.
- No DTO, database, manifest schema, or provider-default change is planned.
- No implementation placeholder remains.
