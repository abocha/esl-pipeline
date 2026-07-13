# Assignment Step One Student Design

## Meta

- Date: 2026-07-13
- Status: approved direction, awaiting written-spec review
- Scope: assignment setup and student-selection presentation within Step 1
- Delivery: the existing assignment-workflow UI polish branch
- Behavior boundary: no change to workflow navigation, student identity contracts, or downstream
  artifact invalidation

## Summary

Step 1 currently keeps its large `Resume or start` chooser visible after the user has already made
that decision. It also presents student selection as a permanently expanded form, exposes a manual
`Refresh students` control, and follows the picker with a reassurance card that repeats behavior the
workflow already guarantees.

The redesign gives assignment setup and student selection explicit unresolved and resolved states.
Once the user makes either choice, the corresponding control collapses immediately into a compact
summary with a quiet `Change` action. This keeps Step 1 focused on the next unresolved decision
without changing how assignments or students are loaded, persisted, validated, or invalidated.

## Selected Approach

Use two separate, visually related stateful sections:

1. `Assignment setup` owns the New-versus-Resume decision.
2. `Student` owns student selection.

Each section renders its full choice UI only while unresolved or while the user is explicitly
changing the choice. A valid choice immediately returns the section to its compact resolved state.
The sections remain separate because assignment mode and student identity are different decisions
with different consequences.

## Alternatives Considered

### Keep the existing controls and reduce spacing

This is the cheapest visual change, but completed decisions would still compete with the current
task and the student picker would still look like a form that requires attention.

### Combine assignment setup and student selection into one large card

This would reduce the number of containers but would couple two independent decisions and create a
larger multi-state component. It would also make the resumed-assignment artifact summary harder to
place coherently.

### Separate two-state sections (selected)

This preserves clear ownership while giving both decisions the same progressive-disclosure
behavior. It is compact after completion and straightforward to test in isolation.

## Assignment Setup States

### Unresolved or changing

Render the existing Resume and New choices. No mode is implied before the user chooses one.

### New assignment selected

Render a compact horizontal summary:

- label: `Assignment setup`
- value: `New assignment`
- supporting context: `Starting a new assignment.` before student selection, then
  `Starting a new assignment for Alex.` when the student identity is known
- a subtle success indicator
- quiet `Change` action

Do not render a completed-assignment artifact card merely because New was selected.

### Resumed assignment selected

Render the equivalent compact summary with resumed-assignment wording. If a real saved or published
artifact exists, its assignment/handout block remains separately visible because it represents an
output, not setup status.

## Student States

### Unselected or changing

Render one focused student selector under a `Choose the student` heading. The selector contains the
currently loaded valid students and retains existing loading, empty, and error behavior.

Do not render a `Refresh students` action. Student-list synchronization remains application-owned:
the list is populated through the existing page/session loading path and may be refreshed by normal
runtime or page-refresh behavior. The workflow must not delegate cache synchronization to the
tutor.

### Selected

Immediately after a valid selection, replace the expanded selector with a compact summary:

- label: `Student`
- selected student name
- concise `Selected for this assignment` status
- quiet `Change` action

Do not add learner-context reassurance copy to this summary. The selected identity and status are
sufficient.

Activating `Change` expands the selector in place with the current student preselected. Choosing a
valid student collapses it immediately. The visible workflow step does not change during either
action.

## Removed Presentation

Remove the `Learner context stays connected` notice from Step 1 without replacing it. This notice
does not explain a choice, warn about a consequence, or offer recovery, so it adds visual weight
without helping the user act.

This decision applies only to that notice. Other workflow notices remain in scope for later
step-by-step review and are not removed by analogy.

## Data and Validation Contract

- Continue using the existing student collection and selected student ID supplied to `StudentStep`.
- Selecting or changing a student continues through the existing controller callback.
- A selected student ID must still resolve to a currently valid student before Step 1 can continue.
- Existing downstream invalidation and confirmation behavior for changing a student remains
  authoritative.
- Removing the refresh button does not introduce polling, a new endpoint, or a new cache contract.
- Network, loading, and refresh failures remain application errors; they are not converted into a
  manual synchronization workflow.

## Accessibility and Responsive Behavior

- Both `Change` actions are native buttons with specific accessible names.
- The full selector retains its associated visible label and keyboard behavior.
- Selection errors remain programmatically associated with the selector and visible until
  resolved.
- Focus moves to the selector when `Change` expands it and returns to the section summary after a
  valid selection.
- On narrow screens, summary content and the `Change` action may wrap without reintroducing large
  card-like controls or horizontal scrolling.
- State changes do not rely on color alone; the text labels identify New, Resume, and selected
  student states.

## Component Boundary

`StudentStep` remains the owner of student-selection presentation. The redesign may extract a small
reusable resolved-choice summary only if both assignment setup and student selection can use it
without obscuring their distinct copy and behavior.

The parent assignment controller remains responsible for assignment mode, student data, selected
identity, validation, persistence, and artifact consequences. No backend, DTO, database, or public
contract change is required.

## Test Contract

Focused frontend tests must prove:

1. The full assignment chooser appears before a mode is selected or while Change is active.
2. Selecting New or Resume immediately renders the matching compact summary.
3. New selection alone does not manufacture a completed-assignment artifact block.
4. A real resumed artifact remains separately visible.
5. The student selector appears when no valid student is selected.
6. A valid student selection immediately renders the compact student summary.
7. Student Change restores the selector with the current student selected.
8. No `Refresh students` control is rendered.
9. The learner-context reassurance notice is absent.
10. Invalid or stale student selection cannot continue to the next step.
11. Existing student-change invalidation behavior remains intact.
12. Both states remain keyboard-operable at desktop and narrow layouts.

## Non-Goals

- Redesigning Steps 2 through 5.
- Changing step navigation or adding automatic advancement.
- Adding student search, creation, deletion, or editing.
- Adding polling or a new student-list synchronization mechanism.
- Changing the saved-assignment artifact card beyond its conditional placement.
- Removing other informational notices before their individual review.
- Changing learner-context data or generation behavior.

## Completion Criteria

1. Completed setup and student decisions render compact summaries instead of expanded controls.
2. Change reopens the relevant choice in place and preserves the current valid value.
3. Student selection collapses immediately after a valid choice.
4. Step 1 contains neither `Refresh students` nor the learner-context reassurance notice.
5. Fresh assignments do not display a completed-assignment artifact block.
6. Resumed assignments retain access to real saved or published artifacts.
7. Validation prevents continuation with a missing or invalid student.
8. No workflow, backend, DTO, or persistence contract changes are introduced.
