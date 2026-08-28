# Preset V2 Spec

## Meta

- Audience: founder, maintainers, AI agents.
- Read Time: 6 minutes.
- Authority Level: canonical preset architecture spec.
- Last Verified Against: 2026-03-13 repo state.
- Owner: founder-maintainer + backend/frontend maintainers.
- Review Cadence: monthly or after preset/runtime contract changes.
- Status: `reference`.

## Purpose

- Define what a learning preset is.
- Lock the MVP contract so implementation does not re-decide preset meaning during execution work.

## Locked Decisions

1. Preset V2 means:
   - prompt strategy
   - pedagogic metadata
   - output contract
2. Legacy color presets are presentation config only, not learning logic.
3. MVP ships one trusted track:
   - `general-english`
4. Prompt governance uses immutable snapshots plus stable aliasing.
5. Runtime provider/model selection remains separate from preset semantics.

## Current Baseline

- active prompt snapshot:
  - `packages/batch-backend/prompt-assets/templates/hw_prompt_definitive.md`
- runtime default lineage:
  - learning preset id: `general-english`
  - learning preset version: `v2`
  - prompt alias: `current`

`general-english@v1` remains available only as explicit compatibility for persisted historical jobs;
new General English jobs use `v2`.

## Contract Shape

Every preset should define:

- stable id
- version and status
- prompt template or template reference
- prompt variables
- pedagogic metadata
- assignment output schema

Every generated draft should retain:

- learning preset id
- learning preset version
- prompt snapshot version
- prompt alias when applicable

## Speaker And Speech-Performance Rules

The default `general-english` preset uses `hw_prompt_definitive`.

- authored `speaker_profiles` stay provider-neutral
- descriptive cast intent belongs in `role`, optional `persona`, and optional `voice_direction`
- `accent` is regional only; omit placeholders such as `neutral`, `standard`, and `default`
- live provider catalogs are resolved after TTS provider/model selection
- expressive delivery planning is a separate runtime stage with identity fallback

## MVP Scope Boundaries

In scope:

- one trusted preset track
- versioning and provenance plumbing
- schema-aware output contract
- preview and validation before publish

Out of scope:

- full CEFR catalog authoring
- marketplace/community preset store
- multi-track pedagogic breadth

## Current Implementation Direction

- DB-first entities are the canonical direction.
- Prompt snapshots remain reference assets, not the long-term source of truth.
- Frontend/runtime should treat preset choice as a stable contract input, not a model-tier prompt fork.
- Pedagogical invariants for the current homework track live in
  [`docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`](HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md).
- Student-memory extraction capability and exact semantic output schemas live in:
  - [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
  - [`docs/reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md`](STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md)
- System-specific homework prompt assembly guidance lives in:
  - [`docs/reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`](HOMEWORK_PROMPTING_SYSTEM_GUIDE.md)

## Related

- [`docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`](HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md)
- [`docs/reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`](HOMEWORK_PROMPTING_SYSTEM_GUIDE.md)
- [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
- [`docs/reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md`](STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md)
- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)
- [`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](PRODUCT_NORTH_STAR_AND_READINESS.md)
