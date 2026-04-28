# Phase 1: Information Architecture And Domain Boundaries

## Summary

The new student area should be organized as one product with four pages, not one workspace with
many panels.

The job of this phase is to lock the page architecture and the domain boundaries so later
implementation work does not reintroduce the same confusion in a different layout.

## Product Goal

When a teacher opens a student area, the system should immediately answer:

1. what matters right now
2. where to go next
3. which data belongs to teaching versus operations versus accounting

The current workspace does not do that consistently because too many unrelated jobs are presented as
peers.

## Locked Decisions

1. The top-level student-area navigation is:
   - `Overview`
   - `Learning`
   - `Schedule & Billing`
   - `History`
2. `Overview` is a summary and routing page.
3. `Learning` is the operational home for pedagogy and structured learner context.
4. `Schedule & Billing` is the operational home for lesson planning, credits, invoices, reminders,
   and calendar sync.
5. `History` is the home for chronology, provenance, and audit-friendly review.
6. Template administration should not remain a long-term responsibility of the student area.
7. The student area should feel calm and directional; dense operational detail belongs in deep
   pages, not on the entry screen.

## Page Contracts

### 1. Overview

Primary job:

1. give the teacher a high-confidence snapshot of the student at a glance
2. surface urgent or incomplete states
3. provide strong deep links into the page where action belongs

Overview is not for:

1. multi-field editing
2. long lists
3. reviewing full evidence payloads
4. administering templates or prompt assets

### 2. Learning

Primary job:

1. maintain the durable pedagogical truth for the student
2. inspect teaching continuity and learner development
3. accept teacher-authoritative edits
4. review or apply generated suggestions without making them mandatory

Learning contains:

1. foundational profile
2. learner memory summaries
3. profile candidates and evidence-backed enrichment
4. profile revision workflow

### 3. Schedule & Billing

Primary job:

1. manage upcoming lessons and cadence
2. manage lesson credits and future accounting actions
3. track reminder and contact-channel behavior
4. connect planning state to future calendar sync

Schedule & Billing contains:

1. next lesson
2. cadence preferences
3. lesson package balance
4. reminder state
5. invoice and attendance state later

### 4. History

Primary job:

1. provide chronological confidence and explainability
2. keep detailed history out of the day-to-day editing views
3. expose provenance when the teacher needs to understand how something got here

History contains:

1. lesson chronology
2. homework chronology
3. profile revisions
4. scheduling and billing events later
5. reminder and communication log later

## Navigation Model

### Student Selection

The student should be selected once, then remain in context across the four pages.

Recommended behavior:

1. a persistent shared student masthead with identity and quick context, owned by
   `StudentAreaShell`
2. tabs or sub-navigation inside the shared student masthead
3. direct deep links from overview cards into the specific page and section that owns the work

Phase 6 supersedes any older page-local header interpretation. Student identity, the back link,
initials/avatar, short ID, and student-area tabs should appear once in the shared shell, not be
rebuilt separately by `Overview`, `Learning`, `History`, or `Schedule & Billing`.

### Cross-Surface Links

The student area must also receive traffic from outside the student area:

1. the minimal assignment flow should link into the learner context for the selected student
2. future billing or reminder notifications should deep-link into `Schedule & Billing`
3. future audits or regressions should deep-link into `History`

## Domain Split

The student record should be modeled as several related domains rather than one overloaded object.

### A. Student Identity & Relationship

Purpose:

1. identify the student
2. define how the teacher or system can contact them
3. carry administrative facts that are important but not pedagogical

Examples:

1. name
2. timezone
3. email
4. Telegram-linked state
5. preferred contact channel
6. relationship or admin notes

### B. Learning Profile

Purpose:

1. capture durable pedagogical truth that should influence lesson and homework generation over time

Examples:

1. level
2. goals
3. communication contexts
4. useful interests
5. stable strengths
6. persistent challenges
7. study preferences
8. durable constraints
9. teacher notes

Must not include:

1. remaining lesson credits
2. invoice state
3. next lesson date
4. one-off lesson corrections
5. recent unresolved issues that belong in memory or lesson operations

### C. Lesson Operations

Purpose:

1. organize teaching continuity and session planning

Examples:

1. cadence preference
2. preferred days or times
3. next lesson date
4. scheduling notes
5. open planning concerns

### D. Billing & Attendance

Purpose:

1. support the business side of recurring teaching without contaminating the pedagogy model

Examples:

1. lessons purchased
2. lessons used
3. lessons remaining
4. invoice status
5. package history
6. cancellation or attendance pattern
7. reminder status

### E. History & Provenance

Purpose:

1. preserve explainability across all other domains

Examples:

1. profile revision timeline
2. assignment timeline
3. lesson chronology
4. billing events
5. reminder events
6. calendar sync log

## Cross-Domain Rules

1. Every page may summarize other domains, but ownership stays with the domain page.
2. Pedagogical data may influence reminder wording later, but billing and reminder state must not
   become fields in the learning profile.
3. `Overview` may display cross-domain summaries, but those summaries should stay compact and
   action-oriented.
4. History should show how data changed, but it should not become the primary editing surface.
5. Future automation should emit events into history, not add hidden side effects into unrelated
   forms.

## Delivery Guidance

The first implementation slices should respect the final IA even if some pages launch with partial
content:

1. ship `Learning` first
2. ship `Overview` once learning data can summarize cleanly
3. move chronology-heavy panels into `History`
4. build `Schedule & Billing` on the correct domain model rather than squeezing it into Overview or
   Learning as an interim shortcut

## Anti-Patterns To Avoid

1. another one-page workspace with more collapsible sections
2. putting template editing into the student area because it is already nearby
3. storing billing state in the learner profile because it is convenient
4. letting generated lesson memory overwrite the durable learner profile directly
5. turning Overview into a dashboard-shaped duplicate of all four pages
