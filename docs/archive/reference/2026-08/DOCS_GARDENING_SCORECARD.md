# Docs Gardening Scorecard

## Meta

- Audience: maintainers and AI agents measuring docs-health progress.
- Read Time: 4 minutes.
- Authority Level: operational scorecard.
- Last Verified Against: 2026-03-13 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: weekly or after major docs-governance changes.
- Status: `reference`.

## Purpose

- Track whether docs gardening is improving the repo in measurable ways.
- Complement the broader quality rubric in `DOCS_QUALITY_SCORE.md` with operational metrics and targets.

## Current Baseline (2026-03-13)

| Metric                             |   Current |                                   Target | Notes                                                              |
| ---------------------------------- | --------: | ---------------------------------------: | ------------------------------------------------------------------ |
| `pnpm docs:check`                  |      pass |                                     pass | Core, ops, and selected non-core scopes are green.                 |
| Docs health composite              |      9.83 |                                   >= 9.9 | Source: `tmp/docs-health-report.md`.                               |
| Stale active candidates            |         1 |                                     <= 3 | Remaining candidate is intentionally kept legacy-schema inventory. |
| Generated reference indexes        |         3 |                                       3+ | Backend routes, package READMEs, and plans inventory.              |
| Active docs with router coverage   | improving | explicit routing for all new active docs | Track via router reviews and stale-candidate reduction.            |
| Package README governance coverage | expanding |   top operational packages fully covered | `telegram-ops-bot` added to current governance scope.              |

## Operating Review Questions

1. Did a behavior change land without updating the relevant runbook or package README?
2. Did a new active doc land without router coverage from `docs/README.md` or `DOCS_IA_MAP.md`?
3. Is a hand-maintained inventory now a better fit for `docs/generated/`?
4. Did any archive move leave a stale active link behind?
5. Did repeated review comments result in a new rule or script update?

## Update Policy

- Refresh after weekly docs-gardening runs or meaningful governance/tooling changes.
- Keep entries compact and operational; this doc is a scorecard, not a narrative report.

## Related

- [`DOCS_QUALITY_SCORE.md`](DOCS_QUALITY_SCORE.md)
- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](../../../reference/DOCS_GARDENING_PLAYBOOK.md)
- [`docs/generated/README.md`](../../../generated/README.md)
