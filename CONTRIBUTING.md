# Contributing

Thanks for helping improve ESL Pipeline. This page is a compact entrypoint; the linked reference
documents own volatile runtime, validation, and release details.

## Prerequisites

- Use the Node.js version pinned in [`.nvmrc`](.nvmrc); the root `package.json` records the
  compatibility floor.
- Use Corepack with the pnpm version pinned by [`package.json`](package.json).
- Install `ffmpeg` on `PATH` when working on provider flows (or set `FFMPEG_PATH`).

Install dependencies with:

```bash
pnpm install
```

## Validation

Choose the smallest gate that covers the change. The canonical routing and CI-owned lanes are in
[`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md) and
[`docs/reference/TESTING_GUIDELINES.md`](docs/reference/TESTING_GUIDELINES.md).

- Documentation-only changes: `pnpm docs:generate:indexes`, `pnpm format`, and `pnpm docs:check`.
- Normal affected changes: `pnpm --silent run check:fast:agent`.
- Broad, shared-contract, or toolchain changes: `pnpm check:pre-pr` (use `pnpm check` when
  reproducing CI or changing migrations, database, workers, or integrations).
- Run the owning package's focused tests and build before the selected repository gate.

## Release overview

Every PR to `main` has exactly one release label: `release:none`, `release:patch`,
`release:minor`, or `release:major`. `release:none` is maintenance-only and is accepted only when
the complete changed-file set passes the release guard's allowlist; deployable or unknown changes
need a versioned label.

After a versioned PR is merged, the release workflow updates the root version and changelog,
creates the release commit and tag, and publishes the production images. It does not deploy them;
production deployment is a separate operator action.

See [`docs/reference/VERSIONING_MODEL.md`](docs/reference/VERSIONING_MODEL.md) for the policy and
[`.github/workflows/release-on-merge.yml`](.github/workflows/release-on-merge.yml) for the workflow.
