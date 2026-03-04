# Md-Validator Ruleset Conventions

## Meta

- Audience: maintainers and AI agents changing markdown validation behavior.
- Read Time: 4 minutes.
- Authority Level: validator design conventions.
- Last Verified Against: 2026-03-04 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: when adding/changing rulesets.
- Status: `reference`.

## Purpose

- Define stable conventions for ruleset IDs, issue codes, and compatibility guarantees.
- Prevent accidental drift in validator outputs consumed by backend/frontend/orchestrator.

## Ruleset Registry Conventions

1. Registry is code-first in `packages/md-validator/src/rulesets/registry.ts`.
2. IDs are kebab-case and stable (for example `general-english`).
3. Version is explicit and stable (`v1`, `v2`, ...).
4. Unknown `learningPresetId` MUST fallback to `general-english@v1` with warning issue code:
   `ruleset.unknown_preset_fallback`.
5. Legacy `preset` values map to `general-english@v1` with metadata reason:
   `legacy_preset_mapping`.

## Issue Model Conventions

1. `code` is machine-stable and dot-scoped (for example `ruleset.unknown_version_fallback`).
2. `ruleId` is stable identity of a rule family (for example `h2-order`, `study-text`).
3. `severity` is one of:
   - `error`
   - `warning`
   - `advisory`
4. `category` is one of:
   - `runtime`
   - `contract`
   - `quality`
   - `voice`
5. `blockingInStrict` expresses strict-mode escalation behavior.

## Compatibility Rules

1. `validateMarkdown` input must stay backward-compatible:
   - existing `path|markdown|context` forms remain valid.
   - new preset fields are optional and additive.
2. Legacy response fields MUST remain:
   - `ok`, `errors`, `warnings`, `meta`, `voiceDiagnostics`.
3. Additive response fields are optional:
   - `issues`, `ruleset`.
4. Deterministic ordering requirement:
   - sort issues by `line -> ruleId -> message`.

## Change Checklist

1. Add/update tests in `packages/md-validator/tests`.
2. If API contract changes, update:
   - `packages/contracts/src/index.ts`
   - `docs/reference/agents-ssot.md`
   - `packages/md-validator/README.md`

