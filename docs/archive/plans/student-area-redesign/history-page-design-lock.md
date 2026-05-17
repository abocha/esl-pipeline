# History Page Design Lock

## Summary

This document locks the product and visual direction for the new student-area `History` page.

It expands the History notes in
[`phase-5-scheduling-billing-reminders-and-history.md`](phase-5-scheduling-billing-reminders-and-history.md)
with the design decisions made after the `Overview` page visual direction was established.

The core decision is:

1. `History` is a graceful teaching ledger, not an audit log.
2. It should explain the learning relationship over time without making the teacher parse raw
   system events.
3. It should share the same warm editorial teaching-studio style as `Overview`.

## Product Purpose

`History` is the chronological memory of the student relationship.

It should help the teacher answer:

1. what happened recently
2. what changed over time
3. what lesson, homework, profile, material, or operational event caused the current state
4. what should be easy to inspect later for provenance or continuity

The page should preserve explainability while keeping active working pages calm:

1. `Overview` shows the current state and next action.
2. `Learning` owns profile editing, memory review, and pedagogy.
3. `Schedule & Billing` owns current operational and financial state.
4. `History` owns chronology, provenance, and relationship memory.

## Visual Direction

The page should feel like a beautifully maintained private teacher archive:

1. warm ivory/parchment background
2. subtle paper grain or notebook texture
3. fine ink-like dividers
4. refined serif hierarchy
5. restrained sans-serif support text
6. muted navy for navigation and links
7. sage for healthy/complete learning state
8. amber for attention or reminders
9. clay/rose for warnings or failed states
10. generous whitespace and quiet rhythm

The desired emotional tone is:

1. calm
2. thoughtful
3. organized
4. humane
5. private
6. teacher-owned

The page should not look like:

1. a SaaS analytics dashboard
2. a dense admin table
3. a raw event stream
4. a debugging console
5. a generic card grid

## Visual Reference Decisions

The approved visual reference has these durable traits:

1. a shared student masthead with name, short student ID, initials/avatar, page context, and tabs
2. a future path to Telegram avatars once the student-facing bot and Telegram binding exist
3. no duplicated page-local identity hero inside the History body
4. a quiet explanatory card such as `About this history`
5. soft filter pills for event domains
6. a reverse-chronological vertical timeline
7. date groupings that make time easy to scan
8. time labels on the left
9. event cards on the right
10. richer cards for lessons and homework
11. smaller rows for supporting events
12. subtle icon markers on the timeline spine
13. provenance hidden behind secondary details rather than exposed by default
14. a small handwritten-style footer note may remain as a product motif

The initials portrait in the shared masthead is not a final identity decision. It is the correct
placeholder until the student-facing Telegram bot can bind a Telegram account to the student
record. When that exists, the Telegram avatar should become the preferred portrait source.

Avatar ownership belongs to the broader student identity/contact domain, not to the learner
profile. The learner profile remains pedagogical.

## Time And Date Rules

Use 24-hour time throughout the student area.

Examples:

1. `10:00`
2. `09:15`
3. `14:20`

Do not use 12-hour time such as `10:00 AM`.

History should default to reverse-chronological order. Grouping by day is the most useful initial
shape, with month grouping as a later option if a student has a long record.

## Data Sources

The first implementation should use the data that already exists rather than inventing a parallel
history model.

Current available sources:

1. student timeline events
2. lesson-memory entries
3. homework-memory entries
4. profile revisions
5. template revisions
6. assignment/material generation jobs
7. job actions such as rerun, cancel, and metadata edits

Future sources:

1. scheduling changes
2. lesson-credit changes
3. invoice and payment events
4. lesson reminders
5. low-balance reminders
6. overdue-invoice reminders
7. Telegram delivery events
8. email delivery events
9. calendar sync or conflict events
10. attendance and cancellation records

## Event Categories

The UI should translate implementation events into teacher-friendly categories.

Recommended filter domains:

1. `All`
2. `Lessons`
3. `Homework`
4. `Profile`
5. `Materials`
6. `Operations`

Near-term mapping:

1. `Lessons`
   - lesson-memory entries
   - recordings
   - transcripts
2. `Homework`
   - homework-memory entries
   - assignment lineage
   - published assignment outputs
3. `Profile`
   - profile revisions
   - profile activation
   - candidate promotion when represented in history
4. `Materials`
   - prompt packages
   - drafts
   - generated jobs
   - template revisions
5. `Operations`
   - reruns
   - cancellations
   - metadata edits
   - future schedule, billing, reminder, and calendar events

The implementation may use more precise internal types, but the visible filter model should stay
teacher-readable.

## Event Language

Do not lead with raw event types such as:

1. `profile_revision_activated`
2. `job_completed`
3. `prompt_package_created`
4. `job_action_rerun`

Translate them into human language:

1. `Profile updated`
2. `Profile revision activated`
3. `Assignment published`
4. `Draft generated`
5. `Lesson memory created`
6. `Homework follow-up added`
7. `Material generated`
8. `Rerun requested`
9. `Reminder sent`
10. `Payment recorded`

Raw IDs, exact event types, provider metadata, and internal statuses belong in a secondary
provenance view.

## Event Card Hierarchy

Not every event deserves the same visual weight.

Use richer cards for:

1. completed lessons
2. lesson-memory entries
3. homework-memory entries
4. published assignments with follow-up cues
5. meaningful profile updates

Use compact rows for:

1. transcript ready
2. prompt package created
3. draft saved
4. template revision saved
5. rerun requested
6. cancellation requested
7. future reminder delivery events
8. future payment events

This keeps the page readable even for students with many records.

## Lesson And Homework Entries

Lesson entries should summarize:

1. lesson title or best available topic
2. lesson summary
3. key topics discussed
4. current learning focus if available
5. follow-up recommendations
6. links to lesson memory or source artifacts

Homework entries should summarize:

1. assignment topic
2. homework summary
3. task count when available
4. grammar, vocabulary, pronunciation, or review targets
5. teacher follow-up cues
6. publish target or material link when available

The first implementation does not need perfect lesson grouping. It is acceptable to show lesson
memory and homework memory as separate but related timeline entries. Later, they can be grouped
into a richer lesson episode when lineage is strong enough.

## Scheduling Placeholder Decision

The History page may reserve a subtle metadata slot for future scheduling details even before the
scheduling domain is implemented.

Examples:

1. `-- min · format not set`
2. `duration pending · format pending`

This placeholder exists to preserve the future shape of the page. It should remain quiet and should
not pretend the data exists.

When `Schedule & Billing` adds real lesson planning, the slot can become:

1. `60 min · Online`
2. `90 min · In person`
3. `45 min · Telegram call`

## Provenance Behavior

History should make provenance available without making it the main experience.

Default visible content:

1. event title
2. timestamp
3. short summary
4. category
5. teacher-meaningful status
6. primary linked artifact or owning page

Secondary provenance may include:

1. recording ID
2. transcript ID
3. prompt package ID
4. draft ID
5. job ID
6. profile revision ID
7. template revision ID
8. source event type
9. provider/model metadata later
10. raw error details when needed

The provenance control should feel like `Details`, `View source`, or `Provenance`, not like the
main label.

## Empty And Sparse States

Some students have sparse history.

Empty or sparse states should be useful and calm:

1. explain that lesson, homework, profile, and operations events will collect here
2. link to the most relevant next page
3. avoid apologetic or technical language
4. avoid showing fake history

For a student with no lesson memory but profile history, show profile events rather than treating
the page as empty.

## Relationship To Future Scheduling And Billing

Schedule & Billing owns current operational state.

History owns how that state changed.

Future History events should include:

1. lesson scheduled
2. lesson rescheduled
3. lesson cancelled
4. lesson completed
5. credits added
6. credit consumed
7. invoice sent
8. payment recorded
9. reminder sent
10. reminder failed
11. Telegram binding changed
12. email address changed
13. calendar sync conflict detected

These events should summarize into `Overview` only when they affect the current state or next
action.

## Implementation Guardrails

Preserve these rules during implementation:

1. Do not turn History into a raw timeline table.
2. Do not make raw event names the primary UI language.
3. Do not expose every technical identifier by default.
4. Do not put scheduling or billing data into the learner profile.
5. Do not make History an editing surface.
6. Do not duplicate detailed profile editing from `Learning`.
7. Do not duplicate current billing controls from `Schedule & Billing`.
8. Do not use 12-hour time.
9. Do not introduce fake operational data except quiet placeholders that clearly indicate missing
   data.
10. Do not reintroduce `bound profile` language.

## Image-Generation Prompt Reference

Use this prompt when generating future visual references:

```text
Design a polished web app page for a private ESL teacher’s student area. The page is called
“History” and it is the chronological archive of one student’s learning relationship.

Use the same visual language as a calm editorial teaching studio: warm ivory parchment background,
subtle paper grain, fine ink-like divider lines, refined serif typography for major headings, quiet
sans-serif support text, muted navy blue for navigation and links, sage green for healthy learning
signals, amber for attention, and soft clay/rose for warnings. The mood should be thoughtful,
organized, humane, and private, not corporate SaaS.

The page should feel like a beautifully maintained teacher’s notebook or archive ledger. It should
help the teacher understand what happened over time: lessons, homework assignments, profile
updates, generated materials, teacher actions, and eventually scheduling, credits, invoices, and
reminder events.

Make the interface much less dense than a dashboard. Prioritize one clear chronological story. Use
generous whitespace, calm rhythm, and clear date grouping. The teacher should immediately
understand the recent arc of the student without reading a wall of data.

Show history items in teacher-friendly language, not raw system labels. Examples: “Lesson memory
created,” “Assignment published,” “Profile updated,” “Draft generated,” “Homework follow-up
added,” “Reminder sent,” “Payment recorded.” The detailed IDs, technical statuses, and provenance
should feel tucked away behind subtle secondary affordances, not visible as the main content.

Include a sense of filtering by event type, such as Lessons, Homework, Profile, Materials,
Operations, but keep the controls elegant and quiet. The main visual impression should be a
graceful reverse-chronological timeline with richer lesson/homework entries and smaller supporting
events.

The page belongs to a multi-page student area with Overview, Learning, History, and Schedule &
Billing. History should feel connected to those pages but not like an editing screen. It is for
explainability, continuity, and confidence.

Use the shared student masthead for student identity and initials/avatar treatment. Leave the
visual system ready for real Telegram avatars later, once the student-facing Telegram bot can bind a
Telegram account to the student record. Use 24-hour time throughout. Reserve a quiet lesson
metadata slot for future scheduling details, but do not pretend duration or format data already
exists.

Avoid: dense card grids, admin tables as the main layout, bright saturated colors, generic startup
dashboard styling, purple gradients, dark mode, fake analytics overload, 12-hour time, and too many
buttons competing for attention.
```
