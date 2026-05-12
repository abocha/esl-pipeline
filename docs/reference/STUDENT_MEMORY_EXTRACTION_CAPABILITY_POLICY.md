# Student Memory Extraction Capability Policy

## Meta

- Audience: founder, maintainers, backend implementers, AI agents.
- Read Time: 7 minutes.
- Authority Level: canonical extraction-capability policy for student-memory generation.
- Last Verified Against: 2026-05-12 repo state.
- Owner: founder-maintainer + backend maintainers.
- Review Cadence: monthly or after provider/runtime capability changes.
- Status: `reference`.

## Purpose

- Lock which model capabilities are acceptable for canonical lesson/homework/snapshot extraction.
- Separate memory-extraction requirements from the broader draft-generation provider policy.
- Keep the system provider-agnostic at the architecture level without pretending all models are
  equally suitable for schema-critical extraction work.

## Why This Exists

Homework draft generation and memory extraction are not the same workload.

- Homework generation is prose-first and can tolerate a broader provider/model surface.
- Memory extraction is schema-first and must produce stable machine-readable artifacts.

Version 1 should therefore use capability-based routing for extraction, not provider-indifferent
routing.

## Locked Decisions

1. Canonical lesson-memory, homework-memory, and student-memory snapshot writes require native
   structured-output capability.
2. Version 1 canonical extraction tier is `structured_json` only.
3. Version 1 does not allow plain-text prompting to write canonical memory artifacts.
4. Version 1 does not allow strict tool-schema extraction to write canonical memory artifacts.
5. If the configured provider/model cannot satisfy canonical extraction capability, the extraction
   run fails fast instead of silently degrading into a weaker mode.
6. Backend validation remains mandatory even when native structured outputs are used.
7. Extraction schemas must target a provider-agnostic JSON Schema subset that can be mapped across
   supported providers.
8. LLM extraction outputs cover semantic content only. Backend-owned metadata, lineage, ids, and
   lifecycle fields are not requested from the model.
9. OpenRouter remains an acceptable provider path for canonical extraction when the selected model
   explicitly supports structured outputs and routing is configured to require those parameters.

## Capability Tiers

### Tier A: `structured_json`

Definition:

- provider/model supports native response shaping against an explicit JSON schema
- the response is expected to conform to the supplied schema at the provider boundary

Examples of supported patterns from current provider docs:

- OpenAI structured outputs / schema-constrained responses
- Gemini `responseMimeType=application/json` plus `responseJsonSchema`
- Anthropic structured outputs
- OpenRouter `response_format.type = json_schema` for compatible models

Version 1 policy:

- this is the only tier allowed to write canonical student-memory artifacts

### Tier B: `strict_tool_schema`

Definition:

- provider/model can emit arguments for a declared tool or function schema with strong validation,
  but does not provide native structured final-response mode suitable for this pipeline

Version 1 policy:

- non-canonical
- not used for canonical student-memory writes
- may be considered later if evals prove it is operationally equivalent for this workload

### Tier C: `plain_text_json`

Definition:

- the prompt requests JSON in text form, but the provider does not enforce schema conformance at the
  response boundary

Version 1 policy:

- non-canonical
- not used for canonical student-memory writes
- failures should not silently fall through to this tier

## Canonical Extraction Rule

Version 1 canonical extraction requires all of the following:

1. native structured-output support on the chosen provider/model path
2. backend-supplied schema for the requested artifact content
3. provider-level structured-output request configuration
4. local schema validation after provider response
5. business-rule validation after local schema validation

If any of those fail, the extraction run is not canonical.

## Failure Policy

When canonical extraction capability is missing or unusable:

1. fail the extraction run
2. record actionable diagnostics
3. allow replay on a capable provider/model later
4. do not write a degraded canonical memory row

Version 1 out of scope:

1. degraded canonical writes
2. plain-text fallback writes
3. non-canonical sidecar extraction artifacts

## Provider-Agnostic Schema Rules

Schemas used for canonical extraction should stay within a conservative cross-provider subset:

1. `object`, `array`, `string`, `boolean`, `number`, `integer`
2. explicit `required` fields
3. explicit `enum` where stable
4. `additionalProperties: false` where feasible
5. limited nullable singleton fields where absence is semantically distinct from empty collection

Avoid for version 1 canonical schemas:

1. very deep nesting
2. highly dynamic/dictionary-shaped payloads
3. recursive schemas
4. provider-specific schema tricks that do not port cleanly

## Backend Validation Stack

Canonical extraction always passes through three checks:

1. provider-level schema conformance
2. local schema validation
3. business-rule validation

Business-rule validation exists because schema-valid JSON can still be semantically wrong. Examples:

1. transcript noise represented as a learner mistake
2. impossible enum/value combinations
3. filler strings standing in for genuinely missing content
4. structurally valid but pedagogically useless outputs

## Backend-Owned Versus Model-Owned Fields

The model owns semantic content objects only.

The backend owns:

1. artifact ids
2. `studentId`
3. `schemaVersion`
4. `generatedAt`
5. `provider`
6. `model`
7. `status`
8. `sourceKind`
9. `sourceIds`
10. prompt-package lineage fields
11. publish timestamps and source-truth delivery metadata when already known from the system of
    record

This boundary keeps extraction schemas smaller, more portable, and less error-prone.

## OpenRouter Compatibility Rule

OpenRouter remains a valid extraction provider path in version 1 if and only if:

1. the selected model advertises structured-output support
2. provider routing is configured to require the needed parameters
3. the request uses `response_format.type = json_schema`
4. the schema is supplied in strict mode
5. the model passes the same local/business validation as direct-provider paths

This means cheap OpenRouter-served models may be usable for canonical extraction, but only when they
actually satisfy the structured-output contract. Price alone is not a capability signal.

## Operational Guidance

Implementers should treat extraction capability as a first-class routing input:

1. choose provider/model by capability first
2. choose cost/performance second within the set of capable models
3. reject unsupported paths early

Draft-generation provider policy and extraction-capability policy may therefore differ intentionally.

## Related

- [`docs/reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md`](STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md)
- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)
- [`docs/plans/student-memory-system-upgrade/phase-1-requirements-contracts-and-schema-boundaries.md`](../plans/student-memory-system-upgrade/phase-1-requirements-contracts-and-schema-boundaries.md)
- [`docs/plans/student-memory-system-upgrade/phase-2-lesson-memory-pipeline.md`](../plans/student-memory-system-upgrade/phase-2-lesson-memory-pipeline.md)
- [`docs/plans/student-memory-system-upgrade/phase-3-homework-memory-pipeline.md`](../plans/student-memory-system-upgrade/phase-3-homework-memory-pipeline.md)
