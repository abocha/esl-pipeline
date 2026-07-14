# Harness-Aligned Agentic Docs Upgrade - Next Phases

## Meta

- Audience: maintainers and docs-tooling agents.
- Authority Level: archived docs-tooling roadmap.
- Last Verified Against: 2026-07-14 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after docs-tooling implementation PRs.
- Status: `archived`.
- Exit Trigger: archive after the remaining docs-tooling phases are implemented or superseded by docs governance.
- Archive Reason: all listed phases are complete and current policy now lives in docs governance,
  gardening guidance, scripts, and CI.

## Summary

This topic captures the remaining phases after the initial docs-governance baseline landed.

## Scope and Locked Decisions

1. Keep incremental rollout; avoid full-doc hard-fail coverage in one step.
2. Expand enforcement in two controlled waves:
   - backend/frontend active docs first,
   - selected package READMEs second.
3. Keep stale-doc tooling non-destructive (report-only).
4. Convert repeated review issues into checks via quarterly rule-promotion loop.

## Historical Trace

Archived phase details remain available for rationale, but this README is the active edit surface.

1. [phase-3-enforcement-expansion-backend-frontend.md](../../archive/plans/harness-agentic-docs-upgrade/phase-3-enforcement-expansion-backend-frontend.md)
2. [phase-4-enforcement-expansion-package-readmes.md](../../archive/plans/harness-agentic-docs-upgrade/phase-4-enforcement-expansion-package-readmes.md)
3. [phase-5-gardening-calibration-and-rule-promotion.md](../../archive/plans/harness-agentic-docs-upgrade/phase-5-gardening-calibration-and-rule-promotion.md)
4. [verification-acceptance-and-assumptions.md](../../archive/plans/harness-agentic-docs-upgrade/verification-acceptance-and-assumptions.md)

## Operator Commands

1. `pnpm docs:generate:indexes`
1. `pnpm docs:check`
1. `pnpm docs:health:report`
1. `pnpm docs:stale:active`
