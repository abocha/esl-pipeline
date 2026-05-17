# Verification, Acceptance, and Assumptions

## Summary

This doc defines what evidence is required to call the student-profile enrichment workstream
implemented rather than merely drafted.

The phases define the intended product shape. This doc defines how we verify:

1. backend correctness
2. review and revision trust
3. runtime isolation from unapproved facts
4. pragmatic but complete frontend operability

## Locked Decisions

1. Backend correctness and provenance are the hard acceptance bar.
2. Frontend acceptance is workflow completeness, not polished release-grade design.
3. Pending or rejected profile candidates must never leak into live prompt packages.
4. Approved candidates affect runtime only through activated foundational profile revisions.
5. Acceptance is cumulative across all enrichment phases.
6. Drift control is part of acceptance, not a nice-to-have after implementation.
7. Promotion should use constrained LLM drafting for profile prose quality, not purely mechanical
   text stitching.

## Verification Layers

The workstream should be verified in these layers:

1. candidate persistence and retrieval
2. review mutations and audit trail
3. promotion into normal profile revisions
4. starter profile creation flow
5. prompt-package lineage and runtime isolation
6. frontend workspace operability
7. repo-wide docs and checks

## Verification Matrix

### 1. Candidate Pipeline

Required verification:

1. candidate facts can be generated from canonical memory
2. candidate facts are stored separately from foundational profile revisions
3. dedupe and supersession rules behave deterministically
4. candidate evidence remains queryable
5. repeatability rules are enforced for profile-worthy strengths
6. candidate identity and provenance are sufficient for later rejection-aware re-proposal checks

Acceptance evidence:

1. repository and application tests cover candidate writes and reads
2. tests prove candidate generation does not mutate active profile content
3. read-only inspection API tests pass

### 2. Review Workflow

Required verification:

1. teachers can approve, edit-and-approve, reject, and defer
2. every review action captures actor and timestamp metadata
3. original proposed text and evidence remain inspectable after review
4. deferred items are distinguishable from never-reviewed pending items

Acceptance evidence:

1. backend tests cover review state transitions
2. workspace tests cover visible pending and reviewed states
3. mutation tests prove review does not activate a profile revision yet
4. tests cover the secondary review-state/filter contract for deferred items

### 3. Promotion Workflow

Required verification:

1. approved candidates can produce a draft profile revision
2. the resulting revision uses the existing revision system
3. activation changes future prompt-package profile resolution
4. pre-activation prompt packages remain reproducible against the older revision
5. selected-candidate provenance is preserved
6. the drafting step remains bounded to selected approved facts and allowed profile sections

Acceptance evidence:

1. backend tests cover promotion output and revision lineage
2. prompt-package lineage tests prove exact revision tracking before and after activation
3. workspace tests cover draft generation and activation visibility
4. tests or fixtures demonstrate that unrelated profile sections are preserved except for bounded
   coherence edits

### 4. Starter Profile UX

Required verification:

1. teacher can create a student with starter profile fields
2. the flow produces a student row, profile revision, and active binding
3. the created student is immediately usable in prompt-package generation
4. CEFR level may be absent without blocking student creation

Acceptance evidence:

1. backend tests cover bundled create flow
2. workspace tests cover starter profile submission
3. prompt generation smoke path works for a newly created student

### 5. Runtime Isolation

Required verification:

1. pending candidates do not affect live prompt packages
2. rejected candidates do not affect live prompt packages
3. approved-but-not-promoted candidates do not affect live prompt packages
4. only activated profile revisions change runtime profile context

Acceptance evidence:

1. prompt-package tests explicitly cover each candidate state
2. lineage tests prove the resolved profile revision is still the single runtime authority
3. tests prove selected promotion provenance rather than implicit bulk promotion

### 6. Frontend Operability

Required verification:

1. candidate inspection is usable in the current workspace
2. review actions are understandable and complete
3. promotion flow is inspectable
4. starter profile flow is usable without separate tooling

Acceptance evidence:

1. workspace tests cover the main happy paths
2. sampled manual verification confirms end-to-end operability
3. no release-grade visual polish is required for acceptance

### 7. Live Transition and Operator Adoption

Required verification:

1. non-migrated legacy-profile students can continue operating during the transition window
2. one student can be normalized from a legacy overloaded profile into a draft revision
3. mixed-state operation remains safe while some students are migrated and others are not
4. activation and rollback of the normalized revision remain possible through the normal revision
   lifecycle

Acceptance evidence:

1. sampled manual migration of at least one live student is documented
2. prompt-package lineage is inspected before and after migration
3. the operator runbook is sufficient to repeat the workflow on another student

## Repo-Wide Checks

Required checks:

1. `pnpm --filter @esl-pipeline/batch-backend typecheck`
2. `pnpm --filter @esl-pipeline/batch-frontend test`
3. targeted backend repository/application tests for each phase
4. `pnpm docs:generate:indexes`
5. `pnpm docs:check`
6. `pnpm check:fast`

## Assumptions

1. The current student workspace remains the temporary operational home for this feature set.
2. A future frontend rewrite may replace this UI, but the backend contracts designed here should be
   durable.
3. Candidate generation should remain downstream of canonical student memory rather than creating a
   parallel fact-extraction architecture.
4. Profile enrichment is intended to improve profile quality over time, not replace existing memory
   retrieval.
5. Good profile prose is a product requirement, so LLM-assisted drafting is desirable as long as it
   remains constrained by explicit backend-owned selection and authority rules.

## Related

- [`README.md`](README.md)
- [`phase-1-candidate-fact-pipeline.md`](phase-1-candidate-fact-pipeline.md)
- [`phase-2-teacher-review-workflow.md`](phase-2-teacher-review-workflow.md)
- [`phase-3-profile-revision-promotion.md`](phase-3-profile-revision-promotion.md)
- [`phase-4-starter-profile-ux.md`](phase-4-starter-profile-ux.md)
