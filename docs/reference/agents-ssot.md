# ESL Pipeline Agent Handbook (SSOT)

## Meta

- Audience: maintainers and AI agents implementing or reviewing repo behavior.
- Authority Level: authoritative contracts and invariants.
- Last Verified Against: 2026-05-16 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly and after contract-level changes.
- Status: `reference`.

This is the canonical repo contract. If it conflicts with `AGENTS.md`, router docs, or package READMEs, this document wins.

## Read Selectively

Start with `AGENTS.md` and `docs/README.md`, then use this file for hard rules:

- runtime and verification baseline
- ownership and extension boundaries
- forbidden changes
- contract-preserving workflows

For deep system maps, prefer the linked docs rather than growing this file again.

## Ownership Model

### Canonical package boundaries

- `@esl-pipeline/orchestrator`
  - canonical pipeline semantics and manifest behavior
  - library-only surface; no CLI/wizard/path-picker runtime
- `@esl-pipeline/batch-backend`
  - operational HTTP + worker surface
  - persistence, queuing, auth, and workflow orchestration
- `@esl-pipeline/batch-frontend`
  - operator UI over `batch-backend`
- supporting implementation packages
  - validation/parsing: `md-validator`, `pmd`
  - adapters/providers: `html-publisher`, `tts-*`, `stt-*`, `storage-uploader`
  - shared runtime utilities: `provider-runtime`, `shared-infrastructure`, `contracts`

### Source-of-truth rules

- pipeline semantics -> orchestrator
- public DTOs / transport payloads -> `@esl-pipeline/contracts`
- live capability status -> `docs/backend-frontend/backend-frontend-alignment.md`
- environment policy -> `docs/reference/env.md`
- operational procedures -> `docs/operations/*`

## Non-Negotiable Invariants

### Pipeline and runtime

- Do not bypass orchestrator contracts for pipeline behavior changes.
- Do not silently change stage order or meaning for validate/import/colorize/voice-plan/speech-plan/tts/upload/add-audio/manifest.
- Manifest behavior is contract-level; changes must be coordinated with tests and docs.
- New schema-5 study-text voice plans emit `ranked`, `deterministic`, or `fallback` resolution modes.
  Manifests containing the older `resolved` token normalize it to `deterministic` when read.
- Authored lesson Markdown stays provider-neutral. Provider capability resolution and expressive
  speech rendering happen after TTS provider/model selection.
- Rerun family selection is contract-level:
  - unchecked study-text / pronunciation families must preserve prior published artifacts and persisted family defaults
  - checked families must replace the published artifact for that family even when deterministic upload keys or hashes are unchanged
- `batch-backend` may orchestrate and persist work, but it must not invent alternate pipeline semantics.

### Contracts and compatibility

- Public request/response DTO changes must go through `@esl-pipeline/contracts`.
- Do not silently rename or repurpose manifest/config fields.
- Backward compatibility should remain unless a breaking change is explicit, planned, and versioned.
- Legacy compatibility paths should be retired deliberately, never by drift.

### Schema and persistence

- Database changes belong in versioned migrations.
- Runtime legacy schema patching is emergency-only and must not become the normal change path.
- Durable workflow state, action history, and lineage are backend responsibilities, not frontend inventions.

### Security and config

- Never hardcode secrets.
- Prefer canonical namespaced env vars over legacy aliases.
- Fail-safe defaults matter more than convenience defaults for auth, quotas, and mutating operations.

## Safe Change Rules

### When changing pipeline behavior

Update together:

- orchestrator code
- affected package tests
- this SSOT if the contract changes
- relevant runbook/reference docs

### When changing backend/frontend workflow behavior

Update together:

- backend or frontend implementation
- `docs/backend-frontend/backend-frontend-alignment.md`
- relevant package README
- `docs/reference/env.md` if config changed

### When changing docs/tooling/governance

Update together:

- `scripts/docs/*` and config
- docs governance/playbook docs
- routers if the doc graph changes

## Runtime and Verification Baseline

- Node.js 24.11.1+
- pnpm
- system ffmpeg where provider flows require it

Required repo checks for behavior changes:

- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm check:fast`

Docs-heavy changes also require:

- `pnpm docs:generate:indexes`
- `pnpm docs:check`

## Environment and Entrypoints

- Executable entrypoints should bootstrap env through shared `loadCliEnv()` or a thin wrapper around it.
- Do not reintroduce ad-hoc dotenv parsing.
- Host and container runtime contexts are different:
  - Compose-safe defaults stay canonical for containers.
  - Host-side tools should adapt internally instead of forcing env churn.

## High-Signal Task Routing

- pipeline/runtime behavior:
  - `packages/orchestrator/README.md`
  - `docs/PIPELINE_INTEGRATION_VISION.md`
- backend operational surface:
  - `packages/batch-backend/README.md`
  - `docs/backend-frontend/batch-backend-ssot.md`
- frontend workflow/state:
  - `packages/batch-frontend/README.md`
  - `docs/backend-frontend/backend-frontend-alignment.md`
- environment and providers:
  - `docs/reference/env.md`
  - `docs/reference/GENERATION_PROVIDER_POLICY.md`
  - `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`
- docs governance:
  - `docs/reference/DOCS_GOVERNANCE.md`

## Forbidden Shortcuts

- Do not use archive docs as current truth.
- Do not move active behavior explanations only into PR text or chat.
- Do not widen mutating operational surfaces without updating the relevant runbook and safety model.
- Do not treat package READMEs as substitutes for canonical contracts.

## Related

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/README.md`](../README.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../backend-frontend/backend-frontend-alignment.md)
- [`docs/reference/env.md`](env.md)
