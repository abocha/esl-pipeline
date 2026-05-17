# Versioning Private Contracts Overhaul

## Meta

- Audience: maintainers and release/tooling agents.
- Authority Level: active release-system execution plan.
- Last Verified Against: 2026-05-17 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after release automation or contract-versioning PRs.
- Status: `active`.
- Exit Trigger: archive after the private release model and contract-version automation are fully implemented and represented in versioning docs.
- Current Focus: implement the private release-tag and contract-version automation until it is promoted into versioning docs.

## Summary

Implement a clean private-repo versioning model with deterministic release automation and explicit contract versions.

Core outcomes:

1. Private-only distribution model (no npm publish path).
2. Repo release tags (`vX.Y.Z`) on every merged PR.
3. Root `package.json` version always synchronized with release tag.
4. Explicit contract version registry for API/manifest/prompt/validator/DB.
5. CI guardrails for release labels and contract consistency.

## Decisions (Locked)

1. Release cadence: every merge.
2. Bump strategy: contract-first semver.
3. Required contract tracks: API + Manifest + Prompt + Validator + DB.
4. Changesets: remove from active release flow.
5. Orchestrator: private-only.
6. Historical tags: hard reset allowed and documented.
7. New baseline after reset: `v1.0.0`.
8. Repo version authority: both tag and root package version must match.
9. DB contract model: latest migration only, semver mirror + explicit migration head.

## Scope

In scope:

1. Contract version registry and exposure in shared contracts package.
2. Backend version metadata endpoint (`GET /meta/version`).
3. CI release-label guard.
4. Merge-time release automation workflow (commit + tag).
5. Docs and SSOT updates for private release model.
6. Tag reset runbook and archive scaffold.

Out of scope:

1. Actual remote tag deletion execution.
2. Runtime compatibility layer for older branches.
3. npm publication workflow.

## Important API / Interface / Type Changes

1. `@esl-pipeline/contracts` adds:

- contract version constants
- `CONTRACT_VERSIONS`
- `DB_MIGRATION_HEAD`
- `VersionMetaResponse`

2. Batch backend adds endpoint:

- `GET /meta/version`

Response shape:

```json
{
  "repoVersion": "2.3.0",
  "contracts": {
    "api": "1.0.0",
    "manifest": "1.0.0",
    "prompt": "1.0.0",
    "validator": "1.0.0",
    "db": "0.7.0",
    "dbMigrationHead": "0007_rls_readiness_artifacts"
  }
}
```

## File-by-File Implementation Plan

1. Contracts foundation:

- `packages/contracts/src/contract-versions.ts` (new)
- `packages/contracts/src/index.ts` (exports + DTO)

2. Backend endpoint:

- `packages/batch-backend/src/application/version-meta.ts` (new)
- `packages/batch-backend/src/transport/core-routes.ts` (`/meta/version`)
- `packages/batch-backend/tests/transport.http-server.integration.test.ts` (coverage)

3. Release scripts:

- `scripts/release/compute-next-version.mjs` (new)
- `scripts/release/resolve-release-bump-from-pr.mjs` (new)
- `scripts/release/verify-contract-version-consistency.mjs` (new)
- `scripts/release/write-release-files.mjs` (new)

4. Workflow automation:

- `.github/workflows/ci.yml` (PR release-label guard + contract consistency step)
- `.github/workflows/release-on-merge.yml` (new)

5. Policy and docs:

- `package.json` (remove changesets scripts/dependency; add release scripts)
- `packages/orchestrator/package.json` (`private: true`)
- `CONTRIBUTING.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/reference/agents-ssot.md`
- `docs/reference/DOCS_IA_MAP.md`
- `docs/operations/pr-style-release-notes.md`
- `docs/reference/VERSIONING_MODEL.md` (new)
- `docs/archive/release/versioning-tag-reset-runbook.md` (new; one-time reset record)
- `docs/archive/release/tag-history-pre-v1-reset.md` (new)

## Version Bump Matrix

1. Major:

- Breaking compatibility in any tracked contract.

2. Minor:

- Backward-compatible feature additions across contract/product surface.

3. Patch:

- Fixes/docs/ops/refactors with no contract break.

## CI / Release Workflow Spec

PR checks:

1. PR must include exactly one release label:

- `release:major`
- `release:minor`
- `release:patch`

2. Contract consistency checker must pass.

On merged PR to main:

1. Resolve bump from PR label.
2. Compute next semver.
3. Update root `package.json` + prepend changelog entry.
4. Bot commit `chore(release): vX.Y.Z`.
5. Tag `vX.Y.Z`.
6. Push commit and tag.

## Test Cases And Scenarios

1. Script unit behavior:

- release label parser fails on 0 or >1 labels.
- semver bump script computes major/minor/patch correctly.
- contract verifier fails on invalid semver constants.
- contract verifier fails when DB migration head is stale.

2. Backend route:

- `/meta/version` returns expected payload.
- `/meta/version` available even when extended API is disabled.

3. CI/Workflow:

- PR without release label fails guard.
- PR with conflicting release labels fails guard.
- merged PR creates synchronized commit + tag.

## Acceptance Criteria

1. Orchestrator is private and no active docs prescribe npm publishing.
2. CI enforces release-label and contract-version policy.
3. `/meta/version` exposes repo + contract versions.
4. Root `package.json` and release tag are synchronized per merge.
5. Tag reset runbook exists and historical tags are archived in docs.

## Assumptions

1. Repo remains private.
2. Release model is merge-driven, not calendar-driven.
3. Backward compatibility is not guaranteed unless explicitly required.
4. DB contract semver mirrors migration-head model.
