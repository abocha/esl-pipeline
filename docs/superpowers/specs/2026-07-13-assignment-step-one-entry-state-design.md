# Assignment Step One Entry-State Design

## Meta

- Date: 2026-07-13
- Status: approved
- Scope: Step 1 assignment entry, resume selection, new-assignment learner selection, and the
  summary shown when revisiting Step 1
- Delivery: the existing `codex/assignment-workflow-ui-polish` branch
- Contract boundary: frontend state presentation and accessibility only; no backend, DTO, database,
  or persistence-contract change
- Supersedes: the assignment-setup and student-state presentation in
  `2026-07-13-assignment-step-one-student-design.md`

## Summary

Step 1 is an entry router with two mutually exclusive transactions:

1. reopen existing assignment work
2. start a new assignment for a learner

The current screen exposes controls from both transactions at once. After choosing Resume, the
teacher can still see the learner picker and generic workflow continuation. That creates competing
primary actions and makes it unclear whether selecting a learner is required to reopen work.

The redesign makes Step 1 an explicit state machine. Resume and New appear together only on the
default-choice screen. Once the teacher chooses a route, only controls for that route remain. A
quiet `Change choice` action returns to the default screen.

## Core Interaction Rules

1. Step 1 shows at most one primary action.
2. Resume and New controls appear simultaneously only on the default-choice screen.
3. Route changes happen only through explicit user actions.
4. Step 1 never renders the workflow Back button.
5. `Change choice` returns from Resume or New to the default-choice screen without selecting the
   opposite route automatically.
6. Resume state never renders learner selection or `Confirm and continue`.
7. New state never renders recent assignments or a resume action.
8. Only the active Step 1 state is rendered in the accessibility tree.
9. Recent assignments and learners load automatically. Manual Refresh controls are not part of the
   normal UI.
10. Loading replaces the relevant content; it does not add another layer of controls.

## State Model

| State                              | Visible content                                                          | Primary action                      |
| ---------------------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| Initial loading                    | Default-choice layout while recent-work availability is checked          | Resume and New temporarily disabled |
| Default choice                     | `Resume recent work` and `Start new assignment` only                     | The teacher chooses one route       |
| Default, no recent work            | Default choice with Resume disabled; no empty-state explanation          | `Start new assignment`              |
| Resume loading                     | Recent-work skeleton and quiet `Change choice`                           | Disabled                            |
| Resume list                        | Saved assignments and quiet `Change choice`                              | Disabled until selection            |
| Unfinished session selected        | Selected session, saved stage, and preservation message                  | `Continue assignment`               |
| Processing job selected            | Queued or running assignment job and current progress                    | `Review progress`                   |
| Ready-to-share selected            | Generated but unpublished assignment                                     | `Review assignment`                 |
| Published selected                 | Published status, date, and handout availability                         | `Open assignment`                   |
| Needs-attention selected           | Failed assignment job and contextual issue summary                       | `Review issue`                      |
| Resume load error                  | Contextual error, `Try again`, and quiet `Change choice`                 | `Try again`                         |
| Opening assignment                 | Selected assignment retained with progress feedback                      | `Opening…`, disabled                |
| Learners loading                   | Learner-picker skeleton and quiet `Change choice`                        | Disabled                            |
| New, no learner selected           | Learner picker and quiet `Change choice`                                 | `Continue`, disabled                |
| New, learner selected              | Compact selected-learner summary and quiet `Change choice`               | `Continue`                          |
| No learners available              | Empty learner selector, manage-learners route, and quiet `Change choice` | None                                |
| Learner error or invalid selection | Contextual error with valid state preserved where possible               | `Try again` or disabled `Continue`  |
| Starting assignment                | Selected learner retained with progress feedback                         | `Starting…`, disabled               |
| Existing assignment summary        | Learner, assignment status, and entry origin when revisiting Step 1      | None; quiet `Change assignment`     |

If recent-work loading resolves with zero assignments while Resume is open, return to the default
choice and disable Resume. Do not introduce a separate no-recent-work explanation screen.

## Default Choice

The default screen contains exactly two route choices:

- `Resume recent work`
- `Start new assignment`

Neither route is preselected. While recent-work availability is unresolved, both choices are
disabled. When loading completes:

- Resume is enabled if any recent assignment can be opened, including a published assignment.
- Resume is disabled if there is no recent work.
- New is enabled when learner data can be requested through the existing application flow.

The disabled Resume control receives normal disabled semantics. Do not add explanatory copy merely
to state that no recent work exists.

## Resume Route

### List behavior

Entering Resume replaces the default choices with the recent-assignment list. No learner controls
or generic workflow footer action remain visible.

The list does not silently preselect an assignment. Until the teacher selects a row, the route's
primary action is disabled.

Use native radio-group semantics for selectable rows unless the implementation supplies the full
ARIA listbox keyboard contract. Selection must be identifiable without color alone.

Each row presents teacher-relevant identity in this order:

1. learner name, plus the lesson title only when it is already available in frontend data
2. saved workflow stage or last meaningful activity
3. concrete artifact outcome
4. last-worked timestamp
5. concise state: `Unfinished`, `In progress`, `Ready to share`, `Published`, or
   `Needs attention`

Do not expose raw job IDs, session IDs, truncated support labels, or provider terminology in the
primary row content. The current frontend contracts do not guarantee a lesson title. Omit it when
unavailable rather than displaying a raw lesson ID or adding a backend contract.

### Status-specific actions

- An `Unfinished` session opens at its persisted workflow step with `Continue assignment`.
- An `In progress` job opens Review & share with `Review progress`. Job DTOs do not contain a saved
  workflow stage, so Step 1 must not imply that one can be restored.
- `Ready to share` opens Review & share with `Review assignment`.
- `Published` opens Review & share with `Open assignment`; the published handout and Advanced
  actions remain available there.
- `Needs attention` opens Review & share with `Review issue`, where the existing support details
  and recovery actions remain available.

Map the current job states as follows:

- queued or running: `In progress`, opening Review & share
- awaiting approval: `Ready to share`
- succeeded with a published handout URL: `Published`
- succeeded without a published handout URL: `Ready to share`
- failed: `Needs attention`

After selection, show one quiet sentence describing the consequence, for example:
`Opens Cora's saved assignment at Teaching context. Existing work is preserved.`

The action may name the selected learner when that improves confidence, but the accessible name and
visible text must remain accurate if learner names are long.

### Loading and errors

Recent work loads automatically. Do not render a routine `Refresh recent work` action. During a load,
show a stable skeleton in the list region. On failure, replace the list with a contextual error and
`Try again`; retain `Change choice`.

During open, retain the selected row and replace the primary label with `Opening…`. Disable route
changes and duplicate submissions until the request settles.

## New Route

Entering New replaces the default choices with learner selection. No recent-assignment list or
resume action remains visible.

The route reuses the existing automatically loaded learner collection and selected-learner
validation. It does not add polling, manual refresh, learner creation, or a new data contract.

### Learner states

- While learners load, render a stable picker skeleton.
- With no selection, render `Choose learner` and a disabled `Continue` action.
- After a valid selection, collapse the picker to a compact learner summary and enable `Continue`.
- `Change` inside the summary reopens the picker with the current learner selected.
- If no learners exist, offer the existing route to manage learners and no continuation action.
- If loading or validation fails, show the error beside the learner region and preserve any still-valid
  selection.

During start, retain the selected learner, change the primary label to `Starting…`, and disable
duplicate submissions and route changes.

`Continue` is the explicit user action that begins the new assignment and advances the workflow.
The reset/invalidation boundary must preserve the validated learner selected in this route; it may
clear prior recording, transcript, authoring, session, and job state, but it must not clear or swap
the learner before Step 2 renders. No state change automatically selects another workflow step.

## Existing Assignment Summary

After an assignment has been started or reopened, revisiting Step 1 renders a compact summary rather
than either entry route. The summary includes:

- learner
- assignment state: unfinished, in progress, ready to share, published, or needs attention
- whether the assignment was started new or reopened
- quiet `Change assignment`

`Change assignment` returns to the default choice using the existing confirmation/invalidation
contract when current work would be affected. Published handout links and Advanced actions remain on
Review & share rather than being duplicated in Step 1.

## Accessibility Contract

- The default choices and all route actions are native buttons.
- Resume rows use native radio inputs within a labelled fieldset, or an equivalently complete
  keyboard-operable selection pattern.
- Only the current Step 1 route and the shared workflow progress navigation are exposed to assistive
  technology.
- Loading and opening/starting state changes are announced through the existing status mechanism or
  a route-local live region.
- Disabled actions use native `disabled` semantics.
- Errors are associated with the relevant list or picker and remain visible until resolved.
- Selection, saved status, and loading do not rely on color alone.
- Controls preserve a minimum 44px target and remain usable at desktop and narrow widths.

## Data and Navigation Contract

- Continue using the existing recent-job collection, learner collection, selected IDs, resume
  callback, new-assignment callback, and workflow navigation callbacks.
- Do not introduce a backend endpoint, DTO field, database migration, polling loop, or cache contract.
- Opening a saved session is an explicit user navigation action and may move directly to its
  persisted step.
- Opening any job-backed item moves to Review & share because the current job contract has no saved
  workflow stage.
- Initial `?sessionId=` or `?jobId=` hydration reports one resolved entry result to the parent:
  sessions supply their persisted destination; jobs supply Review & share. The parent applies this
  destination and existing-summary origin once. Later collection changes cannot repeat hydration or
  move the active step.
- Beginning New moves forward only when the teacher activates `Continue` with a valid learner.
- Derived readiness may enable controls but never selects a route or workflow step.

## Test Contract

Focused frontend tests must prove:

1. Initial loading disables both default choices.
2. Default choice shows only Resume and New.
3. Zero recent assignments disables Resume without rendering explanatory empty-state copy.
4. Selecting Resume removes New, learner controls, and generic `Confirm and continue`.
5. Selecting New removes Resume and all recent-work controls.
6. `Change choice` returns either route to the unselected default choice.
7. Resume list starts with no selected assignment and a disabled primary action.
8. Unfinished sessions, processing jobs, ready-to-share jobs, published jobs, and needs-attention
   jobs produce the correct action label and destination, including every current job state.
9. Resume rows contain teacher-relevant context and omit raw IDs/session strings.
10. Routine manual Refresh is absent; error state exposes `Try again`.
11. Resume open retains selection, announces `Opening…`, and rejects duplicate submission.
12. New route loading, empty, error, unselected, selected, changing, and starting states match the
    state table.
13. A stale learner selection cannot enable continuation.
14. New continuation preserves the validated learner while clearing prior assignment artifacts.
15. Initial `?sessionId=` and `?jobId=` hydration each set the correct summary and destination once.
16. Revisiting Step 1 renders every applicable existing-assignment summary state, including
    `Needs attention`, rather than an entry route.
17. Inactive Step 1 and later-stage content is absent from the accessibility tree.
18. Desktop and narrow layouts preserve one primary action and keyboard operation.

## Sandbox Acceptance Contract

The mock-auth sandbox adds dev-only, query-selectable Step 1 scenarios. These scenarios change only
the existing frontend adapter's seeded responses; they never affect production APIs, DTOs, or
persistence. Supported scenarios cover:

- recent work with session and job-backed states
- no recent work
- recent-work load failure
- no learners
- learner load failure
- deliberately delayed responses for collection loading and assignment opening feedback

The default sandbox behavior remains unchanged when no scenario query is present. Component and
integration tests remain the source of truth for the full state matrix; the scenarios exist so the
maintainer can inspect representative states at desktop and narrow widths before review or CI.
Transient New `Starting…` feedback remains a controlled component-test state because the current
New transition is local and does not have a network request that the sandbox can safely delay.

## Non-Goals

- Redesigning Steps 2 through 5.
- Changing recent-job or learner APIs.
- Adding assignment deletion, search, pagination, or bulk actions.
- Adding learner creation or editing inside Step 1.
- Duplicating published handout or Advanced actions in Step 1.
- Automatically refreshing on an interval.
- Changing artifact invalidation or persistence semantics.
- Adding production fixtures or test-only behavior outside explicit frontend sandbox mode.
- Running backend, CI, PR, deployment, or production work during sandbox iteration.

## Completion Criteria

1. Step 1 implements the state table without simultaneous Resume/New route content.
2. The default is the only screen that shows Resume and New together.
3. Resume is disabled without explanation when no recent work exists.
4. Resume and New each expose one route-specific primary action.
5. `Change choice` returns to the default without selecting the opposite route.
6. Recent-work rows use teacher-relevant context and status-specific actions.
7. All job-backed work opens Review & share; only saved sessions claim a persisted workflow step.
8. New continuation preserves the selected learner across assignment reset.
9. Published and needs-attention work remain discoverable and open Review & share.
10. Query-driven initial resume hydration resolves the summary and destination once.
11. Representative Step 1 states are available through dev-only sandbox scenarios.
12. Only active state content is present in the accessibility tree.
13. No backend or persistence contract changes are introduced.
