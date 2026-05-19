# Schedule-Triggered Homework Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect lesson schedule state to homework assignment creation so a teacher can act on elapsed scheduled lessons from the schedule surface.

**Architecture:** Keep schedule/billing as the operational source of lesson state, and keep homework generation in the existing assignment pipeline. Add an explicit, nullable lesson link through assignment-session and publish lineage so the UI can show whether an elapsed lesson still needs the "completed lesson + homework" follow-up.

**Tech Stack:** PostgreSQL migrations, `@esl-pipeline/contracts`, `@esl-pipeline/batch-backend`, `@esl-pipeline/batch-frontend`, Vitest, React Testing Library.

---

## Meta

- Audience: maintainers and AI agents implementing schedule-to-homework workflow slices.
- Authority Level: active implementation plan.
- Last Verified Against: 2026-05-19 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after each implementation PR touching schedule, assignment sessions, reminders, or homework memory.
- Status: `active`.
- Exit Trigger: archive after the lesson-linked homework follow-up workflow ships and durable behavior is represented in product/reference docs and package READMEs.
- Current Focus: implementation complete; pending PR review/merge and archive once shipped from active routing.

## Source Notes Interpreted

1. "Connect schedule and homework assignment" becomes a durable lesson-to-assignment link. A homework assignment should be traceable back to the scheduled lesson it came from, without moving homework generation logic into schedule/billing.
2. "Notifications: mark conducted lesson + generate homework when the scheduled time passes" becomes an operator reminder, not an automatic mutation. When a scheduled lesson has ended, the app should surface a follow-up action: mark the lesson completed, then create or resume the homework assignment flow for that lesson.

## Product Boundaries

1. The system must not auto-complete lessons just because time has passed. The teacher remains the actor for completion and credit consumption.
2. The system must not auto-publish homework without the existing draft/review/publish path.
3. Schedule/billing owns lesson timing, status, credits, and reminders.
4. Assignment sessions, prompt packages, drafts, jobs, and homework memory own homework generation, publication, and memory extraction.
5. Telegram or email delivery remains future-compatible. The first implementation should use the existing manual reminder/action surfaces.

## Current Repo Anchors

- Schedule and lesson state: `packages/batch-backend/src/application/student-schedule-billing.ts`
- Student schedule routes: `packages/batch-backend/src/transport/extended-routes/students-routes.ts`
- Teacher-wide schedule routes: `packages/batch-backend/src/transport/extended-routes/business-routes.ts`
- Assignment-session persistence: `packages/batch-backend/src/application/assignment-sessions.ts`
- Draft-to-job publication: `packages/batch-backend/src/application/create-approval-job.ts`
- Homework-memory follow-up after publish: `packages/batch-backend/src/application/request-homework-memory-generation.ts`
- Contracts: `packages/contracts/src/index.ts`
- Student schedule UI: `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.tsx`
- Teacher schedule UI: `packages/batch-frontend/src/ui/business/BusinessSchedulePage.tsx`
- Assignment flow UI: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Frontend API client: `packages/batch-frontend/src/utils/api.ts`

## Data Model Direction

Add nullable `lessonId` lineage fields rather than replacing existing assignment lineage:

1. `assignment_sessions.lesson_id`
2. `prompt_packages.lesson_id`
3. `drafts.lesson_id`
4. `jobs.lesson_id`
5. `homework_memory_entries.lesson_id`

Each field should reference `student_lessons(id)` with `ON DELETE SET NULL`, and each write path should validate that the lesson belongs to the same student as the assignment context when both IDs are present.

This keeps the relationship simple for reads:

1. a lesson can have zero or more assignment attempts
2. the latest successful published job for a lesson is the visible homework artifact
3. homework memory can be grouped by lesson without inferring from transcript or recording alone

## Follow-Up Semantics

An elapsed lesson follow-up is due when:

1. `student_lessons.status = 'scheduled'`
2. `student_lessons.recurrence_obsolete_at IS NULL`
3. `starts_at + duration_minutes <= now()`
4. no successful published job is linked to that lesson

The first shipped reminder type should be:

- `lesson_followup`
- title: `Finish lesson follow-up`
- message: `This scheduled lesson has ended. Mark it completed and generate homework.`
- action intent: `complete_lesson_and_start_assignment`

The action should first call the existing lesson update path with `status: 'completed'` and `consumesCredit: true`, then open the assignment flow with `studentId` and `lessonId` context.

## Task Plan

### Task 1: Add Lesson Linkage Contracts And Migration

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Create: `packages/batch-backend/migrations/0030_lesson_assignment_linkage.sql`
- Modify: `packages/batch-backend/schema.sql`
- Modify: `packages/contracts/src/contract-versions.ts`
- Test: `packages/batch-backend/tests/integration.migrations.test.ts`

- [x] Add nullable `lessonId` fields to assignment-session, prompt-package, draft, job, and homework-memory DTOs where those records are exposed.
- [x] Add migration columns, foreign keys, and read-path indexes for `lesson_id`.
- [x] Regenerate and verify schema baseline.
- [x] Run migration and contract verification:
  - `pnpm release:verify:contracts`
  - `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline`
  - `pnpm --filter @esl-pipeline/batch-backend test:db:migrations`

### Task 2: Preserve Lesson Context Through Assignment Creation

**Files:**

- Modify: `packages/batch-backend/src/application/assignment-sessions.ts`
- Modify: `packages/batch-backend/src/application/create-prompt-package.ts`
- Modify: `packages/batch-backend/src/application/create-draft.ts`
- Modify: `packages/batch-backend/src/application/create-approval-job.ts`
- Modify: `packages/batch-backend/src/application/request-homework-memory-generation.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`
- Test: `packages/batch-backend/tests/application.assignment-sessions.test.ts`
- Test: `packages/batch-backend/tests/application.homework-memory-source.test.ts`

- [x] Accept optional `lessonId` on assignment-session create/update requests.
- [x] Validate `lessonId` belongs to the selected `studentId` before persisting it.
- [x] Copy `lessonId` from assignment session or request context into prompt package, draft, approval job, and homework-memory pending entry.
- [x] Ensure rerun descendants inherit the original lesson lineage but do not create duplicate homework-memory entries.
- [x] Add tests proving a lesson-linked assignment keeps the same `lessonId` from session creation through publish and homework-memory request.

### Task 3: Expose Elapsed-Lesson Follow-Ups In Schedule Surfaces

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/batch-backend/src/application/student-schedule-billing.ts`
- Modify: `packages/batch-backend/src/application/teacher-business-dashboard.ts`
- Test: `packages/batch-backend/tests/application.student-schedule-billing.test.ts`

- [x] Extend `StudentReminderType` with `lesson_followup`.
- [x] Add linked-assignment summary fields to `StudentLessonDto`, enough for the UI to know whether a lesson has a draft, active session, running job, successful published job, or homework memory.
- [x] Return `lesson_followup` reminders for elapsed scheduled lessons that do not yet have a successful linked homework assignment.
- [x] Include these reminders in `GET /students/:id/surfaces/schedule-billing` and `GET /business/schedule`.
- [x] Add tests for not-yet-ended lessons, elapsed scheduled lessons, completed lessons, canceled/no-show lessons, and elapsed lessons that already have a successful linked job.

### Task 4: Add Schedule Actions To Start Homework From A Lesson

**Files:**

- Modify: `packages/batch-frontend/src/utils/api.ts`
- Modify: `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.tsx`
- Modify: `packages/batch-frontend/src/ui/business/BusinessSchedulePage.tsx`
- Test: `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.test.tsx`
- Test: `packages/batch-frontend/src/ui/business/BusinessSchedulePage.test.tsx`

- [x] Render elapsed lesson follow-ups as action rows instead of plain copy-only reminder text.
- [x] Add a `Complete + homework` action for scheduled elapsed lessons.
- [x] Keep the existing `Complete` action available for teachers who only want attendance/credit tracking.
- [x] After `Complete + homework`, update the lesson through the existing `PATCH /students/:id/lessons/:lessonId` path, then navigate to the assignment flow with `studentId` and `lessonId`.
- [x] Show linked homework status on lesson rows: not started, draft in progress, publishing, published, or homework memory ready.

### Task 5: Teach Minimal Assignment About Lesson Context

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-basic.test.tsx`

- [x] Read `lessonId` from route/query state and persist it into the active assignment session.
- [x] Display compact lesson context in the assignment flow so the teacher can confirm they are generating homework for the intended lesson.
- [x] Keep normal student selection behavior, but prevent changing to a different student while a lesson-linked assignment session is active.
- [x] On publish success, leave a clear link back to the originating student Schedule & Billing page.
- [x] Add resume coverage proving lesson-linked sessions reload with the same `lessonId`.

### Task 6: Documentation And Validation Closeout

**Files:**

- Modify: `docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`
- Modify: `docs/reference/STUDENT_SYSTEM_ROADMAP.md`
- Modify: `docs/backend-frontend/backend-frontend-alignment.md`
- Modify: `packages/batch-backend/README.md`
- Modify: `packages/batch-frontend/README.md`

- [x] Document that elapsed-lesson follow-ups are teacher-confirmed actions.
- [x] Document the lesson-to-assignment lineage field and the surfaces that expose it.
- [x] Update package READMEs for new API/client behavior.
- [x] Run validation:
  - `pnpm format`
  - `pnpm run lint:repo-hygiene`
  - `pnpm docs:check`
  - `pnpm check:fast`
  - `pnpm release:verify:contracts`
  - `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline`

## Acceptance Criteria

1. A scheduled lesson that has ended appears as a lesson follow-up in the student Schedule & Billing page.
2. The same follow-up appears in the teacher-wide business schedule.
3. The teacher can mark the lesson completed and enter the homework assignment flow from that follow-up.
4. Generated/published homework keeps a durable `lessonId` lineage back to the lesson.
5. Once a successful homework assignment is linked, the lesson no longer appears as needing homework follow-up.
6. The workflow does not auto-complete lessons or auto-publish homework without teacher action.
7. Credit consumption still happens only through the existing completed-and-chargeable lesson rules.

## Deferred Work

1. Telegram delivery for elapsed-lesson follow-ups.
2. Email delivery for elapsed-lesson follow-ups.
3. Calendar sync or external event matching.
4. Automatic recording-to-lesson matching by time window.
5. Student-facing homework notification delivery.

## Related

- [`docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`](../../reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md)
- [`docs/reference/STUDENT_SYSTEM_ROADMAP.md`](../../reference/STUDENT_SYSTEM_ROADMAP.md)
- [`docs/reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md`](../../reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md)
- [`docs/plans/student-area-redesign/README.md`](../student-area-redesign/README.md)
- [`docs/plans/student-memory-system-upgrade/README.md`](../student-memory-system-upgrade/README.md)
