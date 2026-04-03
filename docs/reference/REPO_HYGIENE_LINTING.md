# Repo Hygiene Linting

Purpose: record which non-code lint tools are promoted in this repo, which are advisory only, and why.

## Current State

- Blocking in CI:
  - `actionlint`
  - `ShellCheck`
- Advisory only:
  - `SQLFluff` via `pnpm run lint:sqlfluff`
- Not promoted:
  - `editorconfig-checker`
  - `dotenv-linter`

## Why

- `actionlint`: high-signal for GitHub Actions mistakes; low noise.
- `ShellCheck`: high-signal for shell scripts already maintained in-repo.
- `SQLFluff`: useful for SQL debt review, but current migrations/schema produce too much legacy style noise for a blocking gate.
- `editorconfig-checker`: currently dominated by historical docs/archive indentation churn.
- `dotenv-linter`: currently dominated by key-order and example-surface drift rather than meaningful correctness issues.

## Commands

- Main code lint lane:
  - `pnpm lint`
  - Runs Biome + specialized ESLint only.
- Repo hygiene lane:
  - `pnpm run lint:repo-hygiene`
  - Runs `actionlint` + `ShellCheck`.
- SQL advisory lane:
  - `pnpm run lint:sqlfluff`

## CI Behavior

- GitHub Actions installs and runs `actionlint` and `ShellCheck` in the static-checks job.
- Biome is already part of CI because the main lint step runs `pnpm lint`.
- `SQLFluff` is intentionally not part of the blocking CI lane yet.

## Revisit Trigger

Revisit this setup when one of these becomes true:

- workflow or shell lint starts producing low-value noise
- SQL files are reformatted/calibrated enough for `SQLFluff` to become a truthful gate
- env/example file policy is tightened enough that `dotenv-linter` would catch real mistakes
- archive/docs formatting debt is reduced enough for `editorconfig-checker` to become useful
