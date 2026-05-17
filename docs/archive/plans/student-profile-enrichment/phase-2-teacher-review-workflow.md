# Phase 2: Teacher Review Workflow

## Summary

Add the first writable product workflow for profile enrichment:

1. expose pending candidate facts inside the student workspace
2. let the teacher approve, edit, reject, or defer them
3. preserve clear evidence and provenance for every decision

This phase is intentionally workflow-first, not design-system-first. The UI only needs to be clear
and complete enough to prove the product loop.

## Locked Decisions

1. The student workspace is the review surface; no separate review app is introduced.
2. Candidate facts are generated at fact granularity but reviewed in section-grouped UI.
3. Review actions must preserve provenance and actor identity.
4. Approval in this phase marks facts as approved for later promotion; it does not yet activate a
   new profile revision automatically.
5. The UI may be operationally plain as long as it is functionally complete.
6. The teacher should choose which approved facts move forward; bulk promotion may exist as a
   convenience but not as an implicit default.

## Why This Phase Follows Phase 1

The review workflow depends on canonical candidate facts already existing.

This phase should not invent:

1. ad hoc client-side candidate state
2. direct text edits against the active foundational profile
3. alternate approval storage outside the backend

## Product Shape

### Review Unit

The backend stores individual candidate facts, but the workspace should present them grouped by
target section.

Recommended review sections:

1. goals and motivation
2. work and communication context
3. interests and personal context
4. learning preferences and study habits
5. long-running strengths
6. persistent challenges or constraints

Each group should still let the teacher act on individual facts.

### Required Candidate Display Fields

Each review item should show:

1. proposed fact text
2. category
3. suggested profile section
4. authority
5. confidence
6. source summary
7. evidence excerpt(s)
8. current review status

### Teacher Actions

Version 1 review actions:

1. approve
2. approve with edit
3. reject
4. defer

Behavior rules:

1. approve preserves the fact text and marks the candidate ready for promotion
2. approve with edit stores the teacher-edited fact as the approved text while preserving the
   original proposal and evidence
3. reject stores a durable rejection status and optional note
4. defer keeps the item pending but allows the teacher to move on

## Backend Requirements

Add authenticated mutation endpoints for candidate review.

Suggested routes:

1. `POST /students/:id/profile-candidates/:candidateId/approve`
2. `POST /students/:id/profile-candidates/:candidateId/reject`
3. `POST /students/:id/profile-candidates/:candidateId/defer`

Suggested request fields:

1. optional edited fact text on approve
2. optional reviewer note on approve or reject
3. actor identity from the authenticated user

Suggested status evolution:

1. `pending_review`
2. `approved`
3. `rejected`
4. `superseded`

`defer` should usually keep `pending_review` while recording audit metadata rather than creating a
separate durable lifecycle branch unless later product needs justify it.

To keep the UI and verification model unambiguous, Phase 2 should add a secondary review-state
field separate from lifecycle status.

Suggested review-state values:

1. `unreviewed`
2. `deferred`
3. `approved`
4. `rejected`

Recommended mapping:

1. `pending_review + unreviewed`
2. `pending_review + deferred`
3. `approved + approved`
4. `rejected + rejected`

Filter rule:

1. “pending” should mean `pending_review + unreviewed`
2. “reviewed” should include `approved`, `rejected`, and `pending_review + deferred`
3. deferred items should be surfaced explicitly rather than hidden inside the generic pending bucket

## Audit And Explainability Rules

Every review action should preserve:

1. reviewer id
2. action timestamp
3. original candidate text
4. edited approved text if applicable
5. reviewer note if supplied
6. source evidence and source artifact ids

The system must always be able to answer:

1. what the model proposed
2. what the teacher accepted or changed
3. why the fact was eligible for promotion

## Frontend Direction

The student workspace should add a new utilitarian section for profile candidates.

Minimum useful capabilities:

1. list pending candidates grouped by section
2. expand a candidate to inspect evidence
3. approve directly
4. edit and approve
5. reject with an optional note
6. filter to pending vs reviewed
7. clearly surface whether a reviewed candidate is merely approved or already promoted later
8. show deferred items as a distinct visible review state

Non-goals for this phase:

1. perfect visual hierarchy
2. advanced keyboard UX
3. polished comparison animations
4. permanent design language decisions

## Acceptance Criteria

1. Teachers can inspect pending profile candidates in the student workspace.
2. Teachers can approve, edit-and-approve, reject, or defer candidates.
3. Review decisions are persisted in the backend with actor and timestamp metadata.
4. Candidate evidence remains visible after review.
5. No review action mutates the active foundational profile yet.
6. The UI makes it clear that approval and promotion are separate steps.

## Validation

1. `pnpm --filter @esl-pipeline/batch-backend typecheck`
2. targeted backend tests for approve/reject/defer flows
3. `pnpm --filter @esl-pipeline/batch-frontend test`
4. `pnpm docs:generate:indexes`
5. `pnpm docs:check`
