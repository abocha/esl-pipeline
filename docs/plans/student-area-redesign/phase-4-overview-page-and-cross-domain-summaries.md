# Phase 4: Overview Page And Cross-Domain Summaries

## Summary

`Overview` should be the control tower for the student area.

Its job is not to replicate the whole product. Its job is to answer:

1. what is the current state of this student
2. what is incomplete or urgent
3. what should the teacher do next

The page should be fast to scan, emotionally calm, and rich in good next actions.

## Locked Decisions

1. `Overview` is summary-first and action-oriented.
2. Each overview card should end in a clear next action or deep link.
3. Detailed editing stays in the owning page.
4. Overview may summarize all domains, but it should not become a dumping ground for raw detail.
5. The page should help the teacher prioritize, not merely browse.

## Recommended Page Layout

### 1. Student Header

Shows:

1. student name
2. timezone
3. preferred contact channel
4. next lesson state when known
5. compact alert badge or missing-data state

Primary header actions may include:

1. `Open Learning`
2. `Schedule Lesson`
3. `Record Payment`
4. `View History`

### 2. Summary Grid

Recommended cards:

1. `Profile Health`
2. `Teaching Snapshot`
3. `Next Lesson`
4. `Billing Snapshot`
5. `Reminder Status`
6. `Recent Activity`

### 3. Alerts Or Attention Strip

This strip appears only when needed.

Examples:

1. no active learner profile
2. draft profile pending review
3. no next lesson scheduled
4. lesson credits low
5. invoice overdue
6. reminder delivery failing

## Card Contracts

### Profile Health

Shows:

1. active profile or missing profile
2. last updated time
3. draft-present state
4. missing key profile fields when relevant

Primary CTA:

1. `Complete Foundational Profile`
2. `Review Draft`
3. `Open Learning`

### Teaching Snapshot

Shows:

1. top goals
2. top strengths
3. top challenges
4. current teaching focus if present

Primary CTA:

1. `Open Learning`

### Next Lesson

Shows:

1. next scheduled lesson time
2. cadence summary
3. whether planning is missing

Primary CTA:

1. `Schedule Lesson`
2. `Adjust Cadence`

### Billing Snapshot

Shows:

1. lessons remaining
2. package or invoice state
3. whether attention is needed soon

Primary CTA:

1. `Open Schedule & Billing`
2. `Record Payment`
3. `Send Reminder`

### Reminder Status

Shows:

1. preferred reminder channel
2. Telegram link state
3. latest reminder result later

Primary CTA:

1. `Manage Reminders`

### Recent Activity

Shows:

1. last lesson
2. last homework
3. last profile change
4. last billing or reminder event later

Primary CTA:

1. `Open History`

## Overview UX Rules

1. Every card should stay compact enough to scan in seconds.
2. The page should not require the teacher to open accordions to understand the student's state.
3. Metrics and status should be framed in teacher language, not internal implementation language.
4. Empty states should be useful, not apologetic.
5. The overview should make the whole student area feel trustworthy and organized.

## What Should Stay Hidden From Overview

1. full profile form fields
2. candidate evidence excerpts
3. full lesson-memory bodies
4. revision-by-revision diff details
5. full invoice history
6. raw sync logs

Those belong in the owning pages.

## Onboarding And Incomplete States

`Overview` should also handle very early student lifecycle states cleanly.

Examples:

1. student exists but profile is missing
2. student has profile but no next lesson
3. student has no billing package configured yet
4. reminders cannot run because no contact channel is configured

The product response should always be:

1. clear state
2. one direct action
3. no overwhelming diagnostic clutter

## Relationship To Other Pages

`Overview` should teach the teacher the shape of the new student area:

1. Learning owns pedagogy
2. Schedule & Billing owns operational and financial state
3. History owns chronology and explainability

If the Overview page starts accumulating detailed editing UI, the architecture is drifting.
