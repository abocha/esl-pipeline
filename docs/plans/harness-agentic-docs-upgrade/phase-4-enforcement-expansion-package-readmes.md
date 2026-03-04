# Phase 4 - Enforcement Expansion to Selected Package READMEs

## Summary

Add targeted package README docs to mechanical docs checks to improve agent onboarding at package boundary level.

Selected packages (locked):

1. `packages/orchestrator/README.md`
2. `packages/batch-backend/README.md`
3. `packages/batch-frontend/README.md`
4. `packages/provider-runtime/README.md`

## Goals

1. Ensure package entry docs are current, consistent, and machine-checkable.
2. Strengthen onboarding speed and authority clarity near implementation surfaces.

## In Scope

1. Add selected package READMEs to enforced docs config.
2. Require Meta contract fields in each selected README.
3. Enforce link integrity for references inside these READMEs.
4. Apply freshness threshold (45 days unless tightened later).

## Out of Scope

1. Enforcing all package READMEs.
2. Broad package architecture refactors.

## Work Plan

1. Confirm each selected README exists; create missing README if needed.
2. Add each README to `meta_required_docs` and enforcement include list.
3. Add or normalize `Meta` sections in selected README files.
4. Validate cross-links to SSOT/router docs where appropriate.
5. Run:
   - `pnpm docs:check`
   - `pnpm docs:health:report`
6. Tune config only for proven false positives (do not weaken core rules by default).

## Exit Criteria

1. All selected package READMEs pass metadata/freshness/link checks.
2. CI is green with expanded scope.
3. `docs-health-report` composite score remains >= 9.7.

## Risks and Mitigations

1. Risk: package README variance increases initial failure count.
   Mitigation: enforce only selected high-value READMEs in this phase.
2. Risk: stale content hidden behind passing metadata.
   Mitigation: include substantive manual review during phase execution.

