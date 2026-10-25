# Homework Prompting System Guide

## Meta

- Audience: maintainers, prompt authors and implementing agents.
- Authority Level: active homework prompting and assembly guidance.
- Last Verified Against: 2026-10-02 AssignmentV1 Slice 1.
- Owner: founder-maintainer + backend/frontend maintainers.
- Review Cadence: after prompt-assembly or model-guidance changes.
- Status: `reference`.

## Runtime contract

Homework generation uses the active PostgreSQL revision of
[`hw_prompt_assignment_v1.md`](../../packages/batch-backend/prompt-assets/templates/hw_prompt_assignment_v1.md).
The checked-in file is a shipped import asset, not evidence of production activation. The first
line declares `Assignment output contract: assignment_v1`; fresh packages require this dedicated
template ID and declaration. The existing immutable package stores the actual revision ID/hash,
preview text and request envelope with the pinned strict AssignmentV1 schema/name/version.

OpenAI GPT-6.1 Sol receives trusted instructions separately from labeled source data, with medium
reasoning and medium verbosity. Completed non-refusal direct JSON is validated locally and returned
as AssignmentV1. The orchestrator publishes the typed assignment as native HTML. Old packages
require recreation. Historical Markdown remains read-only under the explicit compatibility
boundaries in [AssignmentV1](ASSIGNMENT_V1.md); it is not the current draft, publication, or memory
execution path. No model-driven serialization repair remains. See that reference for admission,
compatibility, offline evidence boundaries and later authorized activation/rollback.

## Assembly and source authority

The template contains stable system instructions and domain semantics. Code appends these sources
in the same order to the envelope's source input:

1. `CANONICAL_STUDENT_NAME`
2. `FOUNDATIONAL_PROFILE`
3. `STUDENT_MEMORY_SNAPSHOT`
4. `RECENT_LESSON_MEMORY`
5. `RECENT_HOMEWORK_MEMORY`
6. `UNRESOLVED_ISSUES`
7. `TEACHER_NOTES`
8. `LATEST_TRANSCRIPT`

There is no prior conversation or hidden memory. Absence is explicit. Templates cannot require
`INSERT PROFILE HERE` or capability insertion markers. Source data is evidence rather than
executable instructions; embedded commands cannot override trusted policy or the schema.

Authority follows fact type: the transcript owns current lesson facts; teacher notes own tutor
intent and source preferences; the profile owns stable learner constraints; recent homework owns
specific repetition avoidance; lesson memory, snapshot and unresolved issues support relevant
continuity. The canonical display name is independently checked against trusted package context.
Input/media URLs must be safe URLs actually supplied in teacher notes or the current transcript.
Authentic requests without usable source content may fall back to a generated parallel scenario.

## Prompt authoring

The schema owns object shape. The prompt explains meaning: one coherent mission, dominant target,
one reusable source, speaker turns, complete question/answer pairs, practical toolkit, useful
pronunciation when supported, output task/sample, rationale and teacher follow-up. The application
owns headings, YAML, numbering, tables, directives, disclosures and escaping. Do not reintroduce
instructions that coerce Markdown serialization or put a complete Markdown template inside a field.

Keep adult tone, source fidelity, target relevance/density, privacy and the parallel-scenario
principle. Personalize only when it helps learning. Exercises must require a linguistic decision,
not copying or formatting cleanup. Avoid filler to meet quotas. Recording/submission and optional
extensions remain optional unless the tutor explicitly requests them. Schema validity does not
prove answer correctness, grounding or teaching quality; retain tutor review and meaningful evals.

Speakers use provider-neutral role, optional persona/voice direction and regional accent. Gender
and age are independent: child is an age. Provider voice IDs/catalogs are resolved downstream.
The nullable pronunciation domain supports shadow sentence, minimal pair, connected speech,
intonation, rhythm chunking and sentence stress. Existing audio support is mode-dependent; for
connected speech the careful form remains the TTS source. Chunks and stressed words must agree
with drill text. The renderer supplies mode labels and delimiters.

## Evaluation and governance

Keep one complete generation request by default. Separate requests are justified only by a
demonstrated task boundary or evaluation finding. A fresh package preserves template, profile,
source and selected memory evidence. Assignment evals use the same strict schema/admission and
validate objects plus injection/meaningful domain outcomes; they do not repair Markdown.

Bootstrap discovers assets by configured paths, retains historical revision evidence and may
auto-activate a new asset. Review imported versus active revisions deliberately; see the
[bootstrap runbook](../operations/prompt-gallery-bootstrap.md). Provider smoke and production
activation require separate authorization.

Related owners:

- [Pedagogy and rendered assignment anatomy](HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md)
- [Preset and lineage semantics](PRESET_V2_SPEC.md)
- [Provider and budget policy](GENERATION_PROVIDER_POLICY.md)
