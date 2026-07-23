# First-Profile Onboarding

## Meta

- Audience: product owner, maintainers, frontend/backend agents.
- Authority Level: active product design.
- Last Verified Against: 2026-07-23 product decision and v10.2.2 assignment flow.
- Owner: founder-maintainer + frontend/backend maintainers.
- Review Cadence: after the replacement onboarding flow ships or practical tutor use changes the
  decision.
- Status: `spec`.

## Purpose

Define the long-term tutor experience for establishing learner context before the first eligible
assignment. This document records the approved product behavior and its authority boundaries. It is
not an implementation plan.

## Product Decision

Profile drafts, activation, revision identifiers, hashes, and recovery mechanics are internal
system concerns. The assignment flow must not ask a tutor to operate those mechanics.

The intended tutor journey is:

1. Create the student.
2. Optionally enter a few lines of known learner context on the Student Learning page.
3. Start the first eligible assignment and confirm its lesson transcript.
4. Let the system enrich the learner profile automatically from that exact confirmed lesson.
5. Review the resulting profile in Teaching context, correct it on the Student Learning page only
   when necessary, and continue the assignment normally.

There is no assignment-level Populate, Approve, Activate, Skip, or Leave pending decision.

## Eligibility Rule

Automatic initial enrichment occurs when both conditions are true:

1. the learner profile has never completed evidence-based enrichment; and
2. the profile is empty or contains only tutor-authored seed content.

Prior assignment count is not part of the rule. An abandoned assignment, an assignment created
while enrichment was unavailable, or migrated history must not permanently prevent the learner's
first evidence-based enrichment.

Eligibility must come from durable profile provenance. It must not be inferred from profile prose,
an asynchronously loaded frontend list, assignment count, or whether a component currently has a
profile preview.

## Tutor Experience

After Lesson source is confirmed, enrichment starts automatically in the background. Teaching
context may open immediately so the tutor can write lesson-specific guidance while the system is
working.

The temporary state uses teaching language:

> Preparing learner context from this lesson...

When complete, Teaching context shows the profile preview and a restrained completion message:

> Learner context updated from this lesson. Review it below, or continue if everything looks right.

The only profile-specific action is an `Edit learner profile` link to the Student Learning page.
The ordinary assignment `Confirm and continue` action means the visible context is suitable for this
assignment; it is not a profile-revision approval control.

If the tutor edits the profile:

1. the Student Learning page saves the correction as normal profile history;
2. returning to the assignment explicitly reloads authoritative profile state;
3. Teaching context displays the corrected profile; and
4. confirmation pins the corrected active revision, not the earlier automatically enriched
   revision.

A manual correction does not erase the durable fact that initial evidence enrichment has already
occurred. The assignment must not start the initial enrichment again.

## Authority and Data Behavior

Tutor-authored seed content is authoritative input. Initial enrichment may fill missing context and
add evidence-backed information, but it must not silently delete or contradict the tutor's seed
content.

The enrichment source is the exact confirmed assignment source, including transcript identity and
content hash, and the canonical ready lesson-memory evidence derived from it. Older ready lesson
memory cannot satisfy readiness for the current assignment.

The assignment and source must first satisfy the lifetime-canonical identity rules in
[`Canonical assignment state`](CANONICAL_ASSIGNMENT_STATE.md). Re-selecting the same source resumes
that assignment; it cannot create a competing enrichment or assignment session.

The operation survives refresh, focus changes, navigation, retries, and ambiguous responses without
creating duplicate drafts or repeating model work. Internal profile revision creation and activation
remain atomic, revisioned, and recoverable, but invisible in the primary tutor workflow.

The assignment session remains the authority for the profile lineage used by that assignment.
Student-option lists and component loading state are discovery aids, not lineage authorities.

## Failure Behavior

Transient failures retry automatically. The tutor may continue writing lesson guidance while
enrichment is pending.

An exhausted enrichment failure must not fabricate readiness or expose revision controls. The
interface gives a concise learner-context warning and uses valid tutor-authored seed content when
available. The assignment may proceed without profile enrichment when no valid enriched profile is
available; it must never pin partial profile lineage.

Returning from the Student Learning page or refreshing the assignment performs an authoritative
reload. A focus event alone is not treated as proof that profile state is absent or changed.

## Boundary With Ongoing Enrichment

This automatic path is a one-time onboarding exception for an empty or tutor-seeded profile. It does
not authorize automatic ongoing mutation of an established evidence-enriched profile.

Later lesson-derived improvements remain part of the Student Learning page's teacher-reviewed
candidate and profile-maintenance workflow. They must not interrupt the critical assignment path.

## Why This Matters

This product shape removes the pre-v10 first-profile assistant's accidental coupling between:

- asynchronous student/profile discovery;
- assignment recovery state;
- lesson-memory readiness;
- profile drafting and activation; and
- step confirmation.

It prevents a loading state from masquerading as an absent profile, prevents duplicate population
of an existing profile, binds initial enrichment to the confirmed lesson, preserves tutor correction
authority, and keeps internal lineage mechanics out of the teaching workflow.

## Non-Goals

- Exposing profile revision management inside the assignment flow.
- Automatically enriching an established profile after every lesson.
- Replacing the Student Learning page as the profile editing and maintenance surface.
- Defining delivery phases, migrations, endpoint shapes, or an implementation sequence.

## Related

- [`PRODUCT.md`](../../PRODUCT.md)
- [`Product UI preferences`](PRODUCT_UI_PREFERENCES.md)
- [`Canonical assignment state`](CANONICAL_ASSIGNMENT_STATE.md)
- [`Student System Roadmap`](../reference/STUDENT_SYSTEM_ROADMAP.md)
- [`Student Profile Enrichment and Verification`](../plans/student-profile-enrichment/README.md)
- [`Hosted MVP Evidence`](../operations/hosted-mvp-evidence.md)
