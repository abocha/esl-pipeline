# Rollup Optional Binary Troubleshooting

## Meta

- Audience: maintainers and AI agents debugging local build/test runtime issues.
- Authority Level: operations troubleshooting runbook.
- Last Verified Against: 2026-05-12 repo state.
- Owner: maintainer + automation agents.
- Review Cadence: quarterly or after tooling upgrades.
- Status: `runbook`.

## Symptom

Running tests or Vitest-based commands fails with:

`Cannot find module @rollup/rollup-linux-x64-gnu`

Typical examples:

- `pnpm --filter @esl-pipeline/html-publisher test`
- `pnpm --filter @esl-pipeline/md-validator test`
- `pnpm --filter @esl-pipeline/pmd test`
- `pnpm --filter @esl-pipeline/batch-backend exec vitest ...`

## Cause

This is usually an optional dependency hydration issue in `node_modules` (often after partial installs,
store-path drift, or interrupted dependency setup).

## Quick Fix (Recommended)

From repo root:

```bash
CI=true PNPM_STORE_DIR=/home/abocha/.pnpm-store pnpm install --reporter=append-only
```

Then rerun the failed test command.

## If It Still Fails

1. Remove the local install and reinstall using the same command above:

```bash
rm -rf node_modules
CI=true PNPM_STORE_DIR=/home/abocha/.pnpm-store pnpm install --reporter=append-only
```

2. Re-run a targeted command to verify:

```bash
CI=true pnpm --filter @esl-pipeline/html-publisher test -- tests/rendering.test.ts
```

## Notes for Agents

- Prefer the explicit `PNPM_STORE_DIR=/home/abocha/.pnpm-store` form for reproducibility in this repo.
- Normal local pnpm commands use `storeDir: .pnpm-store/v10` from `pnpm-workspace.yaml`; the
  explicit `PNPM_STORE_DIR` form above is only for recovery runs that need a known-good host store.
- If Vitest fails before test discovery with Rollup module errors, treat dependency hydration as the first diagnostic step.
