# Docs Quality Scorecard

## Meta

- Audience: maintainers and AI agents.
- Read Time: 4 minutes.
- Authority Level: operational quality rubric.
- Last Verified Against: 2026-03-13 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: weekly (docs-gardening run).
- Status: `reference`.

## Purpose

- Provide objective quality scoring for the docs system.
- Track trendline and prioritize upgrades by measurable gaps.
- Complement the operational gardening scorecard with a broader quality rubric.

## Rubric (0-10 per dimension)

1. Routing clarity
2. Authority/ownership clarity
3. Freshness and drift resistance
4. Mechanical enforceability
5. Ops runbook reliability
6. Archive hygiene
7. Agent onboarding speed

## Current Baseline (2026-03-04)

| Dimension                      | Score | Notes                                                       |
| ------------------------------ | ----- | ----------------------------------------------------------- |
| Routing clarity                | 9.2   | Strong route chain and IA map coverage.                     |
| Authority/ownership clarity    | 8.8   | SSOT precedence clear; owner metadata rollout in progress.  |
| Freshness and drift resistance | 8.2   | Core docs refreshed; broader scope needs automated cadence. |
| Mechanical enforceability      | 8.0   | Core checks in CI; ops and health artifacts being expanded. |
| Ops runbook reliability        | 9.0   | Strong backup/ops/troubleshooting runbooks.                 |
| Archive hygiene                | 8.9   | Active/archive split clear, with backend archive now added. |
| Agent onboarding speed         | 8.6   | Good fast-path flow; can improve via score-driven grooming. |

**Composite (mean): 8.7 / 10**

## Current Measured Snapshot (Automated)

- Source: `tmp/docs-health-report.md` generated via `pnpm docs:health:report`.
- Timestamp: 2026-03-09T17:15:40.944Z.
- Composite: **9.83 / 10**

## Next Target

- Target composite by next monthly review: **9.9 / 10**

Priority levers:

1. Improve archive hygiene from `8.8` to `>= 9.2` by reducing stale-active noise and ambiguity.
2. Tune stale-doc heuristic weights and routing coverage to reduce false positives.
3. Promote one recurring stale-candidate review issue into an additional scripted check.

## Update Policy

- Update after each weekly docs-gardening run.
- Keep historical snapshots as dated sections below.

## Historical Snapshots

### 2026-03-10 (wave 2 reference expansion)

- Expanded hard-fail selected non-core enforcement to `docs/reference/env.md`, `docs/reference/pipeline-manifest.md`, `docs/reference/ORCHESTRATOR_API_V2_MIGRATION.md`, and `docs/reference/GENERATION_PROVIDER_POLICY.md`.
- Health report now checks `27` docs across `core`, `ops`, and `non_core`.
- Composite remained stable at 9.83 after expansion.

### 2026-03-09 (non-core enforcement expansion)

- Expanded hard-fail docs enforcement to selected non-core docs (`docs/backend-frontend/DEPLOYMENT.md`, `docs/backend-frontend/batch-backend-ssot.md`, and four package READMEs).
- Health report now checks `23` docs across `core`, `ops`, and `non_core`.
- Composite remained stable at 9.83 after expansion.

### 2026-03-09

- Weekly docs-gardening run completed (`pnpm docs:check`, `pnpm docs:health:report`, `pnpm docs:stale:active`).
- Automated snapshot remained stable at 9.83.
- No `docs:check` errors or warnings detected.

### 2026-03-04

- Baseline established at 8.7.
- Automated post-upgrade snapshot recorded at 9.83.

## Related

- [`docs/reference/DOCS_GARDENING_SCORECARD.md`](DOCS_GARDENING_SCORECARD.md)
- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](DOCS_GARDENING_PLAYBOOK.md)
