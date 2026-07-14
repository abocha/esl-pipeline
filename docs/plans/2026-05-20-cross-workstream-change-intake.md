# Cross-Workstream Product Change Intake

## Meta

- Audience: founder-maintainer and agents preparing later implementation plans.
- Authority Level: active intake backlog.
- Last Verified Against: 2026-05-20 repo state.
- Owner: founder-maintainer + implementation agents.
- Review Cadence: before splitting any ticket into an implementation plan or PR.
- Status: `draft`.
- Exit Trigger: archive after these tickets are either split into topic-specific implementation plans or represented in shipped behavior and durable reference docs.
- Current Focus: preserve user intent, current code ownership, desired outcomes, likely change surfaces, and open questions only; do not use this as an implementation checklist.

## Purpose

This intake file formalizes a wide set of related product changes before implementation planning.
The tickets intentionally stop short of step-by-step execution because each item crosses multiple
files or product surfaces.

Use this document to:

1. keep the requested changes visible as trackable tickets
2. map each ticket to the current code owners and existing behavior
3. identify contracts, persistence, and UI surfaces that likely need coordinated changes
4. collect questions that should be answered near implementation time

## Non-Goals For This Pass

1. No runtime code changes.
2. No schema or contract edits.
3. No final implementation sequencing.
4. No UI redesign beyond recording the desired product behavior.

## Ticket Index

| ID  | Type   | Title                                                                 | Primary Areas                                           |
| --- | ------ | --------------------------------------------------------------------- | ------------------------------------------------------- |
| T1  | change | Treat repeated single-speaker study text as monologue                 | validator, voice alignment tests                        |
| T2  | feat   | Make prompt template defaults and per-job selection explicit          | prompt template admin, minimal assignment, backend opts |
| T3  | bug    | Preserve real student name in HTML output for audio reruns            | job rerun lineage, publish metadata, HTML publisher     |
| T4  | feat   | Add lesson details and hide/undo controls for homework reminders      | schedule reminders, preferences/suppression, UI         |
| T5  | feat   | Add artifact links and add-homework actions on lesson rows            | schedule lesson rows, linked homework lineage, UI       |
| T6  | feat   | Show clear lesson context and recent lesson suggestions in assignment | minimal assignment, schedule reads, session lineage     |
| T7  | change | Include business, schedule, and billing events in student History     | student timeline, history surface, schedule/billing     |
| T8  | change | Restrict and deduplicate profile-memory candidates                    | student memory, candidate generation, provenance UI     |
| T9  | update | Add `gemini-3.5-flash` to Google generation model allow-list          | generation config, provider policy, quota metadata      |
| T10 | change | Remove Google TTS model names from voice capability styles            | prompt-package voice capabilities, template context     |

## T1 - Repeated Single-Speaker Study Text Is Monologue

### User Intent

When `study_text_type: monologue` is declared, repeated lines like `Narrator: ...` should still be
valid monologue if there is only one actual speaker and no other speakers are mentioned in the
study text. Multiple `Narrator:` paragraphs should not force detected dialogue.

### Current Code Map

- `packages/md-validator/src/rulesets/general-english/v1.ts`
  - `classifyStudyTextType()` currently counts lines matching the `Speaker: text` shape and returns
    `dialogue` when at least two such lines exist.
  - The mismatch warning/error is emitted when declared `study_text_type` differs from that
    classifier result.
- `packages/md-validator/tests/validator.speaker-study-text.marker-structure.test.ts`
- `packages/md-validator/tests/validator.speaker-study-text.narrator-letter.test.ts`
- `packages/md-validator/tests/validator.strict-alignment.test.ts`

### Desired Outcome

Detection should be based on unique speakers, not repeated marker count. A single unique speaker
label, including repeated `Narrator:` markers, is monologue. Two or more unique speaker labels is
dialogue. The rule should still catch real dialogue and unknown-speaker cases.

### Likely Change Surface

- Replace or extend `classifyStudyTextType(rawLines)` so it extracts unique speaker labels.
- Decide whether unlabelled continuation text can mention another speaker by name and still remain
  monologue. The user request says "no other speakers are mentioned in the text," so the
  implementation plan should define whether that is heuristic text scanning or only marker-based.
- Add focused validator coverage for repeated `Narrator:` blocks and multi-speaker contrast.

### Open Questions

1. Should names mentioned inside prose, not as `Speaker:` markers, count as "other speakers" for
   this rule?
2. Should `speaker_labels: [Narrator]` remain special-cased, or should all one-label cases share the
   same behavior?

## T2 - Prompt Template Default And Per-Job Selector

### User Intent

Prompt templates should be easy to choose per job. The prompt templates page needs a "make default"
button. The main assignment flow needs a prompt template selector next to `Generate instructions`.
The help text under that action should state the actual selected template and learner profile
instead of the generic default-template copy.

### Current Code Map

- Prompt admin UI:
  - `packages/batch-frontend/src/ui/prompts/PromptTemplatesPage.tsx`
  - `packages/batch-frontend/src/ui/prompts/PromptTemplatesPage.test.tsx`
- Assignment flow:
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts`
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`
- Backend prompt resolution:
  - `packages/batch-backend/src/application/prompt-options.ts`
  - `packages/batch-backend/src/application/create-prompt-package.ts`
  - `packages/batch-backend/src/transport/extended-routes/profiles-templates-routes.ts`
  - `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`
- Frontend API client:
  - `packages/batch-frontend/src/utils/api.ts`

### Current Behavior

`MinimalAssignment` resolves `selectedTemplateId` from `promptOptions.defaults.templateId` or the
first template. The assignment stage passes that ID into prompt-package creation, but there is no
operator-facing selector in the generation controls. The visible text currently says the default
template is used.

`PromptTemplatesPage` supports selecting, editing, archiving, revision activation, and creation, but
does not expose a default-template mutation.

### Desired Outcome

1. Prompt templates page clearly identifies the current default template.
2. A selected non-default template can be made default from the prompt page.
3. The main assignment flow has a compact template selector next to `Generate instructions`.
4. The info text names the effective template and effective profile, including fallback/default
   cases.
5. Existing prompt-package lineage keeps recording the resolved template revision used.

### Likely Change Surface

- Add a backend mutation for default template selection, or reuse an existing config asset surface if
  one exists after deeper inspection.
- Extend the frontend API client for that mutation.
- Persist and reload default-template state in `getPromptOptions()`.
- Add state in `MinimalAssignment` for operator-selected template ID instead of deriving it only from
  prompt options.
- Ensure assignment session resume preserves or displays the effective template choice if already
  captured by a prompt package.

### Open Questions

1. Is the default prompt template workspace-scoped, global, or config-file-backed?
2. Should the per-job template selector persist only for the current assignment session, or become
   sticky across new assignments in the browser?
3. Should "make default" require an active revision, or can it target any template with latest
   content?

## T3 - Real Student Name In HTML Output For Audio Reruns

### User Intent

HTML publish output should show the actual student name after audio reruns. Original runs show the
correct name. Audio reruns currently render `student` in the generated HTML hero/tag area.

### Current Code Map

- HTML rendering:
  - `packages/html-publisher/src/rendering.ts`
  - `packages/html-publisher/src/rendering/frontmatter.ts`
  - `packages/html-publisher/src/rendering/page-shell.ts`
  - `packages/html-publisher/tests/rendering.core-media-layout.test.ts`
- Rerun orchestration and lineage:
  - `packages/batch-backend/src/application/job-actions/rerun.ts`
  - `packages/batch-backend/src/application/job-action-handler.ts`
  - `packages/batch-backend/src/domain/job-repository.ts`
  - `packages/batch-backend/src/application/homework-memory-source.ts`
- Pipeline/publish execution:
  - `packages/batch-backend/src/application/process-queue-job.ts`
  - `packages/orchestrator` package paths involved in publish/rerun family execution

### Current Behavior

The HTML publisher renders `frontmatter.student` as a tag. The screenshot shows that during an audio
rerun the rendered page has a `STUDENT` tag, which implies the markdown/frontmatter or rerun publish
input is losing the real student display name before HTML rendering. This appears to be upstream of
`page-shell.ts`, not a pure HTML styling issue.

### Desired Outcome

Audio reruns preserve the original assignment's student display name in frontmatter and published
HTML, matching original full runs.

### Likely Change Surface

- Trace the rerun source markdown path and any frontmatter rewrite path for audio-only reruns.
- Verify whether rerun jobs inherit `student_id`, resolved profile/student display name, and
  original markdown frontmatter.
- Add a regression test at the lowest level that reproduces original-run name correctness and
  audio-rerun name preservation.

### Open Questions

1. Does the rerun path rebuild markdown from a draft, use the already-published markdown, or patch a
   temporary markdown file?
2. Is `student` coming from a placeholder prompt/frontmatter value or from a fallback in rerun
   materialization?

## T4 - Lesson Details And Hide/Undo For Homework Reminders

### User Intent

Past-lesson homework reminders need to say exactly which lesson they refer to, including date and
topic when known. Each reminder should have a hide or ignore action. Only the latest hidden reminder
needs undo support.

### Current Code Map

- Reminder DTOs:
  - `packages/contracts/src/index.ts`
- Student reminders:
  - `packages/batch-backend/src/application/student-schedule-billing.ts`
  - `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.tsx`
  - `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.css`
- Business reminders:
  - `packages/batch-backend/src/application/teacher-business-dashboard.ts`
  - `packages/batch-frontend/src/ui/business/BusinessSchedulePage.tsx`
- Existing preference storage:
  - `student_reminder_preferences` in `packages/batch-backend/schema.sql`
  - schedule/billing tests under `packages/batch-backend/tests/application.student-schedule-billing.test.ts`

### Current Behavior

`lesson_followup` reminders already exist and have `lessonId`, `lessonStatus`, and action intent,
but the visible message is generic: "The scheduled lesson time has passed and homework is not
published yet." The UI repeats identical cards when several lessons are overdue.

### Desired Outcome

1. Each reminder identifies the concrete lesson, preferably with formatted date/time, title/topic,
   and lesson ID in a low-noise detail row.
2. The teacher can hide or ignore a reminder without mutating the lesson itself.
3. The latest hidden reminder can be undone from the same surface.
4. Hidden reminders stay hidden across reloads and across student/business reminder surfaces.

### Likely Change Surface

- Extend reminder DTOs with lesson display summary fields, or have the frontend join against lesson
  rows already present in the schedule surface.
- Add persistent suppression storage keyed by student, lesson, reminder type, and workspace.
- Add backend filtering for suppressed `lesson_followup` reminders.
- Add a small latest-hidden undo response path. Avoid a broad reminder archive UI for the first
  slice unless explicitly chosen later.

### Open Questions

1. Preferred wording: `Hide`, `Ignore`, or `Dismiss`?
2. Should hidden reminders reappear if lesson date/title changes, or remain suppressed by lesson ID?
3. Should business-level reminders share the same suppression state as student-level reminders?

## T5 - Artifact Links And Add-Homework Actions On Lesson Rows

### User Intent

In the `Lessons` section of `Schedule & Billing`, lesson rows should expose direct next actions:
published homework should link to the produced artifact; completed lessons with no homework should
show an add-homework action; scheduled lessons should show the same action only after their time has
passed, not for future lessons.

### Current Code Map

- Lesson homework DTO:
  - `packages/contracts/src/index.ts`
- Backend linked-homework summary:
  - `packages/batch-backend/src/application/student-schedule-billing.ts`
- Student schedule UI:
  - `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.tsx`
  - `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.test.tsx`
- Assignment flow entry:
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`

### Current Behavior

The backend already computes `lesson.homework.status`, `jobId`, `htmlUrl`, and related lineage IDs.
The student schedule UI shows status pills and lesson status actions, but the visible row actions do
not yet expose a published artifact link or an `Add homework` action on the lesson rows themselves.

### Desired Outcome

1. `homework published` rows include a link to `lesson.homework.htmlUrl` when available.
2. Completed lessons with `homework.status === 'not_started'` show an `Add homework` action that
   opens the main assignment flow with `studentId` and `lessonId`.
3. Scheduled lessons show `Add homework` only when the scheduled end time has passed.
4. Future scheduled lessons do not show the add-homework action.
5. The reminder action and row action should share navigation/session behavior.

### Likely Change Surface

- Frontend condition helpers for elapsed lesson detection and homework action eligibility.
- Shared navigation helper in `StudentScheduleBillingPage`.
- Possibly add backend-computed `isHomeworkFollowupDue` or `endedAt` to avoid duplicating time logic
  in the frontend.
- Tests for published link, completed/no-homework action, elapsed scheduled action, and future
  scheduled suppression.

### Open Questions

1. Should the published link label be `Open homework`, `View artifact`, or `Open published homework`?
2. Should `memory_ready` also show the published artifact link when `htmlUrl` is present?

## T6 - Lesson Indicator And Recent Lesson Suggestions In Assignment Flow

### User Intent

When a lesson is known in the main assignment flow, show a clear lesson indicator next to the student
picker, including date and ID. When no lesson is known but recent passed uncompleted lessons exist,
show suggestions like `Link lesson x?`. When neither known nor suggested lessons exist, keep the
student picker as-is.

### Current Code Map

- Assignment flow:
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts`
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`
- Existing lesson context:
  - `linkedLessonId` state in `MinimalAssignment.tsx`
  - disabled student picker when `linkedLessonId` exists in `MinimalAssignment.stages.tsx`
  - current UI copy: `Lesson context: {linkedLessonId}`
- Schedule data source:
  - `getStudentScheduleBillingSurface()` in `packages/batch-frontend/src/utils/api.ts`
  - backend surface in `packages/batch-backend/src/application/student-schedule-billing.ts`

### Current Behavior

The assignment flow already reads `studentId` and `lessonId` query params and preserves lesson
context through assignment-session and prompt-package creation. The visible lesson indicator is only
the raw ID, and there is no suggestion mechanism for recent elapsed lessons.

### Desired Outcome

1. Known lesson context displays human-readable lesson date/time and ID near the student picker.
2. If a student is selected and there are recent elapsed lessons that are not completed, show compact
   link suggestions.
3. Selecting a suggestion attaches that lesson ID to the current assignment session.
4. No empty suggestion UI appears when there are no eligible lessons.

### Likely Change Surface

- Add a lightweight lesson lookup/suggestion fetch after student selection, likely reusing the
  schedule-billing surface or adding a focused backend endpoint if the full surface is too heavy.
- Update session mutation paths so selecting a suggested lesson persists into the active assignment
  session before prompt generation.
- Add tests for explicit query-param lesson context, suggestion visibility, suggestion selection, and
  no-suggestion empty state.

### Open Questions

1. What time window should count as "recent" for link suggestions?
2. Should suggestions include completed lessons that lack homework, or only passed lessons that are
   not completed?
3. Should lesson suggestions be available before a recording is uploaded?

## T7 - Include Business, Schedule, And Billing In Student History

### User Intent

The student `History` tab should include all items from business, schedule, and billing, not only
learning/material/provenance events.

### Current Code Map

- Backend timeline:
  - `packages/batch-backend/src/application/student-timeline.ts`
  - `packages/batch-backend/src/transport/extended-routes/students-routes.ts`
- Frontend history page:
  - `packages/batch-frontend/src/ui/students/StudentHistoryPage.tsx`
  - `packages/batch-frontend/src/ui/students/StudentHistoryPage.test.tsx`
- Schedule/billing source tables and app:
  - `student_lessons`, `student_lesson_packages`, `student_credit_adjustments`,
    `student_payments`, `workspace_business_settings`
  - `packages/batch-backend/src/application/student-schedule-billing.ts`
  - `packages/batch-backend/src/application/teacher-business-dashboard.ts`

### Current Behavior

`student-timeline.ts` unions recordings, transcripts, prompt packages, drafts, jobs, profile
revision events, template revisions, and job actions. It does not currently union schedule,
attendance, package, credit, payment, reminder suppression, or business-setting events.

The history page copy says it includes lessons, homework, materials, profile updates, and important
operations. Its filters do not include business or billing categories.

### Desired Outcome

1. Student History includes schedule and billing records as chronological events.
2. Events cover lesson created/edited/completed/canceled/no-show/restored, package purchase, credit
   adjustment, payment received, and relevant reminder actions if suppression is added.
3. Business-surface actions that affect a student appear in that student's history.
4. Filtering remains understandable; likely add or rename filters to cover `Business` and `Billing`.

### Likely Change Surface

- Extend `StudentTimelineItem` contract/details if new event types need structured IDs.
- Add `UNION ALL` branches in `student-timeline.ts`.
- Map new event types in `StudentHistoryPage.tsx`.
- Add backend timeline tests and frontend rendering tests.

### Open Questions

1. Should schedule/billing event history use current row timestamps only, or do we need durable
   action-history rows for edits/restores to avoid losing earlier states?
2. Should future lesson schedule entries appear in History, or only past/mutating business events?

## T8 - Restrict And Deduplicate Profile-Memory Candidates

### User Intent

After assignments, profile-memory candidates should come from the latest lesson, not stale past
context. Candidates should be deduplicated carefully, ideally with `gemini-3.1-flash-lite`, so old
known facts are not repeatedly proposed as new. Provenance should be visible, ideally in History or
a related student page, so it is clear where each candidate came from.

### Current Code Map

- Candidate generation:
  - `packages/batch-backend/src/application/student-profile-candidates.ts`
  - `packages/batch-backend/src/application/process-student-profile-candidate-refresh-job.ts`
  - `packages/batch-backend/src/application/request-student-profile-candidate-refresh.ts`
  - `packages/batch-backend/src/domain/student-profile-candidate-repository.ts`
- Snapshot generation:
  - `packages/batch-backend/src/application/process-student-memory-snapshot-job.ts`
  - `packages/batch-backend/src/application/student-memory-snapshot-prompt.ts`
- Inspection/UI:
  - `packages/batch-backend/src/application/student-memory-inspection.ts`
  - `packages/batch-backend/src/transport/extended-routes/students-routes.ts`
  - `packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`
  - `packages/batch-frontend/src/ui/students/StudentHistoryPage.tsx`
- Current roadmap:
  - `docs/plans/student-memory-system-upgrade/README.md`
  - `docs/plans/student-profile-enrichment/README.md`

### Current Behavior

Candidate refresh currently uses the latest ready student-memory snapshot plus a configurable number
of recent ready lesson-memory entries. `buildCandidateDrafts()` builds proposals from snapshot
personal facts and corroborating lesson memories, then deduplicates mostly by deterministic
`candidateKey` and existing candidate status.

Because student-memory snapshots are themselves generated from multiple lesson and homework memory
entries, candidates can appear to originate from older context even after a new assignment.

### Desired Outcome

1. New candidate proposals after a lesson should be anchored to the latest lesson memory by default.
2. Candidate generation should avoid creating "new" facts from older context already known in the
   profile, previous candidates, snapshots, or prior lesson/homework memory.
3. Deduplication should use a precise LLM pass with `gemini-3.1-flash-lite` or a similarly approved
   cheap model, after deterministic filtering narrows candidates.
4. Candidate provenance should expose source lesson ID/date/topic, source memory IDs, and whether a
   candidate was dropped as stale/duplicate.
5. History or Learning should show enough provenance for the teacher to understand why a candidate
   exists.

### Likely Change Surface

- Split candidate refresh inputs so "new proposal generation" and "dedup/corroboration context" are
  explicit, not both treated as sources of new facts.
- Add or extend provenance metadata in `student_profile_candidates`, possibly including
  `source_lesson_id`, `source_kind`, or dedup decision records.
- Add a provider-policy path for the candidate-dedup model. This may reuse generation policy but
  should not accidentally change draft generation defaults.
- Add tests with old snapshot facts plus one latest lesson to prove only latest-lesson facts are
  proposed.
- Add UI provenance rows in Learning and/or History.

### Open Questions

1. Should candidate generation run only after lesson-memory generation, or after homework-memory and
   student-memory snapshot refresh as it does now?
2. Should LLM dedup be blocking for candidate creation, or can it mark uncertain candidates for
   review?
3. Should dropped duplicate/stale candidates be persisted for audit visibility, or only logged?

## T9 - Add `gemini-3.5-flash` To Google Model Allow-List

### User Intent

Update the Google LLM provider model list so `gemini-3.5-flash` is selectable/allowlisted, but do
not make it the default model.

### Current Code Map

- `packages/batch-backend/src/config/env.ts`
  - Google primary default is currently `gemini-3-flash-preview`.
  - Default allowed list currently includes `gemini-3.1-pro-preview`,
    `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`, `gemini-2.5-pro`,
    `gemini-2.5-flash`, `gemini-2.5-flash-lite`, and Gemma entries.
- `packages/batch-backend/src/application/generation-policy.ts`
  - Google quota baselines currently have explicit entries for `gemini-3-flash-preview`,
    `gemini-2.5-flash-lite`, and `gemini-2.5-pro`.
- `docs/reference/GENERATION_PROVIDER_POLICY.md`
- `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`
- `packages/batch-backend/tests/application.generation-policy.test.ts`
- `packages/batch-backend/tests/config.env.test.ts`

### Current External Fact Check

As of Google Gemini API docs last updated 2026-05-19, the model page lists stable model code
`gemini-3.5-flash` and identifies `gemini-3-flash-preview` as the preview version for that model
family.

Source: <https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash>

### Desired Outcome

1. `gemini-3.5-flash` is included in the default Google allow-list.
2. `gemini-3-flash-preview` remains the configured primary/default unless explicitly changed in a
   later ticket.
3. Provider policy docs reflect the allow-list addition and note that the new model is selectable but
   not default.
4. Tests assert both inclusion of `gemini-3.5-flash` and preservation of the current default.

### Likely Change Surface

- Add `gemini-3.5-flash` to `GEN_ALLOWED_MODELS_GOOGLE` defaults in `env.ts`.
- Decide whether to add a quota baseline in `generation-policy.ts`; if official rate limits are not
  known or tier-dependent, leave baseline empty and document that choice.
- Update provider policy docs and targeted tests.

### Open Questions

1. Should `gemini-3.1-flash-lite-preview` also be corrected to `gemini-3.1-flash-lite` during this
   same implementation slice, or kept separate because this ticket is only about 3.5 Flash?
2. Should `gemini-3.5-flash` be available for draft generation only, or also for student-memory and
   dedup flows?

## T10 - Remove Google TTS Model Names From Voice Capability Styles

### User Intent

The voice capability block should not list Google TTS model names such as `studio`, `wavenet`,
`neural2`, or `chirp3_hd` as `style` values. Those are provider/model names, not speaking styles,
and they can confuse the LLM when it chooses `speaker_profiles.style`. This should be a simple
removal, not a broader redesign.

### Current Code Map

- Voice capability resolution:
  - `packages/batch-backend/src/application/prompt-voice-capabilities.ts`
- Prompt-package assembly:
  - `packages/batch-backend/src/application/create-prompt-package.ts`
- Regression tests that currently expect model names in style output:
  - `packages/batch-backend/tests/application.prompt-voice-capabilities.test.ts`
  - `packages/batch-backend/tests/application.prompt-package.create-store.test.ts`
- Prompt-template guidance that consumes the capability block:
  - `docs/prompt-gallery/templates/hw_prompt_definitive.md`
  - `docs/reference/HOMEWORK_PROMPT_DEFINITIVE_ASSEMBLY_DRAFT.md`
  - `docs/reference/HOMEWORK_PROMPT_CANDIDATE_TEMPLATE_PAYLOAD.md`

### Current Behavior

The capability resolver normalizes and merges `style` arrays from canonical snapshots and provider
catalog snapshots. Tests currently show a Google catalog contribution of `style: ['chirp3_hd']`
being merged into the block as `style: [chirp3_hd, conversational, professional]`.

### Desired Outcome

1. Provider/model identifiers for Google TTS are filtered out of voice capability `style`.
2. True descriptive style values such as `conversational`, `professional`, `calm`, or `casual`
   remain eligible.
3. The generated `[VOICE_CAPABILITIES]` block no longer contains Google model names in `style`.
4. No new replacement field is introduced for this ticket.

### Likely Change Surface

- Add a small deny-list or predicate in `prompt-voice-capabilities.ts` before formatting or while
  normalizing style values.
- Update focused tests so Google model names are absent while real style values remain.
- Avoid changing the Google TTS model selector, job options, publish overrides, or database enum.

### Open Questions

None for the intake phase. The requested behavior is intentionally narrow: remove these model names
from the style list and leave the rest alone.

## Suggested Planning Split Later

When implementation planning begins, split these tickets into separate plans rather than one large
PR:

1. `T1` validator-only change.
2. `T2` prompt template default and selector.
3. `T3` rerun publish metadata bug.
4. `T4`, `T5`, and `T6` schedule-to-assignment UX polish.
5. `T7` history/timeline expansion.
6. `T8` candidate provenance and dedup hardening.
7. `T9` Google model allow-list update.
8. `T10` voice capability style cleanup.

## Related Active Plans

- [Archived schedule homework follow-up plan](../archive/plans/schedule-homework-followups/README.md)
- [`docs/plans/student-area-redesign/README.md`](student-area-redesign/README.md)
- [`docs/plans/student-memory-system-upgrade/README.md`](student-memory-system-upgrade/README.md)
- [`docs/plans/student-profile-enrichment/README.md`](student-profile-enrichment/README.md)
