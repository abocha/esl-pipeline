# Documentation Governance (Agent-First)

## Meta

- Audience: maintainers and AI agents editing docs.
- Read Time: 3 minutes.
- Authority Level: Governance policy.
- Last Verified Against: 2026-03-10 repo state.
- Last Verified Against: 2026-03-13 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly.
- Status: `reference`.

## Purpose

- Keep active docs reliable, concise, and discoverable.
- Define lifecycle states and maintenance rules.

## Canonical Sources

1. [`AGENTS.md`](../../AGENTS.md)
2. [`docs/README.md`](../README.md)
3. [`docs/reference/agents-ssot.md`](agents-ssot.md)

## Doc Lifecycle States

- `router`: directs readers to authoritative docs.
- `active`: current implementation guidance.
- `reference`: contract/spec-level source of truth.
- `runbook`: operations/procedure guidance.
- `spec`: active design boundary or model doc.
- `roadmap`: sequenced plan or multi-phase delivery doc.
- `generated`: machine-produced reference index.
- `archive`: historical, non-authoritative material.

## Core Docs (Highest Maintenance Priority)

- `AGENTS.md`
- `README.md`
- `START_HERE.md`
- `docs/README.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/QUICK_START.md`
- `docs/reference/DOCS_IA_MAP.md`
- `docs/reference/DOCS_GOVERNANCE.md`
- `docs/reference/VERSIONING_MODEL.md`
- `docs/reference/agents-ssot.md`
- `docs/backend-frontend/BATCH_SYSTEM.md`
- `docs/backend-frontend/backend-frontend-alignment.md`

## Active Ops Docs (Enforced)

- `docs/operations/docker-host-paths.md`
- `docs/operations/postgres-backup-restore.md`
- `docs/operations/postgres-backup-s3.md`
- `docs/operations/postgres-ops-health.md`
- `docs/operations/prompt-gallery-bootstrap.md`
- `docs/operations/pr-style-release-notes.md`
- `docs/operations/rollup-optional-binary-troubleshooting.md`
- `docs/operations/telegram-ops-control-panel.md`
- `docs/operations/voice-alignment-v2-runbook.md`

## Selected Non-Core Docs (Enforced)

- `docs/backend-frontend/DEPLOYMENT.md`
- `docs/backend-frontend/batch-backend-ssot.md`
- `docs/reference/env.md`
- `docs/reference/pipeline-manifest.md`
- `docs/reference/ORCHESTRATOR_API_V2_MIGRATION.md`
- `docs/reference/GENERATION_PROVIDER_POLICY.md`
- `docs/reference/AGENT_LEGIBILITY_MODEL.md`
- `docs/reference/DOCS_GARDENING_PLAYBOOK.md`
- `docs/reference/DOCS_GARDENING_SCORECARD.md`
- `docs/plans/README.md`
- `packages/orchestrator/README.md`
- `packages/batch-backend/README.md`
- `packages/batch-frontend/README.md`
- `packages/telegram-ops-bot/README.md`
- `packages/provider-runtime/README.md`

## Rules

- Keep router docs concise; avoid duplicating deep specs.
- Update core docs when behavior/status changes.
- Prefer archiving stale long docs over incremental patching.
- Generated docs under `docs/generated/` are reference-only lookup aids, not policy sources.
- Do not use machine-local file URI links in active docs.
- If docs conflict, SSOT and code win.

## Archive Discipline

- Archive when a doc is no longer routed by active docs or is superseded by a better active source.
- Do not archive a doc that is still the only explanation of a live decision or still linked from SSOT/router docs.
- Every archive move must update:
  - the relevant archive index
  - active router links
  - replacement pointers when they exist

## Package README Policy

- Operational package READMEs must document:
  - package role
  - current runtime/public surface
  - related env/runbook links
  - validation commands
- Package READMEs should link to deeper runbooks/reference docs instead of duplicating long specs.

## Operational Policy

Before merge for docs-heavy changes:

1. Regenerate indexes when repo inventories changed: `pnpm docs:generate:indexes`.
2. Run `pnpm docs:check`.
3. Generate report: `pnpm docs:health:report`.
4. Generate stale candidates: `pnpm docs:stale:active`.
5. Verify router chain is coherent:
   `AGENTS.md` -> `docs/README.md` -> `DOCS_IA_MAP.md` -> task docs.
6. Confirm archive docs are not presented as canonical.

## Metadata Contract (Enforced Scope)

Core + active-ops + selected non-core docs must include these `Meta` keys:

- `Audience`
- `Authority Level`
- `Last Verified Against` (ISO date)
- `Owner`
- `Review Cadence`
- `Status` (`router`, `active`, `reference`, `runbook`)

Checks are configured in:
`scripts/docs/docs-check.config.json`

## Freshness Policy (Enforced Scope)

- Core docs: max age `30` days from `Last Verified Against`.
- Active ops docs: max age `45` days.
- Selected non-core docs: max age `45` days.
- `docs/reference/agents-ssot.md`: warning threshold `60` days.

## Rule Promotion Policy

When a docs issue repeats in review 2+ times:

1. Add a mechanical check under `scripts/docs`.
2. Update `scripts/docs/docs-check.config.json`.
3. Update this governance doc.

## Rule Promotion Changelog

### 2026-03-13

- Added explicit agent-legibility and docs-gardening reference docs, plus a generated-docs router.
- Expanded enforcement scope to include `docs/operations/telegram-ops-control-panel.md`, `docs/operations/voice-alignment-v2-runbook.md`, `docs/plans/README.md`, the new gardening reference docs, and `packages/telegram-ops-bot/README.md`.
- Added generated-reference policy and promoted `pnpm docs:generate:indexes` into the standard docs-heavy change loop.

### 2026-03-10

- Expanded selected non-core enforcement to high-impact reference docs (`docs/reference/env.md`, `docs/reference/pipeline-manifest.md`, `docs/reference/ORCHESTRATOR_API_V2_MIGRATION.md`, `docs/reference/GENERATION_PROVIDER_POLICY.md`).
- Applied required metadata/freshness normalization for the new reference-doc scope under hard-fail `non_core` checks.

### 2026-03-09

- Expanded enforced scope with selected non-core docs (`docs/backend-frontend/DEPLOYMENT.md`, `docs/backend-frontend/batch-backend-ssot.md`, and four package READMEs).
- Added non-core freshness threshold enforcement (`non_core: 45 days`) and promoted hard-fail `docs:check` gating for this scope.
- Expanded docs health and stale-active reporting to include selected non-core scope.

### 2026-03-04

- Promoted metadata contract (`Audience`, `Authority Level`, `Last Verified Against`, `Owner`, `Review Cadence`, `Status`) to mechanical checks for core + active ops docs.
- Promoted freshness thresholds to mechanical checks (`core: 30 days`, `ops: 45 days`, `SSOT warning: 60 days`).
- Promoted route-hint integrity checks for router chain coherence.

## Related

- [`docs/reference/DOCS_IA_MAP.md`](DOCS_IA_MAP.md)
- [`docs/reference/AGENT_LEGIBILITY_MODEL.md`](AGENT_LEGIBILITY_MODEL.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](DOCS_GARDENING_PLAYBOOK.md)
- [`docs/reference/DOCS_GARDENING_SCORECARD.md`](DOCS_GARDENING_SCORECARD.md)
- [`docs/reference/DOCS_QUALITY_SCORE.md`](DOCS_QUALITY_SCORE.md)
- [`docs/generated/README.md`](../generated/README.md)
- [`docs/archive/README.md`](../archive/README.md)
