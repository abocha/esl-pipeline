# Assignment Platform V2: Roadmap to Production

## Meta

- Audience: founder-maintainer, product designers, frontend/backend implementers, AI coding agents.
- Read Time: 24 minutes.
- Authority Level: future product architecture, implementation roadmap, and cutover decision record.
- Last Verified Against: 2026-07-10 repo state.
- Owner: founder-maintainer + assignment-platform maintainers.
- Review Cadence: after Closed Alpha evidence, before implementation begins, and at each production gate.
- Status: `roadmap`.
- Exit Trigger: archive this roadmap after Assignment Platform V2 is the production default, its shipped contracts are represented in canonical reference docs, and the legacy Markdown assignment path has an explicit retirement disposition.
- Current Focus: preserve the intended destination, sequencing, compatibility boundary, and Codex execution strategy. Do not interrupt the current alpha release work.

## Executive Summary

Assignment Platform V2 is a clean replacement for the current Markdown-first assignment authoring and static HTML publication path.

The product should evolve from:

```text
lesson evidence
-> LLM-generated Markdown
-> Markdown textarea
-> validation and post-processing
-> static document-shaped HTML
```

into:

```text
lesson evidence and learner context
-> typed assignment decision
-> LLM-generated AssignmentDocumentDraft
-> backend validation and canonicalization
-> structured visual tutor editor
-> immutable AssignmentRevision
-> self-contained interactive learner artifact
-> learner outcome evidence
-> future assignment decisions
```

The central decision is not to migrate the current alpha flow organ by organ. The alpha path should remain stable and operational while V2 is built as an isolated, coherent subsystem. Implementation may land in reviewable phases, but tutors should not be exposed to a half-Markdown, half-typed authoring experience.

The intended strategy is:

> Build V2 boldly, integrate it safely, and cut over only when one complete tutor-to-learner path works end to end.

This roadmap deliberately minimizes transitional compatibility work because compatibility code consumes engineering time, model context, test surface, and Codex limits without advancing the destination architecture.

## Product Reframe

The current product generates rich homework pages.

The future product is an AI-assisted lesson-authoring environment built around a typed pedagogical document, a structured tutor editor, an interactive learner runtime, and a closed evidence loop.

This changes the primary product object.

### Current primary object

A Markdown document that is rendered into HTML.

### Future primary object

A versioned assignment document whose blocks know their pedagogical role, learner target, answer behavior, visibility, rationale, and outcome semantics.

The HTML artifact becomes one projection of that document rather than the document itself.

## Decisions Locked by This Roadmap

### 1. V2 is a replacement architecture, not a permanent hybrid

New V2 assignments use a typed canonical document from generation through editing, publishing, and outcome capture.

Markdown is not the canonical representation of a V2 assignment.

### 2. The current alpha remains stable during the build

The existing Markdown path remains the production alpha path until V2 passes its production gates.

V1 receives:

- release-critical fixes,
- reliability fixes,
- security fixes,
- narrowly justified alpha usability fixes.

V1 should not receive major new authoring capabilities that V2 will replace.

### 3. Implementation can be incremental without exposing an incremental product

V2 should be implemented in bounded PRs and testable subsystems.

Those subsystems remain behind internal routes, explicit feature gates, or non-routed packages until the core path is coherent.

Incremental engineering does not require incremental product schizophrenia.

### 4. No editable dual representation

A V2 assignment must not maintain editable Markdown and editable typed content simultaneously.

The system must not promise lossless two-way synchronization between them.

### 5. No routine dual-write

Saving a V1 assignment should not automatically create an approximate V2 assignment.

Saving a V2 assignment should not regenerate canonical Markdown.

Optional one-way import may be added later, with explicit review and a new V2 lineage.

### 6. The product owns the canonical schema

The canonical assignment representation must be an ESL Pipeline domain contract.

It must not be an editor library's internal JSON format, rendered HTML, or provider-specific response shape.

### 7. The model generates semantics, not executable UI

The LLM may generate a strict `AssignmentDocumentDraft`.

It must not generate JSX, arbitrary JavaScript, or trusted executable behavior.

The backend assigns canonical identity, validates cross-references, sanitizes content, and creates the persisted revision.

### 8. The first V2 production release must complete the whole core loop

The first production release must support:

```text
select learner and lesson context
-> generate typed assignment
-> edit visually
-> preview learner states
-> publish self-contained interactive HTML
-> learner completes objective tasks locally
-> learner or tutor can obtain a useful result summary
```

It does not need every later feature, but the path it ships must not fall back to raw Markdown authoring for normal use.

### 9. Production cutover is deliberate and reversible

V2 becomes the default only after founder dogfood, selected tutor use, and explicit production gates.

Rollback must be possible by restoring the V1 default for new assignments without corrupting either format.

### 10. Codex efficiency is an architectural constraint

The roadmap should minimize:

- broad repeated repository archaeology,
- temporary translation layers,
- dual-format branches in every service,
- micro-PR overhead,
- long-lived half-migrations,
- repeated regeneration of the same runtime bundle,
- cleanup work created only by transitional architecture.

## Why Markdown Is No Longer the Right Canonical Format

Markdown was a high-leverage choice when the product inherited a Notion-style workflow.

It provided:

- readable model output,
- cheap manual editing,
- portable storage,
- simple debugging,
- quick rendering,
- easy copy and paste.

Those advantages remain real.

The limitation appears when an assignment must preserve semantics such as:

- task identity,
- task type,
- accepted answers,
- checking policy,
- hint behavior,
- answer-reveal behavior,
- learner target references,
- review/new/mixed role,
- selection rationale,
- student visibility,
- attempt outcome mapping.

Encoding those semantics in headings, prose conventions, or custom directives would require the system to parse its own intentions back out of text.

That is avoidable reverse engineering.

## Target Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Evidence and planning                                               │
│ transcript + lesson memory + homework memory + profile + tutor note │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Assignment decision                                                 │
│ selected targets + roles + rationale + evidence refs + dose         │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ AssignmentDocumentDraft                                             │
│ model-authored semantic sections, tasks, explanations, and media    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ validate / canonicalize
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ AssignmentRevision                                                  │
│ stable block IDs + task IDs + answer specs + lineage + revision     │
└───────────────────┬──────────────────────────────┬───────────────────┘
                    │                              │
                    ▼                              ▼
┌─────────────────────────────┐      ┌─────────────────────────────────┐
│ Structured tutor editor     │      │ Learner artifact builder        │
│ canvas + inspector + AI ops │      │ prebuilt Preact runtime + data  │
└──────────────┬──────────────┘      └────────────────┬────────────────┘
               │ save immutable revision              │ publish
               ▼                                      ▼
┌─────────────────────────────┐      ┌─────────────────────────────────┐
│ Approved AssignmentRevision │      │ self-contained interactive HTML │
└─────────────────────────────┘      └────────────────┬────────────────┘
                                                     │ attempt events
                                                     ▼
                                      ┌─────────────────────────────────┐
                                      │ outcome summary / outcome memory │
                                      └────────────────┬────────────────┘
                                                       │
                                                       ▼
                                      future assignment decisions
```

## Canonical Domain Model

The exact schema will be designed during Phase 1. The following boundary is locked even if field names change.

```ts
interface AssignmentDocument {
  schemaVersion: 'assignment-document-v2';
  assignmentId: string;
  revisionId: string;
  revisionNumber: number;

  metadata: AssignmentMetadata;
  sections: AssignmentSection[];
  generationLineage: AssignmentGenerationLineage;
  publicationPolicy: AssignmentPublicationPolicy;
}
```

```ts
type AssignmentSection =
  | MissionBriefingSection
  | StudyTextSection
  | GrammarToolkitSection
  | VocabularySection
  | ExerciseGroupSection
  | PronunciationSection
  | OpenMissionSection
  | TeacherFollowUpSection;
```

```ts
type InteractiveTask =
  | ChoiceTask
  | GapTask
  | ErrorCorrectionTask
  | ReorderTask
  | MatchingTask
  | OpenResponseTask;
```

Each task should be able to carry:

- stable task identity,
- task type,
- prompt and content,
- answer specification,
- target references,
- hint,
- explanation,
- linked theory support,
- visibility policy,
- rationale reference,
- outcome classification policy.

## Rich Content Policy

Typed assignment structure does not mean all prose becomes plain strings.

V2 should use a controlled rich-content model for instructional prose inside domain objects.

The rich-content model may support:

- paragraphs,
- headings,
- bullet and numbered lists,
- emphasis,
- links,
- callouts,
- constrained tables,
- inline code where pedagogically useful.

The first implementation should avoid an unlimited document grammar.

The assignment domain model should describe pedagogical meaning. The rich-content model should describe local presentation.

## Tutor Authoring Experience

### Primary surface: assignment canvas

The tutor edits the assignment itself.

The canvas should support:

- inline text editing,
- block selection,
- drag or keyboard reordering,
- duplicate,
- delete,
- insert before or after,
- change compatible block or task type,
- collapse long sections,
- undo and redo,
- autosave,
- version history,
- regenerate selected block,
- restore generated version.

### Secondary surface: block inspector

Selecting a block reveals structured controls.

For an exercise, the inspector may expose:

- task type,
- target references,
- new/review/mixed role,
- accepted answers,
- normalization policy,
- hint,
- explanation,
- answer reveal behavior,
- theory links,
- learner visibility,
- selection rationale and evidence.

For a study text, the inspector may expose:

- level,
- target density,
- speaker roles,
- linked vocabulary,
- media references,
- regeneration constraints.

### Preview modes

The same authoring surface should support preview states for:

- learner desktop,
- learner mobile,
- print,
- first attempt,
- incorrect answer,
- correct answer,
- answer revealed,
- completed assignment,
- teacher-only annotations.

A final exact artifact preview may remain, but it should be verification rather than the tutor's first look at the assignment.

## AI-Assisted Editing Model

Typed blocks allow bounded model operations.

Initial AI operations may include:

- rewrite selected block at a different level,
- shorten selected block,
- replace examples while preserving targets,
- create easier or harder variants,
- change recognition into controlled production,
- regenerate a pronunciation sentence while preserving mode,
- add one review task for a selected target,
- replace a scenario while preserving pedagogical intent.

The model should return a validated patch for selected block IDs.

Whole-assignment regeneration remains available, but local operations should be preferred when tutor intent is local.

## Interactive Learner Runtime

### Delivery format

The first V2 learner artifact should remain a self-contained HTML file.

Use a prebuilt Preact runtime and CSS bundle produced once during package build.

At assignment publication time, inject:

- serialized validated assignment data,
- theme tokens,
- media metadata,
- assignment identity and revision,
- optional result-submission configuration.

Do not invoke Vite once per assignment.

### First task behaviors

The first production release should support:

1. multiple choice,
2. gap fill,
3. error correction,
4. sentence reconstruction,
5. matching if implementation cost remains bounded,
6. open response marked complete but not automatically scored.

### Feedback behavior

The default objective-task loop should be:

```text
attempt
-> check
-> correct: explanation and completion
-> incorrect: concise feedback + optional hint
-> retry
-> explicit answer reveal when allowed
```

### Progress behavior

The first artifact should support:

- local progress persistence,
- graceful in-memory fallback,
- reset,
- section progress,
- completion summary,
- copyable tutor summary.

### Privacy boundary

Objective task responses may be persisted locally.

Personal free writing should remain local unless the learner explicitly submits it.

Do not collect keystrokes, cursor movement, or speculative engagement telemetry.

## Learner Outcomes and Student Memory

Typed assignments make outcome evidence possible without reverse-extracting task semantics from Markdown.

The future chain is:

```text
assignment decision ledger
-> selected target
-> typed task with stable target references
-> task attempt
-> outcome event
-> homework outcome summary
-> future learner-state update
```

The first production release may stop at a local or copyable result summary.

Backend-connected outcomes may follow when assignment-instance identity, authentication, privacy, idempotency, and offline behavior are ready.

The relationship to student memory is specified in:

- [`../student-memory-decision-ledger/README.md`](../student-memory-decision-ledger/README.md)

Assignment V2 supplies the structured attempt evidence that the future outcome-memory layer currently lacks.

## Compatibility and Legacy Policy

### Format boundary

```ts
type AssignmentFormat = 'legacy_markdown_v1' | 'structured_assignment_v2';
```

This boundary should be explicit at storage and routing edges.

### V1 policy

- existing V1 assignments remain readable,
- existing V1 publishing remains operational during the V2 build,
- V1 receives maintenance only,
- no V2 subsystem should depend on parsing mutable V1 Markdown at runtime.

### V2 policy

- V2 typed content is canonical,
- normal tutor editing never requires Markdown,
- V2 publication is rendered from the typed document,
- V2 outcomes refer to immutable assignment revisions and stable task IDs.

### Import policy

A one-way `Duplicate as V2` or `Import into V2` capability may be added after the native path works.

Import rules:

- conversion is best-effort,
- converted output requires tutor review,
- conversion creates a new V2 lineage,
- original V1 content remains untouched,
- no promise of round-trip fidelity,
- import is not a prerequisite for V2 production launch.

### Retirement slope

After V2 becomes the default:

1. new assignments default to V2,
2. V1 remains viewable,
3. V1 editing remains only if production evidence requires it,
4. V1 becomes read-only,
5. `Duplicate as V2` replaces routine legacy editing,
6. V1 generation and publishing code is removed when retention and support requirements permit.

The roadmap should always preserve a route toward deletion.

## Production Scope for V2.0

### Required

- typed domain schema,
- schema validation and migration versioning,
- persisted immutable revisions,
- structured model generation,
- structured tutor editor,
- current lesson/profile/memory context integration,
- at least four objective task types,
- open-response tasks,
- local answer checking,
- local progress,
- single-file interactive publication,
- mobile and desktop learner experience,
- result summary,
- explicit V1/V2 routing,
- production rollback switch,
- observability for generation, validation, editing, rendering, and publishing failures.

### Deferred from V2.0

- collaborative editing,
- arbitrary plugin blocks,
- full legacy conversion,
- server-secret answer checking,
- adversarial assessment security,
- AI grading of personal writing,
- real-time tutor dashboards,
- cross-student analytics,
- a complete language-learning ontology,
- every possible exercise type,
- student-facing decision explanations,
- automatic memory mutation from weak outcome signals.

## Implementation Strategy

### Parallel replacement

Keep V1 stable while V2 is built alongside it.

V2 code may merge to the main branch when it is:

- non-routed,
- internal-only,
- feature-gated,
- or otherwise unable to alter the alpha production path.

### Coherent PR sizing

Avoid both extremes:

- one enormous unreviewable PR,
- dozens of tiny PRs whose coordination costs consume Codex limits.

Prefer one coherent subsystem per PR.

A phase PR should ideally be completable in one to three focused Codex sessions and leave:

- passing tests,
- stable contracts,
- updated handoff notes,
- no production behavior change unless the phase explicitly authorizes it.

### Integration branch policy

Do not require a long-lived branch for the entire V2 program.

Merge isolated, inert foundations to main behind no route or an internal flag. This reduces branch drift and lets each later Codex session start from current repository truth.

Use a temporary integration branch only when several tightly coupled PRs must be exercised together before they can safely merge.

## Codex Budget and Context Strategy

Codex limits are a product constraint, not an embarrassing implementation detail.

### 1. Give each phase a context capsule

Every phase plan should include:

- objective,
- exact package and file boundaries,
- read-first docs,
- contracts to preserve,
- forbidden areas,
- acceptance tests,
- manual verification,
- exit state,
- next-phase handoff.

The agent should not rediscover the whole repository for each phase.

### 2. Prefer new isolated packages over compatibility edits across many packages

A clean `assignment-document` package is cheaper to reason about than adding V1/V2 unions to every existing Markdown helper.

A clean `interactive-assignment-runtime` package is cheaper than extending imperative scripts until they resemble a framework.

### 3. Use fixtures as executable context

Create representative assignment fixtures early:

- dialogue-heavy lesson,
- grammar review,
- vocabulary-focused assignment,
- pronunciation task,
- multimedia assignment,
- mixed objective/open production assignment,
- deliberately invalid documents.

Fixtures reduce prompt repetition and make regression expectations concrete.

### 4. Avoid premature generalized abstractions

Implement the smallest stable contract that expresses current real assignments.

Do not spend model context designing hypothetical block marketplaces, universal course graphs, or editor-plugin systems before the core path works.

### 5. Avoid temporary round-trip infrastructure

Do not spend Codex sessions building:

- typed-to-Markdown-to-typed synchronization,
- legacy directive compilers intended to be deleted immediately,
- broad dual-write repositories,
- one-off migration shims required only because the cutover boundary was placed too low.

### 6. Make tests narrow and reusable

Each package should have fast contract tests.

Cross-package end-to-end tests should be concentrated at stable boundaries rather than duplicated in every phase.

### 7. Record decision changes immediately

When implementation evidence changes the roadmap, update this document or the active phase plan in the same PR.

Do not make the next agent infer why the code differs from the roadmap.

## Proposed Package Boundaries

The exact names may change, but the responsibility split should remain recognizable.

```text
packages/assignment-document
  domain types
  schema validation
  canonicalization
  version migrations
  fixtures
  diff helpers

packages/assignment-authoring
  tutor canvas
  block inspector
  editor commands
  undo/redo
  autosave integration
  AI patch application

packages/interactive-assignment-runtime
  Preact learner components
  answer checking
  task state
  progress storage
  accessibility
  result summary

packages/interactive-assignment-builder
  prebuilt runtime assets
  serialized document injection
  static fallback shell
  artifact hash and render identity

packages/html-publisher
  legacy V1 renderer
  shared publication transport
  explicit V2 artifact handoff
```

Backend persistence and routes may remain in `batch-backend` initially, provided the domain logic stays in dedicated packages rather than being buried in transport files.

## Roadmap Phases

## Phase 0: Alpha Release and Evidence Freeze

### Objective

Ship and operate the current alpha without beginning the V2 implementation detour.

### Work

- finish the current frontend overhaul,
- invite the waiting tutors,
- observe how tutors edit generated assignments,
- collect examples of common manual changes,
- preserve representative V1 assignments as V2 fixtures,
- record failures that V2 must solve.

### Exit criteria

- alpha is in real tutor use,
- at least a small set of representative edit patterns exists,
- no release-critical work is blocked by V2 planning.

### V2 exposure

None.

## Phase 1: AssignmentDocument Contract and Fixtures

### Objective

Prove that one product-owned typed schema can express real assignments without relying on Markdown as canonical state.

### Work

- create `assignment-document` package,
- define V2 schema and domain types,
- define controlled rich-content model,
- define task answer specifications,
- define stable block and task identity rules,
- define validation errors and warnings,
- create valid and invalid fixtures from real V1 assignments,
- define schema-version migration boundary,
- write architecture decision records.

### Explicit non-work

- no editor,
- no provider generation,
- no persistence migration,
- no production route,
- no V1 converter.

### Exit criteria

- fixtures cover current assignment diversity,
- schema validates all approved fixtures,
- invalid fixtures fail deterministically,
- task and block identity rules are documented,
- no Markdown parsing is required to render fixture meaning.

## Phase 2: Persistence, Revision, and API Boundary

### Objective

Create canonical V2 storage without changing the current production assignment flow.

### Work

- add assignment format discriminator,
- add V2 assignment/revision persistence,
- preserve immutable published revision identity,
- add draft save and revision APIs,
- add optimistic concurrency or revision conflict rules,
- add lineage and audit fields,
- add internal read/write routes,
- add repository and transport tests.

### Compatibility boundary

V1 remains untouched except for the smallest routing discriminator needed to identify format.

### Exit criteria

- V2 documents round-trip through persistence without semantic loss,
- revisions are immutable after publication,
- concurrent save behavior is deterministic,
- production V1 behavior is unchanged.

## Phase 3: Read-Only V2 Canvas and Learner Renderer

### Objective

Demonstrate that one typed document can power both tutor and learner projections.

### Work

- build read-only tutor canvas from fixtures and stored V2 drafts,
- build learner renderer from the same document,
- implement desktop, mobile, and print layouts,
- render media, theory, study text, vocabulary, and task blocks,
- add internal V2 route,
- add visual regression or screenshot fixtures where useful,
- define design tokens shared with the main service.

### Exit criteria

- representative documents render correctly in both projections,
- no UI infers semantics from final HTML,
- the current alpha route remains unchanged,
- accessibility baseline passes.

## Phase 4: Direct Structured Generation

### Objective

Generate valid V2 documents directly from the model.

### Work

- define provider structured-output contract,
- add `AssignmentDocumentDraft` response schema,
- separate model-authored fields from backend-owned fields,
- canonicalize IDs and lineage in the backend,
- validate and perform one bounded repair when justified,
- add generation evaluator fixtures,
- store generation request and result lineage,
- expose generated V2 drafts only on internal routes.

### Rejected shortcut

Do not generate Markdown and immediately parse it into V2 as the normal path.

### Exit criteria

- representative prompts produce valid typed drafts,
- invalid output fails or repairs deterministically,
- backend-owned identity and provenance cannot be spoofed by model output,
- generated documents render through Phase 3 surfaces.

## Phase 5: Structured Visual Editor

### Objective

Replace raw source editing with a tutor-facing pedagogical editor.

### Work

- inline rich-text editing,
- block selection and inspector,
- insert, reorder, duplicate, delete,
- task-type-specific controls,
- accepted-answer editing,
- undo and redo,
- autosave,
- draft revision history,
- learner-state previews,
- bounded AI block operations,
- validation surfaced at block level.

### Product rule

The normal V2 editor must not expose a Markdown textarea as an escape hatch.

A developer-only JSON inspector may exist for debugging.

### Exit criteria

- tutors can perform the common alpha edit patterns without source syntax,
- no edit loses stable identity unexpectedly,
- invalid task configurations are blocked or clearly surfaced,
- autosave and conflict behavior are reliable,
- founder can author and revise a real assignment entirely in V2.

## Phase 6: Interactive Single-File Publication

### Objective

Publish a self-contained learner artifact with local interaction.

### Work

- build Preact learner runtime once,
- inject assignment data at publication time,
- implement objective task checking,
- implement staged feedback and answer reveal,
- implement local progress and reset,
- implement open-response completion,
- implement result summary,
- preserve multimedia and pronunciation support,
- integrate artifact hashing and S3 publication,
- add CSP and content-safety review,
- add offline and direct-file smoke tests.

### Exit criteria

- one V2 assignment publishes to one functional HTML file,
- the file works without supporting JS/CSS assets,
- objective tasks check deterministically,
- progress survives refresh where storage is available,
- personal writing follows the privacy policy,
- current V1 publisher remains operational.

## Phase 7: Assignment Instances and Outcome Boundary

### Objective

Define the learner-attempt contract without overcommitting to server-connected telemetry.

### Work

- define assignment instance identity,
- define attempt and task-outcome contracts,
- produce local outcome summaries,
- support explicit copy or export to tutor,
- decide whether V2.0 needs authenticated submission,
- if authorized, add narrow idempotent result submission,
- keep free writing opt-in,
- map task outcomes to target references,
- prepare later homework outcome memory integration.

### Exit criteria

- every outcome refers to an immutable assignment revision and stable task ID,
- observed events are separated from pedagogical interpretation,
- privacy behavior is explicit,
- a useful tutor result exists even if backend submission remains deferred.

## Phase 8: Founder Dogfood and Selected Tutor Pilot

### Objective

Exercise the complete V2 path with real assignments before default cutover.

### Work

- founder authors and publishes multiple real assignments,
- compare V1 and V2 authoring time,
- test mobile learner experience,
- test task-checking edge cases,
- invite selected alpha tutors behind an opt-in gate,
- collect structured failure reports,
- fix reliability and comprehension issues,
- test rollback to V1 default.

### Exit criteria

- core authoring path is reliable,
- tutors can understand the editor without Markdown knowledge,
- published artifacts work for intended learner devices,
- failures are observable and recoverable,
- no known data-loss path remains,
- rollback has been tested.

## Phase 9: Production Cutover

### Objective

Make V2 the default for new assignments without deleting the escape route prematurely.

### Work

- enable V2 by default for new assignments,
- keep V1 readable,
- retain an operator-controlled V1 fallback for new assignments during the confidence window,
- monitor generation, editing, publication, and learner-runtime failures,
- document support procedures,
- announce the product behavior change,
- stop adding features to V1.

### Exit criteria

- production default is V2,
- new V2 assignment success rate meets the agreed reliability threshold,
- support burden is manageable,
- rollback is no longer needed for normal operation,
- V1 retirement can be planned from evidence.

## Phase 10: Legacy Retirement

### Objective

Remove compatibility code that no longer earns its cost.

### Work

- make V1 read-only,
- add `Duplicate as V2` only if real demand justifies it,
- remove V1 generation entry points,
- remove V1 draft editing,
- remove Markdown validation from the normal assignment path,
- retain only required historical viewing or artifact access,
- archive V1 plans and update canonical docs,
- delete dead compatibility code and tests.

### Exit criteria

- no new assignment depends on V1,
- retained V1 access has a documented business or retention reason,
- V2 is the sole active authoring architecture,
- the main codebase no longer carries unnecessary dual-format branches.

## Production Gates

### Gate A: Document expressiveness

Pass when the typed model represents approved real assignments without hidden Markdown semantics.

### Gate B: Generation reliability

Pass when direct structured generation produces valid, pedagogically usable drafts at an acceptable repair/failure rate.

### Gate C: Tutor authoring completeness

Pass when common tutor edits can be completed in the visual editor without source-code escape hatches.

### Gate D: Learner artifact reliability

Pass when interactive single-file artifacts work across intended browsers, devices, and storage conditions.

### Gate E: Outcome integrity

Pass when task results point to stable assignment revisions and do not overclaim learner knowledge.

### Gate F: Cutover safety

Pass when V2 has real-user evidence, observable failures, support procedures, and a tested default rollback.

## Definition of Done for Assignment Platform V2 in Production

V2 is in production when:

1. new assignments default to `structured_assignment_v2`,
2. the model generates a validated typed document directly,
3. tutors can edit the normal assignment entirely through the visual editor,
4. published assignments are self-contained interactive HTML artifacts,
5. objective tasks provide deterministic local checking,
6. progress and result summaries work reliably,
7. assignment revisions and task identities remain stable and traceable,
8. the current learner context and memory system can guide structured generation,
9. failures are observable and recoverable,
10. V1 remains only as an explicit historical or temporary fallback path,
11. there is a documented path to delete the remaining legacy code.

## Risks and Mitigations

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Schema becomes too generic | Long design cycle and weak product semantics | Model real current assignments first; defer plugin-style generalization. |
| Editor library becomes canonical | Vendor-shaped domain and future lock-in | Keep product-owned schema and write adapters. |
| Structured generation is brittle | High repair rate and blocked authoring | Strong schema, bounded repair, evaluator fixtures, fallback only at the route level. |
| Visual editor consumes the entire program | Delayed learner value | Build read-only projections first; implement only common alpha edit operations for V2.0. |
| Local answer keys are inspectable | Learners can find answers in source | Accept for normal homework; use server checking only for future high-stakes modes. |
| V1/V2 compatibility spreads | Permanent dual architecture | Keep format branching at routing/storage edges; no dual-write or round-trip. |
| Codex context is repeatedly exhausted | Slow and inconsistent implementation | Phase context capsules, isolated packages, executable fixtures, explicit forbidden areas. |
| One large implementation run drifts | Hard review and hidden assumptions | Coherent subsystem PRs with stable contracts and handoff updates. |
| V2 is exposed too early | Tutors experience incomplete product | Internal route until full core loop passes gates. |
| Outcome data overclaims learning | Corrupted memory and bad review selection | Store observed events first; derive learner state conservatively and separately. |

## Rejected Approaches

### Extend Markdown with increasingly rich directives

Rejected as the final architecture because task semantics would remain encoded in text and recovered by parsing.

May be used only for one-off migration tooling, not the canonical V2 path.

### Make the visual editor edit Markdown underneath

Rejected because stable task identity, accepted-answer configuration, block semantics, and rationale cannot be preserved reliably through arbitrary text edits.

### Build a generic WYSIWYG document editor

Rejected because the product needs pedagogical blocks, not only formatted prose.

### Use an editor framework's JSON as canonical storage

Rejected because it moves lock-in from Markdown to a third-party implementation format.

### Convert every existing assignment before launch

Rejected because native V2 value should not be blocked by imperfect historical conversion.

### Rewrite the current production path in place

Rejected because it increases alpha risk and forces half-migrated states onto tutors.

### Put the entire V2 program into one PR

Rejected because review, rollback, tests, and agent context become fragile.

### Split the program into dozens of micro-PRs

Rejected because coordination overhead and repeated context loading waste Codex limits.

## Decision Ledger

| Decision | Rationale | Rejected alternative | Revisit trigger |
| --- | --- | --- | --- |
| Build V2 in parallel | Protects alpha while allowing a clean destination. | Rewrite V1 in place. | Only if an early contract cannot coexist without modifying production behavior. |
| Typed document is canonical | Preserves pedagogical semantics through generation, editing, publication, and outcomes. | Markdown plus directives as permanent source of truth. | Only if structured generation proves unworkable after measured evaluation. |
| No editable Markdown fallback in V2 | Avoids dual truth and round-trip complexity. | Visual editor plus source textarea. | Developer-only diagnostics do not count as a product fallback. |
| Product owns schema | Protects domain stability and portability. | Persist editor-library JSON. | Revisit adapter choice, not canonical ownership. |
| Merge inert foundations to main | Reduces branch drift and repeated context setup. | One long-lived program branch. | Use temporary integration branches for tightly coupled slices only. |
| Coherent subsystem PRs | Balances reviewability with Codex context cost. | One giant PR or many micro-PRs. | Adjust phase size based on measured agent performance. |
| No routine dual-write | Prevents permanent transition machinery. | Keep V1 and V2 synchronized. | One-way import may be justified by real user demand. |
| Cut over after complete core loop | Avoids half-legacy tutor experience. | Gradually expose individual V2 fragments. | Internal dogfood remains allowed before full cutover. |
| Keep local-first learner runtime | Delivers interactivity without immediate auth/backend complexity. | Require connected submission for first release. | Add submission when product need and privacy contract are clear. |
| Link outcomes later to memory | V2 supplies structured evidence missing today. | Treat assignment publication as proof of learning. | Begin when attempt identity and outcome integrity pass Gate E. |

## Implementation Start Conditions

Implementation may begin after:

1. the current alpha release is operating,
2. the main frontend overhaul is no longer blocking release,
3. representative tutor edit patterns have been captured,
4. the founder explicitly promotes this roadmap from future planning into active execution,
5. Phase 1 receives a concrete context capsule and acceptance plan.

Implementation should not begin merely because this roadmap is exciting and available.

## Relationship to Existing Documentation

Read these alongside this roadmap:

1. [`../student-memory-decision-ledger/README.md`](../student-memory-decision-ledger/README.md)
2. [`../../reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`](../../reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md)
3. [`../../reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`](../../reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md)
4. [`../../reference/PRESET_V2_SPEC.md`](../../reference/PRESET_V2_SPEC.md)
5. [`../../reference/pipeline-manifest.md`](../../reference/pipeline-manifest.md)
6. [`../student-area-redesign/README.md`](../student-area-redesign/README.md)
7. [`../2026-06-23-alpha-readiness.md`](../2026-06-23-alpha-readiness.md)

## Final Instruction to Future Implementers

Do not preserve legacy merely because it exists.

Preserve user data, published artifacts, operational continuity, and rollback safety. Those are product obligations.

Do not preserve Markdown as the active V2 authoring model, do not build permanent two-way conversion, and do not spread V1/V2 branching through every internal layer merely to make the migration look gradual.

Build the clean replacement in bounded, testable slices. Keep it invisible until the whole core flow works. Then cut over deliberately and begin deleting the bridge behind it.