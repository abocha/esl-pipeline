# Phase 3: Profile Generation, Migration, And Prompt Packaging

## Summary

This phase translates the product decisions from Phase 2 into the future system behavior for:

1. profile generation and drafting
2. one-off migration from markdown profiles
3. prompt packaging and runtime rendering

The main shift is simple:

1. profiles stop being authored as markdown
2. profiles become structured canonical revisions
3. markdown-like rendered text becomes a runtime presentation artifact rather than the source of
   truth

## Locked Decisions

1. Canonical profile revisions store structured profile data, not freeform markdown.
2. Prompt packaging deterministically renders structured profile data into the
   `[FOUNDATIONAL_PROFILE]` block.
3. Profile drafting for canonical writes should use structured outputs, not plain-text generation.
4. Teacher-authored edits always remain valid regardless of whether a structured draft was generated
   by the model.
5. The repo should support a one-off migration for the existing small set of markdown profiles.
6. Migration should preserve recoverability; no legacy profile content should disappear without a
   fallback trail.

## Structured Revision Contract

The future profile revision should be thought of as:

1. structured content
2. revision metadata
3. activation status
4. provenance

The structured content shape is the profile defined in Phase 2:

1. `overallLevel`
2. `primaryGoals`
3. `communicationContexts`
4. `interestsAndUsefulThemes`
5. `stableStrengths`
6. `persistentChallenges`
7. `studyPreferences`
8. `durableConstraints`
9. `teacherNotes`

Revision metadata and provenance continue to matter, but they are not part of the teacher-facing
form.

## LLM Usage Model

The profile system should use LLMs only for bounded drafting jobs that benefit from synthesis.

### Allowed Structured-Output Uses

1. draft a first structured profile from lesson evidence
2. draft a refreshed structured profile from approved candidate facts
3. help normalize legacy overloaded profiles into the new shape during transition

### Disallowed Uses

1. silently mutating the active profile
2. deciding final truth without teacher review
3. generating open-ended freeform profile prose as the canonical stored format

### Output Style

For canonical profile writes, the LLM should return schema-shaped data aligned to the structured
profile contract. Prose quality may still matter later when the profile is rendered into prompt
text, but the authoritative write path should be machine-shaped first.

This mirrors the repo's existing structured-output philosophy for student-memory artifacts.

## Draft Generation Entry Points

### 1. Populate First Profile From Lesson

Input sources:

1. latest transcript
2. current lesson memory when available
3. latest student-memory snapshot when available
4. minimal teacher notes if available

Output:

1. a structured draft revision

Guardrails:

1. never auto-activate
2. favor omission over invention
3. uncertain or weak facts should stay out of the foundational profile

### 2. Refresh Draft From Approved Candidates

Input sources:

1. existing active or working draft profile
2. selected approved candidate facts
3. reviewer note when supplied

Output:

1. a refreshed structured draft revision

Guardrails:

1. only selected approved facts may be newly introduced
2. unrelated sections should remain stable
3. teacher edits should not be thrown away casually

## One-Off Migration From Existing Markdown Profiles

The existing markdown profiles should be migrated with a one-off workflow.

### Migration Goal

1. move the existing small profile set into the structured canonical shape without losing useful
   information

### Migration Principles

1. preserve the original legacy text for recovery or comparison
2. map clear durable content into the structured fields
3. route ambiguous leftovers into `teacherNotes` instead of discarding them
4. require human spot-checking rather than pretending migration is perfectly lossless

### Recommended Migration Flow

1. enumerate current active markdown profiles
2. create a migration artifact for each profile that captures:
   - original markdown content
   - proposed structured mapping
   - any ambiguous leftovers
3. write new structured revisions
4. preserve a link to the legacy source content for recovery and audit
5. spot-check each migrated profile in the `Learning` page before considering the migration closed

### Migration Acceptance Standard

The migration is good enough when:

1. no durable learner truth is lost
2. no clearly business or tactical noise is carried into the structured profile just because it
   existed in the markdown
3. the resulting structured profile is easier to edit than the original markdown

## Prompt Packaging Contract

Prompt packaging should continue to behave deterministically.

### New Rule

`[FOUNDATIONAL_PROFILE]` is rendered from the active structured profile revision.

That renderer should:

1. keep a stable section order
2. omit empty sections cleanly
3. render compact readable headings and bullet lists
4. avoid leaking billing, scheduling, or recent tactical continuity into the foundational profile
   block

### Why Rendering Matters

The runtime model still benefits from text-first packaged context, but the system no longer needs
teacher-authored markdown to get there.

This also unlocks:

1. stable UI previews
2. clean minimal-flow summaries
3. easier profile drift checks
4. future alternate renderers without changing the canonical data

## Shared Rendering Surfaces

The same structured profile should support several read surfaces:

1. prompt-package foundational profile block
2. minimal assignment flow profile preview
3. overview summary cards
4. learning-page preview or revision summaries

These surfaces may render different levels of detail, but they should all read from the same
structured truth.

## Manual Editing Principle

The structured profile must never become harder to edit than markdown was.

Success looks like:

1. the teacher sees clearer fields
2. the teacher fixes mistakes faster
3. generated drafts become easier to audit
4. future prompts become more stable because the stored structure is cleaner

## Follow-On Compatibility Note

The current backend and frontend will likely need a transition period where legacy markdown-backed
revisions and structured revisions both exist in migration tooling or history.

That is acceptable as a temporary implementation concern, but the product direction is fixed:

1. structured profile is canonical
2. rendered text is derived
3. markdown is no longer the product-facing authoring format
