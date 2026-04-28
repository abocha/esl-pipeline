# Phase 4: Starter Profile UX

## Summary

Make student creation start from a compact teacher-authored starter profile instead of a bare
student row plus later manual profile editing.

This phase improves the beginning of the product loop:

1. create student
2. capture minimal durable profile truth immediately
3. let memory enrichment build on that clean base later

## Locked Decisions

1. Student creation should collect enough information to generate a useful first foundational
   profile revision.
2. Starter profile capture is human-authored, not generated.
3. Advanced teacher-directed profile editing remains available after creation.
4. The workspace can remain operationally plain; complete workflow matters more than visual polish.
5. Backend-created profile revisions from the starter flow must use the same canonical revision
   system as every other profile update.
6. CEFR level may be unknown at student creation time and should not block the flow.

## Why This Phase Comes Last

The starter profile flow is a product UX improvement, not a prerequisite for trustworthy backend
enrichment.

Phases 1 through 3 establish:

1. candidate generation
2. review
3. promotion into normal profile revisions

Only after those contracts are stable should student creation be made more opinionated.

## Starter Profile Shape

Version-1 starter profile should be compact and structured.

Recommended fields:

1. student level (optional)
2. primary goals
3. profession or communication context
4. interests and preferred topics
5. known long-running challenges
6. study preferences or constraints
7. optional freeform teacher notes

This is enough to generate a useful first foundational profile without forcing a full essay.

## Flow Shape

Recommended creation flow:

1. teacher opens student workspace
2. teacher enters core student metadata
3. teacher fills starter profile fields
4. backend creates:
   - student row
   - profile record
   - initial profile revision
   - active student-profile binding
5. teacher lands in the normal workspace with manual editing still available

## Backend Requirements

Suggested service behavior:

1. one canonical create flow that can:
   - create a student without starter profile when needed
   - or create student + starter profile bundle when fields are supplied
2. starter profile content should populate the canonical foundational-profile shape used by the
   future structured profile system
3. the created profile revision should be a normal revision with provenance indicating starter-flow
   origin

Suggested origin markers:

1. source = `starter_profile_form`
2. status = `active` on first creation unless explicitly saved as draft in a later enhancement

## Frontend Direction

The current student workspace should add a pragmatic starter-profile section to the create-student
form.

Version-1 UX expectations:

1. plain field groups are acceptable
2. helper copy should explain what belongs in each section
3. the teacher should not need to understand revision internals to complete creation
4. after creation, the workspace should still expose the resulting profile revision normally

The goal is a complete showcase of workflow value, not long-term frontend perfection.

## Relationship To Later Enrichment

Starter profile and generated enrichment should work together:

1. starter profile establishes initial high-authority truth
2. memory enrichment proposes durable additions later
3. teacher review and promotion keep the profile evolving safely over time

This phase should make that lifecycle feel coherent rather than like separate unrelated features.

## Acceptance Criteria

1. A teacher can create a student together with a starter foundational profile.
2. The starter flow creates a normal profile revision and active binding.
3. The resulting student can immediately participate in prompt-package generation.
4. Later enrichment phases can still propose and promote new facts on top of the starter profile.
5. Manual advanced profile editing remains available.
6. Student creation still works when the level is unknown.

## Validation

1. `pnpm --filter @esl-pipeline/batch-backend typecheck`
2. targeted backend tests for starter-profile creation flow
3. `pnpm --filter @esl-pipeline/batch-frontend test`
4. `pnpm docs:generate:indexes`
5. `pnpm docs:check`
