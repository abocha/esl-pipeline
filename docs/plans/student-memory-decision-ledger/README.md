# Student Memory Decision Ledger and Outcome Memory

## Meta

- Audience: founder-maintainer, future student-memory implementers, product designers, AI agents.
- Read Time: 18 minutes.
- Authority Level: deferred future architecture and decision record.
- Last Verified Against: 2026-07-10 repo state.
- Owner: founder-maintainer + backend/frontend maintainers.
- Review Cadence: after Closed Alpha evidence, then before any implementation proposal.
- Status: `backlog`.
- Exit Trigger: promote the validated parts into canonical reference docs when implementation begins; archive this plan after the shipped architecture is represented in SSOT, schemas, runtime docs, and product behavior.
- Current Focus: preserve reasoning and boundaries only. Do not implement before the MVP release and supervised alpha evidence establish a concrete need.

## Executive Summary

The current student-memory architecture is structurally sound and should be preserved.

It already has the correct major layers:

1. teacher-authored foundational profile,
2. canonical lesson memory,
3. canonical homework memory,
4. derived long-term student-memory snapshot,
5. deterministic bounded prompt packaging,
6. one stateless assignment-generation call.

The next major capability should not be a memory rewrite. It should be an additive decision layer between memory retrieval and assignment generation:

```text
canonical evidence
-> episode memories
-> current student-memory snapshot
-> assignment decision ledger
-> generated assignment
-> learner outcome evidence
```

The assignment decision ledger should record which learning targets were considered, which were selected, why they were selected, which evidence supports them, and how strongly the assignment should intervene.

A later learner-outcome layer should record what happened after an assignment was given. This is genuinely new evidence. Current homework memory records what was assigned, but not whether the learner completed it, struggled with it, used hints, improved, or continued making the same error afterward.

Together, these additions can support:

- source-backed tutor explanations,
- student-facing `Why am I seeing this again?` explanations,
- more reliable review selection,
- calibrated intervention size,
- correction controls and feedback,
- later analysis of whether an intervention helped.

This work is deliberately deferred until after release. The current risk is not missing architecture. The current risk is delaying real tutor use by building a sophisticated future layer before the existing loop has produced enough evidence to justify its exact contract.

## Decision Status

### Preserve now

Keep the current memory architecture and runtime ownership model.

### Add later

Introduce a separate assignment decision ledger, stable learning-target identities, source-addressable conclusions, and learner outcome memory.

### Explicitly defer

Do not redesign retrieval, add embeddings, expose public memory editing, or restructure the canonical memory tables before post-release evidence shows that the simpler architecture is insufficient.

## Current Architecture Baseline

The current system already separates durable truth, episode evidence, compressed state, and runtime packaging.

### 1. Foundational profile

Teacher-authored, versioned, slow-changing, and highest-authority.

It should continue to contain confirmed durable context such as:

- level and long-term goals,
- communication contexts,
- stable strengths,
- persistent challenges,
- study preferences,
- durable constraints,
- teacher-authored pedagogical context.

Inferred lesson or homework facts must not silently mutate this profile.

### 2. Lesson memory

One canonical structured artifact per transcript.

It already stores rich pedagogical evidence, including:

- mistake patterns,
- observed forms and suggested targets,
- evidence quotes and notes,
- confidence,
- grammar reviewed and watchlists,
- vocabulary and pronunciation focus,
- student facts with authority and evidence,
- progress signals,
- follow-up recommendations.

### 3. Homework memory

One canonical structured artifact per published assignment.

It records what was assigned:

- grammar and vocabulary targets,
- `new`, `review`, or `mixed` target roles,
- review targets,
- task shape,
- pronunciation intervention,
- communicative outcome,
- teacher follow-up cues,
- publication lineage.

It does not currently record learner performance on that assignment.

### 4. Student-memory snapshot

A compact, derived current state over lesson and homework memory.

It includes:

- stable strengths,
- recurring issues,
- active review backlog,
- recent progress,
- personal facts,
- recommended assignment directions,
- unresolved issues.

The snapshot is state, not archive. The database remains the archive.

### 5. Runtime prompt package

The backend deterministically selects and packages:

- foundational profile,
- latest student-memory snapshot,
- bounded recent lesson memory,
- bounded recent homework memory,
- unresolved issues,
- teacher notes,
- latest transcript.

The live model does not decide which database records to retrieve.

## Architectural Assessment

### The architecture is not missing a foundation

The current design already has the important reliability properties:

1. canonical database artifacts,
2. versioning and provenance,
3. deterministic backend-owned retrieval,
4. bounded prompt context,
5. stateless provider execution,
6. review-mediated promotion of inferred durable facts,
7. prompt-package lineage.

These are expensive decisions to get right. They should not be casually reopened.

### The current bottleneck is projection, not storage

The lower-level memory records contain more information than the assignment runtime currently exposes.

Lesson memory may contain:

- an exact observed learner form,
- a suggested correction,
- evidence text,
- confidence,
- source identity.

The assignment prompt often receives only a compact label or short summary such as:

```text
Grammar watchlist: articles; prepositions; Past Simple
```

This flattening was a correct v1 tradeoff because it kept prompt size bounded and implementation understandable.

It now creates the next natural seam: the system can know why a target matters without preserving the selection decision as a first-class artifact.

### Current use of memory is real but implicit

The assignment prompt already tells the model to:

- use the latest transcript for immediate lesson evidence,
- use unresolved issues and recent memory for continuity,
- use homework memory to avoid repetition,
- carry forward selected review targets,
- include evidence-backed learner patterns in controlled practice.

The missing part is not memory use. The missing part is an inspectable record of how memory became a particular assignment choice.

## Core Problem

Today the system can answer:

> What does the current memory say about this student?

It cannot always answer with sufficient precision:

> Why did this exact assignment include these exact three review items?

A useful future system should preserve the reasoning chain:

```text
source evidence
-> normalized learning target
-> current learner-state interpretation
-> assignment selection decision
-> intervention size and placement
-> generated task
```

Without this chain, assignment personalization remains partly opaque even when the underlying memory is correct.

## Proposed Future Architecture

### 1. Canonical evidence

Existing lesson transcripts, lesson memories, published assignments, tutor notes, and future learner-attempt events remain source evidence.

No new universal evidence graph is required initially.

### 2. Episode memories

Existing lesson and homework memories remain canonical summaries of individual events.

These should continue to be independently replayable and backfillable.

### 3. Current learning-state snapshot

The existing student-memory snapshot remains the compact current state.

It should not become:

- the complete archive,
- the assignment planner,
- the explanation ledger,
- the learner-attempt store,
- the public feedback system.

Keeping these responsibilities separate prevents the snapshot from becoming a large, unstable object that every downstream feature must reinterpret.

### 4. Assignment decision ledger

Add one canonical planning artifact for each generated assignment or assignment draft lineage.

Its job is to record:

- candidate learning targets considered,
- targets selected,
- selected target roles,
- supporting source references,
- current learner-state interpretation,
- selection rationale,
- intervention dose,
- omitted or deferred targets when useful,
- explanation-safe summaries for tutor or learner surfaces.

This artifact should be created before or alongside assignment generation and persisted with prompt-package lineage.

### 5. Generated assignment

The assignment remains the learner-facing pedagogical object.

The decision ledger should guide it but should not force every internal field into visible homework copy.

### 6. Learner outcome memory

Add canonical outcome events later, after the product has a reliable source of learner interaction data.

Possible sources:

- assignment form submissions,
- answer checking,
- hint or answer reveal events,
- teacher marking,
- voice-note review,
- next-lesson observations,
- tutor-entered completion status.

The first version should be conservative. It should store observed events rather than claim a complete cognitive diagnosis.

## Proposed Assignment Decision Ledger Contract

The exact schema must be designed from post-release evidence. The following shape is illustrative, not locked.

```ts
interface AssignmentDecisionLedger {
  id: string;
  studentId: string;
  assignmentLineageKey: string;
  promptPackageId: string | null;
  schemaVersion: string;
  generatedAt: string;

  candidateTargets: AssignmentTargetDecision[];
  selectedTargets: AssignmentTargetDecision[];
  omittedTargets: AssignmentTargetOmission[];

  primaryTargetKey: string | null;
  decisionSummary: string;
  explanationVersion: string;

  sourceSnapshotId: string | null;
  sourceLessonMemoryIds: string[];
  sourceHomeworkMemoryIds: string[];
  sourceTranscriptId: string | null;

  provider: string | null;
  model: string | null;
  contentHash: string;
}
```

```ts
interface AssignmentTargetDecision {
  targetKey: string;
  displayLabel: string;
  targetType: 'grammar' | 'vocabulary' | 'pronunciation' | 'fluency' | 'communication' | 'other';
  role: 'primary' | 'supporting' | 'review' | 'monitor_only';

  learnerState:
    | 'unknown'
    | 'not_understood'
    | 'understood_not_retrievable'
    | 'controlled_only'
    | 'spontaneous_use_unstable'
    | 'decaying'
    | 'likely_one_off'
    | 'stable';

  reasonCode:
    | 'current_lesson_focus'
    | 'recurring_error'
    | 'error_after_correction'
    | 'review_due'
    | 'previous_assignment_follow_up'
    | 'progressive_challenge'
    | 'teacher_requested'
    | 'goal_alignment'
    | 'other';

  rationale: string;
  confidence: 'low' | 'medium' | 'high';
  sourceRefs: AssignmentDecisionSourceRef[];

  intervention: {
    controlledPracticeItems: number;
    productionRequired: boolean;
    explanationRequired: boolean;
    pronunciationSeconds: number | null;
  };
}
```

```ts
interface AssignmentDecisionSourceRef {
  sourceKind:
    | 'latest_transcript'
    | 'lesson_memory'
    | 'homework_memory'
    | 'student_memory_snapshot'
    | 'foundational_profile'
    | 'teacher_note'
    | 'learner_outcome';
  sourceId: string;
  itemPath?: string | null;
  evidenceSummary: string;
  evidenceQuote?: string | null;
}
```

## Why the Ledger Must Be Separate From the Snapshot

### Different lifecycle

The snapshot changes when learner state changes.

The decision ledger changes for every assignment because it represents one pedagogical choice under one set of runtime inputs.

### Different purpose

The snapshot answers:

> What currently matters about this learner?

The ledger answers:

> What did this assignment decide to do about it, and why?

### Different retention needs

Old snapshots may be superseded as current state evolves.

Old decision ledgers remain useful for audit, assignment history, intervention comparison, and future outcome analysis.

### Different trust boundary

The snapshot may contain broad inferred guidance.

A student-facing explanation should use only explanation-safe, source-backed ledger fields selected for that assignment.

### Rejected alternative

Do not add assignment-specific fields such as item counts, chosen exercise formats, or explanation copy directly to `StudentMemorySnapshotRecord`.

That would couple long-term memory refresh to every assignment-generation decision and turn one compact state artifact into a multi-purpose container.

## Stable Learning-Target Identities

### Problem

Current memory uses free-text labels such as:

- `article use`,
- `missing articles`,
- `articles with jobs`,
- `article omission in spontaneous speech`.

These may refer to the same underlying learning target but are difficult to count, compare, or trace reliably.

### Future direction

Introduce stable target keys without requiring a complete universal language taxonomy.

Example:

```text
grammar.articles.jobs
fluency.linkers.spontaneous_speech
pronunciation.th_voiceless
vocabulary.travel.airport_problem_solving
```

### Guardrail

Do not let a model freely create an unlimited taxonomy and treat it as canonical.

A practical first version may use:

1. a small governed target registry,
2. aliases or normalization mappings,
3. an `other` or provisional target path,
4. tutor-visible labels separate from stable internal keys.

### Why this is additive

Episode memory can keep its human-readable labels while gaining optional normalized keys later.

No current artifact needs to be discarded.

## Learner-State Distinctions

A future planning layer should distinguish pedagogically different situations that currently risk being flattened into `wrong` or `review recommended`.

Useful distinctions include:

1. learner does not understand the rule,
2. learner understands but cannot retrieve it reliably,
3. learner succeeds in controlled practice but not spontaneous speech,
4. learner used to perform reliably but the skill appears to be decaying,
5. evidence is too weak and the mistake was probably one-off,
6. learner performance is stable and review is not currently warranted.

These states should guide intervention size.

Examples:

| Learner state | Likely response |
| --- | --- |
| `not_understood` | explanation plus focused controlled practice |
| `understood_not_retrievable` | retrieval practice with reduced explanation |
| `controlled_only` | guided production and spontaneous use |
| `spontaneous_use_unstable` | short repeated production across contexts |
| `likely_one_off` | monitor, do not assign remedial work |
| `stable` | avoid unnecessary review |

The first version should not pretend these are clinical-grade measurements. They are practical teaching interpretations with explicit confidence and evidence.

## Positive Evidence and Denominators

Error counts alone are not enough.

Four errors in five opportunities are different from four errors in eighty opportunities.

Future outcome and lesson evidence may benefit from recording:

- observed opportunities,
- correct uses,
- incorrect uses,
- self-corrections,
- correction accepted or repeated,
- controlled versus spontaneous context,
- trend over time.

This should be introduced only when the underlying evidence source can support it reliably.

Do not manufacture denominators from incomplete transcripts or treat silence as a failed opportunity.

## Learner Outcome Memory

### Current gap

Homework memory records assignment intent, not learner result.

The current architecture can often infer:

> This target was assigned before and the same issue appeared in a later lesson.

It cannot necessarily prove:

> The learner completed twelve items, answered ten correctly, revealed the answer twice, and still omitted the form in spontaneous speech three days later.

### Future outcome event shape

Illustrative only:

```ts
interface LearnerOutcomeEvent {
  id: string;
  studentId: string;
  assignmentLineageKey: string | null;
  targetKey: string | null;
  observedAt: string;
  sourceKind:
    | 'assignment_submission'
    | 'answer_check'
    | 'answer_reveal'
    | 'teacher_marking'
    | 'lesson_observation'
    | 'tutor_note';
  outcomeType:
    | 'completed'
    | 'correct'
    | 'incorrect'
    | 'self_corrected'
    | 'hint_used'
    | 'answer_revealed'
    | 'skipped'
    | 'reappeared_in_speech'
    | 'demonstrated_in_speech'
    | 'other';
  context: 'controlled' | 'guided_production' | 'spontaneous' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
  sourceRef: string;
  note: string | null;
}
```

### Guardrail

Store observed events first. Derive broader learner-state conclusions separately.

Do not write `learner does not know articles` merely because one answer was wrong.

## Student-Facing Explainability

The future student-facing feature should answer a practical question at the moment resistance appears:

> Why am I reviewing this again?

A useful explanation might be:

> You understand this rule in exercises, but it is not automatic in spontaneous speech yet. It appeared as an error in two recent lessons, including once after correction, so this assignment includes three short review items rather than a full grammar section.

The explanation may show compact sources such as:

- lesson on 8 July,
- lesson on 3 July,
- previous homework published on 29 June.

### Explanation requirements

1. Use evidence selected in the decision ledger.
2. Explain the learner state, not just repeat a grammar label.
3. State the intervention dose when useful.
4. Avoid overstating certainty.
5. Avoid exposing private transcript text by default.
6. Avoid punitive or patronizing language in shipped copy.
7. Let the tutor inspect deeper evidence when appropriate.

### Possible controls

Later controls may include:

- `This was useful`,
- `This did not feel relevant`,
- `I am already comfortable with this`,
- `Why was this selected?`,
- `Show the teacher's explanation`,
- `Report an incorrect learner fact`.

Feedback should become evidence for review, not automatic truth that rewrites canonical memory.

## Tutor-Facing Explainability

Tutor-facing detail may be richer than student-facing detail.

A tutor should eventually be able to inspect:

- selected target,
- learner-state interpretation,
- reason code,
- confidence,
- source records,
- intervention size,
- recent assignments that touched the target,
- later outcomes when available.

The first useful surface may be a plain internal drawer or support panel. It does not need a dashboard shaped like an airport control tower.

## Preservation Decisions

| Decision | Preserve | Reason |
| --- | --- | --- |
| Foundational profile remains highest authority | Yes | Protects confirmed durable truth from inference drift. |
| Episode memories remain canonical | Yes | They provide replayable source-level history. |
| Snapshot remains compact current state | Yes | Keeps refresh bounded and operationally understandable. |
| Runtime retrieval remains backend-owned | Yes | Preserves determinism, auditability, and provider independence. |
| Live assignment generation remains one prepared package and one provider call | Yes | Limits runtime complexity and keeps lineage inspectable. |
| Prompt packages retain exact memory lineage | Yes | Required for later explanation and debugging. |
| Inferred facts require review before profile promotion | Yes | Prevents quiet corruption of durable learner context. |
| All history may be stored but only bounded context reaches model calls | Yes | Controls cost, latency, and noise. |

## Proposed Additive Changes

| Change | Why | Does it require a rewrite? |
| --- | --- | --- |
| Stable target keys | Normalize recurring concepts across free-text memories. | No |
| Per-decision source references | Make assignment choices explainable. | No |
| Assignment decision ledger | Preserve the planning chain between memory and generated work. | No |
| Learner outcome events | Add evidence about what happened after assignment. | No |
| Learner-state interpretation | Calibrate intervention to the type of difficulty. | No |
| Student-facing explanation projection | Improve buy-in and trust. | No |
| Tutor-facing decision inspection | Improve correction, support, and debugging. | No |

## Alternatives Considered and Rejected

### 1. Rewrite the student-memory architecture

Rejected because the current profile, episode memory, snapshot, and bounded packaging layers already express the right responsibilities.

A rewrite would create migration and regression risk without solving the actual missing capability.

### 2. Put all evidence into every assignment prompt

Rejected because prompt size would grow, signal would become noisier, and the provider would still need to infer which evidence mattered.

The backend should select or prepare a bounded decision context.

### 3. Let the live model retrieve memory agentically

Rejected for the first implementation because it weakens deterministic lineage and makes support harder.

Revisit only if rule-based selection demonstrably fails after real usage.

### 4. Use the student-memory snapshot as the decision ledger

Rejected because snapshot state and assignment decisions have different lifecycles, purposes, and retention needs.

### 5. Infer outcomes only from later lesson transcripts

Rejected as the complete solution because transcript evidence cannot reliably represent assignment completion, answer accuracy, hints, or skipped work.

Later lesson observations remain valuable outcome evidence, but they are only one source.

### 6. Build a complete CEFR or grammar ontology first

Rejected because a universal taxonomy could become a large research and governance project before the product needs it.

Start with the smallest governed target registry that supports actual repeated decisions.

### 7. Expose raw memory and transcript evidence directly to students

Rejected because raw evidence may be noisy, private, confusing, or harsher than the pedagogical explanation requires.

Use an explanation-safe projection with optional tutor access to deeper provenance.

## Why This Work Is Deferred

### 1. The current architecture is already sufficient for MVP validation

The system can generate personalized homework with durable profile context, recent lesson continuity, recent homework continuity, and a compact long-term snapshot.

The missing decision ledger improves explanation and later optimization. It is not required to prove that tutors can use the core workflow.

### 2. Real tutor behavior should shape the contract

Before release, it is unclear which explanation questions tutors and learners will ask most often.

Examples:

- Why was this grammar point selected?
- Why was a previous topic repeated?
- Why was a target omitted?
- Why did the system choose three items rather than ten?
- Why did a student fact influence the scenario?

Alpha evidence should determine which of these deserve first-class fields.

### 3. Outcome data sources are not yet stable

A meaningful outcome layer depends on how learners complete, check, submit, and discuss homework in the shipped product.

Designing the contract before those interaction paths are established risks modelling imaginary behavior.

### 4. Implementation would cross multiple systems

A serious version touches:

- memory schemas,
- prompt-package lineage,
- assignment generation,
- learner interactions,
- tutor review UI,
- student-facing UI,
- privacy and data lifecycle.

This is not a harmless side patch before a 3 to 5 tutor alpha.

### 5. Premature implementation would delay the evidence needed to design it well

The shortest path to a good future decision ledger is to release the current product, observe real use, and discover where explanation and outcome tracking actually fail.

Building it now would postpone that evidence while producing a schema based mostly on founder intuition and model speculation.

## Revisit Triggers

Resume this work when at least one of the following becomes true:

1. Tutors repeatedly ask why a target or review item was selected.
2. Students show resistance to repeated review and a source-backed explanation would plausibly improve compliance.
3. Support work requires manually tracing assignments back through snapshot, lesson memory, homework memory, and transcript evidence.
4. The product begins collecting structured homework attempts or answer-check events.
5. Assignment quality review needs to compare intended intervention against learner outcome.
6. Free-text target labels create clear duplicate, trend, or counting failures.
7. Tutor feedback shows that the generator selects valid but poorly calibrated review doses.
8. A public or larger beta requires stronger explainability, correction controls, or learner data provenance.

A single anecdote may justify investigation, not automatic implementation.

## Post-Release Discovery Questions

Collect evidence for these questions before locking the schema:

1. Which assignment decisions most often need explanation?
2. Do tutors care more about source provenance, pedagogical rationale, or both?
3. Should learners see exact source dates, summarized evidence, or only a plain-language reason?
4. Which target categories recur enough to justify stable keys?
5. Can transcript-derived evidence reliably distinguish controlled and spontaneous use?
6. What homework interaction events are actually available and trustworthy?
7. Does learner feedback improve selection, or mostly express understandable dislike of review?
8. How often does the system over-review versus under-review?
9. Does the tutor need to approve the plan before generation, or only inspect it afterward?
10. What retention and privacy rules apply to evidence excerpts shown outside internal tools?

## Suggested Future Delivery Phases

### Phase 0: Observe and instrument

Goal: learn which decisions require explanation without changing generation architecture.

Possible work:

- record tutor support questions,
- review repeated target selection manually,
- inspect assignment and memory lineage,
- document common unexplained decisions,
- identify available learner outcome events.

Exit signal:

- a small ranked set of explanation and outcome needs exists.

### Phase 1: Write-only internal decision ledger

Goal: persist assignment target decisions without changing student-facing output.

Possible work:

- add a versioned ledger record,
- link it to prompt packages and assignment lineage,
- add stable reason codes,
- preserve source references,
- show a plain operator inspection payload.

Guardrail:

- generation output should remain unchanged unless a ledger field is explicitly consumed.

### Phase 2: Tutor-facing explanation

Goal: let tutors inspect why the assignment selected its targets.

Possible work:

- compact `Why this target?` drawer,
- source summaries,
- intervention dose,
- correction or feedback action,
- no automatic memory mutation from feedback.

### Phase 3: Learner outcome events

Goal: record what happened after assignment delivery.

Possible work:

- completion and checking events,
- tutor-marked outcomes,
- next-lesson observations,
- target-linked outcome aggregation,
- conservative derived learner-state updates.

### Phase 4: Student-facing explainability

Goal: answer `Why am I seeing this again?` with concise, source-backed language.

Possible work:

- explanation-safe copy,
- limited source dates or categories,
- relevance feedback,
- privacy review,
- accessibility and tone review.

### Phase 5: Smarter retrieval only if necessary

Goal: improve selection after deterministic target and evidence rules have reached their practical limit.

Possible work:

- semantic ranking,
- embedding-assisted evidence retrieval,
- model-assisted candidate ranking,
- cross-history similarity.

Entry condition:

- measured failures show deterministic selection is insufficient.

## Reliability and Safety Guardrails

1. The database remains canonical.
2. Every selected target should be traceable to source evidence or explicit tutor intent.
3. Weak evidence should produce lower confidence or omission, not stronger prose.
4. Learner feedback must not silently rewrite profile truth.
5. Generated rationales must not invent evidence.
6. Student-facing explanations must use an allowlisted projection of ledger data.
7. Raw transcript quotes should remain internal by default.
8. Stable target keys must be governed and versioned.
9. Outcome events must distinguish observed behavior from derived interpretation.
10. The decision ledger must remain bounded and should not duplicate complete source artifacts.
11. Assignment generation should remain operational if the ledger is unavailable during an early rollout, with explicit observability rather than silent false confidence.
12. New model calls must justify their cost and should not be added merely to narrate decisions already available deterministically.

## Success Criteria

The future architecture succeeds when:

1. A tutor can explain why each major assignment target was selected.
2. The explanation identifies supporting sources without manually searching raw history.
3. The system can distinguish prior assignment from demonstrated learner outcome.
4. Review dose reflects learner state rather than a generic `wrong` label.
5. Repeated target labels can be normalized and tracked across time.
6. Student-facing explanations remain concise, respectful, and source-backed.
7. Feedback is auditable and does not silently corrupt canonical memory.
8. Existing profile, lesson memory, homework memory, snapshot, and deterministic prompt packaging remain intact.
9. The feature improves trust or pedagogy according to observed product evidence, not merely architectural elegance.

## Non-Goals

This plan does not authorize immediate work on:

1. embeddings or vector search,
2. agentic runtime retrieval,
3. a complete linguistic ontology,
4. automatic foundational-profile mutation,
5. public raw-memory editing,
6. cross-student analytics,
7. large model-evaluation infrastructure,
8. a new memory dashboard,
9. a rewrite of assignment generation,
10. a new provider-specific runtime architecture.

## Decision Ledger

| Decision | Rationale | Rejected alternative | Revisit trigger |
| --- | --- | --- | --- |
| Preserve current four-layer memory architecture | Responsibilities are already separated correctly and implemented with provenance. | Rewrite around a new universal memory model. | Only if production failures show the boundaries themselves are wrong. |
| Add an assignment-specific ledger | The missing object is the selection decision, not another general summary. | Make the live model explain itself after generation without stored lineage. | After alpha evidence identifies repeated explanation needs. |
| Keep ledger separate from snapshot | Different lifecycle, purpose, and retention requirements. | Add assignment planning fields to snapshot. | Revisit only if a minimal implementation proves separate storage creates unjustified complexity. |
| Add outcome memory later | Current homework memory records intent, not performance. | Treat assignment publication as evidence of learning. | When structured learner or tutor outcome events exist. |
| Introduce stable target keys incrementally | Free-text labels block reliable counting and tracing. | Build a complete taxonomy before shipping. | When duplicate labels create measurable errors. |
| Keep retrieval deterministic initially | Preserves lineage and supportability. | Agentic database retrieval during live generation. | When deterministic selection misses relevant evidence in measured cases. |
| Defer student-facing explainability | Requires trustworthy decision and privacy contracts first. | Generate friendly explanations directly from current prompt text. | After internal tutor explanations are reliable. |
| Release before implementing | Real usage is needed to design the right contract. | Continue architecture work before the supervised alpha. | After MVP release and evidence review. |

## Relationship to Existing Documentation

Read these first when this plan is resumed:

1. [`../student-memory-system-upgrade/README.md`](../student-memory-system-upgrade/README.md)
2. [`../../reference/STUDENT_MEMORY_V1_1_DESIGN.md`](../../reference/STUDENT_MEMORY_V1_1_DESIGN.md)
3. [`../../reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md`](../../reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md)
4. [`../../reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`](../../reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md)
5. [`../../reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`](../../reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md)
6. [`../student-memory-system-upgrade/reliability-review.md`](../student-memory-system-upgrade/reliability-review.md)

## Implementation Warning

Do not turn this backlog document into an excuse to reopen the stable memory and assignment pipeline before release.

The current architecture already contains the foundation needed for this future capability. The correct near-term move is to preserve the reasoning, ship the product, collect real evidence, and return with sharper requirements.
