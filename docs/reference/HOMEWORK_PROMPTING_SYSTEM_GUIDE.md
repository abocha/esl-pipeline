# Homework Prompting System Guide

## Meta

- Audience: founder, maintainers, prompt/runtime implementers, AI agents.
- Read Time: 9 minutes.
- Authority Level: active system prompting and assembly guidance for homework drafting.
- Last Verified Against: 2026-03-27 repo state.
- Owner: founder-maintainer + backend/frontend maintainers.
- Review Cadence: after prompt-assembly or model-guidance changes.
- Status: `reference`.

## Purpose

- Document the current prompt-package architecture used by the homework drafting system.
- Capture prompt-structure guidance that is specific to this repo, not just generic provider advice.
- Preserve prompting decisions discovered during model/runtime work before they are lost across context resets.

## Scope

This doc is about the **draft-generation prompt package** used by `batch-backend`.

It is not:

- the canonical pedagogy spec
- the provider/model policy
- the DB bootstrap runbook

Use this doc when changing:

- homework prompt structure
- prompt-package assembly order
- template/profile/runtime block boundaries
- provider-facing drafting prompts

## Related Docs

- Use [`docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`](HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md) for the protected pedagogical method and assignment anatomy.
- Use [`docs/reference/PRESET_V2_SPEC.md`](PRESET_V2_SPEC.md) for prompt governance, learning preset semantics, and lineage requirements.
- Use [`docs/operations/prompt-gallery-bootstrap.md`](../operations/prompt-gallery-bootstrap.md) for DB bootstrap, asset import, and activation workflow.
- Use [`docs/reference/gpt-5.4_prompt-guidance.md`](gpt-5.4_prompt-guidance.md) for broader GPT-5.4 prompt patterns not specific to the ESL homework system.

## Current Runtime Truth

### DB-canonical templates

Prompt templates and profiles are runtime-managed from PostgreSQL revision tables.

The filesystem template:

- [`docs/prompt-gallery/templates/hw_prompt_definitive.md`](../prompt-gallery/templates/hw_prompt_definitive.md)

is now primarily a **bootstrap seed/reference asset**, not the live runtime source of truth.

At the time of writing:

- template id is `hw_prompt_definitive.md`
- the active DB revision is `v1`

This means prompt changes must be reasoned about in two layers:

1. the **live DB template revision**
2. the **code-side assembly contract** that wraps and augments that template

### Final model input path

The final drafting request is assembled once during prompt-package creation and then passed through directly to the generation provider.

Current flow:

1. Resolve active template revision from DB.
2. Resolve active profile revision from DB.
3. Materialize capability placeholders inside the template when needed.
4. Stitch runtime context blocks around that template/profile content.
5. Store the finished prompt package.
6. Send the stored prompt-package text to the provider for draft generation.

Implication:

- prompt quality is mostly determined **before** the LLM call
- later provider execution does not re-assemble or reinterpret the package

## Current Assembly Contract

The prompt package is now assembled with one uniform rule:

- the template is a pure static system-instructions document
- `[FOUNDATIONAL_PROFILE]` is appended by code like every other runtime block
- templates no longer contain or require `INSERT PROFILE HERE`

The effective runtime order is:

1. static template content
2. `[FOUNDATIONAL_PROFILE]`
3. `[STUDENT_MEMORY_SNAPSHOT]`
4. `[RECENT_LESSON_MEMORY]`
5. `[RECENT_HOMEWORK_MEMORY]`
6. `[UNRESOLVED_ISSUES]`
7. `[TEACHER_NOTES]`
8. `[LATEST_TRANSCRIPT]`

This matters because every dynamic block now follows one explicit assembly contract instead of mixing template-local insertion with appended context.

## Prompt Shape

The active design shape is:

### Static system instructions first

The template revision should become a pure system-instructions document, containing only the stable prompt contract, for example:

1. role and scope
2. working context contract
3. context priority rules
4. conflict resolution rules
5. task-specific generation rules
6. output formatting rules
7. definitive homework output template

### Runtime context blocks second

After the static instructions, the backend appends the dynamic blocks in one fixed canonical order:

1. `[FOUNDATIONAL_PROFILE]`
2. `[STUDENT_MEMORY_SNAPSHOT]`
3. `[RECENT_LESSON_MEMORY]`
4. `[RECENT_HOMEWORK_MEMORY]`
5. `[UNRESOLVED_ISSUES]`
6. `[TEACHER_NOTES]`
7. `[LATEST_TRANSCRIPT]`

### Design principle

Static prompt contract first, dynamic lesson/student data last.

This aligns with both:

- system clarity in this repo
- current OpenAI prompt-caching guidance to keep static/repeated content at the beginning and dynamic content at the end

OpenAI source:

- <https://developers.openai.com/api/docs/guides/prompt-caching/>

## Bootstrap And Discovery Notes

Prompt bootstrap no longer uses a content marker to distinguish templates from profiles.

- template/profile discovery starts from the configured roots
- when those roots overlap, bootstrap prefers obvious profile paths and names such as `profiles/...` and `*_PROFILE_*.md`
- the marker-based contract is retired and should not be reintroduced into new template revisions

## Recommended Section Order Inside The Static Prompt

For GPT-5-class models, the most reliable high-level ordering for this system is:

1. `Role & Scope`
2. `Working Context Contract`
3. `Context Priority Rules`
4. `Conflict Resolution Rules`
5. `Task-Specific Generation Rules`
6. `Output Formatting Rules`
7. `Definitive Homework Output Template`

Why this order works well:

- role establishes identity and task shape early
- context contract tells the model how to interpret the appended blocks
- conflict rules resolve ambiguity before the model reaches formatting constraints
- output rules and the definitive template stay close to the generation target

This follows the spirit of current OpenAI GPT-5 guidance:

- define role clearly
- provide explicit workflow/contract guidance
- then specify output constraints and formatting

OpenAI sources:

- <https://developers.openai.com/api/docs/guides/prompt-engineering/>
- <https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide>

## Guidance On The Former "Dynamic Lesson Input" Section

The old standalone `Dynamic Lesson Input` section is not a good long-term fit for this system.

Reason:

- it reflects an older mental model where the prompt template itself expects teacher notes and transcript in a special embedded slot
- it under-describes the newer memory/profile layers
- it duplicates information that belongs more naturally in the context contract

Recommendation:

- remove `Dynamic Lesson Input` as a standalone section
- move its useful semantics into the static prompt's context contract

What should be preserved:

- teacher notes may be absent
- transcript is the primary evidence for the current lesson
- labeled blocks are the only working context for the request

What should not remain:

- any implication that only notes/transcript are "dynamic"
- any template wording that suggests hidden insertion slots beyond the canonical block list

## Single Request vs Multi-Request Drafting

### Default recommendation

For final homework drafting, prefer **one well-structured request**.

Best-practice shape:

1. static instructions first
2. dynamic blocks second

Do **not** split into:

1. one request for instructions/template
2. another request for the actual student/profile/transcript data

unless you are intentionally building a multi-stage pipeline.

### Why a single request is better by default

- the model receives one complete, explicit contract
- there is less orchestration complexity
- there are fewer persistence and state-carryover failure modes
- it fits OpenAI prompt-caching guidance well when static content stays at the front

### Important Responses API detail

When using `previous_response_id`, OpenAI docs note that prior instructions are **not** automatically carried over as the new system/developer instructions.

Implication:

- multi-request designs usually still need explicit instruction handling
- splitting requests does not automatically improve context understanding

OpenAI source:

- <https://developers.openai.com/api/reference/resources/responses/methods/create/>

### When multiple requests do make sense

Use multi-stage prompting only when the stages have distinct purposes, such as:

1. extraction -> generation
2. normalization -> generation
3. retrieval/summarization -> generation
4. human approval checkpoint -> final generation

In those cases, the benefit is not "better attention" from the model by default.

The benefit is:

- clearer state transitions

## Pronunciation Mode Contract

The pronunciation section now follows one shared contract:

- `**Mode:**`
- `**Target:**`
- `**Focus:**`
- `**Action:**`
- `**Deliverable:**`

After those shared fields, exactly one mode-specific drill block must appear.

Current rollout is intentionally tiered:

- tier 1 full-stack modes:
  - `shadow_sentence`
  - `minimal_pair`
  - `connected_speech`
- tier 2 prompt/validator/renderer-first modes:
  - `intonation`
  - `rhythm_chunking`
  - `sentence_stress`

Important nuance:

- the prompt and validator know all 6 modes explicitly
- the renderer should render all 6 cleanly
- provider-backed pronunciation audio is still not fully symmetrical across all modes

Recommendation:

- keep pronunciation in the same homework-drafting request by default
- only consider a second pronunciation-specific model call later if evals show that the stabilized single-call contract is still not reliable enough
- better artifact reuse
- better evalability
- easier approval or correction between stages

## Prompting Best Practices For This Repo

### 1. Keep the prompt contract explicit

Use labeled sections and clear headings.

Avoid:

- vague prose instructions
- duplicated rules that say the same thing in different words
- hidden assumptions about which block should dominate

### 2. Separate pedagogy from runtime assembly

Pedagogical invariants belong in the pedagogy/template spec.

Prompt assembly rules belong in code and this system guide.

Do not bury runtime assembly semantics only inside template prose.

### 3. Keep static content truly static

The template should contain:

- role
- context handling contract
- generation rules
- output rules
- output template

It should not depend on special sentinel placement for one context block unless there is a compelling technical reason.

### 4. Put dynamic blocks at the end

Static first, dynamic last.

This improves:

- readability
- prompt-caching friendliness
- assembly determinism
- future provider portability

### 5. Prefer exact block names over narrative references

The model works better when block semantics are explicit:

- `[FOUNDATIONAL_PROFILE]`
- `[UNRESOLVED_ISSUES]`
- `[LATEST_TRANSCRIPT]`

This is better than relying on diffuse narrative phrases like "student details above" or "lesson input below."

### 6. Make absence explicit

If a block is missing, use a stable explicit absence marker rather than silently omitting the block.

This helps the model distinguish:

- absent context
- empty context
- context that should not be inferred

### 7. Put conflict rules before formatting rules

The model should know how to choose and prioritize evidence before it reaches the output-template section.

Otherwise it may over-focus on formatting while under-resolving context conflicts.

### 8. Use output contracts, not just examples

The static prompt should specify:

- required sections
- required order
- hard formatting constraints
- "never do X" rules where necessary

Examples/templates help, but the explicit contract should remain primary.

### 9. Avoid redundant prompt prose

GPT-5-class models usually perform better with concise, scoped instructions than with repeated reminders.

Good:

- one clear rule
- one clear conflict policy
- one clear output contract

Less helpful:

- repeating the same warning in multiple sections
- maintaining stale explanatory sections after architecture has changed

### 10. Design for evals and provenance

Prompt changes should be easy to test and reason about later.

Prefer designs where you can inspect:

- the exact template revision used
- the exact prompt package stored
- the exact block order

That makes regression review much easier than hidden runtime insertion logic.

## Migration Outcome

This refactor should be understood as a prompt-assembly contract change, not just a template text edit.

What changed:

1. active template revisions are now treated as pure static system instructions
2. `INSERT PROFILE HERE` is removed from the active assembly contract
3. all runtime blocks are appended in one canonical order
4. template validation no longer requires the marker
5. bootstrap no longer relies on the marker for classification

## Non-Goals

This doc does not decide:

- the final wording of the next template revision
- the exact migration sequence for removing the profile marker
- provider-specific tuning beyond general GPT-5-class prompt patterns
- pedagogical changes to the homework method itself

Those should be handled in the relevant implementation or decision work.

## Sources

- OpenAI Prompt engineering guide:
  - <https://developers.openai.com/api/docs/guides/prompt-engineering/>
- OpenAI GPT-5 prompting guide:
  - <https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide>
- OpenAI Prompt caching guide:
  - <https://developers.openai.com/api/docs/guides/prompt-caching/>
- OpenAI Responses API reference:
  - <https://developers.openai.com/api/reference/resources/responses/methods/create/>
