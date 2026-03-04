# Documentation Governance (Agent-First)

## Meta

- Audience: maintainers and AI agents editing docs.
- Read Time: 3 minutes.
- Authority Level: Governance policy.
- Last Verified Against: 2026-03-04 repo state.
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
- `docs/reference/agents-ssot.md`
- `docs/backend-frontend/BATCH_SYSTEM.md`
- `docs/backend-frontend/backend-frontend-alignment.md`

## Active Ops Docs (Enforced In Phase 1)

- `docs/operations/docker-host-paths.md`
- `docs/operations/postgres-backup-restore.md`
- `docs/operations/postgres-backup-s3.md`
- `docs/operations/postgres-ops-health.md`
- `docs/operations/prompt-gallery-bootstrap.md`
- `docs/operations/pr-style-release-notes.md`
- `docs/operations/rollup-optional-binary-troubleshooting.md`

## Rules

- Keep router docs concise; avoid duplicating deep specs.
- Update core docs when behavior/status changes.
- Prefer archiving stale long docs over incremental patching.
- Do not use machine-local file URI links in active docs.
- If docs conflict, SSOT and code win.

## Operational Policy

Before merge for docs-heavy changes:

1. Run `pnpm docs:check`.
2. Generate report: `pnpm docs:health:report`.
3. Generate stale candidates: `pnpm docs:stale:active`.
4. Verify router chain is coherent:
   `AGENTS.md` -> `docs/README.md` -> `DOCS_IA_MAP.md` -> task docs.
5. Confirm archive docs are not presented as canonical.

## Metadata Contract (Enforced Scope)

Core + active-ops docs must include these `Meta` keys:

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
- `docs/reference/agents-ssot.md`: warning threshold `60` days in Phase 1.

## Rule Promotion Policy

When a docs issue repeats in review 2+ times:

1. Add a mechanical check under `scripts/docs`.
2. Update `scripts/docs/docs-check.config.json`.
3. Update this governance doc.

## Rule Promotion Changelog

### 2026-03-04

- Promoted metadata contract (`Audience`, `Authority Level`, `Last Verified Against`, `Owner`, `Review Cadence`, `Status`) to mechanical checks for core + active ops docs.
- Promoted freshness thresholds to mechanical checks (`core: 30 days`, `ops: 45 days`, `SSOT warning: 60 days`).
- Promoted route-hint integrity checks for router chain coherence.

## Related

- [`docs/reference/DOCS_IA_MAP.md`](DOCS_IA_MAP.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/reference/DOCS_QUALITY_SCORE.md`](DOCS_QUALITY_SCORE.md)
- [`docs/playbooks/DOC_GARDENING_PLAYBOOK.md`](../playbooks/DOC_GARDENING_PLAYBOOK.md)
- [`docs/archive/README.md`](../archive/README.md)
