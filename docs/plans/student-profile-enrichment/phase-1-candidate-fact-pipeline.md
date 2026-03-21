# Phase 1: Candidate Fact Pipeline

## Summary

Build the first backend slice for teacher-verified student profile enrichment:

1. derive candidate durable profile facts from canonical memory
2. persist them separately from the foundational profile
3. expose them for inspection without affecting runtime homework generation

## Locked Decisions

1. Source inputs are canonical lesson memory and student-memory snapshots, not raw transcript
   re-analysis in version 1.
2. Candidate facts are advisory artifacts, not authoritative profile content.
3. No candidate fact may affect live prompt packages before teacher approval.
4. Existing foundational profile, profile revisions, and bindings remain unchanged in this phase.
5. Candidate generation must be rule-based enough to minimize drift and arbitrary promotion.

## Scope

### In

1. `student_profile_candidates` persistence
2. candidate-fact generation service
3. refresh trigger strategy
4. read-only inspection endpoints
5. backend tests and docs alignment

### Out

1. teacher approve/reject mutations
2. profile revision drafting from candidates
3. starter profile creation UX

## Candidate Sources

Priority order:

1. latest ready student-memory snapshot `personalFacts`
2. recent ready lesson-memory `studentFacts`
3. optional stable strengths / recurring issues only when explicitly marked profile-worthy by the
   generator

The pipeline should prefer stable, repeated, durable signals over recent tactical details.

## Candidate Shape

Each candidate should include:

1. `id`
2. `studentId`
3. `targetSection`
4. `fact`
5. `category`
6. `authority`
7. `confidence`
8. `reviewNeeded`
9. `sourceSnapshotId`
10. `sourceLessonMemoryIds`
11. `evidence`
12. `status`
13. `createdAt`
14. optional `supersededBy`

Allowed statuses:

1. `pending_review`
2. `superseded`

This phase does not need `approved` / `rejected` writes yet, but the schema should leave room for
them.

## Generation Rules

1. Deduplicate semantically identical facts per student when evidence and category materially match.
2. Prefer snapshot-derived facts over lesson-derived duplicates when both exist.
3. Keep low-confidence or `model_inferred` facts only if they carry strong evidence and
   `reviewNeeded=true`.
4. Skip obviously transient facts.
5. Do not propose facts that merely restate short-term lesson review items.
6. Do not emit profile candidates outside the allowed durable categories defined in the higher-level
   plan.
7. Strength-oriented candidates must satisfy the repeatability rule before they become
   `pending_review`.
8. Rejection-aware re-proposal suppression is deferred to Phase 2, when rejection state exists.

## Strength Eligibility Rules

Stable strengths are allowed, but only under explicit controls.

A strength candidate should be eligible only when:

1. it is expressed as a durable learning strength rather than a one-lesson success
2. it is observed in at least two distinct canonical source artifacts, or
3. it appears in the latest snapshot and is corroborated by at least one contributing lesson-memory
   entry

Ineligible examples:

1. “did well with today’s modal exercise”
2. “answered this lesson’s comprehension questions accurately”
3. “seemed more confident in this one conversation”

Eligible examples:

1. “responds well to formula-based grammar explanations”
2. “retains tense-contrast logic when explanations are structured”
3. “benefits from one-take speaking tasks and spontaneous production drills”

## Re-Proposal Rules

A previously rejected fact may be re-proposed only when one of these is true:

1. a new canonical source artifact adds corroborating evidence
2. authority tier improved
3. confidence improved because the fact is now repeated across additional sources

Simple rewording or repeated extraction from the same evidence is not enough.

Phase boundary:

1. this rule becomes enforceable only after review-state persistence exists in Phase 2
2. Phase 1 should preserve enough candidate identity and source provenance for later re-proposal
   checks, but it is not responsible for enforcing them yet

## Trigger Strategy

Generate or refresh candidate facts when:

1. a new ready student-memory snapshot is written
2. operator replay/backfill is invoked

This keeps the enrichment pipeline downstream of the existing student-memory system rather than
parallel to it.

## Read Surface

Add authenticated read-only endpoints:

1. `GET /students/:id/profile-candidates`
2. optional filters:
   - status
   - limit
   - offset
   - order

The student workspace should be able to inspect candidates, but no review controls are needed in
this phase.

## Acceptance Criteria

1. New ready snapshots can produce pending profile candidates.
2. Candidate facts are stored separately from foundational profile revisions.
3. Prompt packages and live homework generation ignore profile candidates entirely.
4. Operators can inspect candidate facts and their evidence through the backend.
5. Replay/backfill is possible without mutating the active profile.
6. Candidate identity and provenance are sufficient for later rejection-aware re-proposal checks in
   Phase 2.

## Validation

1. `pnpm --filter @esl-pipeline/batch-backend typecheck`
2. targeted repository + application tests for candidate generation and listing
3. `pnpm docs:generate:indexes`
4. `pnpm docs:check`
