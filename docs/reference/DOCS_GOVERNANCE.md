# Documentation Governance (v2 Harness)

## Meta

- Audience: maintainers and AI agents editing docs.
- Read Time: 3 minutes.
- Authority Level: governance policy.
- Last Verified Against: 2026-06-12 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after docs-tooling changes.
- Status: `reference`.

## Purpose

- Keep the docs system agent-friendly, high-signal, and mechanically checkable.
- Define the v2 docs-gardening contract: hard gates, warnings, heuristics, manual review queue, rolling issue lifecycle, and data-first artifacts.

## Harness Contract

- `docs:check` is the hard gate.
- Docs health and stale-candidate outputs are warning/triage artifacts, not policy sources.
- The rolling issue is the manual review queue for unresolved warnings, heuristic candidates, and repeated drift.
- Generated artifacts are the source of truth for each run; markdown summaries are renderings of those artifacts.
- `pnpm docs:garden` emits the full artifact family for that run, including health and stale-active
  reports, so the GitHub workflow does not advertise files that were produced by separate commands.
- `pnpm docs:generate:plans-index` refreshes only the plan lifecycle index for plan-only changes.
- Plan lifecycle checks are hard gates: active plans stay under `docs/plans/`; completed or
  superseded execution plans move to `docs/archive/plans/`.

## Lifecycle States

- `router`: directs readers to the right authoritative docs.
- `active`: current implementation guidance.
- `reference`: contract or policy source of truth.
- `runbook`: operational procedure.
- `spec`: active design boundary or model.
- `roadmap`: sequenced plan.
- `generated`: machine-produced lookup aid.
- `archive`: historical, non-authoritative material.

## Enforcement Model

### Hard gates

- Broken links, missing routes, missing metadata, and freshness violations are hard failures where the scope is enforced.
- `docs:check` should remain the only gate that blocks merge on those violations.

### Warnings

- Warnings are allowed for trends that need attention but do not yet justify a merge block.
- The current warning surface is the docs-health snapshot, especially repository-wide freshness or quality drift.

### Heuristics

- Heuristics are advisory only.
- Stale-active candidates are meant to guide human review, not to auto-archive anything.
- Manual review decides whether to archive, refresh, re-route, or ignore a candidate.
- Low-signal content corpora can be included in docs scans without receiving route-coverage
  pressure; this keeps generated/template galleries from crowding out actionable docs work.
- Plan lifecycle output distinguishes editable active plans, active-tree historical trace, archived
  trace, and router/editability contradictions so agents do not patch stale implementation intent.

## Rolling Issue Policy

- Keep one open rolling issue for docs-gardening findings.
- Update the issue body from the latest structured artifacts.
- Close it only when the latest run has no hard failures, no meaningful warnings, and no active stale candidates.
- Treat it as a queue, not as a changelog.

## Update Rules

- Update core docs when behavior, scope, or contracts change.
- Update this doc when the harness model changes.
- Keep the policy concise here; move operational steps to the playbook.

## Related

- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](DOCS_GARDENING_PLAYBOOK.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/reference/DOCS_QUALITY_SCORE.md`](DOCS_QUALITY_SCORE.md)
- [`docs/reference/DOCS_GARDENING_SCORECARD.md`](DOCS_GARDENING_SCORECARD.md)
