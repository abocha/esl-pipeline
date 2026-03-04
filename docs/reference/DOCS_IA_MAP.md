# Documentation IA Map (Agent Task Router)

## Meta

- Audience: AI agents and maintainers.
- Read Time: 3 minutes.
- Authority Level: Active routing map.
- Last Verified Against: 2026-03-04 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly.
- Status: `router`.

## Purpose

- Map common tasks to the smallest doc set needed for safe implementation.

## Canonical Sources

1. [`AGENTS.md`](../../AGENTS.md)
2. [`docs/README.md`](../README.md)
3. [`docs/reference/agents-ssot.md`](agents-ssot.md)

## Agent Task -> Doc Path

| Task | Read First | Then Read |
| --- | --- | --- |
| Repo orientation | `docs/PROJECT_OVERVIEW.md` | `docs/reference/agents-ssot.md` |
| Setup/run commands | `docs/QUICK_START.md` | `docs/reference/env.md` |
| Contracts/invariants | `docs/reference/agents-ssot.md` | `docs/backend-frontend/backend-frontend-alignment.md` |
| Markdown validator rules/rulesets | `docs/reference/MD_VALIDATOR_RULESET_CONVENTIONS.md` | `docs/reference/agents-ssot.md` |
| Backend/frontend capability status | `docs/backend-frontend/backend-frontend-alignment.md` | `docs/backend-frontend/BATCH_SYSTEM.md` |
| Prompt gallery DB runtime | `docs/operations/prompt-gallery-bootstrap.md` | `docs/reference/env.md` |
| Docker dev stack recovery | `docs/operations/docker-host-paths.md` | `docs/QUICK_START.md` |
| Postgres backup/restore routine | `docs/operations/postgres-backup-restore.md` | `docs/operations/postgres-backup-s3.md` |
| Ops health alerts and key checks | `docs/operations/postgres-ops-health.md` | `docs/reference/env.md` |
| PR workflow and release notes | `AGENTS.md` | `docs/operations/pr-style-release-notes.md` |
| Restart after context overload | `START_HERE.md` | `docs/playbooks/RESTART_TOMORROW.md` |

## Routing Rules

- Prefer active docs in `docs/` before archive docs.
- Use archive docs only for historical rationale.
- If docs conflict, SSOT and code win.

## Related

- [`docs/reference/DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/archive/README.md`](../archive/README.md)
