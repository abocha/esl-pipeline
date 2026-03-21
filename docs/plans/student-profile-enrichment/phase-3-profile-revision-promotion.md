# Phase 3: Profile Revision Promotion

## Summary

Turn approved candidate facts into a normal foundational profile revision workflow:

1. assemble a draft profile revision from approved facts plus the current active profile
2. let the teacher inspect the proposed revision
3. activate the revision through the existing profile lifecycle

This is the phase that converts reviewed enrichment into live prompt-generation truth.

## Locked Decisions

1. Promotion must produce a normal profile revision, not mutate the active revision in place.
2. The teacher must be able to inspect the draft before activation.
3. Approved candidate facts affect homework generation only after activation of the promoted
   revision.
4. Existing profile revision history, drift, and binding semantics remain canonical.
5. The system should preserve both the original approved fact set and the generated draft revision
   provenance.
6. Promotion should operate on a teacher-selected subset by default, with a convenience action to
   select all currently approved facts.

## Why This Phase Is Separate

Approval and promotion are different product responsibilities:

1. review says which facts are trustworthy enough
2. promotion says how those facts become coherent profile prose

Keeping them separate protects revision quality and keeps the backend architecture explainable.

## Draft Revision Model

Promotion should create a draft profile revision derived from:

1. the current active profile revision
2. the approved candidate set selected for promotion
3. bounded drafting rules and merge constraints

The resulting revision should be:

1. inspectable
2. diffable against the current active revision
3. activatable through normal profile lifecycle controls

## Merge Strategy

Version 1 should use a constrained LLM-assisted drafting strategy rather than either:

1. fully autonomous free-form rewriting
2. bland deterministic string stitching that reduces the profile to tagged fragments

Recommended approach:

1. treat the current active profile as the canonical base
2. pass only teacher-selected approved facts into the drafting step
3. constrain drafting to explicit target sections and explicit rewrite rules
4. preserve unrelated profile wording whenever possible
5. allow prose smoothing and coherence improvements where needed
6. avoid broad stylistic rewrites that make diffs harder to trust

This phase should optimize for teacher trust, diff readability, and genuinely good profile prose.

## Drafting Rules

The draft-generation step should be smart, but bounded.

Required drafting inputs:

1. current active profile revision content
2. selected approved candidate facts
3. target sections for each candidate
4. explicit instructions about what must remain unchanged unless a selected fact requires an update

Required drafting behavior:

1. integrate approved facts into coherent prose
2. deduplicate overlapping statements
3. preserve the profile's useful structure and tone where possible
4. avoid rephrasing unrelated sections just for style
5. avoid inventing new durable facts beyond the approved candidate set

Prohibited drafting behavior:

1. promoting non-selected candidates
2. rewriting the whole profile from scratch
3. introducing unsupported “helpful” profile facts
4. deleting unrelated stable profile content without a selected-fact reason

## Promotion Surface

Suggested backend operations:

1. `POST /students/:id/profile-candidates/promote`
2. inputs:
   - selected approved candidate ids
   - optional base profile revision id override
   - optional reviewer note
3. outputs:
   - created draft profile revision id
   - included candidate ids
   - excluded candidate ids
   - content hash

Suggested follow-on existing operations:

1. inspect the generated draft revision through current profile revision routes
2. activate it through current activation routes

Suggested backend implementation shape:

1. deterministic selection and constraint building
2. one bounded LLM drafting call to produce the candidate revision prose
3. normal profile revision persistence and activation lifecycle

## Candidate Lifecycle After Promotion

Once promotion succeeds:

1. included approved candidates should be marked as consumed or promoted
2. later promotion passes should not keep reusing the same candidates unless explicitly requested
3. rejected candidates remain rejected
4. pending candidates remain pending

Suggested terminal or derived statuses after this phase:

1. `pending_review`
2. `approved`
3. `rejected`
4. `promoted`
5. `superseded`

Selection rule:

1. the default promotion path should require an explicit candidate selection
2. the frontend may offer “select all approved” as a convenience wrapper around explicit selection
3. the backend should not treat “all approved” as an invisible implicit default

## Frontend Direction

The student workspace should add a plain but complete promotion flow:

1. show approved candidates ready for promotion
2. generate draft revision
3. preview draft content and diff
4. activate or leave as draft

Usability bar for this phase:

1. clear enough for a teacher to trust the outcome
2. no special visual polish required
3. evidence and candidate provenance should remain one click away

## Runtime Contract

Live prompt generation must continue to use:

1. the active foundational profile revision
2. canonical student memory
3. current teacher notes and transcript

Promotion draft revisions do not affect runtime until activated.

## Acceptance Criteria

1. A teacher can generate a draft profile revision from approved candidate facts.
2. The draft is stored as a normal profile revision with lineage preserved.
3. The teacher can inspect and activate the draft using the existing revision lifecycle.
4. Prompt packages created before activation keep pointing at the old active profile revision.
5. Prompt packages created after activation resolve to the new active profile revision.
6. Promotion provenance records exactly which approved candidates were selected.
7. The generated draft does not rewrite unrelated profile sections beyond bounded coherence edits.

## Validation

1. `pnpm --filter @esl-pipeline/batch-backend typecheck`
2. targeted backend tests for promotion and revision lineage
3. `pnpm --filter @esl-pipeline/batch-frontend test`
4. `pnpm docs:generate:indexes`
5. `pnpm docs:check`
