# Student Profile Enrichment and Verification

## Meta

- Audience: maintainers, backend/frontend agents, product owner.
- Authority Level: active follow-on plan.
- Last Verified Against: 2026-03-21 repo state.
- Owner: founder-maintainer + backend/frontend maintainers.
- Review Cadence: after each implementation phase.
- Status: `active`.

## Summary

This follow-on plan extends the upgraded student-memory system with a teacher-verified profile
enrichment workflow.

The current architecture already distinguishes:

1. foundational profile = durable, high-authority student context
2. lesson memory = generated per-transcript memory
3. homework memory = generated per-assignment memory
4. student memory snapshot = generated long-term rollup

This plan keeps that split intact while adding a safe promotion path from generated memory into the
foundational profile.

Workspace/product-shape note:

1. learner-profile UX, page architecture, and the future student-area surface are now governed by
   [`docs/plans/student-area-redesign/README.md`](../student-area-redesign/README.md)
2. this topic remains the enrichment workstream for candidate facts, review, promotion, and
   migration support inside that broader student-area blueprint

## Problem Statement

The current system can already extract profile-like facts from lessons and long-term rollups, but
those facts remain inside generated memory artifacts. Teachers still need to manually update the
foundational profile when important durable facts emerge over time.

This creates two product problems:

1. useful durable facts stay trapped in generated memory instead of improving the stable profile
2. the authoritative profile becomes expensive to maintain manually, especially after the first few
   lessons

At the same time, direct auto-mutation of the foundational profile is not acceptable because it
would blur the line between curated truth and inferred memory.

## Locked Decisions

1. The foundational profile remains the highest-authority student document.
2. Transcript- or memory-derived facts must not auto-promote directly into the foundational profile.
3. Generated profile enrichment is allowed only as a proposed change set that requires teacher
   review.
4. Approved profile enrichment must create a normal profile revision, preserving lineage and
   restore/activate semantics.
5. Rejected or ignored candidate facts remain in generated memory only; they do not mutate the
   foundational profile.
6. Candidate fact generation should reuse canonical lesson memory and student-memory snapshots where
   possible instead of re-reading raw transcripts in the first version.
7. The student workspace remains the operational home for review; no separate profile-enrichment app
   is introduced.
8. Promotion should default to teacher-selected approved facts, with a convenience path to select
   all approved facts in one action.
9. Stable strengths may be promoted into the foundational profile only when they satisfy explicit
   repeatability and review criteria; they must not be promoted opportunistically.
10. Rejected facts may be re-proposed only when the evidence set materially changed.
11. Starter profile level may be unknown at creation time; CEFR level is optional in version 1.
12. The system should use LLMs for bounded synthesis and drafting where structured profile quality
    and rendered readability matter, but not as the final authority for what becomes profile truth.

## Goals

1. Make student onboarding lighter by collecting a minimal teacher-authored starter profile.
2. Let the system propose additional stable profile facts after lessons accumulate.
3. Keep all foundational profile changes teacher-approved and revisioned.
4. Preserve clear explainability between:
   - human-authored profile truth
   - generated but unapproved candidate facts
   - generated memory used for runtime continuity
5. Improve homework quality by gradually strengthening the foundational profile without sacrificing
   trust.

## Out of Scope

1. Automatic profile mutation without teacher approval.
2. Free-form agentic profile editing.
3. Replacing lesson/homework/snapshot memory with profile synthesis.
4. Shipping a separate admin app for profile review.
5. Reworking the current memory schemas before this workflow exists.
6. Treating one-time migration helpers as permanent architecture.

## Current System Baseline

### Human-authored and human-controlled today

1. student record metadata
2. foundational profile content
3. profile revision activation and restore
4. student-to-profile binding history
5. teacher notes and transcript corrections

### Generated today

1. lesson memory from transcript
2. homework memory from canonical published homework
3. student-memory snapshot from lesson/homework history

### Already-extracted profile-like data

1. lesson memory contains `studentFacts`
2. student-memory snapshots contain `personalFacts`
3. those facts already carry authority/confidence/review signals

This means the repo already has the raw material for enrichment, but not the promotion workflow.

## Product Shape

### 1. Starter Profile at Student Creation

When a student is created, the teacher should provide a compact starter profile instead of writing a
full long-form profile from scratch.

Version-1 starter fields:

1. level
2. goals
3. profession or primary use case
4. known interests
5. known long-running challenges
6. study constraints or preferences
7. optional freeform teacher notes

This starter content should produce the initial foundational profile revision using the existing
revision system.

### 2. Candidate Profile Facts

After a student has enough memory history, the system should generate candidate durable facts for
teacher review.

Good candidates:

1. stable background facts repeated across lessons
2. durable preferences and interests
3. recurring work/life communication contexts
4. long-running learning preferences
5. confirmed strengths or persistent challenges worth elevating into the profile

Poor candidates that should stay in memory only:

1. one-off lesson anecdotes
2. transient short-term review items
3. speculative facts with weak evidence
4. assignment-specific tactical directions

### Profile-Worthy Rules

Version 1 should use explicit eligibility rules instead of free-form model judgment.

Facts should be considered profile-worthy only when they satisfy both:

1. they fit an allowed durable category
2. they satisfy a minimum evidence and repeatability rule

Allowed durable categories:

1. goals and motivation
2. work and communication context
3. interests and personal context
4. learning preferences and study habits
5. persistent challenges or constraints
6. repeated stable strengths

Minimum repeatability rule:

1. the fact is supported by at least two distinct canonical source artifacts, or
2. the fact appears in the latest snapshot and is corroborated by at least one contributing lesson
   memory entry

Minimum evidence rule:

1. at least one evidence excerpt must be preserved
2. purely weak `model_inferred` facts are not sufficient on their own
3. teacher-confirmed or student-stated support should outrank model inference whenever available

These rules exist specifically to reduce drift and over-promotion.

### 3. Teacher Review Before Promotion

The review workflow should show:

1. proposed fact text
2. source category
3. authority level
4. confidence
5. evidence excerpt(s)
6. suggested destination section in the profile

Teacher actions:

1. approve
2. approve with edit
3. reject
4. defer

Approved facts should produce a draft profile revision that the teacher can inspect and activate.

## Data Model Direction

Version 1 should add a dedicated candidate-facts surface instead of overloading the foundational
profile or raw memory tables.

Suggested canonical object:

1. `student_profile_candidates`
2. linked to:
   - `student_id`
   - source lesson-memory entry ids and/or snapshot id
   - current profile revision id at proposal time
3. stores:
   - candidate fact text
   - target section
   - authority
   - confidence
   - review status
   - evidence payload
   - optional reviewer decision metadata

Suggested statuses:

1. `pending_review`
2. `approved`
3. `rejected`
4. `superseded`

Approved candidates should not mutate the active profile in place. They should be converted into a
new profile revision using the normal revision flow.

## Runtime and Authority Rules

1. Homework generation continues to use the active foundational profile plus generated memory.
2. Pending or rejected profile candidates must not affect live prompt packages.
3. Approved candidates affect homework only after they land in an activated profile revision.
4. Generated memory remains the home for tactical continuity even if some facts later graduate into
   the foundational profile.

## LLM Usage Philosophy

This workstream should use LLMs where they add real product value, while keeping authority and
selection logic governable.

Use LLMs for:

1. extracting lesson, homework, and snapshot memory
2. synthesizing candidate fact proposals from canonical memory
3. drafting coherent structured profile revisions from teacher-selected approved facts

Do not use LLMs as the final authority for:

1. deciding which facts become profile truth without teacher review
2. silently promoting inferred facts into the foundational profile
3. broad autonomous rewriting of unrelated profile sections

Version-1 balance:

1. deterministic or rule-based selection and eligibility
2. constrained LLM-assisted drafting where structured fidelity matters and readable rendered output
   still matters
3. teacher approval at the final authority boundary

## Drift-Control Rules

To keep enrichment systematic rather than arbitrary, version 1 should follow these controls:

1. candidate generation must use deterministic source inputs and explicit category rules
2. profile-worthiness must be evaluated against fixed eligibility rules, not free-form prose
   judgment
3. review actions must preserve original proposed text and supporting evidence
4. promotion must operate on teacher-selected approved facts, not an implicit “everything approved”
   default
5. rejected facts may only re-enter review when they have materially stronger evidence than the
   rejected version
6. LLM drafting must be constrained to the selected approved facts, current active profile, and
   explicit section targets rather than unconstrained profile rewriting

## Suggested Phases

### Phase 1: Candidate Fact Pipeline

1. derive candidate profile facts from lesson-memory entries and latest student-memory snapshot
2. persist candidate facts for review
3. expose authenticated read-only APIs for pending and historical candidate facts

### Phase 2: Teacher Review Workflow

1. add review UI inside the student workspace
2. approve / reject / defer candidate facts
3. show evidence and source provenance

### Phase 3: Profile Revision Promotion

1. build a draft profile revision from approved candidates plus current active profile
2. let the teacher inspect and activate it
3. preserve diff/revision history

### Phase 4: Starter Profile UX

1. replace the current bare student create flow with a compact starter profile form
2. create both student row and initial profile revision in one guided flow
3. keep manual advanced editing available

### Phase 5: Live Transition and Operator Adoption

1. support mixed-state live operation while legacy overloaded profiles still exist
2. provide one-student-at-a-time normalization of legacy profiles into the new profile-plus-memory
   model
3. document the operator workflow for safe adoption on real students

## Phase Index

1. [`phase-1-candidate-fact-pipeline.md`](phase-1-candidate-fact-pipeline.md)
2. [`phase-2-teacher-review-workflow.md`](phase-2-teacher-review-workflow.md)
3. [`phase-3-profile-revision-promotion.md`](phase-3-profile-revision-promotion.md)
4. [`phase-4-starter-profile-ux.md`](phase-4-starter-profile-ux.md)
5. [`phase-5-live-transition-and-operator-adoption.md`](phase-5-live-transition-and-operator-adoption.md)
6. [`verification-acceptance-and-assumptions.md`](verification-acceptance-and-assumptions.md)

## Epilogue Boundary

Phase 5 is an adoption epilogue, not a new permanent architecture layer.

Its purpose is to help live students move safely from the old overloaded profile style into the new
system where:

1. foundational profile holds durable teacher-approved truth
2. generated memory holds tactical and longitudinal continuity
3. candidate facts provide the controlled bridge between them

Temporary migration helpers are acceptable in this phase as long as they do not become hidden
runtime authority.

## Implementation Style Guidance

This workstream intentionally uses different quality bars for backend and frontend.

### Backend

Backend contracts should be treated as durable product infrastructure:

1. canonical data model first
2. strong provenance and revision semantics
3. replayable and inspectable workflows
4. no temporary architecture that assumes a rewrite later

Refactors are allowed. Backend rewrite assumptions are not.

### Frontend

The current student workspace may remain intentionally draft-grade while this workflow is being
proven.

Frontend expectations for this plan:

1. complete functionality matters more than polished interaction design
2. utilitarian placement inside the current workspace is acceptable
3. visual elegance and long-term information architecture are not blockers
4. end-to-end operability matters more than UI finish

This plan should optimize for backend correctness and product learning, not frontend permanence.

## Acceptance Criteria

1. A teacher can create a student with a minimal starter profile.
2. After lessons accumulate, the system can propose durable profile facts with evidence.
3. No generated fact changes the foundational profile until a teacher approves it.
4. Promotion produces a normal profile revision with lineage preserved after teacher approval.
5. Prompt packages remain reproducible: they still point to the exact profile revision and memory
   state used at generation time.
6. Rejected facts never appear in the foundational profile unless later re-proposed and approved.

## Phase Construction Rule

This workstream does not require each intermediate phase to remain independently usable while the
system is under active construction.

Allowed during implementation:

1. temporary non-working or partially wired intermediate states between phases
2. moving an acceptance obligation from an earlier phase to a later phase when the earlier phase
   does not yet have the lifecycle state required to satisfy it
3. tightening cross-phase contracts so the completed system is internally coherent

The hard requirement is coherence and usability once the intended phase set is complete.

## Related

- [`docs/plans/student-memory-system-upgrade/README.md`](../student-memory-system-upgrade/README.md)
- [`docs/reference/STUDENT_SYSTEM_ROADMAP.md`](../../reference/STUDENT_SYSTEM_ROADMAP.md)
- [`docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`](../../reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md)
- [`docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`](../../reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md)
