# Overview Page Design Lock

## Summary

This document locks the product and visual direction for the new student-area `Overview` page.

It expands
[`phase-4-overview-page-and-cross-domain-summaries.md`](phase-4-overview-page-and-cross-domain-summaries.md)
with the concrete design decisions made during implementation and visual iteration.

The current implementation is a useful first pass, but this document describes the intended target,
not a claim that the page is finished or pixel-perfect.

The core decision is:

1. `Overview` is a calm control surface for the teacher.
2. It should summarize the whole student relationship without becoming a dense dashboard.
3. It should establish the warm editorial teaching-studio style for the rest of the student area.

## Product Purpose

`Overview` is the first page a teacher should trust when opening a student.

It should answer:

1. who this student is
2. what their learning state is right now
3. what needs attention
4. what the next useful action is
5. where to go for deeper work

The page is not an editing surface. It is a glanceable orientation surface.

Detailed work belongs elsewhere:

1. `Learning` owns pedagogy, learner profile editing, memory review, and profile revisions.
2. `History` owns chronology, provenance, and relationship memory.
3. `Schedule & Billing` owns scheduling, lesson credits, payments, reminders, and calendar state.

## Visual Direction

The page should feel like a private teaching studio, not a business dashboard.

Use the same visual language later shared by `History`:

1. warm ivory/parchment background
2. subtle paper grain or notebook texture
3. fine ink-like dividers
4. refined serif hierarchy
5. restrained sans-serif support text
6. muted navy for navigation and links
7. sage for healthy learning state
8. amber for attention
9. clay/rose for warnings
10. generous whitespace

The desired emotional tone is:

1. calm
2. composed
3. trustworthy
4. personal
5. teacher-owned
6. quietly operational

The page should not look like:

1. a SaaS cockpit
2. a dense KPI dashboard
3. a card mosaic
4. a CRM record page
5. a debugging/admin surface

## Visual Reference Decisions

The preferred visual reference had these durable traits:

1. a shared student masthead with portrait/initials, name, short student ID, and local navigation
2. one clear learning-state story before secondary data
3. a calm status note such as `On track`
4. a compact operations rail for future scheduling, credits, reminders, and invoices
5. a learner snapshot card with level, goal, strengths, and challenges
6. a current focus card that points to the active teaching direction
7. one attention cue, not many competing warnings
8. a recent activity preview that links into `History`
9. a quiet handwritten-style footer note as an optional product motif
10. large breathing room around all major groups

The first image-generation draft was too dense and made the eye unsure where to look. The approved
direction deliberately reduced the number of visible details and preserved only the few signals
needed to orient the teacher.

## Student Identity

The shared student masthead should show:

1. student name
2. short student ID
3. portrait placeholder
4. compact relationship/status text when available

Use initials as the portrait placeholder for now.

When the student-facing Telegram bot exists and students can bind Telegram accounts to student
records, the Telegram avatar should become the preferred portrait source.

Avatar ownership belongs to the broader student identity/contact domain, not to the learner
profile. The learner profile remains pedagogical.

Do not show legacy `bound profile` language. Short student IDs are the durable disambiguation tool
for students with similar names.

## Page Composition

The intended page composition is:

1. shared student masthead from `StudentAreaShell`
2. profile/learning status note
3. operations rail
4. learner snapshot
5. current focus
6. attention cue
7. recent activity preview
8. optional handwritten-style closing note

The page may evolve, but these regions preserve the right mental model:

1. identity once in the shared shell
2. learning signal first in the page body
3. operations as a quiet side rail
4. deep work delegated to owning pages

## Learner Snapshot

The learner snapshot should summarize durable pedagogical context.

Recommended fields:

1. current level
2. main goal
3. stable strengths
4. persistent challenges
5. link to `Learning`

It should not expose:

1. the full profile form
2. candidate evidence
3. revision details
4. raw markdown
5. internal profile IDs

If the profile is incomplete, the snapshot should communicate the missing state calmly and provide
one clear path into `Learning`.

## Current Focus

The current focus card should answer:

1. what should the next lesson or homework generation lean into
2. why this focus makes sense
3. whether the focus is memory-backed, profile-backed, or waiting for more data

Preferred sources:

1. latest ready student-memory snapshot
2. recommended assignment directions
3. unresolved issues
4. recent progress signals
5. fallback learner-profile context

This section should feel pedagogical rather than technical.

## Operations Rail

The operations rail is future-facing. It reserves space for scheduling and business state without
letting those concerns invade the learner profile.

Recommended rows:

1. next lesson
2. lesson credits
3. reminders
4. latest invoice

Near-term placeholders are acceptable if they are honest:

1. `Not scheduled yet`
2. `Not configured yet`
3. `Telegram and email pending`
4. `Not tracked yet`

Future values may include:

1. `May 23 · 10:00`
2. `60 min · Online`
3. `5 lessons remaining`
4. `1 reminder ready`
5. `Apr 18 · Paid`

The rail should make future domains feel planned, not bolted on. It should remain visually quiet and
secondary to the student story.

## Attention Cue

Overview should show at most one dominant attention cue.

Good attention examples:

1. profile needed
2. profile draft waiting
3. candidate learning facts need review
4. memory snapshot pending
5. no next lesson scheduled later
6. low lesson credits later
7. reminder delivery failed later

Avoid stacking many warnings. If multiple things need attention, choose the highest-leverage next
action and route the teacher to the owning page.

The calm state is also meaningful. A `No urgent review` state can reassure the teacher that the
student record is usable.

## Recent Activity Preview

Recent activity on `Overview` should be a preview, not the full chronology.

It should show:

1. the last few meaningful events
2. teacher-readable labels
3. 24-hour timestamps
4. a link to `History`

It should not show:

1. raw event type names
2. long provenance details
3. full lesson memory bodies
4. raw IDs unless explicitly opened

## Time And Date Rules

Use 24-hour time throughout the student area.

Examples:

1. `10:00`
2. `09:15`
3. `14:20`

Do not use 12-hour time such as `10:00 AM`.

Short dates are acceptable in compact surfaces. Exact formatting can follow the user locale, but
time should remain 24-hour for consistency and teacher readability.

## Loading And Stability Rules

The Overview page must not show readable fake/default content while real data is loading.

Avoid:

1. visible text that changes a split second later
2. default placeholders such as `Not set` that are immediately replaced
3. duplicate entrance animations for skeleton and real content
4. layout shift between pending and final content

Preferred loading behavior:

1. use non-readable silhouettes
2. reserve the same visual slots as final content
3. avoid slide-up entrance on the real content after the pending canvas
4. keep skeleton and final content aligned as closely as possible
5. expose loading state to screen readers with visually hidden text

The teacher should never feel like they missed something because text flashed and changed.

## Empty And Early Lifecycle States

Overview should handle early student states gracefully.

Examples:

1. student exists but has no learner profile
2. student has a profile but no memory snapshot
3. student has no next lesson scheduled
4. billing is not configured
5. Telegram is not connected yet
6. no recent activity exists

The response should always be:

1. clear state
2. one direct action
3. no overwhelming diagnostic clutter
4. no fake operational data

## Relationship To Other Pages

Overview should teach the architecture of the student area:

1. pedagogy lives in `Learning`
2. chronology lives in `History`
3. operations live in `Schedule & Billing`

Overview can summarize all domains, but it must not absorb their detailed workflows.

If the page starts accumulating forms, tables, long diffs, raw event streams, or many competing
buttons, the design is drifting.

## Implementation Guardrails

Preserve these rules during implementation and polish:

1. Do not make Overview a dense dashboard.
2. Do not add detailed editing controls.
3. Do not expose raw implementation labels as primary UI copy.
4. Do not reintroduce `bound profile` language.
5. Do not store scheduling or billing state in the learner profile.
6. Do not fake future operations data beyond honest placeholders.
7. Do not use 12-hour time.
8. Do not show readable loading defaults that are immediately replaced.
9. Do not allow the skeleton and real content to visibly jump between positions.
10. Do not let the operations rail overpower the learning story.

## Image-Generation Prompt Reference

Use this prompt when generating future visual references:

```text
Design a polished Overview page for a private ESL teacher’s student area. The page is the calm
control surface for one student, not a dense dashboard.

Use a warm editorial teaching-studio visual language: ivory parchment background, subtle paper
grain, fine ink-like dividers, refined serif typography for headings, restrained sans-serif support
text, muted navy links and navigation, sage green for healthy learning state, amber for attention,
and soft clay/rose for warnings. The mood should be calm, personal, organized, humane, and
teacher-owned.

The shared masthead should tell the identity story first: student name, short student ID, portrait
placeholder, active page context, and student-area navigation. The Overview body should then begin
with a concise learning/profile status and a short description of where the learner is right now. It
should feel like opening a carefully maintained private teaching notebook.

Include a compact learner snapshot with level, main goal, stable strengths, and persistent
challenges. Include a current teaching focus that feels pedagogical and memory-informed. Include
one attention cue, not many competing warnings. Include a small recent activity preview that points
toward the full History page.

Include a quiet operations rail for future business and scheduling signals: next lesson, lesson
credits, reminders, and latest invoice. These should feel secondary and planned, not dominant.
Placeholder states are acceptable if they clearly look like missing future data rather than real
values.

Use initials as the portrait placeholder for now, but keep the visual system ready for real Telegram
avatars later once students can bind Telegram accounts through the student-facing bot. Use 24-hour
time throughout.

Avoid: dense card grids, analytics dashboards, CRM styling, bright saturated colors, purple
gradients, dark mode, raw event labels, raw IDs, fake operational certainty, too many buttons, and
anything that makes the teacher wonder where to look first.
```
