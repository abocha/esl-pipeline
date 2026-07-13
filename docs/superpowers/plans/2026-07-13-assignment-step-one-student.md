# Assignment Step One Student Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace completed Step 1 choices with compact, reversible summaries while removing manual
student refreshing and the unnecessary learner-context notice.

**Architecture:** Keep assignment-mode state in `MinimalAssignment` and student identity state in the
existing source controller. Add presentation-only edit states inside `StartStageSection` and
`StudentStep`; their `Change` buttons reveal the existing controls without changing workflow
navigation or persistence ownership. Use focused component and integration regressions before
changing production markup.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, existing Calm Studio CSS tokens and
product button classes.

## Global Constraints

- The visible workflow step changes only through existing user navigation actions.
- Student-list synchronization remains application-owned; do not add polling, endpoints, or cache
  contracts.
- A missing or stale student ID cannot unlock forward navigation.
- Preserve existing student-change invalidation, linked-lesson locking, assignment resume, and
  artifact behavior.
- Fresh New flows never manufacture a completed-assignment artifact card.
- Existing saved or published artifact cards remain separately visible when backed by real data.
- Do not redesign Steps 2 through 5 or remove any other workflow notice.
- Do not touch the open Word lock file under `docs/design/reviews/~$*.docx`.

---

### Task 1: Two-state student selector

**Files:**

- Create: `packages/batch-frontend/src/ui/assignments/steps/StudentStep.test.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/steps/StudentStep.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-step-props.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`

**Interfaces:**

- Consumes: `students: StudentOption[]`, `selectedStudentId: string`, `selectionLocked?: boolean`,
  `error: string | null`, and `onSelect(studentId: string): void`.
- Produces: an expanded selector when the selected ID is absent/invalid or Change is active; a
  compact `Student` summary when the selected ID resolves to a current option.
- Removes: `StudentStepProps.onRefresh` and the controller render prop that calls
  `loadStudentOptions()` manually.

- [ ] **Step 1: Write the failing component regressions**

Create a controlled test harness so selecting another student rerenders the production component:

```tsx
function StudentHarness({ initialStudentId = '' }: { initialStudentId?: string }) {
  const [studentId, setStudentId] = useState(initialStudentId);
  return (
    <StudentStep
      students={[
        { id: 'student-alex', name: 'Alex', profileId: 'profiles/alex.md' },
        { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
      ]}
      selectedStudentId={studentId}
      error={null}
      onSelect={setStudentId}
    >
      <div>Assignment setup</div>
    </StudentStep>
  );
}
```

Add tests that prove:

```tsx
it('collapses immediately after a valid student selection and reopens through Change', async () => {
  const user = userEvent.setup();
  render(<StudentHarness />);

  await user.selectOptions(screen.getByRole('combobox', { name: /^Student$/i }), 'student-alex');

  expect(screen.getByText('Alex')).toBeTruthy();
  expect(screen.getByText('Selected for this assignment')).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: /^Student$/i })).toBeNull();

  await user.click(screen.getByRole('button', { name: /Change student/i }));
  expect((screen.getByRole('combobox', { name: /^Student$/i }) as HTMLSelectElement).value).toBe(
    'student-alex',
  );
});

it('does not expose manual refresh or learner-context reassurance', () => {
  render(<StudentHarness initialStudentId="student-alex" />);
  expect(screen.queryByRole('button', { name: /Refresh students/i })).toBeNull();
  expect(screen.queryByText(/Learner context stays connected/i)).toBeNull();
});
```

Add one locked-state assertion: `selectionLocked` disables `Change student` and does not expose the
selector, preserving the existing linked-lesson restriction.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/assignments/steps/StudentStep.test.tsx --testTimeout=15000
```

Expected: FAIL because selected students still render the permanent combobox and the refresh and
reassurance controls remain present.

- [ ] **Step 3: Implement the minimal two-state component**

In `StudentStep.tsx`:

- resolve `selectedStudent` from `students` and `selectedStudentId`
- keep local `isChangingStudent` state
- show the selector when no valid student is selected or Change is active
- after a valid `onChange`, call `onSelect(value)` and set `isChangingStudent` to `false`
- render an explicit `Change student` button in the summary
- disable that button while `selectionLocked` is true
- focus the select when Change opens it
- remove the refresh button, `ProductNotice`, and `ShieldCheck`

The selected markup should use this semantic shape:

```tsx
<section className="assignment-student-choice" aria-labelledby="assignment-student-heading">
  <div className="assignment-choice-summary__identity">
    <span className="assignment-choice-summary__avatar" aria-hidden="true">
      {selectedStudent.name.trim().charAt(0).toUpperCase()}
    </span>
    <div>
      <p className="assignment-choice-summary__label">Student</p>
      <h3 id="assignment-student-heading">{selectedStudent.name}</h3>
      <p>Selected for this assignment</p>
    </div>
  </div>
  <button
    type="button"
    className="product-button product-button--quiet"
    disabled={selectionLocked}
    onClick={() => setIsChangingStudent(true)}
  >
    Change student
  </button>
</section>
```

Remove `onRefresh` from `StudentStepProps` and from the `StudentStep` call in
`MinimalAssignment.tsx`. Do not remove the controller's initial student-loading path.

Replace `.assignment-student-picker` rules with state-specific styles that use existing border,
surface, radius, ink, control, and spacing tokens. Use flex for the resolved row and a compact grid
for the open selector. Add a narrow-layout rule that stacks the quiet action below the identity.

- [ ] **Step 4: Run the component test and typecheck to verify GREEN**

Run:

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/assignments/steps/StudentStep.test.tsx --testTimeout=15000
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: all `StudentStep` tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/batch-frontend/src/ui/assignments/steps/StudentStep.test.tsx \
  packages/batch-frontend/src/ui/assignments/steps/StudentStep.tsx \
  packages/batch-frontend/src/ui/assignments/assignment-step-props.ts \
  packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx
git commit -m "fix(batch-frontend): collapse selected student choice"
```

---

### Task 2: Two-state assignment setup

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.css`

**Interfaces:**

- Consumes: existing `StartStageMode`, New and Resume callbacks, resume-job data, current artifact
  data, and new `selectedStudentName: string | null` presentation input.
- Produces: `Assignment setup` summary for resolved New or Resume mode and an explicit
  `Change assignment setup` action that reveals the existing chooser in place.

- [ ] **Step 1: Write the failing integration regressions**

Add a focused test in `MinimalAssignment.workflow-ui.test.tsx`:

```tsx
it('collapses resolved Step 1 choices and restores them through explicit Change actions', async () => {
  const user = createMinimalUser();
  renderMinimalAssignment();

  await user.click(screen.getByRole('button', { name: /Start new assignment/i }));

  expect(screen.getByRole('heading', { name: /New assignment/i })).toBeTruthy();
  expect(screen.getByText('Starting a new assignment.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Resume recent work/i })).toBeNull();

  await user.selectOptions(
    await screen.findByRole('combobox', { name: /^Student$/i }),
    'student-alex',
  );
  expect(screen.getByText('Starting a new assignment for Alex.')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: /Change assignment setup/i }));
  expect(screen.getByRole('button', { name: /Resume recent work/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Start new assignment/i })).toBeTruthy();
});
```

Extend the published/resume fixture regression to prove that an existing handout link remains
outside the compact setup summary. Update the stale-rehydration assertion from `New assignment
ready` to the new `New assignment` heading.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx \
  src/ui/minimal/MinimalAssignment.resume-basic.test.tsx \
  --testTimeout=15000
```

Expected: FAIL because the chooser remains visible in resolved mode and the new summary and Change
action do not exist.

- [ ] **Step 3: Implement the compact setup summary**

Add `selectedStudentName: string | null` to `StartStageSectionProps` and pass
`source.selectedStudent?.name ?? null` from `MinimalAssignment.tsx`.

Inside `StartStageSection`:

- keep `isChangingSetup` local state
- treat `idle` as unresolved
- treat `start` as resolved immediately
- keep `resume` expanded until an assignment is actually opened; once current assignment data is
  present, collapse it as resolved
- set `isChangingSetup` to `false` after starting New and after successful Resume data appears
- render the existing chooser and resume list only while unresolved/changing
- render the real artifact block independently from the setup summary

Use the following summary copy contract:

```tsx
const setupTitle = mode === 'resume' ? 'Resumed assignment' : 'New assignment';
const setupDescription =
  mode === 'start' && selectedStudentName
    ? `Starting a new assignment for ${selectedStudentName}.`
    : mode === 'start'
      ? 'Starting a new assignment.'
      : 'Continuing saved assignment work.';
```

Render `Change assignment setup` with the quiet product-button class. The summary must be a compact
horizontal row with a visible text status and must not rely on the success icon/color alone.

Replace the old `.minimal-start-summary` rules with a reusable compact setup-summary block using
existing Calm Studio tokens. At the narrow breakpoint, allow text and action to stack without
horizontal overflow.

- [ ] **Step 4: Run focused and adjacent workflow suites to verify GREEN**

Run:

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/assignments/steps/StudentStep.test.tsx \
  src/ui/assignments/AssignmentWorkflow.test.tsx \
  src/ui/assignments/AssignmentWorkflow.navigation.test.tsx \
  src/ui/assignments/AssignmentWorkflow.responsive.test.tsx \
  src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx \
  src/ui/minimal/MinimalAssignment.resume-basic.test.tsx \
  --testTimeout=15000
corepack pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: all selected tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.css
git commit -m "fix(batch-frontend): distill assignment setup choice"
```

---

### Task 3: Integrated validation and sandbox smoke

**Files:**

- Modify only if validation exposes a scoped regression in the files from Tasks 1–2.

**Interfaces:**

- Consumes: completed Task 1 and Task 2 commits.
- Produces: fresh automated and visual evidence that Step 1 satisfies the approved design without
  changing later steps.

- [ ] **Step 1: Run formatting and affected validation**

```bash
corepack pnpm format:write
corepack pnpm format
corepack pnpm run lint:repo-hygiene
corepack pnpm --silent run check:fast:agent
```

Expected: formatting is stable, repository hygiene passes, and the affected batch-frontend lanes
pass. If the agent lane fails, inspect the reported `tmp/check-logs/...` artifact before rerunning a
raw command.

- [ ] **Step 2: Run the complete frontend unit suite**

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend test:unit
```

Expected: all batch-frontend unit tests PASS.

- [ ] **Step 3: Perform the visible sandbox smoke**

At desktop and narrow widths, verify:

1. initial Step 1 shows Resume/New and an open student selector
2. New immediately becomes the compact setup summary
3. selecting Alex immediately becomes the compact student summary
4. both Change actions reopen only their own control
5. no Refresh students or learner-context notice appears
6. Confirm and continue still moves only on user action
7. a resumed/published fixture retains its real assignment handout block

- [ ] **Step 4: Commit validation-only corrections if needed**

If the validation steps required scoped fixes, stage only those files and commit:

```bash
git commit -m "test(batch-frontend): harden step one choice states"
```

If no files changed, do not create an empty commit.
