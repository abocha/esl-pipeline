# Phase 5 - Prompt Template and Provider Runtime

## Goals

1. Rewrite the system prompt to match the actual stateless backend execution model.
2. Replace the current lightweight lesson-history appendix with explicit structured memory blocks.
3. Define one frontier-friendly, provider-agnostic prompt package for version 1.
4. Preserve room for later provider-specific tuning without fragmenting the initial implementation.

Pedagogical invariants for the assignment itself are documented separately in
[`docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`](../../reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md).
This phase defines runtime prompt packaging, not the teaching method from scratch.

## Locked Decisions

1. Version 1 uses one prompt package contract for all supported providers.
2. Version 1 does not introduce separate prompt templates per provider.
3. Version 1 does not introduce provider-specific behavioral tuning in prompt assembly beyond stable
   ordering and additive compatibility-safe guidance.
4. The prompt package must be structured for frontier-class models, with GPT-5.4-style block
   prompting as the primary reference quality bar.
5. The runtime remains one prepared prompt package -> one provider request -> one reply.
6. Provider runtime remains single-request and deterministic.
7. Prompt assembly uses explicit labeled context blocks for every memory layer.
8. The prompt must explicitly state when memory context is absent instead of silently implying
   continuity.
9. Conflict resolution rules must be explicit inside the prompt contract.
10. Recent homework memory must be called out as more important than broad rollup memory for
    avoiding repetition.
11. Prompt ordering should be cache-friendly for providers that support cached-token reuse, but
    caching is not a correctness dependency.
12. Phase 5 must leave room for future provider-specific prompt variants or adapter-side tuning if
    later evals justify them.

## Why This Phase Waits Until After Retrieval Packaging

Prompt text should be stabilized only after:

1. memory artifact contracts are fixed
2. retrieval packaging is fixed
3. prompt-package provenance is fixed

Otherwise prompt work creates churn and fake progress.

## Prompting Guidance Direction

Phase 5 is informed by:

1. local GPT-5.4 prompting guidance in this repo
2. official provider guidance emphasizing:
   - explicit output contracts
   - block-structured prompts
   - grounded context use
   - stable system instructions
   - compact, information-dense inputs

Version 1 should optimize for a generic frontier-model-friendly package, not for provider-specific
prompt tricks.

## Cross-Model Prompting Principles

The version-1 prompt package should follow these cross-model principles that hold across current
frontier and modern instruction-tuned models:

1. use explicit labeled blocks instead of relying on implicit conversational memory
2. keep system instructions stable and high-priority
3. keep context semantically structured and compact
4. place long-lived context before dynamic per-lesson context
5. make output contract and behavior rules explicit
6. make absence of context explicit instead of implying hidden continuity

These principles are the reason version 1 uses one provider-agnostic prompt package. Later
provider-specific tuning may optimize around the same structure, but should not replace it.

## Canonical Prompt Contract

The prompt package must explicitly provide these labeled sections:

1. foundational profile
2. student-memory snapshot
3. recent lesson-memory entries
4. recent homework-memory entries
5. unresolved issues
6. teacher notes
7. latest transcript

The package should preserve this conceptual hierarchy:

1. foundational profile = stable student identity, goals, and constraints
2. student-memory snapshot = long-term compressed continuity
3. recent lesson/homework memory = tactical recent continuity
4. unresolved issues = active carry-forward teaching priorities
5. teacher notes = current lesson nuance
6. latest transcript = immediate source of truth for the current assignment

## Prompt Assembly Rules

The current assembly path should evolve from:

1. profile
2. notes
3. lightweight history string
4. transcript

to explicit block-labeled assembly for the new memory model.

Assembly rules:

1. every context layer must have an explicit block label
2. the old generic lesson-history text block is removed
3. the latest transcript remains last because it is the most dynamic and immediately actionable
4. the prompt package must remain compact and structured rather than prose-heavy

## Missing Context Rules

The prompt must not imply continuity that is not present.

Missing-context rules:

1. if a student-memory snapshot is unavailable, the prompt must state that it is unavailable
2. if recent lesson or homework memory is unavailable, the prompt must state that explicitly or use
   a stable absence marker
3. omission must never cause the model to assume missing continuity is still known

## Conflict Resolution Rules

The prompt must explicitly instruct the model how to resolve conflicts between sources.

Version 1 conflict policy:

1. latest transcript is the primary source for what happened in the current lesson
2. teacher notes refine current-lesson nuance when they add intent, emphasis, or correction context
3. unresolved issues and recent memory guide carry-forward continuity
4. student-memory snapshot provides broad long-term context
5. foundational profile remains authoritative for stable student identity, goals, and durable
   preferences
6. inferred facts must never override profile-grade truth

## Recent Homework Priority Rule

The prompt must explicitly state that recent homework memory matters more than broad rollup memory
for avoiding repetition.

Why this is explicit:

1. the rollup may summarize broad patterns
2. recent homework memory is the most reliable source for what was just assigned
3. the model should use recent homework first when deciding what not to repeat immediately

## Provider Runtime Rules

Version 1 provider runtime remains unchanged in shape:

1. one prompt package is built by the backend
2. one provider request is made for generation
3. one response is returned

Phase 5 does not introduce:

1. runtime tools
2. provider-specific prompt forks
3. live memory-fetch agents
4. multi-step deliberative retrieval loops

## Scope Boundaries

Phase 5 defines memory-aware prompt packaging and runtime behavior. It does not define:

1. exact YAML/frontmatter syntax details
2. markdown directive syntax rules
3. validator-rule implementation details
4. homework pedagogy from first principles
5. frontend rendering behavior
6. database schema for lesson/homework/snapshot artifacts

Those concerns belong to other authoritative docs. Phase 5 should consume their contracts, not
redefine them.

## Cache-Friendly Ordering

Prompt assembly should place the most stable blocks earlier:

1. system instructions
2. foundational profile
3. student-memory snapshot
4. recent lesson/homework memory
5. unresolved issues
6. teacher notes
7. latest transcript

Ordering rules:

1. this ordering is intended to be friendly to cached-token reuse where providers support it
2. cached-token reuse is an optimization, not a behavioral requirement
3. correctness must not depend on provider-specific cache behavior

## Future Extensibility Boundary

Version 1 intentionally standardizes on one prompt contract, but this phase must preserve room for
future improvement.

Allowed future extension directions:

1. provider-specific prompt variants
2. adapter-side behavioral tuning
3. provider-specific compact/expanded prompt tiers
4. provider-specific formatting optimizations validated by evals

Boundary rule:

1. those future extensions must sit behind the same canonical retrieval and memory-package contract,
   not redefine lesson/homework/rollup semantics

## Safety And Behavior Rules

The system prompt should instruct the model to:

1. prioritize the latest transcript for current lesson context
2. use student memory to personalize and maintain continuity
3. use recent homework memory to avoid immediate repetition
4. use unresolved issues to carry forward still-open learning goals
5. treat inferred facts carefully
6. not invent biography, goals, or preferences absent from supplied context
7. avoid overcommitting to noisy transcript artifacts when evidence is weak

## What This Phase Unlocks

1. a stateless prompt contract that matches the real backend runtime
2. memory-aware assignment generation without agentic retrieval
3. one strong version-1 prompt package usable across providers
4. future provider-specific tuning without reopening the core memory-system design

## Exit Criteria

1. System prompt language matches stateless runtime truth.
2. Prompt assembly consumes explicit memory blocks instead of the old lightweight history string.
3. Missing memory context is represented explicitly.
4. Conflict resolution rules are encoded in the prompt contract.
5. Provider runtime remains single-request and deterministic.
6. The design leaves room for future provider-specific tuning without requiring it in version 1.
