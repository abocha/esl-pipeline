# Versioning Model (Private Monorepo)

## Meta

- Audience: maintainers and AI agents.
- Authority Level: reference.
- Last Verified Against: 2026-09-12 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly or after release workflow changes.
- Status: `reference`.

## Summary

This repo uses a hybrid versioning model with two independent tracks:

1. Repo release version (`vX.Y.Z` tag + root `package.json` version) for deployment/release tracking.
2. Explicit contract versions for API and runtime compatibility surfaces.

This repository is private-only. npm publishing is not part of the release process.

## Sources Of Truth

1. Repo release version:

- Git tag `vX.Y.Z`.
- Root [`package.json`](../../package.json) `version` (must match tag without `v`).

2. Contract versions:

- [`packages/contracts/src/contract-versions.ts`](../../packages/contracts/src/contract-versions.ts).

## Contract Version Registry

Canonical contract keys:

1. `api`
2. `manifest`
3. `prompt`
4. `validator`
5. `db`

Additional DB release context: `DB_MIGRATION_HEAD` in the registry records the latest required
migration ID. Do not copy that volatile value into this policy; the registry and migration
directory are the source of truth when the head advances.

## Bump Policy (Contract-First SemVer)

1. Major bump:

- Breaking compatibility in any versioned contract.

2. Minor bump:

- Backward-compatible feature additions that extend contract or product surface.

3. Patch bump:

- Bug fixes, docs, ops, refactors, and internal hardening without contract breaks.

## Pull Request Release Labels

Each PR targeting `main` must have exactly one label:

1. `release:major`
2. `release:minor`
3. `release:patch`
4. `release:none`

The dedicated `Release Label Guard` workflow fails if none or multiple are present.

`release:none` is reserved for changes that do not alter a deployable release. The guard accepts it
only when the complete, count-validated PR file set is inside the repository's conservative
maintenance-only allowlist: GitHub metadata, non-runtime documentation, selected repository test
and documentation tooling, project-local Codex maintainer configuration under `.codex/**`, the
Hadolint runner, the exact CI/release-selection classifier modules, and explicitly named lint/editor
configuration.
Unknown or mixed paths require a normal release label.
`packages/batch-backend/prompt-assets/**` is runtime content copied into the backend image and always
requires a normal release.

Choosing `release:patch`, `release:minor`, or `release:major` is always safe even when a change could
qualify for `release:none`. The policy intentionally prefers an unnecessary release over suppressing
a potentially deployable one.

## Release Workflow

On each merged PR to `main`, a decision job revalidates the final label and changed-file policy.
For `release:patch`, `release:minor`, or `release:major`, it then:

1. Resolve release bump from PR label.
2. Compute next version from root `package.json`.
3. Update root `package.json` version + prepend `CHANGELOG.md` entry.
4. Create bot commit `chore(release): vX.Y.Z`.
5. Create and push tag `vX.Y.Z`.
6. Build and publish production `batch-backend`, `batch-frontend`, and `telegram-ops-bot` images to
   GHCR for `linux/amd64`, tagged with both the 40-character release-commit SHA and `vX.Y.Z`.

The release workflow publishes images but does not deploy them. Production deployment remains a
separate operator action using the immutable release SHA.

GHA build-cache export is best-effort because it is only a build acceleration. Image pushes and
unchanged-image reuse remain fail-closed. If publication fails after the release commit and tag
exist, do not deploy the incomplete bundle. Use the manual recovery workflow documented in
[`DEPLOYMENT.md`](../backend-frontend/DEPLOYMENT.md) to restore only the missing unchanged manifests
and verify the complete three-image bundle.

For a valid `release:none` merge, the complete release transaction is skipped: no root version or
changelog update, release commit, tag, or production image is created. Skipping only image
publication is forbidden because it would create a release SHA without a deployable image bundle.

Workflow file:

- [`/.github/workflows/release-on-merge.yml`](../../.github/workflows/release-on-merge.yml)
- [`/.github/workflows/recover-release-image-bundle.yml`](../../.github/workflows/recover-release-image-bundle.yml)
  for manual incident recovery only

## Contract Consistency Guard

Run at least in CI static checks:

```bash
pnpm release:verify:contracts
```

This validates:

1. Contract versions are valid semver.
2. `DB_MIGRATION_HEAD` matches latest migration in `packages/batch-backend/migrations`.

Pre-PR rule when migrations or schema baselines change:

1. Run `pnpm release:verify:contracts`.
2. Run `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline`.
3. If schema verification reports drift, regenerate with `pnpm --filter @esl-pipeline/batch-backend run db:generate-baseline` and commit the updated `packages/batch-backend/schema.sql`.

## Non-Goals

1. Supporting older runtime branches by default.
2. Publishing orchestrator to npm.
3. Maintaining Changesets as active release authority.
