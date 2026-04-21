# Phase 2: Learning Page And Structured Profile

## Summary

`Learning` should be the first fully redesigned student-area page and the first place where the new
student-area architecture becomes real.

This page owns:

1. the structured foundational learner profile
2. memory-aware teaching support
3. profile enrichment review
4. profile revision workflow

It should feel like the calm, trustworthy home for pedagogical truth.

## Why This Page Comes First

The learner profile and memory model directly affect homework quality, teacher confidence, and the
minimal assignment flow. They are also the clearest product area where the current workspace shape
is holding the system back.

Improving `Learning` first creates immediate product value while also establishing the design
language that later pages can follow.

## Locked Decisions

1. The foundational learner profile becomes structured canonical data.
2. The teacher must be able to edit any profile field directly and quickly.
3. The profile remains teacher-authoritative even when generated drafts or candidate facts exist.
4. The page uses one coherent profile form composed of section cards, not one giant textarea and
   not many unrelated save points.
5. The full profile draft is saved together as one revision.
6. Generated help remains secondary:
   - useful
   - evidence-backed
   - easy to ignore or correct
7. Stable strengths are first-class profile data alongside persistent challenges.
8. Candidate-review workflows must not become the only path for fixing profile truth.

## Page Structure

Recommended vertical layout:

### 1. Learning Header

Shows:

1. student identity
2. active profile status
3. draft-present or no-draft state
4. last updated time
5. clear primary actions

Primary header actions:

1. `Populate First Profile From Lesson`
2. `Refresh Draft From Approved Candidates`
3. `Save Draft`
4. `Activate Draft`

### 2. Foundational Profile

This is the primary editing surface.

It should be a single form, visually broken into section cards:

1. `Goals & Motivation`
2. `Communication Contexts`
3. `Strengths & Challenges`
4. `Study Preferences & Constraints`
5. `Teacher Notes`

The teacher should feel like they are editing one profile, not hopping between admin mini-tools.

### 3. Memory & Signals

Secondary summary area showing:

1. recent long-term learning signals
2. latest memory snapshot cues
3. current unresolved teaching threads

This area supports the profile but does not own it.

### 4. Profile Candidates

Secondary review area for evidence-backed candidate facts.

It should remain below the profile form because it is support material, not the primary product
loop.

### 5. Revision Rail

A secondary rail or footer area showing:

1. active revision
2. draft revision
3. revision history
4. restore or activate actions

This keeps provenance available without forcing the teacher to think in revision mechanics during
basic editing.

## Canonical Structured Profile Shape

The canonical profile should stay compact and durable.

Recommended fields:

1. `overallLevel`
   - optional string
   - example: `A2`, `B1`, `Low B2`, `Unknown`
2. `primaryGoals`
   - array of durable goal statements
3. `communicationContexts`
   - array of durable real-world English-use contexts
4. `interestsAndUsefulThemes`
   - array of topics that support engagement when relevant
5. `stableStrengths`
   - array of durable positive learner traits or capabilities
6. `persistentChallenges`
   - array of durable recurring issues or risks
7. `studyPreferences`
   - array of durable learning preferences or recurring useful teaching patterns
8. `durableConstraints`
   - array of durable constraints affecting lesson or homework design
9. `teacherNotes`
   - freeform string for durable pedagogical notes that do not fit elsewhere

### Why This Shape

This shape aligns with the pedagogy docs:

1. the profile should govern stable truth, goals, preferences, and durable constraints
2. recent lesson details should stay in memory, not be copied into the profile
3. strengths matter as much as weaknesses for challenge calibration and homework design

### Editing Model

The form should favor easy correction over heavy ceremony.

Recommended input treatment:

1. `overallLevel`
   - single optional text input or select with freeform fallback
2. list fields
   - editable line-item lists with add/remove controls
   - each item is simple text, not a nested object the teacher must manage
3. `teacherNotes`
   - freeform textarea

Keep the structured schema simple even if later revisions add richer metadata behind the scenes.

## Teacher Authority Model

The teacher should never feel locked out of the learner profile by automation.

Required product behaviors:

1. The teacher can manually edit any field in the current draft.
2. The teacher can create a draft even when no candidates exist.
3. The teacher can correct bad generated content without going through a candidate review queue.
4. The teacher explicitly activates a draft; nothing becomes truth automatically.
5. Generated actions are framed as helpers, not requirements.

## Generated Draft Actions

### 1. Populate First Profile From Lesson

Purpose:

1. help bootstrap a first useful profile when the teacher did not enter much starter information

Behavior:

1. manually triggered only
2. creates a draft profile from lesson evidence and memory, not an active profile
3. expects teacher review and correction before activation

Best fit:

1. early student lifecycle
2. thin or missing profile
3. migration or recovery workflow

### 2. Refresh Draft From Approved Candidates

Purpose:

1. incorporate approved durable facts into a coherent draft profile revision

Behavior:

1. only uses approved candidate facts
2. preserves manual edits in unrelated sections where feasible
3. remains a draft until teacher activation

### 3. Save Draft

Purpose:

1. persist the teacher's current form edits without activating them

Behavior:

1. single save for the whole profile form
2. visible unsaved state before save
3. explicit success and error feedback

### 4. Activate Draft

Purpose:

1. promote the reviewed structured draft into the live foundational profile

Behavior:

1. activation is explicit
2. previous active revision remains available in history
3. future prompt packaging and previews use the newly active structured revision

## Profile Candidates On The Learning Page

Profile candidates should remain visible and useful, but subordinate.

Required behavior:

1. show candidate fact text, evidence, confidence, and source context
2. allow approve, approve with edit, reject, and defer
3. allow bulk selection for draft refresh
4. do not block normal profile editing when candidates are messy or incomplete

The page should communicate:

1. candidate facts are proposed durable truths
2. the teacher decides what becomes foundational truth

## Memory & Signals On The Learning Page

This section should help the teacher update the profile and plan teaching, but it should not become
another overloaded data dump.

Show concise summaries such as:

1. current broad strengths
2. current broad challenges
3. open learning threads
4. recent progress signals

Link to deeper chronology in `History` when needed.

## Cross-Surface Integration

### Minimal Assignment Flow

The minimal assignment flow should stop editing the learner profile directly.

`Add teaching context` should become:

1. editable lesson guidance
2. read-only compact learner-profile preview
3. button into the student area

Recommended CTA:

1. `Manage Learner Profile In Student Workspace`

Recommended preview content:

1. current level
2. top goals
3. top strengths
4. top challenges

This preview should read from the structured profile directly rather than trying to summarize freeform
markdown on the fly.

### Overview Page

`Overview` later summarizes the structured profile at a glance, but detailed editing remains in
`Learning`.

## UX Rules

1. Form labels must explain what belongs in each section.
2. Empty states should be explicit and non-threatening.
3. Generated-draft actions should be near the profile form, not buried in chronology panels.
4. Save and activate actions should be specific and visible.
5. The page should privilege fast correction over clever automation.
6. Revision internals should be available, but secondary.

## Out Of Scope

1. template editing
2. billing or reminder controls
3. schedule planning widgets
4. turning `Learning` into a chronology-first dashboard
