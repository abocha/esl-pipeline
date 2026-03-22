# Legacy Profile Normalization

## Meta

- Audience: operator-maintainer using the live student system during transition.
- Read Time: 6 minutes.
- Authority Level: temporary adoption runbook.
- Last Verified Against: 2026-03-22 repo state.
- Owner: founder-maintainer + batch-backend maintainers.
- Review Cadence: after profile-enrichment transition tooling changes.
- Status: `active`.

## Purpose

Explain how to migrate a live student from an overloaded legacy profile into the new
profile-plus-memory model with minimal churn.

This runbook is intentionally transitional. It exists to help adoption of the new architecture and
should not be mistaken for a permanent second profile workflow.

## When To Use This Runbook

Use this when a student's active profile clearly mixes:

1. durable personal truth
2. recent lesson continuity
3. unresolved tactical teaching loops
4. old-style LLM-generated prose that now overlaps with canonical memory

Do not use this runbook when:

1. the student's current active profile is already compact and durable
2. the student has no meaningful canonical memory yet
3. you are trying to patch generated memory artifacts directly

## Core Rules

1. The active profile revision remains the live authority until you activate a new revision.
2. Legacy normalization must create a draft profile revision, never mutate the active one in place.
3. Canonical student memory remains the source of continuity; do not push tactical continuity back
   into the foundational profile just because the old profile used to hold it.
4. Keep migration student-by-student. Do not attempt global one-shot rewrites.
5. Rollback is done by re-activating the earlier profile revision if needed.

## One-Student Migration Workflow

1. Open the student workspace.
2. Inspect the student's:
   - current active profile
   - latest ready snapshot
   - recent lesson memory
   - recent homework memory
3. Confirm memory looks current enough to support normalization.
4. Generate a normalized draft profile revision from:
   - current active profile
   - latest snapshot
   - recent lesson/homework memory
5. Review the draft with these questions:
   - did it preserve durable truth?
   - did it remove short-term tactical continuity now covered by memory?
   - did it avoid inventing new facts?
   - is the prose still useful and readable?
6. If acceptable, activate the new revision.
7. Create a fresh prompt package for the student.
8. Inspect prompt-package lineage and verify the new profile revision is used.
9. Generate one real assignment and sanity-check whether the result still feels personalized.

## Mixed-State Safety

During transition, you may have:

1. non-migrated students with overloaded profiles
2. migrated students with normalized profiles
3. students with incomplete memory coverage

This is acceptable.

The migration workflow improves quality gradually; it is not a prerequisite for continued live use.

## What “Good” Normalization Looks Like

A good normalized profile should:

1. stay shorter and more durable than the old profile
2. preserve goals, identity, stable preferences, constraints, and persistent patterns
3. stop carrying short-lived tactical details that now belong in memory
4. remain readable, teacher-trustworthy prose rather than turning into a pile of tags

## Red Flags

Reject or revise the draft if it:

1. drops clearly important durable context
2. copies snapshot or lesson-memory wording too literally into the foundational profile
3. preserves recent tactical reminders that should now stay in memory
4. invents polished but unsupported student facts
5. rewrites unrelated sections for style without a good reason

## Rollback

If the normalized revision performs poorly:

1. reactivate the previous profile revision
2. keep the failed draft in revision history for analysis
3. inspect the latest prompt-package lineage and assignment output
4. retry only after understanding whether the problem was:
   - bad source memory
   - bad normalization draft
   - operator activation decision

## Related

- [`docs/plans/student-profile-enrichment/README.md`](../plans/student-profile-enrichment/README.md)
- [`docs/plans/student-profile-enrichment/phase-5-live-transition-and-operator-adoption.md`](../plans/student-profile-enrichment/phase-5-live-transition-and-operator-adoption.md)
- [`docs/operations/student-memory-replay-backfill.md`](student-memory-replay-backfill.md)
