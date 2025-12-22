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

1. Update versions manually (root `package.json` plus any package releases in `packages/*`).
2. Review and polish `CHANGELOG.md` (see the template in `CHANGELOG.md`).
3. Run `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
4. Commit the version update, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. Publish the orchestrator package if needed: `pnpm --filter @esl-pipeline/orchestrator publish --access public`.
