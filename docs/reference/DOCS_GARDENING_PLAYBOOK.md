# Docs Gardening Playbook

## Meta

- Audience: maintainers and AI agents curating docs quality.
- Read Time: 5 minutes.
- Authority Level: operational playbook.
- Last Verified Against: 2026-05-12 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: weekly.
- Status: `reference`.

## Purpose

- Provide the repeatable workflow for the v2 docs-gardening harness.
- Keep the loop short: hard gate, generated report, heuristic queue, manual triage.

## Standard Loop

1. Run `pnpm docs:garden`.
2. If you are fixing docs-heavy work before merge, also run `pnpm docs:check`.
3. For plan-only lifecycle updates, run `pnpm docs:generate:plans-index` instead of regenerating
   every generated index.
4. Review the rolling issue queue.
5. Update docs, routing, archive state, or governance policy as needed.

## What Each Artifact Is For

- `docs:garden`: single harness entrypoint for the weekly gardening run.
- `docs:check`: hard gate for merge safety.
- `tmp/docs-gardening.json`: canonical structured snapshot for the run.
- `tmp/docs-gardening-issue.json` / `.md`: rolling issue payload generated from the snapshot.
- `tmp/docs-health-report.json` / `.md`: health snapshot and scorecard rendering.
- `tmp/docs-stale-active.json` / `.md`: heuristic queue for manual review.
- `tmp/docs-plan-lifecycle.json` / `.md`: hard-gated plan lifecycle, editability, and current-focus report.
- Rolling issue: triage surface for unresolved warnings and candidates.

## Triage Rules

### Fix now

- Broken links.
- Missing metadata or freshness in enforced scope.
- Route hints or governance requirements that are mechanically failing.
- Active plan lifecycle violations: completed/superseded plans under `docs/plans/`, missing exit
  triggers or current focus on routed active plans, non-editable active statuses, non-editable router
  targets, or orphan standalone plans.

### Review manually

- Stale-active candidates.
- Repeated warnings that are not yet hard failures.
- Ambiguous archive versus refresh decisions.
- P1 stale-by-age candidates in the weekly queue; authoritative docs should be verified first even
  when they are not yet hard-gate failures.

### Archive or split

- Docs that are no longer routed by active docs.
- Mixed-purpose docs that keep generating stale noise.
- Inventory-style docs that are better generated than hand-maintained.
- Low-signal content galleries should usually be tuned in the gardening config rather than routed
  just to satisfy generic no-route heuristics.
- Implementation plans should normally archive after their PR lands unless they remain explicit
  roadmaps.

## Habitual Checkpoints

- Keep router docs short.
- Keep generated artifacts data-first.
- Keep policy in governance docs, not in scripts or workflow comments.
- Keep the issue body readable for a stressed maintainer.

## Non-Goals

- Do not auto-archive on heuristic output alone.
- Do not expand the loop with extra manual steps unless they reduce false positives.
- Do not duplicate policy across multiple reference docs.

## Related

- [`docs/reference/DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/reference/DOCS_QUALITY_SCORE.md`](DOCS_QUALITY_SCORE.md)
