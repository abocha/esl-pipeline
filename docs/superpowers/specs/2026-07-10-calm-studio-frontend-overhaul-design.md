# Calm Studio Frontend Overhaul Design

## Meta

- Date: 2026-07-10
- Status: approved design
- Scope: batch frontend foundation, application shell, and assignment builder
- Production posture: keep the current production frontend deployed while the overhaul is developed and validated locally
- Follow-up surfaces: students, business, assignment templates, and authentication

## Summary

The batch frontend has mature workflow behavior, route structure, API integration, resume handling,
and automated coverage, but its presentation architecture is fragmented and visually
overwrought. The overhaul will preserve that functional spine while replacing the shell, visual
system, component vocabulary, and assignment-builder composition.

The approved direction is **Calm Studio**: a restrained, teacher-first product interface with a
compact top bar, icon-led left navigation, readable working typography, fine dividers, limited
surface framing, and small radii. It must feel approachable to non-technical tutors without
sacrificing speed or workflow clarity.

This is a progressive replacement inside the existing React application. It is not a clean-room
rewrite and not a superficial theme pass.

## Alternatives Considered

### Repair the existing presentation incrementally

This would preserve the most code but retain oversized page components, duplicated CSS
vocabularies, and the current continuous-scroll assignment composition. It would improve polish
without resolving the underlying information architecture.

### Rewrite the frontend from scratch

This would maximize visual freedom but discard substantial behavior encoded in authentication,
resume and polling logic, job actions, capability gating, API integration, and tests. The risk and
rediscovery cost are not justified.

### Progressive presentation replacement (selected)

Keep contracts and proven behavior, introduce a new visual/component foundation, then recompose
one complete workflow at a time. Delete replaced presentation code as each surface moves across so
the project does not maintain two permanent design systems.

## Product Principles

1. Make the tutor's current task and next safe action immediately legible.
2. Preserve student and lesson context near the work without turning every fact into a card.
3. Use familiar product affordances and plain teaching language.
4. Keep technical diagnostics available but outside the normal teaching path.
5. Make state preservation visible and trustworthy.
6. Use icons to improve scanning, never as an unlabeled substitute for important text.
7. Prefer alignment, whitespace, and dividers over rounded containers and decorative effects.

## Visual System

### Typography

- Use one legible sans-serif family throughout operational UI.
- Default body and form text is 16px.
- Navigation and supporting copy use 14px.
- Concise metadata may use 12px; no working text should be smaller.
- Page headings use a restrained fixed scale rather than fluid display typography.
- Keep prose within readable line lengths while allowing data surfaces to use available width.

### Geometry and surfaces

- General containers use 4-6px radii.
- Buttons and inputs use approximately 4px radii.
- Pills are reserved for compact statuses where the shape conveys grouping.
- Avoid nested cards, large soft shadows, decorative gradients, glass effects, and textured grids.
- Use borders or restrained shadows, not both as decoration on the same component.

### Color

- Use a neutral light working canvas with a restrained blue action/selection color.
- Reserve success, warning, and error colors for semantic state.
- Maintain WCAG AA contrast for text and controls.
- Do not use color as the only state signal.

### Icons and identity

- Use the existing Lucide icon family consistently for global navigation, workflow steps, actions,
  status summaries, and meaningful metadata.
- Pair major icons with text labels.
- Use `ESL` as the temporary product mark until a proper brand mark/favicon exists; do not use
  `ES`.

### Motion

- Use 150-250ms state transitions where they clarify selection, disclosure, or completion.
- Do not animate layout properties or orchestrate page-load choreography.
- Provide reduced-motion behavior.

## Application Shell

The new authenticated shell contains:

1. A compact top bar with the ESL mark, product name, current workspace context, and account
   controls.
2. An icon-led global left navigation for Assignments, Students, Business, and Assignment
   Templates.
3. Contextual navigation within a product area, such as the student Overview, Learning, Schedule,
   and History routes.
4. A wide, neutral task canvas with route-level loading and error boundaries.

Desktop shows the full navigation. Tablet collapses it to an icon rail. Narrow screens use a
compact header and drawer while preserving the approved type scale and touch targets.

## Assignment Builder Structure

The current six large stage cards and continuous page stack will be replaced by five focused step
views over one persistent assignment draft:

1. **Student** - select or confirm the learner.
2. **Lesson source** - upload an OPUS recording or provide an existing transcript.
3. **Teaching context** - confirm transcript, learner context, and assignment intent.
4. **Create** - review generation inputs and create the assignment draft.
5. **Review and share** - edit, preview, validate, and publish.

The top progress structure remains visible on desktop and uses distinct semantic icons for learner,
audio source, teaching context, creation, and review/share. Labels and explicit completed/current
state remain alongside icons. Narrow layouts use a vertical summary or compact current-step
control rather than squeezing the horizontal tracker.

Only the active step receives substantial space. Reassuring, useful guidance may occupy a quiet
right column when space permits. Guidance should explain what happens next, what is saved, and what
the system will or will not do; it must not become decorative filler.

`Advanced actions` is not a sixth peer step. Provider controls, quotas, reruns, provenance, IDs,
and recovery operations belong in contextual Support details after the normal flow requires them.

## Lesson Source Contract

During the alpha, the upload control must promise only OPUS audio. Other media formats are future
work and must not appear in accepted-format copy until the runtime supports them.

The approved design also makes **existing transcript** a first-class alternative source. Current
backend behavior can update a transcript only after a recording exists, so this path requires a
small backward-compatible contract expansion. The implementation plan must define an orchestrator-
compliant way to create a lesson source from pasted transcript text while preserving student
ownership, lesson history, provenance, prompt-package expectations, and resume behavior. It must
not fabricate a client-only recording or bypass durable workflow ownership.

This is the only planned backend/API expansion in the first visual-overhaul slice. If repository
analysis shows it cannot be safely delivered within that slice, the implementation must keep the
UI affordance capability-gated and split the contract addition into an explicit prerequisite PR.

## Persistent Step Model

All five screens operate over one normalized assignment-draft state. The presentation layer should
distinguish:

- current step
- highest confirmed step
- dirty inputs
- committed inputs
- processing operations
- stale downstream artifacts
- failed operations
- completed outputs

Field changes remain available immediately in the active browser session. `Confirm and continue`
validates the current step and persists its committed state through existing durable workflow
contracts. Refresh or resume restores the latest committed state.

Back and completed steps are always available. Returning to an earlier step must restore its values
without silent clearing. Browser navigation and route changes must protect genuinely uncommitted
work.

### Dependency invalidation

Changing earlier input invalidates only downstream artifacts that actually depend on it. The UI
must explain the consequence before destructive regeneration.

Examples:

- Changing teacher instructions can stale the generated assignment without discarding the lesson
  source or transcript.
- Editing transcript text can stale learner-context selection, prompt inputs, and generated output,
  but must retain the original recording association and saved transcript history.
- Changing the selected student affects student-owned context and later artifacts and therefore
  requires a clear confirmation before proceeding.
- Editing the assignment draft during review does not require repeating source or context steps.

The implementation should centralize this dependency model rather than scatter invalidation logic
across screen components.

## Error Handling and Recovery

- Show validation messages beside the affected field or action.
- Translate operational failures into teacher-friendly language with a specific retry or recovery
  action.
- Put raw error codes, provider information, IDs, and diagnostic payloads under Support details.
- Long-running transcription and generation states show what is happening and preserve navigation.
- Loading must not obscure already available content.
- Never discard work on failure.
- Confirm destructive regeneration or student/source replacement and identify exactly which
  downstream artifacts will be affected.

## Component and Module Boundaries

The implementation should establish three presentation layers:

1. `ui/system` - tokens and reusable product primitives with no assignment-specific behavior.
2. `ui/shell` - authenticated application frame, global navigation, responsive behavior, and route
   boundaries.
3. `ui/assignments` - assignment draft adapter, dependency rules, workflow progress, and the five
   focused step screens.

Exact paths may follow existing package conventions, but these responsibilities should remain
separate. Existing authoring, source, resume, polling, and publish logic should be reused behind
focused interfaces rather than copied into new components.

Large files are a design constraint. New page components should orchestrate bounded subcomponents
and hooks rather than recreate another multi-thousand-line `MinimalAssignment.tsx`.

## Migration Sequence

1. Introduce Calm Studio tokens and base primitives without changing route behavior.
2. Replace the authenticated application shell and retain all routes.
3. Add the normalized assignment presentation adapter and centralized step/dependency model.
4. Migrate Student and Lesson source.
5. Migrate Teaching context and Create.
6. Migrate Review and share, publish, resume, and recovery behavior.
7. Move advanced/diagnostic controls into Support details.
8. Remove the old continuous-scroll stage composition and obsolete CSS.
9. Validate desktop, tablet, and narrow layouts in the browser.

Student, Business, Assignment Templates, and authentication routes remain functional throughout
this slice. They move to Calm Studio in later focused migrations.

## Accessibility and Responsive Contract

- WCAG AA contrast for text and controls.
- Keyboard-complete navigation and step movement.
- Visible focus states.
- Accessible names for icon buttons and icons hidden from assistive technology when text already
  supplies the name.
- Primary touch targets of at least 44px; compact secondary controls should remain at least 40px.
- Semantic error and status announcements.
- Reduced-motion support.
- No horizontal page overflow at supported widths.
- Forms become single-column on narrow screens without reducing working text below the approved
  scale.

## Verification Strategy

Preserve existing tests as behavioral protection, then add focused coverage for:

- design-system component states and accessibility contracts
- shell navigation and responsive collapse
- all forward and backward step transitions
- committed and dirty state preservation
- refresh and resume at each durable boundary
- dependency invalidation and regeneration confirmation
- OPUS validation and copy
- existing-transcript capability and provenance
- transcription and generation progress/failure recovery
- review edits, preview, publish, and post-publish support actions
- keyboard workflow and semantic announcements
- representative desktop, tablet, and narrow browser checks

The first implementation slice should run targeted frontend Vitest and typecheck throughout, then
the repository's affected check. Because the slice is broad and may add a backward-compatible API
surface, it also requires `pnpm check:pre-pr`; broader backend or contract changes may require the
full validation lane under repository rules.

## Non-Goals

- Rewriting backend business logic unrelated to transcript-source creation.
- Redesigning Student, Business, Assignment Templates, or authentication content in the first
  slice.
- Supporting non-OPUS upload formats during alpha.
- Creating a new permanent compatibility theme.
- Building a custom icon set or final brand identity.
- Exposing diagnostics as primary teacher workflow.

## Completion Criteria

The first slice is complete when:

1. The authenticated shell uses Calm Studio across every existing route.
2. The complete assignment journey uses the five focused screens.
3. Tutors can move backward and forward without losing work.
4. Resume, polling, transcript editing, generation, preview, publish, and recovery behavior remain
   correct.
5. OPUS is the only promised upload format.
6. Existing-transcript entry is either safely implemented through a durable contract or explicitly
   capability-gated behind a prerequisite contract change.
7. Advanced machinery no longer competes with the primary flow.
8. Old assignment-stage presentation code and obsolete CSS are removed.
9. Desktop, tablet, narrow, keyboard, contrast, and reduced-motion checks pass.
10. Student, Business, Assignment Templates, and authentication routes remain operational.
