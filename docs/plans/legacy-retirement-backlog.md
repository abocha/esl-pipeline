# Legacy Retirement Backlog

## Summary

This document is the canonical source of truth for retiring legacy compatibility contracts across the repo.
It defines the backlog item schema, deterministic prioritization, release policy, and wave sequencing.

This slice is planning-only and introduces no runtime behavior changes.

## Backlog Item Schema (Canonical)

Every backlog item MUST include all fields below:

1. `id`
2. `surface`
3. `current_behavior`
4. `target_end_state`
5. `contract_class` (`public_api` | `runtime_internal` | `env` | `data_compat` | `docs_only`)
6. `breaking_level` (`none` | `additive` | `breaking`)
7. `risk` (`low` | `medium` | `high`)
8. `owner`
9. `dependencies`
10. `validation`
11. `docs_to_update`
12. `status` (`queued` | `in_progress` | `blocked` | `done`)

## Deterministic Prioritization Rubric

Sort items using this lexicographic order:

1. `public_contract_risk` (ascending)
2. `runtime_complexity` (ascending)
3. `blast_radius` (ascending)
4. `migration_readiness` (descending)
5. `id` (ascending tie-breaker)

Scoring values:

- `public_contract_risk`:
  - `0`: internal-only; no external API/env contract impact
  - `1`: external contract touched but preserved (dual-path/non-breaking)
  - `2`: external breaking change required
- `runtime_complexity`:
  - `0`: single module, no schema/transport coupling
  - `1`: multi-module in one package
  - `2`: cross-package or runtime+transport coordination
- `blast_radius`:
  - `0`: low traffic/admin path
  - `1`: common path with bounded callers
  - `2`: high traffic or broad consumer exposure
- `migration_readiness`:
  - `0`: no migration path defined
  - `1`: migration notes drafted
  - `2`: migration tooling and validation already available

## Release Policy For Retirement Items

Release labels MUST follow `docs/reference/VERSIONING_MODEL.md`:

1. `release:patch`
   - Internal retirements, docs-only updates, warning hardening, non-breaking refactors.
2. `release:minor`
   - Backward-compatible contract tightening, additive metadata, migration aids.
3. `release:major`
   - Breaking contract removals (deprecated route/field/env alias removal).

Each item must declare a required label before implementation PR creation.

## Wave Sequencing

Wave objectives:

1. Wave 1: low-risk internal retirements and warning hardening.
2. Wave 2: public-contract dual-path reductions with migration notes.
3. Wave 3: explicitly breaking removals with versioned communication.

Wave assignment table:

| id | wave | rationale | required_release_label |
| --- | --- | --- | --- |
| LR-006 | Wave 1 | Internal data-compat join cleanup after migration confirmation | release:patch |
| LR-007 | Wave 1 | Internal event bridge fallback channel retirement | release:patch |
| LR-008 | Wave 1 | Internal settings normalization cleanup with safe defaults retained | release:patch |
| LR-009 | Wave 1 | Internal constructor fallback retirement and startup hardening | release:patch |
| LR-010 | Wave 1 | Internal migration helper retirement after storage migration verification | release:patch |
| LR-011 | Wave 2 | Validation contract keeps legacy payload fields and legacy preset mapping | release:minor |
| LR-012 | Wave 2 | Parser accepts legacy fenced markdown inputs | release:minor |
| LR-013 | Wave 2 | TTS adapter accepts legacy `voice_id` field | release:minor |
| LR-002 | Wave 2 | Job submission dual-accept path for legacy `preset` | release:minor |
| LR-003 | Wave 2 | Timeline query accepts legacy `job_approved` filter alias | release:minor |
| LR-005 | Wave 2 | Generation env alias support for emergency override | release:minor |
| LR-001 | Wave 3 | Legacy status route alias removal (`/jobs/:jobId/status`) | release:major |
| LR-004 | Wave 3 | Manifest compatibility alias removal (`audio` -> `audioArtifacts.studyText`) | release:major |

## Per-Item Acceptance Contract

Every implementation PR for a backlog item MUST include:

1. Required tests
   - Unit and integration tests that cover both old and new behavior during migration windows.
2. Expected error/response contract behavior
   - Explicit assertions for status codes, response fields, and error codes when applicable.
3. Docs updates
   - Runtime/API docs and SSOT references updated in the same PR.
4. Required release label
   - Exactly one of `release:patch|release:minor|release:major` aligned to item requirements.

Detailed execution workflow and PR checklist live in `docs/plans/legacy-retirement-execution-playbook.md`.
