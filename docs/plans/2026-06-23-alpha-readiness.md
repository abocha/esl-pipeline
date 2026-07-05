# Alpha Readiness Plan

## Meta

- Audience: founder-maintainer and implementation agents.
- Status: `roadmap`.
- Last Verified Against: 2026-07-06 repository and launch-readiness issue intake.
- Exit Trigger: archive after the product reaches v1 production-readiness or this plan is replaced by
  a later evidence-backed launch plan.
- Current Focus: post-deploy alpha issue intake. Chunks 19-22 are newly logged from tutor testing
  after the Chunk 12 and Chunks 16-18 fixes; implementation, production changes, and hosted smoke
  evidence remain separate approval-gated work.

## Purpose

This is the active continuation of the completed production-readiness restart work. It preserves
the original chunk numbering while directing the next work toward evidence from real tutors, rather
than reopening already-delivered infrastructure or feature work.

The authoritative launch-stage policy is
[`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](../reference/PRODUCT_NORTH_STAR_AND_READINESS.md).

## Launch Stages

| Stage                   | Tutor cohort                        | Intent                                                                                  | Exit evidence                                                                          |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Pre-alpha               | 1 tutor                             | Prove the core flow with one real tutor and remove directly observed friction.          | The tutor can repeatedly complete the core flow with bounded support.                  |
| Closed alpha            | 3–5 tutors                          | Establish repeatable tutor value and reliability under supervised use.                  | Scorecard trends and tutor feedback support admitting a broader cohort.                |
| Closed beta             | 6–10 tutors                         | Confirm the product remains simple, reliable, and supportable across varied real usage. | The readiness scorecard is mostly green for two consecutive weeks.                     |
| v1 production readiness | Evidence-backed decision after beta | Decide whether the service is ready for a production launch.                            | Reliability, support load, and weekly tutor value meet the canonical readiness policy. |

## Completed And Deferred History

| Original chunk | State    | Record                                                                                                                      |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1–6            | complete | Production-worker, hotfix-parity, legacy-runtime, student/profile, assignment UX, and schedule/candidate work are shipped.  |
| 7              | complete | Pronunciation source correctness, selective audio reuse, and explicit regeneration are shipped.                             |
| 8              | deferred | Telegram tutor workflows and non-blocking invite polish are post-alpha work.                                                |
| 9              | complete | VPS deploys read Caddy edge values from the canonical server-local `.env`.                                                  |
| 10             | complete | Student-memory pacing, disabled Batch replay, canonical import, and live-eval evidence are shipped; Batch remains disabled. |
| 11             | complete | PR CI, release commits/tags, and post-release production image publishing are split.                                        |

The preceding intake map is preserved as historical context at
[`docs/archive/plans/standalone/2026-06-15-production-readiness-restart-chunks.md`](../archive/plans/standalone/2026-06-15-production-readiness-restart-chunks.md).

## Active Chunks

### Chunk 12: Tutor-Facing UI Distillation

Priority: P1.

Goal: remove redundant flavor text, repeated headings, static helper copy, and unnecessary visual
nesting from the tutor-facing assignment and student workflows so each current state makes one next
action obvious.

Scope:

- Begin with the minimal assignment workflow, including lesson source, transcript, learning context,
  draft, preview, and share stages.
- Keep dynamic guidance that changes with state, prevents an error, or explains a blocked action.
- Remove repeated static explanations that duplicate the stage title, field label, button label, or
  already-visible state.
- Preserve accessibility labels, error messages, and information needed for an informed tutor action.
- Do not turn this into a visual redesign, provider-control expansion, or backend behavior change.

Acceptance evidence:

- The primary lesson-source screen presents the stage title, the Student field, and one state-aware
  next-step message instead of repeating the same instruction in multiple headings and paragraphs.
- Each primary workflow stage has one clear primary action and only state-relevant instructional
  copy.
- Tutor-facing tests cover the retained dynamic guidance and the removed redundant copy.
- A focused visual review confirms the task hierarchy remains clear at desktop and narrow widths.

### Chunk 13: Target-Model Activation Configuration Hardening

Priority: P1.

Goal: make the evaluated OpenAI target-model ladder a clear, deterministic production configuration
instead of a flag whose effect can be hidden by explicit model overrides.

Scope:

- Define and test the precedence between `GEN_OPENAI_TARGET_MODELS_ENABLED` and every explicit
  `GEN_OPENAI_MODEL_*` value.
- Make the intended operator activation procedure accurate in environment examples and provider
  policy documentation.
- Keep `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false` independent of target-model activation.
- Do not activate a production environment or submit OpenAI Batch work in this implementation chunk.

Acceptance evidence:

- Tests prove the resolved production model ladder for both disabled and enabled states.
- Operator documentation names every required environment change, or a single authoritative switch
  if implementation makes that safe.
- Strict allowlists admit every target model that the enabled ladder can select.

### Chunk 14: Pre-Alpha Tutor-Flow Evidence

Priority: P1.

Goal: make the one-tutor pre-alpha loop observable and actionable before recruiting the closed-alpha
cohort.

Scope:

- Record a small, privacy-safe evidence set for invite acceptance, first student, lesson source,
  assignment generation, sharing, and follow-up.
- Turn a reproduced blocker into a narrowly scoped reliability or usability fix; do not build
  speculative features from one anecdote.
- Use the canonical readiness scorecard and capture the top tutor pain points after each session.

Acceptance evidence:

- Each tutor session records completion, failure/recovery, time-to-assignment, and needed support.
- The next admitted tutor is based on observed evidence, not a broad feature backlog.

### Chunk 15: Closed-Alpha Reliability Loop

Priority: P1, after the cohort reaches 3–5 tutors.

Goal: keep the service dependable and simple while it moves from one supervised tutor to a small
closed-alpha cohort.

Scope:

- Review the readiness scorecard weekly and prioritize reliability-only work when two or more
  metrics are red.
- Ship small fixes to concrete tutor blockers, then record whether the next session improved.
- Avoid broad new product surfaces until the core flow is repeatable with low support burden.

Acceptance evidence:

- Weekly evidence identifies the top three tutor pain points and the chosen follow-up.
- The team can make an explicit, evidence-backed decision to enter closed beta or remain in alpha.

### Chunk 16: Rerun Theme Preservation

Priority: P1.

Goal: make rerun-generated pages preserve the normal run color theme so republished or regenerated
assignment pages do not lose the yellow visual treatment that tutors and students expect.

Scope:

- Reproduce the difference between a normal run and a rerun using the same lesson/student inputs.
- Trace whether the missing theme is caused by rerun DTO construction, manifest reuse, publisher
  inputs, stored artifact metadata, or frontend rendering.
- Add a focused regression test around the smallest layer that drops the theme.
- Fix only the theme preservation path; do not turn this into a broader assignment redesign.

Acceptance evidence:

- Rerun pages preserve the same color-theme metadata and yellow styling as equivalent normal runs.
- The regression test fails before the fix and passes after the fix.
- A manual or screenshot-based smoke check compares one normal run and one rerun artifact.

### Chunk 17: Profile Draft Revision Generation Repair

Priority: P1.

Goal: restore the "generate draft revision" action so it asks the model to write a complete new
student-profile draft from the available profile data, lesson evidence, and approved facts, rather
than accidentally invoking the candidate-promotion safety prompt.

Observed failure:

- The current request prompt says to decide whether selected approved candidates are safe to promote
  into the student profile and return `profile_candidate_patch_v1` JSON.
- The model correctly follows that prompt, but the frontend expects a full draft profile and reports:
  "Profile draft generation appears truncated compared with the base profile. No draft was saved."

Scope:

- Reproduce the button path from the tutor-facing UI and capture which backend endpoint, prompt
  asset, and response schema it actually uses.
- Identify why the draft-generation action is routed to the candidate-promotion prompt/schema.
- Restore the intended draft-generation prompt, response contract, and frontend expectation as one
  coherent path.
- Preserve the separate candidate-promotion safety flow; do not weaken its closed-schema behavior.
- Use fixtures or recorded prompt inspection where possible; do not require live provider calls for
  the regression.

Acceptance evidence:

- Tests prove "generate draft revision" sends the draft-generation prompt/schema, not
  `profile_candidate_patch_v1`.
- Tests prove candidate promotion still uses the candidate-patch safety prompt and closed schema.
- The frontend no longer raises the truncated-draft error for a valid generated draft.
- Manual tutor-flow smoke confirms a draft revision can be generated and saved from the UI.

### Chunk 18: Assignment Prompt Student-Name Grounding

Priority: P1.

Goal: include the canonical student name in the assignment-creation prompt envelope so generated
assignments do not infer the learner's name from transcript text or invent a name for the assignment
header.

Observed failure:

- The assignment-generation request includes lesson data but does not explicitly provide the actual
  selected student name.
- The model must infer the name from transcript content or invent one when the assignment header
  needs a student name.

Scope:

- Reproduce the assignment-generation prompt envelope for a selected student and confirm where the
  student identity is absent.
- Add the canonical student display name to the prompt envelope at the backend boundary that already
  binds assignment generation to the selected student.
- Update prompt instructions, schemas, snapshots, or fixtures so the model treats the provided
  student name as authoritative for headers and student-facing copy.
- Preserve privacy boundaries: include the minimum student identity needed for the assignment output,
  not unrelated profile metadata.
- Do not rely on transcript parsing as the source of truth for the student's name.

Acceptance evidence:

- Tests prove assignment-generation requests include the selected student's canonical display name.
- Tests or prompt snapshots prove the model is instructed to use that name for assignment headers
  instead of inferring or inventing it.
- A tutor-flow smoke check confirms a generated assignment header uses the selected student's real
  name when the transcript omits or ambiguously mentions names.

### Chunk 19: Assignment Name Instruction Prompt-Envelope Placement

Priority: P1.

Goal: move the `CANONICAL_STUDENT_NAME` assignment instruction into the proper structured prompt
envelope location instead of prepending it as a standalone instruction before the assembled prompt.

Observed concern:

- The current instruction says:
  `Use CANONICAL_STUDENT_NAME as the authoritative learner name for assignment headers and student-facing copy. Do not infer or invent the learner name from the transcript.`
- That guidance is directionally correct, but placing it before the prompt body may violate the
  prompt-assembly guidelines and make the envelope harder to reason about.

Scope:

- Inspect the assignment prompt assembly path and identify the correct structured section for
  authoritative assignment instructions.
- Keep the canonical student name available in the request envelope and prompt context.
- Integrate the instruction with the existing prompt contract rather than duplicating it as an
  out-of-band preamble.
- Preserve the privacy boundary from Chunk 18: include only the minimum selected-student identity
  needed for assignment output.
- Do not change model selection, assignment schemas, or unrelated prompt content in this chunk.

Acceptance evidence:

- Prompt snapshots or request-envelope tests prove the canonical-name instruction appears in the
  intended structured prompt section.
- Tests prove the instruction is no longer simply prepended before the prompt body.
- Assignment-generation tests still prove headers and student-facing copy use
  `CANONICAL_STUDENT_NAME` instead of transcript-inferred names.

### Chunk 20: Memory Candidate Promotion Status Finalization

Priority: P1.

Goal: ensure memory candidates that have been promoted into the student profile are marked as
promoted, not left in the approved state.

Observed failure:

- After promotion, memory candidates remain visible or persisted as `approved`.
- This makes the tutor-facing status misleading and risks repeated promotion attempts or confusing
  review queues.

Scope:

- Reproduce the candidate-promotion flow from the tutor-facing UI and backend API.
- Trace the promotion transaction, candidate status update, candidate listing query, and frontend
  refresh/cache behavior.
- Make the intended lifecycle explicit: selected candidates that successfully enter the profile
  should become `promoted` or be hidden from approved-only review views by an equivalent canonical
  state transition.
- Preserve candidate audit/history semantics and avoid deleting evidence rows.
- Do not weaken the candidate-promotion safety prompt, validation, or closed response schema.

Acceptance evidence:

- Backend tests prove successful promotion transitions selected approved candidates to promoted
  status, or to the documented canonical post-promotion state.
- Listing/API tests prove promoted candidates no longer appear as still-approved work.
- Frontend tests or a manual tutor-flow smoke check prove promoted candidates no longer remain in
  the approved queue after refresh.

### Chunk 21: Memory Support Source Count Verification

Priority: P2.

Goal: verify whether the memory support details source-count display is correct when it reports
`Included sources 2 lesson / 2 homework`, given expected recent evidence may be 3 lessons and 2
homework items.

Observed concern:

- In the memory support details, tested students show `Included sources 2 lesson / 2 homework`.
- The expected count may be 3 lessons and 2 homework items, but this has only been observed across
  two tested students so far and could be normal source selection rather than a bug.

Scope:

- Identify the intended source selection policy for memory support details, including lesson and
  homework caps, recency rules, and eligibility filters.
- Compare the displayed counts with the actual selected source manifest or backend response for
  students that have at least 3 lesson sources and 2 homework sources.
- Determine whether the issue is display copy, selection policy, source eligibility, or missing
  backend data.
- Keep this as an investigation-first chunk; do not change the selection count until the intended
  policy is confirmed.

Acceptance evidence:

- A fixture or targeted backend/frontend test covers students with 3 eligible lesson sources and 2
  eligible homework sources.
- The support details display matches the actual selected sources, or the documented policy explains
  why only 2 lesson sources are included.
- If the display is wrong, the fix includes a regression test for the corrected source counts.

### Chunk 22: Legacy Student Workspace Removal

Priority: P1, next PR after Chunks 19-20 ship.

Goal: remove the dead legacy all-in-one student workspace so alpha work stops carrying, building,
and testing a UI surface that is no longer part of the production tutor flow.

Observed concern:

- The routed student experience uses `StudentLearningPage`; the old `StudentWorkspace` surface is
  not linked from the current app route.
- The legacy workspace still has a large harness and multiple tests, so unrelated alpha fixes keep
  paying a maintenance cost for a dead surface.
- Shared modules still carry `StudentWorkspace` naming even when they are used by active pages,
  making it easy to accidentally preserve legacy code instead of deleting it.

Scope:

- Remove the dead `StudentWorkspace` component, CSS, test harness, and tests that only render or
  validate the legacy all-in-one workspace.
- Before deleting, inventory imports from `StudentLearningPage`, `CreateStudentDialog`,
  `WorkspaceCandidatesPanel`, `WorkspaceHistoryPanel`, and related live pages so active shared
  logic is preserved or moved into neutral modules.
- Keep the current student learning page, candidate review panel, history panel, and student
  creation flows covered by live-surface tests after the legacy harness is gone.
- Remove stale references that tell tutors or agents to open the legacy workspace.
- Do not remove unrelated backend legacy-schema emergency compatibility or legacy data
  normalization paths in this cleanup chunk.

Acceptance evidence:

- `rg` shows no production route or live UI imports `StudentWorkspace` after the cleanup.
- Frontend tests no longer include legacy `StudentWorkspace.*` suites, and equivalent live-surface
  coverage exists where behavior is still supported.
- `StudentLearningPage` and student-area routing tests prove the current tutor flow remains intact.
- Frontend typecheck/build and the affected repo validation lane pass without the legacy workspace.

## 2026-06-27 Chunks 16–18 Implementation Evidence

Status: implementation validated locally on branch `codex/alpha-chunks-16-18-fixes`, merged through
PR #116, and release images published by the release workflow. Production deployment and hosted smoke
evidence have not been performed.

Implemented:

- Chunk 16 preserves the selected/persisted color preset through rerun worker payloads and
  orchestrator rerun flags so republished HTML keeps the original heading theme.
- Chunk 17 routes "generate draft revision" to a full foundational-profile draft refresh endpoint
  and keeps candidate promotion on the closed `profile_candidate_patch_v1` path. This required the
  additive migration `0041_profile_revision_refresh_source` because profile revisions persist their
  source in a database check constraint.
- Chunk 18 adds `CANONICAL_STUDENT_NAME` to assignment prompt text and request envelopes, with
  instructions treating that value as authoritative for assignment headers and student-facing copy.

Validation run:

- `pnpm --filter @esl-pipeline/orchestrator exec vitest run tests/rerun-publish-student-name.test.ts`
- `pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/infrastructure.pipeline-worker-entry.test.ts tests/application.profile-candidate-promotion.test.ts tests/application.profile-draft-refresh.test.ts tests/application.prompt-package.resolution.test.ts tests/transport.http-server.integration.students-content.test.ts`
- `pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/students/StudentLearningPage.test.tsx src/ui/students/StudentWorkspace.candidates.test.tsx`
- `pnpm format`
- `pnpm run lint:repo-hygiene`
- `pnpm release:verify:contracts`
- `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline`
- `pnpm --silent run check:fast:agent`
- `pnpm check:pre-pr`

## 2026-07-02 Chunk 12 Lesson-Source Distillation Slice

Status: focused implementation slices in progress on branch `codex/chunk-12-ui-distillation`; this
does not complete all of Chunk 12.

Implemented:

- The lesson-source screen keeps the stage heading, Student field, recording upload control, and one
  state-aware next-step message.
- Repeated static helper copy was removed from the lesson recording panel and upload area.
- The source stage description now reports state instead of repeating the next action.
- Locked future stages now show only title, lock status, and short unlock copy; profile previews,
  draft controls, review actions, and advanced support details stay hidden until their stage unlocks.
- Resumed assignments with saved prompt, draft, or share artifacts still mark earlier stages complete
  so valid persisted work remains visible instead of being hidden by missing earlier source metadata.

Validation run:

- `pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`
- `corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/minimal/MinimalAssignment.prompt-student-selection.test.tsx`
- `corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.generation-defaults.test.tsx src/ui/minimal/MinimalAssignment.resume-basic.test.tsx src/ui/minimal/MinimalAssignment.resume-preset-races.test.tsx src/ui/minimal/MinimalAssignment.prompt-student-selection.test.tsx`
- `corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.generation-defaults.test.tsx src/ui/minimal/MinimalAssignment.generation-quota.test-groups.tsx src/ui/minimal/MinimalAssignment.job-actions.test.tsx src/ui/minimal/MinimalAssignment.logic.test.ts src/ui/minimal/MinimalAssignment.generation-throttle.test.tsx src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx src/ui/minimal/MinimalAssignment.resume-preset-races.test.tsx src/ui/minimal/MinimalAssignment.resume-basic.test.tsx src/ui/minimal/MinimalAssignment.quota-window.test.ts src/ui/minimal/MinimalAssignment.publish-validation.test.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx src/ui/minimal/MinimalAssignment.prompt-student-selection.test.tsx src/ui/minimal/MinimalAssignment.prompt-editor.test.tsx src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.polling.test.ts`
- `corepack pnpm docs:generate:indexes`
- `corepack pnpm docs:check`

Remaining Chunk 12 work:

- Run a focused visual review at desktop and narrow widths after the broader stage pass.

## 2026-07-03 Chunk 12 Unlocked-Stage Distillation Slice

Status: focused implementation slice in progress on branch `codex/chunk-12-ui-distillation`; this
continues the same Chunk 12 work and keeps the backend contract unchanged.

Implemented:

- The Vite `mock-auth` sandbox can now serve a completed assignment fixture at `?jobId=job-sandbox`
  with recording, transcript, prompt package, draft, and provenance responses.
- Resumed completed assignments keep all workflow stages unlocked for local UI review without
  Docker rebuilds, backend auth, or live provider calls.
- Completed source views hide the upload drop zone, recording settings, refresh-students action,
  and duplicate selected-student line while retaining the locked student and recording summary.
- Transcript, learner-context, assignment draft, review, and advanced actions remove static helper
  paragraphs that repeated nearby headings, labels, or button text.
- Resume/start now relies on the two path choices and recent-assignment list instead of duplicate
  "choose how to continue" helper copy.
- Quick reruns and custom rerun keep their buttons, checkboxes, model controls, capability warnings,
  and support details while dropping repeated action descriptions.
- The remaining duplicate resume/start shortcuts, custom-rerun model explainer, overview tagline,
  and completed-state summary notes were removed so the header stays closer to status-only.
- The assignment overview header was further reduced to the page title, current focus, and compact
  stage progress; the eyebrow, summary cards, and progress descriptions were removed.
- The pinned resumed-assignment card no longer repeats advanced-action buttons, details toggles, or
  helper copy; preview-required guidance moved from text into the preview button's attention state.
- Custom rerun keeps the study-text, main pronunciation, and pronunciation chunk settings headings,
  while field labels drop repeated family prefixes and keep only `Provider`, `Model`, `Voice ID`,
  `Accent`, and `Strategy`.
- Quick reruns now render as a plain button row, and learner context now renders as structured text
  instead of nested profile cards.
- Advanced actions no longer duplicates the review-stage cancel control; support details stay in the
  rerun/support area.
- Tutor-facing tests cover the all-stages-unlocked sandbox fixture and the removed unlocked-stage
  copy.

Validation run:

- `corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/dev/frontend-sandbox-api.test.ts src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`
- `corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/dev/frontend-sandbox-api.test.ts src/dev/frontend-sandbox.test.ts src/ui/minimal/MinimalAssignment.generation-defaults.test.tsx src/ui/minimal/MinimalAssignment.generation-quota.test-groups.tsx src/ui/minimal/MinimalAssignment.job-actions.test.tsx src/ui/minimal/MinimalAssignment.logic.test.ts src/ui/minimal/MinimalAssignment.generation-throttle.test.tsx src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx src/ui/minimal/MinimalAssignment.resume-preset-races.test.tsx src/ui/minimal/MinimalAssignment.resume-basic.test.tsx src/ui/minimal/MinimalAssignment.quota-window.test.ts src/ui/minimal/MinimalAssignment.publish-validation.test.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx src/ui/minimal/MinimalAssignment.prompt-student-selection.test.tsx src/ui/minimal/MinimalAssignment.prompt-editor.test.tsx src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.polling.test.ts`
- `corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/minimal/MinimalAssignment.job-actions.test.tsx src/ui/minimal/MinimalAssignment.publish-validation.test.tsx`

## Deferred Follow-Ups

Telegram is intentionally deferred until after closed alpha. Reopen it only when several tutors
demonstrate a repeated communication or coordination need that the primary product cannot meet more
simply. Invite-registration polish is similarly evidence-led: investigate and fix a concrete
reproduction, not a remembered concern.

Inworld STT is also deferred. Reopen it as a provider-evaluation chunk when the alpha flow is stable
enough to compare transcription quality, latency, reliability, cost, and operational fit against
Deepgram. The goal is to test whether Inworld can eventually replace Deepgram STT, not to change the
current alpha STT provider without evidence.

## Operating Boundaries

- Production deployment and production feature-flag changes require separate maintainer approval.
- `STUDENT_MEMORY_OPENAI_BATCH_ENABLED` remains false unless Batch operation is explicitly approved.
- Target-model activation is independent from Batch activation and follows the provider-policy and
  live-evaluation evidence requirements.
- Keep work focused: one active chunk at a time, with a recorded next stopping point.
