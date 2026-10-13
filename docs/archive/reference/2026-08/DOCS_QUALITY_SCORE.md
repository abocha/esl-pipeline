# Docs Quality Scorecard

## Meta

- Audience: maintainers and AI agents.
- Read Time: 4 minutes.
- Authority Level: operational quality rubric.
- Last Verified Against: 2026-04-03 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: weekly (docs-gardening run).
- Status: `reference`.

## Purpose

- Track whether docs gardening is making the repo easier to route, trust, and maintain.
- Separate the stable rubric from the generated measurement snapshot.

## Rubric (0-10)

1. Routing clarity
2. Authority and ownership clarity
3. Freshness and drift resistance
4. Mechanical enforceability
5. Ops runbook reliability
6. Archive hygiene
7. Agent onboarding speed

## Current Baseline

- The living measurement snapshot is generated in `tmp/docs-health-report.md`.
- The rubric below is the durable target model; do not hand-edit the latest measured snapshot into this doc.

| Dimension                       | Baseline | Target | Notes                                                            |
| ------------------------------- | -------: | -----: | ---------------------------------------------------------------- |
| Routing clarity                 |      9.2 | >= 9.5 | Router chain is good; keep stale-route noise low.                |
| Authority and ownership clarity |      8.8 | >= 9.2 | SSOT and governance are clear; keep ownership metadata explicit. |
| Freshness and drift resistance  |      8.2 | >= 9.2 | Keep refresh cadence tight and stale candidates low.             |
| Mechanical enforceability       |      8.0 | >= 9.2 | Prefer checks over review-only guidance.                         |
| Ops runbook reliability         |      9.0 | >= 9.2 | Keep operational docs concise and current.                       |
| Archive hygiene                 |      8.9 | >= 9.2 | Reduce stale-active noise and preserve clear archive boundaries. |
| Agent onboarding speed          |      8.6 | >= 9.2 | Improve “read once, act correctly” behavior.                     |

## How To Use This Scorecard

- Read it as a trend rubric, not as a compliance log.
- Use `tmp/docs-health-report.md` for the current measured snapshot.
- Use `tmp/docs-stale-active.md` as the queue for the next manual cleanup pass.

## Targets

- Keep the composite trending upward, but prioritize the dimensions that reduce docs-gardening noise first.
- The practical order is:
  1. archive hygiene
  2. freshness/drift resistance
  3. mechanical enforceability
  4. onboarding speed

## Update Policy

- Refresh after each weekly docs-gardening run.
- Keep the historical trendline compact.
- Let the generated snapshot carry the exact current numbers.

## Related

- [`DOCS_GARDENING_SCORECARD.md`](DOCS_GARDENING_SCORECARD.md)
- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](../../../reference/DOCS_GARDENING_PLAYBOOK.md)
- [`Archived agentic docs model`](../2026-10/HARNESS_AGENTIC_DOCS_MODEL.md)
