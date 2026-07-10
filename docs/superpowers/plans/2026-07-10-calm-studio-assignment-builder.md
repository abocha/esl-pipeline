# Calm Studio Assignment Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated shell and continuous-scroll assignment UI with the approved Calm Studio shell and a persistent five-step assignment builder while preserving existing workflow behavior.

**Architecture:** Keep `MinimalAssignment.tsx` as the controller composition root during migration, extract pure workflow/dependency decisions, and render one active step through a new assignment workspace. Move existing controller behavior into focused step components, place advanced machinery under Support details, and delete the old stage presentation only after behavior parity is proven.

**Tech Stack:** React 19, TypeScript 6, React Router 7, Lucide React, CSS custom properties, Vitest, Testing Library, Vite.

## Global Constraints

- Preserve authentication, routes, API clients, assignment sessions, polling, resume, capability gating, generation, preview, publish, and recovery behavior.
- Use the prerequisite plan `2026-07-10-manual-transcript-source.md` before enabling pasted-transcript entry.
- Audio upload promises and accepts only `.opus` during alpha.
- The temporary product mark is `ESL`, not `ES`.
- Default body/form text is 16px, navigation/supporting copy is 14px, and concise metadata is no smaller than 12px.
- General containers use 4-6px radii; buttons and inputs use approximately 4px radii; pills are reserved for status.
- Use Lucide icons with text for global navigation and five workflow steps.
- Primary touch targets are at least 44px; compact secondary controls are at least 40px.
- Back and completed-step navigation never silently discards work.
- Changing upstream data invalidates only dependent downstream artifacts and requires confirmation before destructive regeneration.
- Advanced actions, IDs, provider controls, quotas, and provenance are not a sixth primary step.
- Student, Business, Assignment Templates, and authentication routes remain operational throughout.

---

## File Structure

### Create

- `packages/batch-frontend/src/ui/system/CalmStudio.tokens.css` - color, type, spacing, geometry, focus, motion, and z-index tokens.
- `packages/batch-frontend/src/ui/system/ProductButton.tsx` and `.test.tsx` - button/link hierarchy and busy/disabled states.
- `packages/batch-frontend/src/ui/system/ProductNotice.tsx` and `.test.tsx` - semantic guidance/error/status blocks.
- `packages/batch-frontend/src/ui/system/SupportDetails.tsx` and `.test.tsx` - accessible diagnostic disclosure.
- `packages/batch-frontend/src/ui/shell/CalmStudioShell.tsx`, `.css`, and `.test.tsx` - authenticated shell and responsive navigation.
- `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts` and `.test.ts` - step/status/dependency model.
- `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx`, `.css`, and `.test.tsx` - progress, active-step canvas, guidance rail, and navigation controls.
- `packages/batch-frontend/src/ui/assignments/steps/StudentStep.tsx` - learner selection and resume/new entry.
- `packages/batch-frontend/src/ui/assignments/steps/LessonSourceStep.tsx` - OPUS upload, transcript processing/editing, and pasted transcript source.
- `packages/batch-frontend/src/ui/assignments/steps/TeachingContextStep.tsx` - learner context and teacher notes.
- `packages/batch-frontend/src/ui/assignments/steps/CreateAssignmentStep.tsx` - prompt readiness, generation, validation, and draft editing.
- `packages/batch-frontend/src/ui/assignments/steps/ReviewShareStep.tsx` - preview, publish, job progress, and handout link.
- `packages/batch-frontend/src/ui/assignments/AssignmentSupport.tsx` - reruns, provider controls, quotas, provenance, and cancellation.
- `packages/batch-frontend/src/ui/assignments/assignment-step-props.ts` - focused prop contracts shared by the composition root and step components.
- `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx` - back/forward/dirty-state behavior.
- `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.responsive.test.tsx` - DOM contracts for desktop/tablet/narrow presentations.

### Modify

- `packages/batch-frontend/src/index.css` - remove ornamental global defaults and import Calm Studio tokens.
- `packages/batch-frontend/src/ui/App.tsx` - use `CalmStudioShell`.
- `packages/batch-frontend/src/ui/App.test.tsx` - shell and route regression coverage.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx` - compose normalized workflow and focused steps.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts` - OPUS-only input and manual transcript source action.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts` - restore the active UI step from durable session state.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts` - expose explicit stale/dirty actions to the workflow layer.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx` - test helpers for step navigation and manual transcript API.
- Existing assignment behavior tests - update selectors to active-step views without weakening assertions.
- `packages/batch-frontend/README.md` and `docs/backend-frontend/backend-frontend-alignment.md` - document the new UI model.

### Delete after parity

- `packages/batch-frontend/src/ui/minimal/MinimalShell.tsx`
- `packages/batch-frontend/src/ui/minimal/MinimalShell.css`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- Replaced rules in `packages/batch-frontend/src/ui/minimal/MinimalAssignment.css`

---

### Task 1: Build the pure workflow and invalidation model

**Files:**

- Create: `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts`
- Create: `packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts`

**Interfaces:**

- Produces:

```ts
export type AssignmentStepId = 'student' | 'source' | 'context' | 'create' | 'review';
export type AssignmentStepStatus = 'complete' | 'current' | 'available' | 'locked';
export type AssignmentArtifact = 'transcript' | 'prompt' | 'draft' | 'preview' | 'publishedJob';
export type AssignmentInputChange =
  | 'student'
  | 'recording'
  | 'transcript'
  | 'teacherNotes'
  | 'draft';

export interface AssignmentWorkflowInput {
  selectedStudent: boolean;
  transcriptReady: boolean;
  promptReady: boolean;
  draftReady: boolean;
  previewReady: boolean;
  published: boolean;
}

export interface AssignmentWorkflowStep {
  id: AssignmentStepId;
  label: string;
  status: AssignmentStepStatus;
}

export function deriveAssignmentWorkflow(input: AssignmentWorkflowInput): AssignmentWorkflowStep[];
export function getInvalidatedArtifacts(change: AssignmentInputChange): AssignmentArtifact[];
export function mapSessionStageToStep(
  stage: AssignmentSessionStage,
  input: AssignmentWorkflowInput,
): AssignmentStepId;
```

- [ ] **Step 1: Write failing table-driven tests**

Cover empty flow, student selected, transcript ready, prompt ready, draft ready, preview ready, and published. Include these invalidation expectations:

```ts
expect(getInvalidatedArtifacts('student')).toEqual([
  'transcript',
  'prompt',
  'draft',
  'preview',
  'publishedJob',
]);
expect(getInvalidatedArtifacts('recording')).toEqual([
  'transcript',
  'prompt',
  'draft',
  'preview',
  'publishedJob',
]);
expect(getInvalidatedArtifacts('transcript')).toEqual([
  'prompt',
  'draft',
  'preview',
  'publishedJob',
]);
expect(getInvalidatedArtifacts('teacherNotes')).toEqual([
  'prompt',
  'draft',
  'preview',
  'publishedJob',
]);
expect(getInvalidatedArtifacts('draft')).toEqual(['preview', 'publishedJob']);
```

- [ ] **Step 2: Run the test and verify failure**

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/assignment-workflow.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure functions**

Define labels exactly as `Student`, `Lesson source`, `Teaching context`, `Create`, and `Review & share`. Derive the first incomplete step as `current`, earlier steps as `complete`, the immediately reachable next step as `available`, and dependency-blocked steps as `locked`. `mapSessionStageToStep('source', input)` returns `student` when no learner is selected and `source` otherwise; the remaining durable stages map to `context`, `create`, and `review`.

- [ ] **Step 4: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```powershell
git add packages/batch-frontend/src/ui/assignments/assignment-workflow.ts packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts
git commit -m "feat(frontend): model assignment workflow steps"
```

---

### Task 2: Establish Calm Studio tokens and primitives

**Files:**

- Create: `packages/batch-frontend/src/ui/system/CalmStudio.tokens.css`
- Create: `packages/batch-frontend/src/ui/system/ProductButton.tsx`
- Create: `packages/batch-frontend/src/ui/system/ProductButton.test.tsx`
- Create: `packages/batch-frontend/src/ui/system/ProductNotice.tsx`
- Create: `packages/batch-frontend/src/ui/system/ProductNotice.test.tsx`
- Create: `packages/batch-frontend/src/ui/system/SupportDetails.tsx`
- Create: `packages/batch-frontend/src/ui/system/SupportDetails.test.tsx`
- Modify: `packages/batch-frontend/src/index.css:1-340`

**Interfaces:**

- Produces: `ProductButton`, `ProductNotice`, and `SupportDetails` with complete semantic states.
- Produces: `--cs-*` tokens consumed by shell and assignment styles.

- [ ] **Step 1: Write failing component tests**

Assert that busy buttons disable interaction and expose `aria-busy`, notices use `role="alert"` only for errors, and Support details uses a native disclosure:

```tsx
render(<ProductButton busy>Saving</ProductButton>);
expect(screen.getByRole('button', { name: 'Saving' })).toHaveAttribute('aria-busy', 'true');
expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled();

render(
  <ProductNotice tone="error" title="Unable to save">
    Try again.
  </ProductNotice>,
);
expect(screen.getByRole('alert')).toHaveTextContent('Unable to save');

render(<SupportDetails summary="Support details">Diagnostic text</SupportDetails>);
expect(screen.getByText('Support details').closest('summary')).not.toBeNull();
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/system/ProductButton.test.tsx src/ui/system/ProductNotice.test.tsx src/ui/system/SupportDetails.test.tsx
```

Expected: imports fail because components do not exist.

- [ ] **Step 3: Add exact token baseline**

Define at least these tokens:

```css
:root {
  --cs-canvas: #fafbfc;
  --cs-surface: #ffffff;
  --cs-surface-muted: #f0f3f6;
  --cs-ink: #1d2935;
  --cs-ink-muted: #596777;
  --cs-action: #214f80;
  --cs-action-hover: #183f69;
  --cs-selection: #dce7f2;
  --cs-border: #d6dde4;
  --cs-success: #507660;
  --cs-warning: #8a6518;
  --cs-error: #a53f35;
  --cs-radius-control: 4px;
  --cs-radius-surface: 6px;
  --cs-text-body: 1rem;
  --cs-text-support: 0.875rem;
  --cs-text-meta: 0.75rem;
  --cs-control-primary: 44px;
  --cs-control-compact: 40px;
  --cs-focus: 0 0 0 3px rgb(33 79 128 / 22%);
  --cs-motion-fast: 160ms cubic-bezier(0.22, 1, 0.36, 1);
  --cs-z-nav: 100;
  --cs-z-dialog-backdrop: 300;
  --cs-z-dialog: 400;
  --cs-z-toast: 500;
}
```

Import the token file from `index.css`, make Sarabun/system sans the operational font, and remove display-font, cream-paper, gradient, glow, and 22-28px radius defaults from global product controls. Do not yet delete student-specific compatibility aliases needed by unmigrated routes.

- [ ] **Step 4: Implement primitives and run tests**

`ProductButton` accepts `variant: 'primary' | 'secondary' | 'quiet' | 'danger'`, `busy`, `icon`, and native button props. `ProductNotice` accepts `tone: 'info' | 'success' | 'warning' | 'error'`, `title`, optional `icon`, and children. `SupportDetails` renders `<details><summary>...</summary><div>...</div></details>` and does not use a modal.

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/batch-frontend/src/index.css packages/batch-frontend/src/ui/system
git commit -m "feat(frontend): add Calm Studio design foundation"
```

---

### Task 3: Replace the authenticated application shell

**Files:**

- Create: `packages/batch-frontend/src/ui/shell/CalmStudioShell.tsx`
- Create: `packages/batch-frontend/src/ui/shell/CalmStudioShell.css`
- Create: `packages/batch-frontend/src/ui/shell/CalmStudioShell.test.tsx`
- Modify: `packages/batch-frontend/src/ui/App.tsx:1-285`
- Modify: `packages/batch-frontend/src/ui/App.test.tsx`

**Interfaces:**

- Consumes: Calm Studio tokens and Lucide icons.
- Produces: authenticated shell with `ESL`, global left navigation, route canvas, skip link, responsive collapse, user identity, sandbox badge, and logout.

- [ ] **Step 1: Write failing shell tests**

Assert visible text and accessible route labels:

```tsx
expect(screen.getByText('ESL')).toBeVisible();
expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
expect(screen.getByRole('link', { name: /Assignments/i })).toHaveAttribute('href', '/');
expect(screen.getByRole('link', { name: /Students/i })).toHaveAttribute('href', '/students');
expect(screen.getByRole('link', { name: /Business/i })).toHaveAttribute('href', '/business');
expect(screen.getByRole('link', { name: /Assignment Templates/i })).toHaveAttribute(
  'href',
  '/prompts',
);
```

Assert every icon has `aria-hidden="true"` when adjacent text supplies the name and that the menu toggle has an explicit accessible name at narrow width.

- [ ] **Step 2: Run tests and verify failure**

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/shell/CalmStudioShell.test.tsx src/ui/App.test.tsx
```

Expected: new shell import/test fails and the old mark still reads `ES`.

- [ ] **Step 3: Implement and route the shell**

Use `CalendarDays`, `Users`, `ChartNoAxesCombined`, `FileText`, `LogOut`, and `Menu` from Lucide. Keep `<Outlet />`, `#main-content`, current auth props, sandbox behavior, and logout callback. Use CSS grid with a 225px desktop rail, 64px tablet icon rail, and narrow-screen drawer controlled by a button with `aria-expanded`.

Replace the `MinimalShell` lazy-independent import in `App.tsx` with `CalmStudioShell`; routes remain unchanged.

- [ ] **Step 4: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```powershell
git add packages/batch-frontend/src/ui/shell packages/batch-frontend/src/ui/App.tsx packages/batch-frontend/src/ui/App.test.tsx
git commit -m "feat(frontend): replace authenticated app shell"
```

---

### Task 4: Introduce the focused workflow frame without changing controllers

**Files:**

- Create: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx`
- Create: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css`
- Create: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.test.tsx`
- Create: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx:1280-1780`

**Interfaces:**

- Consumes: `AssignmentWorkflowStep[]` from Task 1.
- Produces:

```ts
export interface AssignmentWorkflowProps {
  steps: readonly AssignmentWorkflowStep[];
  activeStep: AssignmentStepId;
  highestAvailableStep: AssignmentStepId;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  guidance?: React.ReactNode;
  support?: React.ReactNode;
  onStepRequest: (step: AssignmentStepId) => void;
  onBack: () => void;
  onContinue: () => void;
  continueLabel: string;
  continueDisabled?: boolean;
  children: React.ReactNode;
}
```

- [ ] **Step 1: Write failing progress and navigation tests**

Test semantic icons/text for five steps, active-step `aria-current="step"`, disabled locked steps, clickable completed steps, Back, and `Confirm and continue`. Test that a dirty upstream change calls the supplied confirmation callback before moving.

- [ ] **Step 2: Run tests and verify failure**

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/AssignmentWorkflow.test.tsx src/ui/assignments/AssignmentWorkflow.navigation.test.tsx
```

Expected: imports fail.

- [ ] **Step 3: Implement the frame**

Use `UserRound`, `AudioLines`, `BookOpen`, `Sparkles`, and `Send` for the five step icons. Render a `<nav aria-label="Assignment progress">` containing buttons for complete/current/available steps and non-interactive locked steps. Keep text labels and state text. Render only `children` for the active step, with optional guidance in a right rail and support below the primary workflow.

- [ ] **Step 4: Connect the frame to existing stage components**

In `MinimalAssignment.tsx`, derive the new five-step model from existing controller facts, hold `activeStep` in state, restore it from `resume.activeAssignmentSession.currentStage`, and temporarily select one existing stage component at a time. Map old `start` behavior into the Student step, old `source` into Lesson source, old `context` into Teaching context, old `assignment` into Create, and old `review` into Review & share. Render `AdvancedActionsStage` through the `support` prop.

Remove the auto-scroll/focus effect at lines 1504-1553 only after active-step tests prove focus moves to the new step heading.

- [ ] **Step 5: Run assignment workflow regression tests and commit**

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/AssignmentWorkflow.test.tsx src/ui/assignments/AssignmentWorkflow.navigation.test.tsx src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/minimal/MinimalAssignment.resume-basic.test.tsx
```

Expected: PASS; only one primary stage is visible at a time and existing behavior callbacks remain intact.

```powershell
git add packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.test.tsx packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx
git commit -m "feat(frontend): focus assignment workflow by step"
```

---

### Task 5: Migrate Student and Lesson source

**Files:**

- Create: `packages/batch-frontend/src/ui/assignments/assignment-step-props.ts`
- Create: `packages/batch-frontend/src/ui/assignments/steps/StudentStep.tsx`
- Create: `packages/batch-frontend/src/ui/assignments/steps/LessonSourceStep.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts:30-580`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx:1375-1650`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx`
- Modify: source, transcript, and resume test groups.

**Interfaces:**

- Consumes: `createManualTranscriptSource()` from the prerequisite plan.
- Produces: `SourceController.createManualTranscript(text, displayName?)`.
- Produces: focused Student and Lesson source component prop types.

- [ ] **Step 1: Write failing source behavior tests**

Add tests that:

1. the upload dropzone accepts only `.opus` and displays `OPUS audio only during the alpha`;
2. pasted transcript requires a selected student and non-empty text;
3. successful manual creation sets recording status to `transcribed`, loads transcript text, saves session stage `context`, and enables Continue;
4. API failure preserves pasted text and presents a retry action;
5. returning from Teaching context retains the selected learner, OPUS filename/recording state, and transcript text.

The core API assertion is:

```ts
expect(api.createManualTranscriptSource).toHaveBeenCalledWith({
  studentId: 'student-1',
  text: 'Existing lesson transcript',
  displayName: 'Pasted lesson transcript',
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx
```

Expected: manual transcript assertions fail and current audio extensions include non-OPUS values.

- [ ] **Step 3: Implement source controller action**

Change the constant to:

```ts
const AUDIO_EXTENSIONS = ['.opus'] as const;
```

Add to `SourceController`:

```ts
manualTranscriptSaving: boolean;
manualTranscriptError: string | null;
createManualTranscript: (text: string, displayName?: string) => Promise<void>;
```

The action calls `createManualTranscriptSource`, sets `recording`, fetches the returned transcript with `fetchRecordingTranscript`, sets `transcriptText`, `transcriptStatus: 'ready'`, clears upload/transcription errors, and does not enqueue `retryRecordingTranscription`.

- [ ] **Step 4: Implement the two focused steps**

`StudentStep` contains new/resume selection, recent assignment access, learner selection, linked-lesson context, and a right-rail notice explaining that learner context will be included. `LessonSourceStep` offers two explicit choices: OPUS upload and existing transcript. It retains transcript review/edit/save behavior after either source path. Provider selection moves into Support details and appears only for OPUS uploads.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command plus `MinimalAssignment.workflow-ui.test.tsx`. Expected: PASS.

```powershell
git add packages/batch-frontend/src/ui/assignments/assignment-step-props.ts packages/batch-frontend/src/ui/assignments/steps/StudentStep.tsx packages/batch-frontend/src/ui/assignments/steps/LessonSourceStep.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
git commit -m "feat(frontend): rebuild lesson source workflow"
```

---

### Task 6: Migrate Teaching context and Create

**Files:**

- Create: `packages/batch-frontend/src/ui/assignments/steps/TeachingContextStep.tsx`
- Create: `packages/batch-frontend/src/ui/assignments/steps/CreateAssignmentStep.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx:1650-1725`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts`
- Modify: context, generation, prompt, validation, and quota test groups.

**Interfaces:**

- Consumes: existing context and authoring controllers.
- Produces: explicit `confirmContextStep()` that saves `teacherNotes`, selected profile, prompt package ID, and session stage `assignment` before navigation.

- [ ] **Step 1: Write failing persistence and invalidation tests**

Test that Confirm and continue from Teaching context calls `saveAssignmentSessionProgress` with:

```ts
expect.objectContaining({
  currentStage: 'assignment',
  studentId: 'student-1',
  recordingId: 'recording-1',
  transcriptId: 'transcript-1',
  teacherNotes: 'Use more travel vocabulary.',
});
```

Test that editing teacher notes after draft generation presents the exact consequence `This will require a new assignment draft. Your lesson source and transcript will stay saved.` before invalidating prompt/draft/preview/published artifacts.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.generation-quota.test-groups.tsx src/ui/minimal/MinimalAssignment.publish-validation.test.tsx
```

Expected: focused-screen and confirmation assertions fail.

- [ ] **Step 3: Implement Teaching context**

Move profile preview, first-profile assist, teacher notes, and context guidance into `TeachingContextStep`. Keep the teacher-facing surface focused; put profile IDs, revision IDs, and memory diagnostics under `SupportDetails`. Continue stays disabled until transcript is ready and session progress saves successfully.

- [ ] **Step 4: Implement Create**

Move prompt readiness, reload, assignment generation, draft editing, validation, quota messaging, and save into `CreateAssignmentStep`. Use Product notices for actionable errors and keep provider/model/quota internals under Support details. `Confirm and continue` saves dirty draft text, requires validation success, persists session stage `review`, and then navigates.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```powershell
git add packages/batch-frontend/src/ui/assignments/steps/TeachingContextStep.tsx packages/batch-frontend/src/ui/assignments/steps/CreateAssignmentStep.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.generation-quota.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.publish-validation.test.tsx
git commit -m "feat(frontend): focus context and assignment creation"
```

---

### Task 7: Migrate Review/share and advanced support

**Files:**

- Create: `packages/batch-frontend/src/ui/assignments/steps/ReviewShareStep.tsx`
- Create: `packages/batch-frontend/src/ui/assignments/AssignmentSupport.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx:1726-1778`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.advanced.tsx`
- Modify: publish, job action, rerun, throttle, and resume tests.

**Interfaces:**

- Consumes: authoring and advanced-actions controllers.
- Produces: primary review/share surface and post-share Support details.

- [ ] **Step 1: Write failing review/support tests**

Assert that Review and share exposes draft preview, editable draft, validation, Share, job progress, failure recovery, and final handout link. Assert that `Advanced actions` is absent from assignment progress and these controls appear only inside Support details after a job exists: cancel, republish, rerun audio, provider/model fields, quotas, provenance, and IDs.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx src/ui/minimal/MinimalAssignment.job-actions.test.tsx src/ui/minimal/MinimalAssignment.generation-throttle.test.tsx
```

Expected: assertions fail while advanced actions remain a peer stage.

- [ ] **Step 3: Implement Review and share**

Use the current preview hash/gate, validation, publish, cancel, job polling, error-description, and handout-link callbacks unchanged. Keep `Preview assignment` and `Share assignment` as the primary actions. When draft text changes, call the pure invalidation model and mark preview/published output stale without clearing source/context.

- [ ] **Step 4: Implement Assignment support**

Refactor `AdvancedActionsStage` into `AssignmentSupport`, preserving its controller behavior and tests while changing only disclosure and copy. Use nested sections inside one `SupportDetails` root, not nested cards or a modal. Diagnostic labels may use technical vocabulary because the tutor explicitly opened support.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command plus resume tests. Expected: PASS.

```powershell
git add packages/batch-frontend/src/ui/assignments/steps/ReviewShareStep.tsx packages/batch-frontend/src/ui/assignments/AssignmentSupport.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.advanced.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.job-actions.test.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.generation-throttle.test.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx
git commit -m "feat(frontend): move review recovery into support"
```

---

### Task 8: Remove legacy presentation and validate the complete slice

**Files:**

- Delete: `packages/batch-frontend/src/ui/minimal/MinimalShell.tsx`
- Delete: `packages/batch-frontend/src/ui/minimal/MinimalShell.css`
- Delete: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.css`
- Create: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.responsive.test.tsx`
- Modify: `packages/batch-frontend/README.md`
- Modify: `docs/backend-frontend/backend-frontend-alignment.md`

**Interfaces:**

- Finalizes: one Calm Studio shell, one assignment visual system, five primary steps, and one support disclosure.

- [ ] **Step 1: Add responsive and accessibility regression tests**

Test DOM contracts for desktop full rail, tablet icon rail, narrow menu toggle, horizontal-to-vertical workflow progress, single-column forms, and no unlabeled icon buttons. Add keyboard tests that tab through global navigation, progress, active fields, Back, and Continue, and assert focus moves to the new active-step heading.

- [ ] **Step 2: Run the focused tests and verify legacy failures**

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/AssignmentWorkflow.responsive.test.tsx src/ui/App.test.tsx src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
```

Expected: new responsive assertions fail until legacy shell/stage styles are removed and final breakpoints are present.

- [ ] **Step 3: Delete replaced presentation code**

Remove old shell files and imports. Delete `MinimalAssignment.stages.tsx` after every behavior has a focused replacement. Reduce `MinimalAssignment.css` to styles still used by controller-owned preview/output markup or move those rules into `AssignmentWorkflow.css`; remove stage cards, ornamental gradients, large radii, serif operational headings, auto-scroll presentation, and continuous stacked sections.

Run:

```powershell
rg -n "MinimalShell|WorkflowOverview|StageSection|Advanced actions" packages/batch-frontend/src
```

Expected: no live legacy component references; `Advanced actions` may appear only in historical test names or support copy assertions that explicitly verify its removal from progress.

- [ ] **Step 4: Update documentation**

Document five focused steps, persistent Back/completed-step behavior, OPUS-only upload, pasted transcript prerequisite, Calm Studio shell, and Support details. Do not claim later Student/Business/Templates content redesigns are complete.

- [ ] **Step 5: Run complete validation**

```powershell
corepack pnpm format
corepack pnpm --filter @esl-pipeline/batch-frontend run typecheck
corepack pnpm --silent run test:unit:prebuilt:fast:agent
corepack pnpm docs:generate:indexes
corepack pnpm docs:check
corepack pnpm run lint:repo-hygiene
corepack pnpm --silent run check:fast:agent
corepack pnpm check:pre-pr
git diff --check
```

Expected: all commands exit 0. Manually inspect assignment Student, Lesson source, Teaching context, Create, Review/share, and Support at desktop, tablet, and narrow widths using the mock-auth sandbox.

- [ ] **Step 6: Commit final cleanup**

```powershell
git add packages/batch-frontend/src packages/batch-frontend/README.md docs/backend-frontend/backend-frontend-alignment.md
git commit -m "refactor(frontend): retire legacy assignment presentation"
```
