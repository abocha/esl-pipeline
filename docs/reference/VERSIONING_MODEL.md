# Versioning Model (Private Monorepo)

## Meta

- Audience: maintainers and AI agents.
- Authority Level: reference.
- Last Verified Against: 2026-07-14 repo state.
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

Additional DB release context: `dbMigrationHead` records the latest required migration ID. At this
verification point it is `0043_manual_transcript_source`; the registry and migration directory are
the source of truth when this value advances.

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

The dedicated `Release Label Guard` workflow fails if none or multiple are present.

## Release Workflow

On each merged PR to `main`:

1. Resolve release bump from PR label.
2. Compute next version from root `package.json`.
3. Update root `package.json` version + prepend `CHANGELOG.md` entry.
4. Create bot commit `chore(release): vX.Y.Z`.
5. Create and push tag `vX.Y.Z`.
6. Build and publish production `batch-backend`, `batch-frontend`, and `telegram-ops-bot` images to
   GHCR for `linux/amd64`, tagged with both the 40-character release-commit SHA and `vX.Y.Z`.

The release workflow publishes images but does not deploy them. Production deployment remains a
separate operator action using the immutable release SHA.

Workflow file:

- [`/.github/workflows/release-on-merge.yml`](../../.github/workflows/release-on-merge.yml)

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
