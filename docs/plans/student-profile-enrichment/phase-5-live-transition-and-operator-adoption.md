# Phase 5: Live Transition and Operator Adoption

## Summary

This epilogue phase turns the new profile-enrichment system into something usable on real live
students without demanding a risky all-at-once migration.

The key problem is that many existing live profiles were written before the new architecture and
therefore contain a mixture of:

1. durable foundational profile truth
2. recent lesson continuity
3. unresolved short-term issues
4. tactical pedagogic reminders
5. profile-like prose generated under the old “LLM magic” approach

This phase provides temporary transition workflows so those students can be migrated gradually with
low operator friction and low runtime risk.

## Locked Decisions

1. Legacy overloaded profiles remain valid runtime inputs until each student is deliberately
   migrated.
2. Migration is one student at a time, not one big global rewrite.
3. Legacy-profile normalization should be LLM-assisted because prose quality matters.
4. Normalization must produce a draft profile revision and never auto-activate.
5. Mixed-state operation is allowed during adoption:
   - some students may still use legacy overloaded profiles
   - some students may use normalized profiles
   - some students may have strong memory coverage while others still lag
6. This phase is explicitly temporary adoption support, not permanent architecture.

## Why This Phase Exists

Without this epilogue, the product would have:

1. a strong new architecture
2. but awkward live adoption for existing students

That would force the operator to choose between:

1. manual profile cleanup with high time cost, or
2. continuing to run overloaded legacy profiles indefinitely

This phase avoids both extremes.

## Legacy Profile Problem Shape

Many existing live profiles may already contain information that now belongs elsewhere.

Typical legacy overload:

1. durable identity, goals, and preferences
2. recent mistakes that should now live in lesson memory or unresolved issues
3. recent homework continuity that should now live in homework memory
4. tactical next-step reminders that belong in snapshot-derived guidance, not durable profile truth

The migration goal is not to delete valuable information. It is to relocate responsibility:

1. profile keeps durable truth
2. memory carries continuity

## Temporary Migration Workflow

For one student at a time:

1. inspect current active legacy profile
2. inspect latest student-memory snapshot and recent lesson/homework memory
3. run legacy profile normalization
4. produce:
   - a normalized draft foundational profile revision
   - optionally candidate facts or migration notes
   - a summary of what was kept vs intentionally omitted
5. teacher reviews the draft
6. activate the draft if acceptable
7. verify the next generated assignment and prompt-package lineage

## Legacy Profile Normalization

Normalization should be LLM-assisted but bounded.

Required inputs:

1. current active legacy profile revision
2. latest ready student-memory snapshot
3. recent ready lesson memory
4. recent ready homework memory
5. explicit target structure for the new foundational profile

Required outputs:

1. normalized draft profile revision
2. compact migration notes describing:
   - what was preserved in profile
   - what was intentionally left to memory
   - what looked ambiguous or risky

Required behavior:

1. preserve durable truths
2. remove or compress tactical continuity that the memory system now covers
3. avoid dropping clearly important durable context
4. avoid inventing new profile truth

Prohibited behavior:

1. auto-activation
2. silent mutation of the active profile
3. destructive rewriting of historical profile revisions

## Mixed-State Runtime Rules

During adoption, the runtime should tolerate students in different states.

Allowed states:

1. legacy overloaded profile + weak memory
2. legacy overloaded profile + strong memory
3. normalized profile + weak memory
4. normalized profile + strong memory

Runtime rule:

1. the active profile revision remains authoritative in every state
2. the operator migration workflow improves quality gradually but is not a hard gate to continued
   use

## Operator Workflow

This phase should lock a practical one-person operator routine.

Recommended live-use sequence:

1. ensure backend and workers are healthy
2. ensure lesson/homework/snapshot memory is current for the student
3. inspect the student workspace memory panels
4. inspect the current active profile
5. generate a normalized draft revision
6. compare the draft against the current profile
7. activate or reject the draft
8. create a real prompt package and inspect lineage
9. generate a real assignment and sanity-check quality

## Transition Tooling Direction

This phase may add temporary backend/operator helpers, but they should remain clearly transitional.

Acceptable helpers:

1. one-student normalization command or backend action
2. migration preview notes
3. “kept vs moved to memory” explanation surfaces
4. operator checklists and runbooks

Unacceptable helpers:

1. making legacy normalization part of permanent live prompt generation
2. introducing a second long-term profile authority
3. special-case runtime prompt assembly that depends on whether a student was migrated

## Acceptance Criteria

1. Existing live students can continue operating before migration.
2. A single student can be migrated from an overloaded legacy profile to a normalized draft profile
   revision.
3. The migration draft is teacher-reviewed and manually activated.
4. The system can run safely in mixed-state mode during adoption.
5. The operator has a documented, repeatable workflow for live use.

## Validation

1. `pnpm --filter @esl-pipeline/batch-backend typecheck`
2. targeted tests for legacy-profile normalization if code is added
3. sampled manual migration of at least one live student
4. prompt-package lineage inspection before and after migration
5. `pnpm docs:generate:indexes`
6. `pnpm docs:check`
