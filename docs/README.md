# Documentation Router

## Meta

- Audience: AI agents and maintainers.
- Read Time: 1 minute.
- Authority Level: router.
- Last Verified Against: 2026-08-12 repository routes.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after documentation-topology changes.
- Status: `router`.

## Start Here

1. Read [`AGENTS.md`](../AGENTS.md), then this router.
2. Read the smallest category entrypoint below.
3. Use the detailed [`Documentation IA map`](reference/DOCS_IA_MAP.md) only when the category does
   not resolve the task.
4. Read [`agents-ssot.md`](reference/agents-ssot.md) whenever contracts, invariants, validation,
   production, or repository administration are involved.

## Categories

| Need                                          | Start with                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Repository orientation or local development   | [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) or [`QUICK_START.md`](QUICK_START.md) |
| Product/runtime contracts and system behavior | [`reference/`](reference/) and the owning package README                           |
| Operations or a current procedure             | [`operations/README.md`](operations/README.md)                                     |
| Product/design work                           | [`design/README.md`](design/README.md)                                             |
| Durable active planning                       | [`plans/README.md`](plans/README.md)                                               |
| Documentation upkeep and routing              | [`reference/DOCS_GOVERNANCE.md`](reference/DOCS_GOVERNANCE.md)                     |
| Named-task execution context                  | [`superpowers/README.md`](superpowers/README.md)                                   |
| Unfinished/disposable exploration             | [`drafts/README.md`](drafts/README.md)                                             |
| Historical rationale or prior execution       | [`archive/README.md`](archive/README.md)                                           |
| Generated inventories                         | [`generated/README.md`](generated/README.md)                                       |

## Lifecycle Boundaries

- `docs/plans/**` is the only durable active planning system.
- `docs/superpowers/**` is named-task execution context, not general current truth.
- `docs/drafts/**` is non-authoritative and excluded from normal task routing.
- Dated operational evidence records a bounded observation; it never replaces the current procedure.
- `docs/archive/**` is historical and non-authoritative.

## Routing Rules

- Prefer current references, runbooks, and package READMEs over task artifacts or archive material.
- Re-read the exact active plan after context loss; use the recovery procedure in
  [`playbooks/RESTART_TOMORROW.md`](playbooks/RESTART_TOMORROW.md), not a stale handoff record.
- If documentation conflicts, code and [`agents-ssot.md`](reference/agents-ssot.md) win.
