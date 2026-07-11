# Assignment Workflow Remediation Design

## Meta

- Date: 2026-07-11
- Status: approved direction, awaiting written-spec review
- Scope: focused assignment navigation, upstream-edit invalidation, final-step completion,
  post-share actions, and shadow-sentence pronunciation audio
- Delivery: one pull request with two review-gated implementation slices
- Deployment: one manual production deployment after the combined pull request is merged
- Supersedes: the July 10 requirement that all advanced actions live inside Support details

## Summary

The five-step Calm Studio assignment builder remains the correct primary structure, but its first
implementation left navigation ownership split between the user, session rehydration, and legacy
guided-flow effects. It also attached destructive-change confirmation directly to teacher-note
keystrokes, rendered a permanently disabled final footer action, hid useful post-share operations
inside diagnostic support content, and retained legacy pill-shaped controls. Separately, the
orchestrator generates a second `Natural` shadow-item clip from the same text and synthesis path as
the `Word` clip, so the two recordings have no meaningful semantic difference.

The remediation keeps one combined release but divides implementation into two reviewer gates:

1. workflow interaction and state ownership
2. post-share actions, visual consistency, and pronunciation semantics

Slice 2 does not begin until Slice 1 has passed its targeted tests and review. Both slices land on
one branch and one pull request because they correct the same newly shipped assignment-builder
experience and do not benefit from separate production deployments.

## Alternatives Considered

### Separate pull request for each slice

This gives each slice an independent merge and rollback boundary, but adds branch and documentation
overhead without reducing deployment risk: the desired production state requires both slices, and
deployment is already manual. Use this fallback only if Slice 1 review exposes architectural work
large enough to delay the post-share corrections.

### One undivided implementation pass

This minimizes ceremony but makes review less reliable. Navigation ownership, TTS semantics, and
post-share presentation have different failure modes and test surfaces.

### One pull request with two review gates (selected)

Keep one feature branch and pull request, but require a clean commit boundary, targeted validation,
and review after Slice 1 before starting Slice 2. Run broad validation only after both slices are
integrated.

## Global Interaction Contract

User intent is the only authority that changes the visible assignment step after initial load.
Valid step transitions are:

- selecting an unlocked item in the progress control
- pressing Back
- pressing Confirm and continue
- invoking the explicit final completion action

Session state and derived artifact readiness may determine which steps are unlocked, complete, or
stale, but must not select a step after initial hydration. No asynchronous completion, field edit,
poll response, resume refresh, or status recalculation may scroll, focus, or navigate to another
step automatically.

### Initial hydration

Opening a new assignment starts on Student. Resuming a durable assignment maps its persisted stage
to the initial visible step once. That mapping must not rerun when prompt, draft, preview, publish,
or session objects later change.

### Focus and scrolling

Focus follows the user's navigation action and moves to the selected step heading or its first
relevant control. Legacy actionable-stage auto-scroll and auto-focus behavior is removed. Reduced
motion preferences continue to apply to any user-initiated scrolling.

## Upstream Edit and Invalidation Contract

Teacher notes are locally editable without interruption. Each keystroke updates controlled input
state and marks the field dirty; it does not confirm, regenerate, or invalidate artifacts.

The controller retains the committed teacher-note value that was used for the current downstream
artifacts. When the user tries to leave Teaching context through Confirm and continue:

- unchanged notes proceed normally
- changed notes with no downstream assignment proceed and become committed
- changed notes with a generated assignment present one confirmation describing that prompt,
  draft, preview, and published-job state will become stale while lesson source and transcript stay
  preserved
- cancellation keeps the user on Teaching context with the edited value intact
- confirmation commits the notes and invalidates the dependent artifacts once

Other explicit operations that consume changed teacher notes, such as generating a replacement
assignment directly, must use the same centralized commit/invalidation decision rather than
duplicating confirmation logic in input handlers.

The existing dependency model remains authoritative:

- student or recording changes invalidate transcript, prompt, draft, preview, and published job
- transcript or teacher-note changes invalidate prompt, draft, preview, and published job
- draft changes invalidate preview and published job

## Final-Step Contract

Review and share contains the actions that actually prepare and publish an assignment. The workflow
footer must not show a disabled `Assignment ready` button.

- Before successful publish, the review footer has Back only; Preview and Share assignment remain
  in the review content where their prerequisites and errors are visible.
- After successful publish, the footer exposes `Start another assignment` as an explicit completion
  action.
- `Start another assignment` resets the completed flow through the existing reset/session lifecycle
  and returns to Student.
- The published assignment link and post-share operations remain available until the user invokes
  that completion action.

This avoids using a disabled action as a status indicator and gives the final footer control a real,
testable state transition.

## Post-Share Information Architecture

`Advanced actions` is a normal post-share section, not a sixth workflow step and not diagnostic
support content. It becomes visible after a job exists and contains operations useful to ordinary
tutors:

- quick audio refresh actions
- republish
- cancellation when supported by job state
- custom rerun entry and queue action

`Support details` remains a separate disclosure adjacent to or within the post-share section and is
reserved for information primarily used to understand or diagnose execution:

- job and artifact identifiers
- provider, model, voice, and provenance details
- quota accounting
- capability warnings and raw failure codes
- rerun lineage and diagnostic payloads

Custom rerun configuration may remain progressively disclosed inside Advanced actions because it is
an optional operation, but opening it must not require opening Support details.

## Post-Share Visual Contract

Advanced actions adopts the Calm Studio component vocabulary. Legacy `.minimal-primary` and
`.minimal-secondary` button styles are not used in the remediated section.

- Use `ProductButton` variants for quick actions, refresh, custom-rerun disclosure, queue,
  republish, cancellation, and completion.
- Use the committed small control radius rather than pill geometry.
- Preserve visible focus, disabled, busy, error, hover, and active states.
- Destructive cancellation uses the existing semantic danger treatment.
- Quick actions wrap responsively without becoming identical oversized cards.
- Provider/model form fields use Calm Studio field geometry and spacing while retaining their
  existing values, capability gating, and payload behavior.

This is a focused migration of the post-share surface, not a repo-wide deletion of all legacy
minimal styles.

## Pronunciation Audio Contract

In `shadow_sentence` mode, each authored drill item receives one item-level clip labelled `Word`,
regardless of word count or character length. The orchestrator no longer manufactures a `Natural`
item clip by resynthesizing the same normalized text.

Sentence-level natural practice remains valid only when the parsed pronunciation mode supplies a
semantically distinct sentence target, such as `naturalSentence` for connected speech, intonation,
rhythm chunking, or sentence stress. This change does not remove those primary sentence clips.

Existing manifests containing duplicate `Natural` item clips remain readable. New runs and selected
pronunciation-chunk reruns stop generating them. No manifest schema or public DTO change is needed.

## Component and Ownership Boundaries

- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx` remains the current controller
  composition root, but step hydration and navigation decisions should move into small pure helpers
  or a focused hook when that reduces effect coupling.
- `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts` owns pure step, hydration, and
  artifact-dependency decisions.
- `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx` owns visible progress and footer
  affordances, including the absence or presence of a final action.
- `packages/batch-frontend/src/ui/assignments/AssignmentSupport.tsx` owns diagnostic disclosure only.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.advanced.tsx` retains operational action
  wiring while its presentation migrates to Calm Studio primitives.
- `packages/orchestrator/src/runtime/pronunciation-audio.ts` remains the source of truth for which
  pronunciation clips are generated.

No backend transport, database, public contract, or manifest-version change is planned.

## Error and Recovery Behavior

- A failed teacher-note commit leaves the edited notes visible and keeps the current step selected.
- Cancelling invalidation does not silently revert the field.
- Failed navigation persistence does not advance the visible step.
- Failed post-share actions remain in Advanced actions with actionable error copy; raw diagnostic
  detail remains under Support details.
- Removing duplicate `Natural` generation must not alter reuse or replacement rules for legitimate
  pronunciation clips during reruns.

## Review-Gated Delivery

### Slice 1: Workflow interaction and state ownership

Deliverables:

- one-time resume hydration
- user-only step transitions
- removal of actionable-stage auto-scroll/focus
- commit-time teacher-note confirmation and centralized invalidation
- meaningful final-step footer behavior
- focused frontend regressions for all affected transitions

Gate before Slice 2:

- targeted workflow and prompt/draft test files pass
- batch-frontend typecheck passes
- reviewer confirms no asynchronous state path can select or scroll to a different step
- reviewer confirms cancelled invalidation preserves both the active step and typed notes

### Slice 2: Post-share actions and pronunciation semantics

Deliverables:

- Advanced actions promoted outside Support details
- diagnostic-only Support details
- Calm Studio action and form styling
- duplicate shadow-item `Natural` clip generation removed
- frontend, orchestrator, and publisher regressions updated
- frontend README and backend/frontend alignment documentation corrected

Final combined gate:

- targeted batch-frontend tests
- targeted orchestrator pronunciation tests
- targeted HTML publisher pronunciation tests when rendering expectations change
- batch-frontend and orchestrator typechecks/builds as selected by affected validation
- `pnpm --silent run check:fast:agent`
- `pnpm check:pre-pr` because the pull request crosses frontend and orchestrator behavior
- manual browser smoke at desktop and narrow widths
- no production deployment from the implementation task

## Documentation Impact

Update the following in the implementation pull request:

- `packages/batch-frontend/README.md`: describe user-owned navigation and distinguish Advanced
  actions from Support details.
- `docs/backend-frontend/backend-frontend-alignment.md`: record corrected post-share information
  architecture and final-step behavior.
- `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`: clarify that shadow items have one item clip and
  that natural sentence audio requires a distinct sentence target.
- The July 10 design and implementation plan remain historical evidence; this spec is the explicit
  superseding decision and they should not be silently rewritten.

## Non-Goals

- Changing the five primary assignment steps.
- Automatically advancing after upload, generation, preview, publish, or polling.
- Redesigning unrelated student, business, template, or authentication surfaces.
- Changing provider selection defaults or rerun payload contracts.
- Adding new careful-versus-natural TTS prompting.
- Migrating every remaining legacy `.minimal-*` style in the frontend.
- Deploying production as part of implementation.

## Completion Criteria

1. Typing teacher notes never opens a confirmation dialog.
2. A destructive teacher-note consequence is confirmed at most once per explicit commit attempt.
3. After initial hydration, only user actions change the visible step.
4. Async readiness and job-state changes neither select, scroll to, nor focus another step.
5. Review and share no longer renders a permanently disabled `Assignment ready` control.
6. Successful publish offers an explicit `Start another assignment` completion action.
7. Advanced actions are usable without opening Support details.
8. Support details contains diagnostics rather than ordinary rerun operations.
9. Post-share controls use Calm Studio geometry and component states.
10. New shadow-sentence runs emit no duplicate `Natural` item clip for identical text.
11. Legitimate distinct natural-sentence audio remains intact.
12. Both review gates and the combined validation matrix pass before the pull request is declared
    ready.
