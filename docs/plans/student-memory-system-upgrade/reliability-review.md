# Student Memory Reliability Review

## Meta

- Audience: founder-maintainer, implementation agents, reviewers.
- Authority Level: planning note.
- Last Verified Against: 2026-07-06 discussion and repo docs.
- Owner: founder-maintainer + automation agents.
- Review Cadence: before student-memory reliability implementation chunks.
- Status: `draft`.
- Exit Trigger: fold completed items into the student-memory roadmap after the Gate C reliability PR lands.
- Current Focus: Gate C reliability review, implemented fixes, and post-Gate-C deferrals.

## Purpose

Capture the current reliability concerns around the student-memory system before mapping work across
the release schedule. The goal is not to add a new subsystem by default. The goal is to decide where
small, test-backed, observable changes can increase trust in a system that already has many moving
parts.

## Reliability Thesis

The student-memory system can produce satisfactory-looking results while still being hard to trust.
The highest-risk failures are not only hard errors. They include partial work, stale inputs,
misunderstood source caps, silent fallback paths, low-value but valid LLM output, and subtle fact
drift across profile draft refreshes.

Reliability work should make the system easier to audit before making it smarter.

## Reliability Layers

### 1. Lifecycle Correctness

The system should prove that each required step happened with the intended inputs and durable state:

```text
lesson/homework evidence
-> lesson and homework memory entries
-> student-memory snapshot refresh
-> candidate or profile decisions
-> prompt package and Learning page visibility
```

Important questions:

1. Did the trigger source get recorded and used?
2. Are selected, included, covered, ready, and eligible sources distinguishable?
3. Are stale, superseded, failed, or wrong-student rows excluded at each boundary?
4. Did candidate refresh run or skip for an explicit recorded reason?
5. Did prompt packaging actually receive the intended memory context?
6. Can an operator explain the latest memory state from app-visible or endpoint-visible evidence?

### 2. Pedagogical Usefulness

Valid structured output is not enough. Memory should improve teaching decisions.

High-value memory should preserve:

1. recurring mistakes and grammar issues,
2. recent progress,
3. active review backlog,
4. useful assignment directions,
5. homework continuity and avoided repetition,
6. learner-specific constraints and preferences,
7. source-backed personal facts.

Low-value but technically valid output often looks like:

1. vague "practice grammar and vocabulary" guidance when concrete evidence exists,
2. summaries that omit active review loops,
3. isolated trivia promoted into durable context,
4. stale issues kept alive after newer evidence contradicts them,
5. fluent prose that is hard to trace back to source evidence.

### 3. Profile Fact Fidelity

Profile draft refresh is a special risk. A model can produce valid JSON and acceptable prose while
slightly warping facts. Repeated small rewrites can create a "broken telephone" effect.

Examples of risky drift:

1. "Prefers doing homework the night before lessons" becomes "often procrastinates."
2. "Struggles with articles in spontaneous speech" becomes "does not understand articles."
3. "Likes travel roleplays" becomes "wants travel-focused lessons."
4. "Said she might visit Japan" becomes "plans to visit Japan."

Profile updates should eventually distinguish:

1. `new fact`,
2. `refined wording`,
3. `contradicted fact`,
4. `unchanged`.

Until that contract exists, profile draft changes should be easy for the tutor/operator to inspect
before approval.

## Candidate Workstreams

### A. Brittle-Parts Review

Do a read-only code review of student-memory reliability before implementation.

Review axes:

1. source selection and coverage,
2. lifecycle and state transitions,
3. silent fallback and null-return paths,
4. worker, retry, and idempotency behavior,
5. frontend observability truthfulness,
6. test realism gaps.

Output should be findings-first and should separate confirmed bugs, misleading observability,
missing tests, and watch-list risks.

### B. Lifecycle Integration Test

Add one deterministic backend-first lifecycle test using fake generation providers.

The test should cover the path from lesson/homework evidence through memory entries, snapshot
refresh, candidate/profile decisions, health payload, and prompt packaging or Learning surface
visibility.

The value is the flight recorder, not just final existence checks. Assertions should include source
IDs, coverage metadata, candidate-refresh decisions, fallback/drop decisions, and the memory context
that reaches prompt packaging.

### C. Pedagogical Fixture Harness

Create a small fixture set of synthetic teaching histories with known pedagogical expectations.

Prefer rubric assertions over exact prose. Example checks:

1. recurring issue is preserved,
2. new strong evidence affects the snapshot or candidate decision,
3. one-off trivia is not promoted,
4. assignment direction is specific when concrete evidence exists,
5. personal facts remain evidence-backed,
6. stale issues are not kept alive after contradiction.

This can start deterministic with fake outputs and later become a live-model evaluation layer when
the release process needs provider-quality evidence.

### D. Profile Draft Diff View

Improve profile draft observability by showing what a profile draft refresh changed.

Lowest-complexity version:

1. compare active profile vs proposed draft,
2. show section-by-section additions, removals, and changed fields or lines,
3. keep it deterministic and mostly client-side at first,
4. do not require a new LLM classification contract in the first pass.

Later version:

1. add a structured change ledger,
2. classify changes as `new fact`, `refined wording`, `contradicted fact`, or `unchanged`,
3. require changed durable facts to cite memory/source evidence,
4. treat contradictions as review items, not silent replacements.

### E. Support-Copy Clarification

Clarify operator-facing copy where technically correct counts can be misread.

Example: "Included sources" in snapshot support details means sources included in the latest
snapshot refresh prompt, not all eligible or all ready student evidence. If this remains confusing,
rename the label to something like "Included in latest refresh" and keep "Covered sources" and
"Memory entries" distinct.

## Complexity Guardrails

1. Prefer test-backed invariants over new runtime pathways.
2. Prefer clearer existing observability surfaces over new dashboards.
3. Prefer deterministic diffing before asking another model to classify changes.
4. Preserve backend ownership of memory selection and packaging.
5. Do not auto-mutate foundational profile facts from inferred lesson or homework memory.
6. Add complexity only when it buys a specific trust or review capability.

## Release-Mapping Inputs

When mapping this into release work, consider these slices:

1. Review-only: brittle-parts reliability review.
2. Test backbone: lifecycle integration test and source-count regression coverage.
3. Tutor trust: profile draft diff view.
4. Quality evidence: pedagogical fixture harness.
5. Later contract work: structured profile-change classification ledger.

The first concrete action should be chosen by release risk, not by architectural neatness.

## Release Schedule Map

### Now: Gate C Preparation

Purpose: reduce founder/operator uncertainty before relying on memory behavior with the real
Closed Alpha cohort of 3-5 tutors.

Do now:

1. Run the brittle-parts review as a read-only code review.
2. Close the source-count concern with a targeted fixture/test and, if needed, support-copy
   clarification.
3. Treat candidate-promotion lifecycle correctness as a near-term trust fix because promoted facts
   that remain `approved` make review queues misleading.
4. Design the lifecycle integration test after the review identifies the smallest useful seam.
5. Add the profile draft diff view if profile draft refresh will be used during Closed Alpha tutor
   sessions.
6. Add the first small pedagogical fixture harness only if lifecycle trust is already covered or the
   brittle-parts review shows low-value-but-valid output is the highest remaining Gate C risk.

Do not do now:

1. Add a new memory dashboard.
2. Add model-generated profile-change classification.
3. Add semantic retrieval, embeddings, or memory editing UX.
4. Add tutor-facing rebuild controls.
5. Add any work mapped to after the Closed Alpha gate.

### Gate B: Pre-Alpha, 1 Tutor

Purpose: prove the one-tutor loop can be trusted with bounded support.

Required reliability evidence before considering this stable:

1. The system can explain `included`, `covered`, `ready`, and `eligible` memory sources for a real
   or fixture-backed student.
2. Snapshot refresh decisions record trigger source, parent snapshot, source coverage, budget
   decision, and candidate-refresh decision.
3. A deterministic lifecycle test proves that selected memory reaches the prompt package or Learning
   surface that the tutor actually uses.
4. Profile draft refresh remains review-mediated and does not silently mutate the active
   foundational profile.

Mapped work:

| Work item                                          | Release priority | Why here                                                              |
| -------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| Brittle-parts review                               | P1               | Finds trust gaps before adding more mechanisms.                       |
| Source-count verification and support-copy clarity | P2               | Resolves an observed confusion without changing policy prematurely.   |
| Lifecycle integration test                         | P1               | Gives a flight recorder for the memory path before broader tutor use. |
| Candidate-promotion lifecycle fix                  | P1               | Prevents misleading review state around promoted memory facts.        |

### Gate C: Closed Alpha, 3-5 Tutors

Purpose: make supervised multi-tutor use supportable without inspecting raw logs or manually
diffing profile drafts.

Gate C preparation work:

1. Add a deterministic profile draft diff view between active profile and proposed draft.
2. Add the first small pedagogical fixture harness with rubric-style assertions.
3. Feed memory-specific observations into the weekly readiness loop: support burden, confusing memory
   states, profile-draft drift, and low-value assignment context.

Mapped work:

| Work item                     | Release priority                                                | Why here                                                                            |
| ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Profile draft diff view       | P1 if draft refresh is used during tutor sessions; otherwise P2 | Directly reduces the "broken telephone" risk and manual comparison burden.          |
| Pedagogical fixture harness   | P2                                                              | Starts quality evidence without turning subjective pedagogy into a large subsystem. |
| Health/support details polish | Evidence-led P2                                                 | Improve only the confusing parts seen during support sessions.                      |

Gate C boundary:

1. Work required to support 3-5 supervised alpha tutors is in scope now.
2. Work that assumes the cohort is already stable belongs after Gate C and is deferred.
3. If an item does not reduce Closed Alpha support risk or tutor trust directly, defer it.

### Closed Alpha Follow-Up

Purpose: add stronger contracts only after tutor/operator evidence shows that lightweight
observability is insufficient.

Status: deferred until after Gate C unless a blocking Closed Alpha incident proves otherwise.

Potential work:

1. Structured profile-change ledger with `new fact`, `refined wording`, `contradicted fact`, and
   `unchanged`.
2. Evidence requirements for changed durable profile facts.
3. Snapshot or profile diff history if support sessions repeatedly need it.
4. Exact DB count helpers if capped health counts are insufficient.
5. Guarded operator rebuild action no earlier than Gate C and only behind an explicit support need.

### Closed Beta Or Later

Purpose: improve quality and scale after the basic trust loop is proven.

Status: deferred.

Defer until here unless evidence forces earlier action:

1. Live-model pedagogy evals as a release gate.
2. Semantic retrieval or embeddings.
3. Public explainability or tutor-facing memory editing UX.
4. Data lifecycle workflows beyond the current private alpha need.

## Proposed Action Queue

1. Run a brittle-parts review and record findings against this map.
2. Convert valid findings into at most two immediate chunks:
   - a Gate C lifecycle/observability test chunk,
   - a Gate C tutor-trust profile-diff chunk if profile draft comparison is already painful.
3. Keep source-count verification small and fold it into the lifecycle/observability chunk if the
   same fixture can cover both.
4. Defer structured change classification until the diff view or review evidence proves the simpler
   approach is not enough.
5. Defer all Closed Alpha follow-up and Closed Beta work until the 3-5 tutor alpha gate is actually
   stable.

## 2026-07-06 Gate C Reliability Pass

Findings-first review outcome:

1. Confirmed bug - prompt-package memory packaging treated repository failures as missing memory.
   `buildStudentMemoryPackageContext` caught snapshot, lesson-memory, and homework-memory lookup
   errors and returned the same empty blocks used for a legitimately empty student. That made an
   assignment prompt package look normal while its memory layer was unknown.
2. Confirmed Gate C trust gap - profile draft refresh already produced review-mediated draft
   revisions, but the Learning page did not show what changed from the active profile when a draft
   was generated from approved candidates. Operators had to manually compare the editor against the
   prior active revision, which is exactly the profile-fact drift risk called out above.
3. Reviewed and not changed - candidate promotion lifecycle already has an explicit promoted state
   through linked draft revisions and activation-time promotion. Approved candidates remaining
   approved while a draft is still unactivated is current product behavior, not a bug fixed in this
   pass.
4. Watch-list risk - the full deterministic lifecycle integration test remains valuable, but the
   smallest Gate C fixes above reduced immediate support risk without adding a new subsystem.

Implemented Gate C fixes:

1. Prompt-package memory retrieval now distinguishes unavailable canonical memory from absent
   memory. When a lookup fails, the prompt package receives an explicit unavailable block and keeps
   the `student-memory-v1` retrieval policy marker so `GET /prompt-packages/:id` evidence is
   inspectable.
2. The Learning page now shows a deterministic `Profile Draft Changes` panel after approved
   candidates generate a draft revision. The first pass compares existing structured profile fields
   against the proposed draft and labels additions, removals, and changes without model-generated
   classification.

Deferred after this pass:

1. Full lifecycle integration flight-recorder test from memory artifacts through prompt packaging.
2. Pedagogical fixture harness for low-value-but-valid output.
3. Structured profile-change ledger with `new fact`, `refined wording`, `contradicted fact`, and
   `unchanged` classifications.
4. Exact DB count helpers, snapshot/profile diff history, and guarded operator rebuild actions
   unless Closed Alpha evidence shows they are needed.

## 2026-07-06 Candidate Draft Activation Incident

Manual smoke after the Gate C reliability deployment found a draft-lineage gap:

1. A tutor approved profile candidates and generated a full profile draft from them.
2. The tutor manually corrected unrelated generated changes, which saved a new draft revision.
3. Activating the manually edited draft did not promote the approved candidates because the
   candidate-to-draft links remained attached to the generated draft revision, while activation
   promotes candidates linked to the exact activated revision.

Root cause:

- `Save Draft` created a new `update` draft revision without preserving candidate-link lineage from
  the generated draft being edited.
- `activateProfileRevisionForProfile` correctly promoted linked candidates for the activated
  revision, but the edited revision had no links.

Implemented fix direction:

1. Draft saves can carry `inheritCandidateLinksFromRevisionId`.
2. The backend validates that source revision belongs to the same profile and copies candidate draft
   links to the saved draft revision.
3. The Learning page passes the current draft revision id when saving manual edits, so candidate
   links survive the generated-draft -> tutor-edited-draft -> activation path.

Remaining edge case:

- The fix preserves tutor-approved draft lineage. It does not attempt semantic proof that every
  candidate fact still appears after manual edits. If tutors begin removing selected candidate facts
  inside draft edits, add explicit candidate inclusion controls or a structured change ledger rather
  than brittle exact-string matching.
