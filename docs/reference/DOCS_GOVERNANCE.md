# Documentation Governance (Agent-First)

## Meta

- Audience: maintainers and AI agents editing docs.
- Read Time: 3 minutes.
- Authority Level: Governance policy.
- Last Verified Against: 2026-02-06 repo state.

## Purpose

- Keep active docs reliable, concise, and low-drift.
- Define what stays active vs what gets archived.

## When To Read

- Before creating/restructuring docs.
- During PRs that change behavior or status.

## Canonical Sources

1. `AGENTS.md`
2. `docs/reference/agents-ssot.md`
3. `docs/reference/DOCS_IA_MAP.md`

## Current State

- Active docs are concise playbooks.
- Historical detail lives under `docs/archive/<domain>/<yyyy-mm>/`.

## Rules

- Keep active docs task-oriented and non-redundant.
- Archive stale or needlessly detailed text by default.
- Link active docs to active sources first; label archive links as historical.
- Avoid machine-local links (`file://`) and outdated path aliases.

## Length Caps (Enforced)

- top-level guides: `<=120` lines
- operational/spec docs: `<=180` lines
- alignment status doc: `<=220` lines

## Do / Don't

- Do update status docs when capability readiness changes.
- Do keep SSOT authoritative and read selectively for deep contract checks.
- Do treat `pnpm deps:audit:strict` as a required CI and maintenance gate.
- Don't keep long historical implementation narratives in active docs.

## Dependency Audit Gate

- `pnpm deps:audit:strict` must stay green in CI and before merge for admin/chore work.
- If it fails, resolve by removing unused deps, moving mis-scoped deps, or adding missing deps.
- Do not bypass this gate by disabling checks in scripts or workflows.

## Related

- `docs/reference/DOCS_IA_MAP.md`
- `docs/archive/README.md`
