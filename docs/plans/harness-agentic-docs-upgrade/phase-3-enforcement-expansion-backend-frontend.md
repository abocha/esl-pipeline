# Phase 3 - Enforcement Expansion to Backend/Frontend Docs

## Summary

Expand docs enforcement coverage from Core + Active Ops to active non-archive docs under `docs/backend-frontend/`.

## Goals

1. Add backend/frontend docs to mechanical checks without breaking repo velocity.
2. Enforce metadata and freshness on these docs.
3. Preserve archive isolation and avoid false-positive churn.

## In Scope

1. Extend `scripts/docs/docs-check.config.json` with backend/frontend doc include list.
2. Add metadata coverage for the same files.
3. Apply freshness threshold policy to this scope (default 45 days).
4. Update docs with missing `Meta` fields and routing links where needed.
5. Add/adjust route hints if backend/frontend docs become router dependencies.

## Out of Scope

1. Package README enforcement.
2. Archive migration decisions.
3. Changes to non-doc runtime code.

## Work Plan

1. Identify active docs in `docs/backend-frontend/` excluding archive/historical files.
2. Add selected files to:
   - `core_docs` or a new explicit backend/frontend enforcement list,
   - `meta_required_docs`.
3. Apply missing metadata keys:
   - Audience
   - Authority Level
   - Last Verified Against
   - Owner
   - Review Cadence
   - Status
4. Run `pnpm docs:check` and fix failures until clean.
5. Regenerate reports:
   - `pnpm docs:health:report`
   - `pnpm docs:stale:active`
6. Update `docs/reference/DOCS_QUALITY_SCORE.md` with post-phase snapshot.

## Exit Criteria

1. `pnpm docs:check` passes with backend/frontend docs in enforced scope.
2. No missing-meta or stale-doc failures in newly enforced files.
3. CI passes with expanded enforcement set.

## Risks and Mitigations

1. Risk: noisy failures from stale but still useful docs.
   Mitigation: move truly historical content to archive and keep active subset enforced.
2. Risk: routing drift due to missing cross-links.
   Mitigation: add required route hints only for docs that are true route anchors.
