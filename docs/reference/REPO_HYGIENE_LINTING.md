# Repo Hygiene Linting

Purpose: record which non-code lint tools are promoted in this repo, which are advisory only, and why.

## Current State

- Blocking in CI:
  - `actionlint`
  - `ShellCheck`
  - `dclint`
  - `Hadolint`
- Advisory only:
  - `SQLFluff` via `pnpm run lint:sqlfluff`
- Not promoted:
  - `editorconfig-checker`
  - `dotenv-linter`

## Why

- `actionlint`: high-signal for GitHub Actions mistakes; low noise.
- `ShellCheck`: high-signal for shell scripts already maintained in-repo.
- `dclint`: validates development and production Compose configuration.
- `Hadolint`: validates every tracked `Dockerfile*` through the official v2.14.0 image pinned by
  digest. The repository is mounted read-only, so local use requires Docker but not a native
  Hadolint installation.
- `SQLFluff`: useful for SQL debt review, but current migrations/schema produce too much legacy style noise for a blocking gate.
- `editorconfig-checker`: currently dominated by historical docs/archive indentation churn.
- `dotenv-linter`: currently dominated by key-order and example-surface drift rather than meaningful correctness issues.

## Commands

- Main code lint lane:
  - `pnpm lint`
  - Runs Biome for JS/TS/TSX/JSX/CSS/JSON and package-manifest linting.
- Formatting ownership:
  - Biome formats and sorts all `package.json` files and formats supported code files.
  - Core Prettier formats Markdown, YAML, and YML only.
- Repo hygiene lane:
  - `pnpm run lint:repo-hygiene`
  - Runs `actionlint` + `ShellCheck`.
- Docker configuration lane:
  - `pnpm docker:lint` runs both Compose and Dockerfile linting.
  - `pnpm docker:lint:compose` checks both Compose files.
  - `pnpm docker:lint:compose:fix` applies dclint fixes to the Compose files only.
  - `pnpm docker:lint:dockerfiles` runs containerized Hadolint across tracked Dockerfiles.
- SQL advisory lane:
  - `pnpm run lint:sqlfluff`

## CI Behavior

- GitHub Actions verifies the runner-provided ShellCheck, downloads checksum-verified Actionlint,
  and runs both in the static-checks job.
- Static checks run `pnpm docker:lint`, covering dclint and Hadolint.
- Biome is already part of CI because the main lint step runs `pnpm lint`.
- `SQLFluff` is intentionally not part of the blocking CI lane yet.

## Revisit Trigger

Revisit this setup when one of these becomes true:

- workflow or shell lint starts producing low-value noise
- SQL files are reformatted/calibrated enough for `SQLFluff` to become a truthful gate
- env/example file policy is tightened enough that `dotenv-linter` would catch real mistakes
- archive/docs formatting debt is reduced enough for `editorconfig-checker` to become useful
