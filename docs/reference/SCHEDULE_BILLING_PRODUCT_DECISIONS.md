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

This document is the durable reference for the first real `Schedule & Billing` implementation.

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
5. A credit is consumed only when a teacher marks a lesson `completed` and chargeable.
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
13. Calendar design must stay sync-ready, but Google Calendar or other bidirectional sync is outside
    the MVP.

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
4. send Telegram or email messages
5. create recurring lessons automatically
6. sync with external calendars
7. enforce the final multi-teacher account permission model
8. alter prompt-package or learner-profile semantics

## Related

- [`docs/reference/STUDENT_SYSTEM_ROADMAP.md`](STUDENT_SYSTEM_ROADMAP.md)
- [`docs/reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md`](TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md)
- [`docs/plans/student-area-redesign/phase-5-scheduling-billing-reminders-and-history.md`](../plans/student-area-redesign/phase-5-scheduling-billing-reminders-and-history.md)
- [`docs/plans/student-area-redesign/mvp-tomorrow-2026-05-01.md`](../plans/student-area-redesign/mvp-tomorrow-2026-05-01.md)
