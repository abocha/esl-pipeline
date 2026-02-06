# Documentation Router (Agent-First)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 2 minutes.
- Authority Level: Router.
- Last Verified Against: 2026-02-06 repo state.

## Purpose

- Route coding tasks to the smallest authoritative doc set.
- Preserve baseline repo understanding without reading code first.
- Keep active guidance short; keep history in archive.

## When To Read

- Immediately after `AGENTS.md`.
- Any time task scope is unclear.

## Canonical Sources

1. `AGENTS.md` (core bootstrap loaded on agent init).
2. `docs/reference/agents-ssot.md` (authoritative annex, read selectively).
3. `docs/backend-frontend/backend-frontend-alignment.md` (live backend/frontend status).
4. `docs/backend-frontend/BATCH_SYSTEM.md` (active system map).

## Current State

- Active docs are concise playbooks with explicit ownership.
- Detailed historical design and phased manuals are archived.
- Package-level details live in package READMEs.

## Do / Don't

- Do start with this order: `AGENTS.md` -> `docs/README.md` -> task-specific doc.
- Do prefer active docs over archive docs for implementation decisions.
- Don't treat archived docs as current source of truth.
- Don't duplicate status tables across active docs.

## Agent Start Path

- Need overall repo orientation: `docs/PROJECT_OVERVIEW.md`.
- Need run commands/setup: `docs/QUICK_START.md`.
- Need contracts/invariants: `docs/reference/agents-ssot.md`.
- Need backend/frontend readiness: `docs/backend-frontend/backend-frontend-alignment.md`.
- Need Docker mount/permissions troubleshooting: `docs/operations/docker-host-paths.md`.

## Related

- `docs/reference/DOCS_IA_MAP.md`
- `docs/reference/DOCS_GOVERNANCE.md`
- `docs/archive/README.md`
