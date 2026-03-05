# Contributing

Thanks for helping improve the ESL pipeline! The notes below keep local development and releases aligned with what CI expects.

## Prerequisites

- Node.js 24.11.1 (`nvm use 24.11.1` or `asdf install nodejs 24.11.1`).
- pnpm 8+ (`corepack enable` installs the pinned version automatically).
- Docker Desktop or the Docker CLI for image builds.
- `ffmpeg` available on your `PATH` (or set the `FFMPEG_PATH` environment variable).

## Development Workflow

- Install dependencies with `pnpm install`.
- Lint and test everything via `pnpm lint`, `pnpm test`, and `pnpm -r build`.
- Match CI locally by running:
  - `pnpm typecheck`
  - `pnpm --filter @esl-pipeline/orchestrator test -- --runInBand`

## Release Process Overview

Release model is private-repo and merge-driven.

1. Ensure the PR has exactly one release label:
   - `release:major`
   - `release:minor`
   - `release:patch`
2. Run checks locally:
   - `pnpm release:verify:contracts`
   - `pnpm -r build`
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test`
3. Merge the PR into `main`.
4. GitHub Actions runs the release workflow and will:
   - compute the next version from PR label,
   - update root `package.json` and `CHANGELOG.md`,
   - create bot commit `chore(release): vX.Y.Z`,
   - create and push `vX.Y.Z` tag.

See:

- `docs/reference/VERSIONING_MODEL.md`
- `.github/workflows/release-on-merge.yml`
