# Phase 5: Scheduling, Billing, Reminders, And History

## Summary

This phase locks the future-facing operational surfaces that are not ready to build immediately but
must already have clear product homes.

The central product decision is:

1. pedagogy and business operations are separate but interconnected
2. scheduling, payment accounting, reminders, and chronology should not be bolted into the learning
   page later

## Schedule & Billing Page Purpose

`Schedule & Billing` should become the operational page for everything needed to keep the teaching
relationship running smoothly.

It should answer:

1. when is the next lesson
2. how often does this student usually meet
3. how many lessons are left
4. does the teacher need to collect payment or send a reminder
5. what channel should operational nudges use

## Locked Decisions

1. The default future billing model is lesson credits, not subscription-first.
2. Reminder delivery is Telegram-first because the bot ecosystem already exists.
3. Email should remain a future-compatible addition rather than a separate parallel architecture.
4. Calendar design should support hybrid bidirectional sync.
5. Scheduling and billing remain product peers inside one page because they drive each other in the
   teaching business.
6. The billing domain belongs to the broader student record, not the learner profile.

## Recommended Subsections For Schedule & Billing

### 1. Lesson Planning

Shows and edits:

1. next lesson date
2. expected cadence
3. preferred days or times
4. scheduling notes
5. connected calendar state later

### 2. Credit Balance

Shows:

1. lessons purchased
2. lessons used
3. lessons remaining
4. low-balance thresholds later

This should become the default teaching-business mental model for many students.

### 3. Payment & Invoice State

Future-facing section for:

1. invoice issued or not
2. payment overdue or not
3. reminder needed or not
4. package history

### 4. Reminder Controls

Shows:

1. preferred channel
2. Telegram link state
3. email availability later
4. last reminder status later
5. recommended next reminder action later

## Reminder Product Model

The reminder system should be designed as a domain concept, not just a button.

Recommended reminder types later:

1. upcoming lesson reminder
2. low balance reminder
3. overdue invoice reminder
4. no next lesson scheduled follow-up

### Channel Direction

Near-term direction:

1. Telegram-first

Longer-term direction:

1. same reminder intents may be delivered by email later
2. student record should keep preferred contact channel and channel readiness separately

This preserves a clean future path without forcing email parity immediately.

## Calendar Direction

The future design should assume hybrid bidirectional sync.

Product implications:

1. a lesson may be created or edited inside the app
2. a lesson may later be updated from a connected calendar
3. the student area needs to reflect sync state and conflict state rather than pretending all
   scheduling originates from one side forever

The product should therefore expose:

1. lesson planning data
2. external calendar link state
3. sync health or mismatch state later

## History Page Purpose

`History` should become the chronological memory of the student relationship.

This page keeps explainability high without cluttering the active working pages.

Recommended history categories:

1. lessons
2. homework and assignment lineage
3. profile revisions
4. scheduling changes
5. billing events
6. reminders and communication events later

## History UX Direction

Recommended behaviors:

1. filter by event type
2. keep reverse-chronological defaults
3. allow drill-in to provenance details
4. show enough summary to scan without opening every event

History uses the shared student masthead from Phase 6. The page itself should own only
history-specific explanation, filters, timeline, empty states, and provenance affordances. It should
not re-render student identity, a page-local portrait, or a separate back link.

Detailed visual and product decisions for the History page are locked in
[`history-page-design-lock.md`](history-page-design-lock.md). That companion doc should guide
implementation of the new History surface.

This page should be where the teacher goes to answer:

1. what happened
2. when did it happen
3. why is the current state like this

## Relationship Between Schedule & Billing And History

Schedule & Billing owns current operational state.

History owns:

1. how that state changed
2. which reminders were sent
3. when credits were added or consumed
4. what changed in the lesson plan

This split keeps the active ops page practical while preserving accountability.

## Product Rules To Preserve

1. Payment state must never leak into the pedagogical profile.
2. Reminder state should summarize into Overview, but detailed reminder events belong in History.
3. Calendar sync should be visible when it matters, but not pollute the learning page.
4. Lesson-credit balance should influence operational behavior, not teaching-target selection.
5. Scheduling and billing should feel like clean business tooling, not like admin notes smuggled
   into the learner profile.

## Future Readiness Without Premature Complexity

The first implementation slices do not need to ship every billing and reminder feature at once.

But the student area should already reserve the right homes for:

1. lesson-credit accounting
2. invoice reminders
3. Telegram student-facing reminders
4. future email reminder parity
5. calendar sync
6. attendance and cancellation pattern review

That is the reason this phase exists now, before all of those features are coded.
