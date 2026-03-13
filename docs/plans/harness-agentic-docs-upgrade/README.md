# Harness-Aligned Agentic Docs Upgrade - Next Phases

## Summary

This topic captures the remaining phases after the initial docs-governance baseline landed.

## Scope and Locked Decisions

1. Keep incremental rollout; avoid full-doc hard-fail coverage in one step.
2. Expand enforcement in two controlled waves:
   - backend/frontend active docs first,
   - selected package READMEs second.
3. Keep stale-doc tooling non-destructive (report-only).
4. Convert repeated review issues into checks via quarterly rule-promotion loop.

## Phase Index

1. [phase-3-enforcement-expansion-backend-frontend.md](phase-3-enforcement-expansion-backend-frontend.md)
2. [phase-4-enforcement-expansion-package-readmes.md](phase-4-enforcement-expansion-package-readmes.md)
3. [phase-5-gardening-calibration-and-rule-promotion.md](phase-5-gardening-calibration-and-rule-promotion.md)
4. [verification-acceptance-and-assumptions.md](verification-acceptance-and-assumptions.md)

## Operator Commands

1. `pnpm docs:generate:indexes`
1. `pnpm docs:check`
2. `pnpm docs:health:report`
3. `pnpm docs:stale:active`
