# Phase 5 - Gardening Calibration and Rule Promotion Loop

## Summary

Harden the ongoing docs-gardening loop by reducing false positives and systematically promoting repeated review findings into mechanical checks.

## Goals

1. Keep weekly docs-gardening actionable and low-noise.
2. Institutionalize rule promotion from review feedback.
3. Keep docs quality score trend moving upward.

## In Scope

1. Improve stale-candidate signal quality.
2. Add governance changelog updates for promoted rules.
3. Add or refine checks for recurring review issues.
4. Confirm rolling issue workflow remains deduplicated and useful.

## Out of Scope

1. Auto-archiving docs from scripts.
2. Global docs IA redesign.

## Work Plan

1. Review 4-6 weekly runs of:
   - `tmp/docs-health-report.md`
   - `tmp/docs-stale-active.md`
2. Track recurring review comments; promote items repeated 2+ times.
3. For each promoted rule:
   - implement check in `scripts/docs/*`,
   - update `scripts/docs/docs-check.config.json`,
   - append entry in `docs/reference/DOCS_GOVERNANCE.md` rule-promotion changelog.
4. Recalibrate stale scoring weights where false positives dominate.
5. Update `docs/reference/DOCS_QUALITY_SCORE.md` monthly with objective snapshots.

## Exit Criteria

1. Rolling docs-gardening issue remains concise and actionable.
2. At least one recurring manual review issue is converted to a scripted check.
3. False-positive stale candidates decrease across two consecutive runs.

## Risks and Mitigations

1. Risk: overfitting checks to recent incidents.
   Mitigation: require repeated occurrence before promotion.
2. Risk: too many strict checks reduce iteration speed.
   Mitigation: stage new checks as warnings first when risk is unclear.
