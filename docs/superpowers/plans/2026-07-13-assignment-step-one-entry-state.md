# Assignment Step One Entry-State Implementation Plan

> **Execution note:** Implement this plan inline, task by task. Keep the sandbox available after
> each visible slice so the maintainer can annotate the real UI. Do not start reviewer, CI, PR, or
> deployment work until the sandbox design is explicitly accepted.

**Goal:** Replace the mixed Step 1 screen with a mutually exclusive entry state machine: choose
Resume or New, complete only that route, and show a compact summary when revisiting Step 1.

**Architecture:** Keep workflow and persistence ownership in `MinimalAssignment`, but extract the
Step 1 presentation into a focused `AssignmentEntryStep`. Add a pure entry-state presenter that maps
the existing session/job data to teacher-facing states, labels, and explicit destinations. The
controller owns route transitions and performs workflow navigation only after a user activates the
route's primary action. Existing APIs and DTOs remain unchanged.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, existing Calm Studio components and
CSS tokens.

**Design contract:**
`docs/superpowers/specs/2026-07-13-assignment-step-one-entry-state-design.md`

## Global Constraints

- Resume and New appear together only in the default-choice state.
- Step 1 renders at most one primary action after a route is selected.
- Step 1 never renders the shared workflow Back action.
- A route or workflow step changes only after an explicit user action, except one-time URL/session
  hydration on initial load.
- Resume never renders the learner picker or generic `Confirm and continue`; New never renders
  recent assignments or Resume actions.
- Recent assignments and learners load automatically. Do not add polling or routine Refresh
  controls.
- Use only current frontend data. Lesson title is optional; never substitute a raw lesson ID.
- Only saved sessions claim a persisted workflow step. Every job-backed item opens Review & share.
- New Continue clears prior assignment artifacts while preserving the validated learner selected in
  the New route.
- Preserve current resume hydration, selected-student validation, linked-lesson locking, artifact
  invalidation, assignment-session persistence, and query-string behavior.
- Do not change backend endpoints, DTOs, contracts, database state, or persistence semantics.
- Sandbox scenario fixtures are allow-listed, dev-only adapter behavior and never enter production
  request paths.
- Do not redesign Steps 2 through 5.
- Do not touch `docs/design/reviews/~$signment-main-flow-ui-review.docx`.
- Keep `.impeccable/critique/2026-07-13T14-30-35Z__ontend-src-ui-minimal-minimalassignment-stages-tsx.md`
  uncommitted unless the maintainer explicitly asks to include critique artifacts.

---

### Task 1: Define the entry-state and recent-assignment presentation model

**Files:**

- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.ts`
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.test.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.ts`
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.test.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`

**Interfaces:**

```ts
export type AssignmentEntryView = 'choice' | 'resume' | 'new' | 'summary';

export type RecentAssignmentState =
  | 'unfinished'
  | 'in-progress'
  | 'ready-to-share'
  | 'published'
  | 'needs-attention';

export interface RecentAssignmentItem {
  id: string;
  learnerName: string;
  lessonTitle?: string;
  activityLabel: string;
  outcomeLabel: string;
  timeLabel: string;
  state: RecentAssignmentState;
  statusLabel: string;
  statusTone: 'success' | 'progress' | 'warning' | 'neutral';
  actionLabel:
    | 'Continue assignment'
    | 'Review progress'
    | 'Review assignment'
    | 'Open assignment'
    | 'Review issue';
  destination: AssignmentStepId;
  selected: boolean;
}
```

The internal `id` remains available for selection and hydration but is never rendered as support
copy. Sessions map their saved `currentStage` to the corresponding workflow destination. Every
job-backed item opens Review & share because `JobStatusDto` has no saved workflow stage. Jobs map:

- queued/running -> in progress / `Review progress` / Review & share
- awaiting approval -> ready to share
- succeeded with `htmlUrl` -> published
- succeeded without `htmlUrl` -> ready to share
- failed -> needs attention

- [ ] **Step 1: Write failing pure-function tests**

Cover every `JobState`, every saved session stage, published versus unpublished success, explicit
selection, stable newest-first sorting, optional lesson-title omission, and the absence of raw job
or session IDs from all visible labels.

Representative assertions:

```ts
expect(item).toMatchObject({
  id: job.jobId,
  state: 'published',
  statusLabel: 'Published',
  actionLabel: 'Open assignment',
  destination: 'review',
});
expect(
  [
    item.learnerName,
    item.lessonTitle,
    item.activityLabel,
    item.outcomeLabel,
    item.statusLabel,
  ].join(' '),
).not.toContain(job.jobId);
expect(item.lessonTitle).toBeUndefined();
```

- [ ] **Step 2: Run the focused tests to verify RED**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/minimal/MinimalAssignment.entry-state.test.ts \
  src/ui/minimal/MinimalAssignment.resume-presentation.test.ts \
  --testTimeout=15000
```

Expected: FAIL because the new state model does not exist and the current presenter exposes support
IDs and generic status/action semantics.

- [ ] **Step 3: Implement the pure state model and presenter**

Move `ResumeJobListItem` out of the broad stages module and replace it with
`RecentAssignmentItem`. Keep formatting and mapping pure. Use learner names already resolved by the
current `studentNameById` map. Accept a lesson title only if a caller already has one; do not derive
or fetch one from `lessonId`.

Preserve the existing current-assignment card presenter for Review-related compatibility, but stop
using its raw support label in Step 1.

- [ ] **Step 4: Run focused tests and typecheck to verify GREEN**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/minimal/MinimalAssignment.entry-state.test.ts \
  src/ui/minimal/MinimalAssignment.resume-presentation.test.ts \
  --testTimeout=15000
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.ts \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.test.ts \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.ts \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.test.ts \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx
git commit -m "refactor(batch-frontend): model assignment entry states"
```

---

### Task 2: Build the mutually exclusive Step 1 component

**Files:**

- Create: `packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.tsx`
- Create: `packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.test.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/steps/StudentStep.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/steps/StudentStep.test.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.css`

**Component contract:**

`AssignmentEntryStep` receives the active `AssignmentEntryView`, recent-work availability/loading/
error state, recent items and selected ID, learner loading/error/options/selection state, existing
assignment summary, route callbacks, and one submit callback per route. It renders exactly one of:

1. default route choices
2. Resume transaction
3. New transaction containing `StudentStep`
4. existing-assignment summary

- [ ] **Step 1: Write failing component tests for the full state table**

Use a controlled harness and cover:

- initial loading disables both default choices
- no recent work disables Resume without explanatory copy
- default shows Resume and New and no route form
- Resume removes New, learner controls, and `Confirm and continue`
- New removes Resume and all recent-work content
- `Change choice` restores the unselected default
- Resume starts without a radio selection and with a disabled primary
- selected rows expose status-specific action labels and consequence copy
- loading, error/`Try again`, opening, learner empty/error, learner selected, and starting states
- summary shows learner, origin, every assignment state including `In progress` and
  `Needs attention`, and `Change assignment`
- no routine Refresh control or raw ID is visible
- each non-default state has no more than one primary action

Use native radio inputs inside a labelled fieldset. Verify keyboard selection with `userEvent.tab()`
and arrow/space interaction supported by the browser's native radio behavior.

- [ ] **Step 2: Run the component tests to verify RED**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/assignments/steps/AssignmentEntryStep.test.tsx \
  src/ui/assignments/steps/StudentStep.test.tsx \
  --testTimeout=15000
```

Expected: FAIL because the extracted component and mutually exclusive route states do not exist.

- [ ] **Step 3: Implement the component without controller side effects**

- Render route buttons only in `choice`.
- Render a skeleton in the route content region while its data loads.
- Disable route changes and submission while opening/starting.
- Make `Try again` reload only the failed collection.
- Use existing `ProductButton` variants and Calm Studio tokens.
- Keep the chosen learner visible during `Starting…` and the chosen assignment visible during
  `Opening…`.
- Keep `StudentStep` responsible only for learner selection/summary; do not let it wrap Resume or
  default content.
- Delete the old `StartStageSection` choice/resume markup after the new component covers it.
- Remove obsolete `minimal-choice-card`, legacy resume listbox, manual-refresh, and support-ID CSS.
- Stack row metadata and primary actions cleanly at narrow widths without changing behavior.

- [ ] **Step 4: Run component tests and typecheck to verify GREEN**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/assignments/steps/AssignmentEntryStep.test.tsx \
  src/ui/assignments/steps/StudentStep.test.tsx \
  --testTimeout=15000
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: component tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.tsx \
  packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.test.tsx \
  packages/batch-frontend/src/ui/assignments/steps/StudentStep.tsx \
  packages/batch-frontend/src/ui/assignments/steps/StudentStep.test.tsx \
  packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.css
git commit -m "feat(batch-frontend): add focused assignment entry step"
```

---

### Task 3: Integrate explicit route transitions and loading state

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-basic.test.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-student-selection.test.tsx`

**Controller changes:**

- Replace `StartStageMode` with `AssignmentEntryView`.
- Add `studentOptionsLoading` to `SourceController`; set it before the initial/retry request and
  clear it in `finally`.
- Extend source reset with an explicit committed learner override:

```ts
export interface SourceResetOptions {
  resetStudent?: boolean;
  nextStudentId?: string;
}
```

When `nextStudentId` is present, it wins over `resetStudent` and becomes the selected learner after
the rest of the source state is cleared.

- Change resume opening to return an explicit result rather than navigating implicitly:

```ts
export interface ResumeOpenSuccess {
  ok: true;
  itemId: string;
  state: RecentAssignmentState;
  destination: AssignmentStepId;
}

export type ResumeOpenResult = ResumeOpenSuccess | { ok: false };
```

- Add `onInitialHydrationResolved(result: ResumeOpenSuccess): void` to the resume-controller input.
  Invoke it once after successful `?sessionId=` or `?jobId=` hydration; never invoke it for later
  collection refreshes.
- Keep this initial query/session result as the sole non-click navigation exception.
- Move the Step 1 primary action into `AssignmentEntryStep`; do not pass the generic workflow
  `onContinue` while `activeStep === 'student'`.

- [ ] **Step 1: Write failing integration regressions**

Add tests proving:

1. fresh load settles on default choice without preselecting a route
2. opening Resume/New swaps the entire transaction rather than appending controls
3. New `Continue` is disabled until a current learner option is selected
4. a stale learner ID cannot enable Continue
5. New `Continue` explicitly moves to Lesson source while preserving the selected learner as the
   learner used by Step 2
6. session resume explicitly moves to its saved step
7. queued, running, ready, published, and failed jobs explicitly move to Review & share
8. a failed open stays on Resume with selection and error intact
9. `Change choice` does not reset or navigate workflow state by itself
10. revisiting Step 1 after starting/resuming shows the summary
11. `Change assignment` uses the existing confirmation/reset path when current work is at risk
12. asynchronous recent-work, learner, job, or session updates never select a route or step
13. Step 1 has no workflow Back or generic `Confirm and continue`
14. initial `?sessionId=` opens the persisted session destination and establishes the Resume summary
    once
15. initial `?jobId=` opens Review & share and establishes the corresponding Resume summary once

- [ ] **Step 2: Run integration tests to verify RED**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx \
  src/ui/minimal/MinimalAssignment.resume-basic.test.tsx \
  src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx \
  src/ui/minimal/MinimalAssignment.prompt-student-selection.test.tsx \
  --testTimeout=15000
```

Expected: FAIL because the parent still treats choosing New as started work, renders the generic
footer action, and lets the old setup component combine route controls.

- [ ] **Step 3: Implement controller integration**

- Initialize the entry view to `choice` when no assignment is hydrated.
- Remove the effect that changes idle choice to New when `hasStartedFlow` changes.
- Do not count choosing the New route alone as a started workflow. Unlock Step 2 only after a valid
  learner is committed by the explicit Continue action. Derive Step 1 completion from the summary/
  committed entry state or real downstream artifacts, not from a tentative picker value.
- Separate `enterNewRoute` from the current reset callback. Merely displaying the New picker must
  not perform a destructive reset; run the established confirmation/reset boundary through
  `Change assignment` or the explicit New Continue action.
- Preserve the current confirmation boundary for starting or changing assignment, but replace the
  zero-argument New reset call with `commitNewAssignment(studentId)`. Validate that `studentId`
  still resolves to a current option, then call the reset path with `nextStudentId: studentId` so
  recording/transcript/authoring/session/job state clears without clearing the committed learner.
- On successful New Continue, set summary origin to New, retain the committed learner, and request
  `source`.
- On successful Resume open, set summary origin to Resume and request only the returned destination.
- Resolve session destinations from `currentStage`. Resolve every job-backed destination to
  `review`, including queued and running jobs; never infer a saved step from job artifacts.
- On open failure, return `{ ok: false }` and do not change the workflow step.
- Derive Resume availability from the loaded session/job collections; if an open Resume route
  reloads to zero items, return to choice and disable Resume.
- Have the resume hook call `onInitialHydrationResolved` after successful URL hydration. The parent
  sets the Resume summary and returned destination once; later collection changes cannot rehydrate
  or move the active step.
- Replace the current `StudentStep > StartStageSection` nesting with `AssignmentEntryStep`, passing
  `StudentStep` only as New-route content if composition remains useful.

- [ ] **Step 4: Run integration tests and typecheck to verify GREEN**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx \
  src/ui/minimal/MinimalAssignment.resume-basic.test.tsx \
  src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx \
  src/ui/minimal/MinimalAssignment.prompt-student-selection.test.tsx \
  --testTimeout=15000
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: all focused integration tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 3**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-basic.test.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-student-selection.test.tsx
git commit -m "feat(batch-frontend): enforce explicit assignment entry routes"
```

---

### Task 4: Remove inactive workflow content from the accessibility tree

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.responsive.test.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`

- [ ] **Step 1: Write failing accessibility and responsive tests**

Assert that inactive workflow mounts have native `hidden` plus `inert`, their controls are absent
from Testing Library role queries, the active mount remains discoverable, and desktop/narrow Step 1
layouts retain one primary action with 44px targets.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/assignments/AssignmentWorkflow.responsive.test.tsx \
  src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx \
  --testTimeout=15000
```

Expected: FAIL because inactive mounts currently rely on off-screen CSS plus `inert`, not native
hidden semantics.

- [ ] **Step 3: Implement native inactive-state isolation**

Add `hidden={activeStep !== step}` while retaining `inert` on every inactive mount. Remove the
fixed-position `left: -100000px` CSS technique. Do not unmount controller-owned steps or change
their persistence behavior.

- [ ] **Step 4: Run focused tests and typecheck to verify GREEN**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/assignments/AssignmentWorkflow.responsive.test.tsx \
  src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx \
  --testTimeout=15000
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: tests PASS; inactive content is excluded from role queries and the narrow layout remains
usable.

- [ ] **Step 5: Commit Task 4**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx \
  packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css \
  packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.responsive.test.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
git commit -m "fix(batch-frontend): hide inactive assignment steps"
```

---

### Task 5: Add a dev-only Step 1 sandbox scenario matrix

**Files:**

- Modify: `packages/batch-frontend/src/dev/frontend-sandbox.ts`
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox.test.ts`
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.ts`
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.test.ts`
- Modify: `packages/batch-frontend/src/utils/api-client.ts`
- Modify: `packages/batch-frontend/README.md`

**Interfaces:**

```ts
export type FrontendSandboxScenario =
  | 'default'
  | 'step-one-no-recent'
  | 'step-one-resume-states'
  | 'step-one-resume-error'
  | 'step-one-no-learners'
  | 'step-one-learner-error'
  | 'step-one-slow';

export function readFrontendSandboxScenario(search: string): FrontendSandboxScenario;

export function createFrontendSandboxApiAdapter(options?: {
  scenario?: FrontendSandboxScenario;
}): AxiosAdapter;
```

The browser reads `sandboxScenario` from `globalThis.location.search` only while explicit mock-auth
sandbox mode is enabled and passes the normalized value into the adapter. Unknown values normalize
to `default`. Production requests never use this adapter.

- [ ] **Step 1: Write failing parser and adapter tests**

Add table-driven tests proving:

```ts
expect(readFrontendSandboxScenario('?sandboxScenario=step-one-no-recent')).toBe(
  'step-one-no-recent',
);
expect(readFrontendSandboxScenario('?sandboxScenario=unknown')).toBe('default');
```

For the adapter, assert:

- `default` retains the current seeded responses
- `step-one-no-recent` returns empty jobs and sessions
- `step-one-resume-states` returns a session plus queued, running, awaiting-approval, published,
  unpublished-success, and failed jobs
- `step-one-resume-error` rejects the recent-work collection request with a contextual sandbox error
- `step-one-no-learners` returns an empty student collection
- `step-one-learner-error` rejects the learner collection request
- `step-one-slow` delays Step 1 collection and assignment-open requests long enough to inspect
  loading labels, using fake timers in tests rather than wall-clock waits

- [ ] **Step 2: Run the sandbox tests to verify RED**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/dev/frontend-sandbox.test.ts \
  src/dev/frontend-sandbox-api.test.ts \
  --testTimeout=15000
```

Expected: FAIL because scenario parsing and scenario-specific adapter responses do not exist.

- [ ] **Step 3: Implement scenario selection inside sandbox mode only**

- Parse the single allow-listed `sandboxScenario` value; do not accept arbitrary fixture data from
  the URL.
- Pass the normalized scenario to `createFrontendSandboxApiAdapter` from `api-client.ts` only when
  `isFrontendSandboxEnabled()` is already true.
- Build scenario responses from the existing `assignmentSession()` and `jobStatus()` helpers.
- Keep the default Step 1 seeds unchanged: three learner options, one succeeded published job, and
  one context-stage assignment session.
- Implement delay with an adapter-local promise helper and a fixed 1500ms duration; do not add
  production timers, polling, or environment variables.
- Document the seven URLs in the frontend README, including that `jobId`/`sessionId` may be added to
  test initial hydration.

- [ ] **Step 4: Run sandbox tests and typecheck to verify GREEN**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/dev/frontend-sandbox.test.ts \
  src/dev/frontend-sandbox-api.test.ts \
  --testTimeout=15000
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: sandbox tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 5**

```bash
git add packages/batch-frontend/src/dev/frontend-sandbox.ts \
  packages/batch-frontend/src/dev/frontend-sandbox.test.ts \
  packages/batch-frontend/src/dev/frontend-sandbox-api.ts \
  packages/batch-frontend/src/dev/frontend-sandbox-api.test.ts \
  packages/batch-frontend/src/utils/api-client.ts \
  packages/batch-frontend/README.md
git commit -m "test(batch-frontend): add assignment entry sandbox scenarios"
```

---

### Task 6: Focused regression gate and maintainer sandbox review

**Files:**

- Modify only if behavior changed during annotated sandbox iteration: focused frontend files and
  their matching tests from Tasks 1 through 5
- Do not modify backend, contracts, deployment, release, or production files

- [ ] **Step 1: Run the complete Step 1 focused suite**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/assignments/steps/AssignmentEntryStep.test.tsx \
  src/ui/assignments/steps/StudentStep.test.tsx \
  src/ui/assignments/AssignmentWorkflow.test.tsx \
  src/ui/assignments/AssignmentWorkflow.navigation.test.tsx \
  src/ui/assignments/AssignmentWorkflow.responsive.test.tsx \
  src/ui/minimal/MinimalAssignment.entry-state.test.ts \
  src/ui/minimal/MinimalAssignment.resume-presentation.test.ts \
  src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx \
  src/ui/minimal/MinimalAssignment.resume-basic.test.tsx \
  src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx \
  src/ui/minimal/MinimalAssignment.prompt-student-selection.test.tsx \
  --testTimeout=15000
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: all focused tests and typecheck PASS.

- [ ] **Step 2: Start the existing frontend sandbox**

Use the repository's documented mock-data command/path already used for the current UI iteration.
Use the documented `sandboxScenario` URLs from Task 5; do not substitute production data.

- [ ] **Step 3: Review every state at desktop and narrow widths**

Walk through:

1. default scenario with recent work
2. `step-one-no-recent`
3. `step-one-resume-states`, including unselected and every session/job state
4. `step-one-resume-error`
5. normal New selection plus `step-one-no-learners` and `step-one-learner-error`
6. `step-one-slow` for collection and opening feedback; verify New `Starting…` in the controlled
   component test because New has no network request that the sandbox can safely delay
7. existing summary after New, session Resume, processing job, published job, and failed job
8. explicit destinations for saved sessions and every job-backed state

Confirm there is never mixed Resume/New route content, more than one primary action, a Step 1 Back
button, a routine Refresh button, raw support IDs, or inactive controls in the accessibility tree.

- [ ] **Step 4: Pause for maintainer annotations**

Treat new browser annotations as part of sandbox iteration. Apply only approved frontend
presentation corrections with matching focused regressions. Do not dispatch reviewers or begin PR
work during this loop.

- [ ] **Step 5: Commit accepted sandbox corrections**

```bash
git commit -m "fix(batch-frontend): polish assignment entry states"
```

Before committing, inspect `git diff --name-only` and stage each accepted Step 1 frontend or test
file by its exact path. Skip this commit if the sandbox review produces no changes.

---

### Task 7: Post-approval branch validation and handoff

Run this task only after the maintainer explicitly accepts the sandbox behavior.

- [ ] **Step 1: Run formatter and repository hygiene**

```bash
corepack pnpm format:write
corepack pnpm format
corepack pnpm run lint:repo-hygiene
```

- [ ] **Step 2: Run the affected frontend lane**

```bash
corepack pnpm --silent run check:fast:agent
```

On failure, inspect the reported `tmp/check-logs/...` artifact before rerunning a raw lane.

- [ ] **Step 3: Re-run the focused Step 1 suite and typecheck**

Use the Task 6 command against the formatted tree.

- [ ] **Step 4: Verify the final diff**

```bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
```

Confirm there are no backend/DTO/database changes and neither untracked local artifact is staged.

- [ ] **Step 5: Commit only mechanical formatting if required**

```bash
git commit -m "style(batch-frontend): format assignment entry flow"
```

Before committing, inspect the formatter diff and stage each in-scope file by its exact path. Skip
this commit if formatting produced no changes. Stop after the validated branch handoff unless the
maintainer separately requests review, push, PR, CI monitoring, or deployment.
