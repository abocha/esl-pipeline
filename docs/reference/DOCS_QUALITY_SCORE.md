# Docs Quality Scorecard

## Meta

- Audience: maintainers and AI agents.
- Read Time: 4 minutes.
- Authority Level: operational quality rubric.
- Last Verified Against: 2026-03-04 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: weekly (docs-gardening run).
- Status: `reference`.

## Purpose

- Provide objective quality scoring for the docs system.
- Track trendline and prioritize upgrades by measurable gaps.

## Rubric (0-10 per dimension)

1. Routing clarity
2. Authority/ownership clarity
3. Freshness and drift resistance
4. Mechanical enforceability
5. Ops runbook reliability
6. Archive hygiene
7. Agent onboarding speed

## Current Baseline (2026-03-04)

| Dimension | Score | Notes |
| --- | --- | --- |
| Routing clarity | 9.2 | Strong route chain and IA map coverage. |
| Authority/ownership clarity | 8.8 | SSOT precedence clear; owner metadata rollout in progress. |
| Freshness and drift resistance | 8.2 | Core docs refreshed; broader scope needs automated cadence. |
| Mechanical enforceability | 8.0 | Core checks in CI; ops and health artifacts being expanded. |
| Ops runbook reliability | 9.0 | Strong backup/ops/troubleshooting runbooks. |
| Archive hygiene | 8.9 | Active/archive split clear, with backend archive now added. |
| Agent onboarding speed | 8.6 | Good fast-path flow; can improve via score-driven grooming. |

**Composite (mean): 8.7 / 10**

## Current Measured Snapshot (Automated)

- Source: `tmp/docs-health-report.md` generated via `pnpm docs:health:report`.
- Timestamp: 2026-03-04T05:33:34.953Z.
- Composite: **9.83 / 10**

## Next Target

- Target composite by next monthly review: **9.9 / 10**

Priority levers:

1. Expand enforcement coverage to `docs/backend-frontend/*` (non-archive).
2. Add selected package READMEs (`orchestrator`, `batch-backend`, `batch-frontend`, `provider-runtime`) to checks.
3. Tune stale-doc heuristic weights and routing coverage to reduce false positives.

## Update Policy

- Update after each weekly docs-gardening run.
- Keep historical snapshots as dated sections below.

## Historical Snapshots

### 2026-03-04

- Baseline established at 8.7.
- Automated post-upgrade snapshot recorded at 9.83.
