# Contributing

Thanks for helping improve the ESL pipeline! The notes below keep local development and releases aligned with what CI expects.

## Prerequisites

- Node.js 24.10.0 (`nvm use 24.10.0` or `asdf install nodejs 24.10.0`).
- pnpm 8+ (`corepack enable` installs the pinned version automatically).
- Docker Desktop or the Docker CLI for image builds.
- `ffmpeg` available on your `PATH` (or set the `FFMPEG_PATH` environment variable).

## Development Workflow

- Install dependencies with `pnpm install`.
- Lint and test everything via `pnpm lint`, `pnpm test`, and `pnpm --filter @esl-pipeline/orchestrator build`.
- Match CI locally by running:
  - `pnpm --filter @esl-pipeline/orchestrator/examples/service vitest run`
  - `pnpm --filter @esl-pipeline/orchestrator docker:build`
- Use `pnpm changeset` to record user-facing changes before merging.

## Release Process Overview

1. Merge any pending Changesets that describe the release.
2. Run `pnpm changeset version` followed by `pnpm install` to apply version bumps.
3. Review and polish `CHANGELOG.md` (see the template in `CHANGELOG.md`).
4. Commit the version update, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. Publish the orchestrator package with `pnpm --filter @esl-pipeline/orchestrator publish --access public`.
6. Optionally trigger the “Release” GitHub workflow for an automated publish using `NPM_TOKEN`.
