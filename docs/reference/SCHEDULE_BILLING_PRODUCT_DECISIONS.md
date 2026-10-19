# Schedule And Billing Product Decisions

## Meta

- Audience: founder-maintainer, product/design collaborators, implementation agents.
- Authority Level: product/domain decision record.
- Date Captured: 2026-05-06.
- Owner: founder-maintainer + automation agents.
- Review Cadence: before schedule/billing, account-model, reminder, invoice, or calendar-sync
  expansion.
- Status: `active`.

## Purpose

This document records the lesson-ledger and billing decisions. ESL-62 supersedes the original
independent scheduling MVP with the approved Google Calendar workflow. See the
[Calendar cutover runbook](../operations/google-calendar-cutover.md) for activation and proof gates.

It exists so scheduling, lesson-credit accounting, payments, reminders, and future account ownership
do not get rediscovered from chat history or temporary plans.

## Product Direction

`Schedule & Billing` is the operational home for the teaching relationship. It answers:

1. when the next lesson is
2. how the student usually meets
3. how many paid lesson credits remain
4. whether the teacher needs to collect payment or send a reminder
5. which operational channel should be used later for reminders

Scheduling and billing are business-operation state. They must not be stored in, generated from, or
smuggled into the pedagogical learner profile.

## Locked MVP Decisions

1. The MVP is a teacher operations ledger, not a full accounting system.
2. The ownership boundary is a future `workspace`; authenticated users are actors/audit subjects,
   not the long-term owner of student business records.
3. The first UI remains single-workspace behavior while the database prepares for future account and
   membership expansion.
4. Lesson credits are counted as lesson units. Duration is stored separately as lesson metadata.
5. A credit is consumed when a lesson becomes `completed` and chargeable. Current session linking
   also completes an eligible elapsed scheduled lesson at Student confirmation/recovery, before
   transcript finish or homework publication. Abandoning review does not reverse this ledger fact.
6. Canceled, no-show, trial, or make-up lessons use explicit lesson status plus explicit
   credit-consumption state.
7. Credit balances may go negative. Negative balance is an urgent operational signal, not a data
   error.
8. Package purchase is the primary billing action. Adding a package creates credit-added accounting
   state and may also record payment state.
9. Payments are factual records only: amount, currency, method, received date, note, and optional
   external payment or invoice URL.
10. Generated invoices, tax/accounting automation, Stripe checkout, and payment collection are
    outside the MVP.
11. Reminder delivery is Telegram-first in product direction, but the first slice stores and shows
    reminder recommendations and copyable text only.
12. Email reminders remain future-compatible and should not become a parallel reminder architecture.
13. Google Calendar is required for scheduling. Other teaching, history, homework and billing
    operations remain usable without a connection.
14. One selected writable lesson calendar owns timing and recurrence after creation. A student may
    have several independent weekly series, each with its own durable creation/recovery operation.
15. ESL owns stable lesson identity, completion/no-show, charge decisions, credits and lineage.
    Provider changes never erase those facts. Later timing edits happen in Google.
16. Retired local rules/slots remain nonexecuting historical evidence. Reviewed cleanup hides unused
    placeholders; protected lesson rows and immutable activity remain attached. Schedule reads do
    not generate lessons.
17. Elapsed lesson reminders are teacher-confirmed actions. The system may surface a
    `lesson_followup` when a lesson's scheduled end time has passed, but it must not mark the
    lesson completed or consume credit merely by reading the reminder. Explicit lesson completion
    or linking that eligible elapsed scheduled lesson to a session performs the current boundary.
18. Homework created from a schedule follow-up keeps nullable `lesson_id` lineage through
    assignment sessions, prompt packages, drafts, jobs, and homework-memory entries. Schedule
    surfaces may summarize that lineage to show whether homework is not started, in progress,
    publishing, published, or memory-ready.

## Future Account Model

The target ownership model is:

1. `workspaces` own students and their operational records.
2. `workspace_memberships` attach users to workspaces with roles.
3. student-level teaching responsibility may later be modeled as teacher/student assignments.
4. user IDs on schedule, billing, payment, reminder, and lesson records are audit fields such as
   `created_by`, `updated_by`, `voided_by`, or `completed_by`.

The MVP may backfill existing data into one default workspace and keep current route visibility
unchanged. That is an intentional bridge, not the final account authorization model.

## Non-Goals

The first implementation must not:

1. generate invoices
2. collect payment
3. store card or bank data
4. send custom reminder emails or Telegram messages (Google Calendar invitations are supported)
5. support providers other than Google Calendar
6. implement multi-tutor routing or private student self-booking
7. alter learner-profile semantics
8. auto-publish homework for elapsed lessons

## Workspace scheduling timezone

Business settings (`workspace_business_settings.timezone`) owns the tutor-facing clock for schedule
display and the default creation timezone. Calendar creation requires explicit valid local timing;
ambiguous/nonexistent wall times are rejected instead of silently adjusted. Google expands recurring
instances in the recorded IANA timezone. Changing workspace settings does not rewrite historical
instants or retime existing Google series.

## Recurrence Architecture

`student_lesson_plans` retains useful duration defaults and operational notes. Google owns executable
recurrence. Calendar schedule bindings are one-to-many per student; occurrence mappings preserve
internal lesson IDs independently of moved actual start times. The bounded upcoming projection uses
Google instances, with durable dirty intents and cursor checkpoints. A 410 rebaseline keeps the ESL
ledger and billing history. Unknown split/copy identity is attention requiring authoritative evidence;
titles, emails, time proximity and a copied marker never establish occurrence continuity.

Student email is optional operational contact. Invitation defaults on when present, with opt-out;
the chosen recipient is frozen into each new operation. Email edits affect future creates. Recovery
reads never resend invitations. No Meet integration is included.

## Schedule-To-Homework Follow-Ups

The first schedule-to-homework workflow is an in-app operator reminder:

1. Student and business schedule surfaces expose `lesson_followup` reminders for elapsed lessons
   that still lack successful linked homework.
2. `Add homework` opens the assignment flow with `studentId` and `lessonId` context; navigation
   alone does not complete the lesson or consume credit. Confirming Student or successfully
   recovering a session with that lesson link completes an eligible elapsed scheduled lesson and
   consumes one credit. Abandoning before linking leaves the ledger unchanged; abandoning after
   linking does not reverse the completed lesson. Explicit `Complete` remains a separate action.
3. The assignment flow preserves the lesson link while prompt packages, drafts, publish jobs, and
   homework-memory extraction proceed through the normal review/publish pipeline.
4. An explicit transcript-only finish records `not_planned` with a nullable transcript-result
   session reference and suppresses only missing-homework follow-up on student/business surfaces.
   A saved checkbox or immutable past finish event is insufficient. Actual homework work takes
   precedence; promotion restores ordinary progress/reminders with accounting unchanged. Finished
   transcript-only review does not create a lesson, charge/refund credit or alter payment records.
5. Concurrent session linking/completion serializes on the shared lesson row before reading status
   and reconciling the debit. Completed non-credit, future, cancelled/no-show and unlinked cases
   retain their existing respective ledger state.

## Related

- [`docs/reference/STUDENT_SYSTEM_ROADMAP.md`](STUDENT_SYSTEM_ROADMAP.md)
- [`docs/reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md`](TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md)
- [Archived phase 5 design rationale](../archive/plans/student-area-redesign/phase-5-scheduling-billing-reminders-and-history.md)
- [`docs/plans/student-area-redesign/README.md`](../plans/student-area-redesign/README.md)
