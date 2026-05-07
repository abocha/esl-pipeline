# Teacher Business Dashboard Product Draft

## Meta

- Audience: founder-maintainer, product/design collaborators, implementation agents.
- Authority Level: product/design draft.
- Date Captured: 2026-05-07.
- Owner: founder-maintainer + automation agents.
- Review Cadence: before implementing teacher-wide schedule, stats, account-profile, or business
  settings work.
- Status: `draft`.

## Purpose

This document captures the core product direction for the future teacher-wide schedule and stats
surfaces before implementation planning starts.

The dashboard is for a self-employed teaching professional. It should answer:

1. how much have I made this month?
2. how much is likely still coming in?
3. what does next month look like?
4. what have I taught, what is scheduled, and what needs action?
5. which students or operations create risk for cashflow, continuity, or workload?

This is not an accounting system, admin console, or student-profile surface.

## Product North Star

The teacher business dashboard is a calm command desk for the teaching business.

It should feel like a professional daily operating surface: money, schedule, reminders, workload,
and risk in one place, with enough confidence labeling that the teacher can trust the numbers.

## Information Architecture

Create a top-level teacher/business area, adjacent to the future teacher profile and account model,
rather than embedding this inside any one student page.

Recommended first pages:

1. `My Schedule`
   - agenda and action surface for all students
   - shows scheduled lessons, reminders, payment follow-ups, and quick operational actions
2. `Stats`
   - business-health surface for income, taught hours, lesson volume, forecast, and risk
3. future `Business Settings` or teacher-profile settings
   - owns defaults used by schedule and stats, such as currency, lesson rate, default duration,
     forecast assumptions, and reminder thresholds

Student-level schedule and billing pages remain the place for editing a specific student's records.
The teacher-wide pages aggregate across students and link back to those student surfaces for detail
and correction.

## My Schedule Draft

`My Schedule` should be agenda-first, not a full drag-and-drop calendar in the MVP.

Primary sections:

1. Today
   - lessons today
   - urgent reminders
   - payment or credit issues that need action
2. Week agenda
   - scheduled lessons grouped by day
   - student name, time, duration, status, and credit-charge flag
   - completed, canceled, and no-show state visible without opening a detail page
3. Reminder queue
   - no next lesson
   - low or negative credits
   - payment follow-up
   - grouped by urgency and preferred channel
4. Payment and credit alerts
   - students at zero or negative credits
   - students likely to need top-up after upcoming lessons
   - recent payments that may need acknowledgement or reconciliation
5. Quick actions
   - mark lesson completed
   - mark no-show or canceled
   - copy reminder text
   - open student Schedule & Billing

Design preference: dense, clear, operational. Avoid a decorative calendar as the first shipped
experience.

## Stats Draft

`Stats` should frame the teacher's business health, not formal accounting.

Primary month-level metrics:

1. Collected
   - payment records received in the selected month
2. Expected
   - likely incoming payments based on scheduled lessons, current credit balances, known top-up
     needs, and payment patterns where available
3. Forecast
   - projected next 30-45 days, including the next month
   - corrected by explicit forecast assumptions such as no-show or cancellation risk
4. Taught
   - completed lessons and completed lesson hours in the selected month

Supporting sections:

1. Cashflow
   - received this month
   - expected remaining this month
   - projected next month
   - outstanding or at-risk amount
2. Workload
   - taught hours
   - scheduled hours
   - completed lessons
   - no-shows and cancellations
   - busiest days or time bands
3. Pipeline
   - students likely to top up soon
   - students at zero or negative balance
   - students with no next lesson
   - upcoming scheduled revenue
4. Risk
   - likely no-shows
   - unconfirmed or stale lessons
   - negative credits
   - students going quiet or missing continuity

## Confidence Model

Stats must distinguish facts from forecasts.

Use clear confidence buckets:

1. Received
   - money already recorded as paid
2. Earned
   - completed chargeable lessons, valued by a configured or inferred lesson rate
3. Scheduled
   - future scheduled lessons
4. Likely
   - forecast based on credit state, package/payment patterns, and upcoming scheduled lessons
5. At risk
   - expected income reduced or flagged because of no-show, cancellation, low-confidence payment,
     or continuity risk

This avoids pretending the product is a bank ledger while still giving the teacher a useful business
forecast.

## Required Business Settings

The current schedule/billing model records operational facts. The teacher-wide stats surface will
need a small business-settings layer before forecasts can feel reliable.

Likely MVP settings:

1. default currency
2. default lesson rate
3. default lesson duration
4. forecast horizon
5. expected no-show or cancellation correction
6. payment/top-up expectation threshold, such as "payment likely when credits are at or below N"

Future settings:

1. per-student lesson rate
2. per-student package size and package price
3. per-student payment lag
4. learned no-show/cancellation risk
5. tax/accounting export preferences

## Architecture Direction

The teacher-wide dashboard should read from workspace-owned operational records.

Likely additive backend surfaces:

1. `GET /teacher/schedule?from=&to=`
2. `GET /teacher/operations`
3. `GET /teacher/stats?month=YYYY-MM`
4. future `GET/PUT /teacher/business-settings`

In the single-workspace bridge, these can aggregate over the default workspace. In the future account
model, they should aggregate over the authenticated user's selected workspace and respect membership
and role constraints.

## Design Principles

1. Agenda-first for schedule.
2. Business-health-first for stats.
3. Confidence labels over false precision.
4. Facts and forecasts shown together, but clearly separated.
5. Student-level edits stay on student Schedule & Billing pages.
6. Teacher-wide pages aggregate, prioritize, and link to the right detail surface.
7. The visual language should be quiet, dense, and professional: metric strip, month selector,
   action queue, agenda list, and readable tables.
8. Avoid a startup KPI dashboard feel and avoid formal accounting claims until accounting features
   exist.

## Explicit Non-Goals For The First Slice

1. tax reporting
2. invoice generation
3. payment collection
4. full double-entry accounting
5. external calendar sync
6. drag-and-drop rescheduling
7. learned forecasting without enough history

## Related

- [`docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`](SCHEDULE_BILLING_PRODUCT_DECISIONS.md)
- [`docs/reference/STUDENT_SYSTEM_ROADMAP.md`](STUDENT_SYSTEM_ROADMAP.md)
- [`docs/plans/student-area-redesign/mvp-tomorrow-2026-05-01.md`](../plans/student-area-redesign/mvp-tomorrow-2026-05-01.md)
