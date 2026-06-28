# Rollup Optional Binary Troubleshooting

## Meta

- Audience: maintainers and AI agents debugging local build/test runtime issues.
- Authority Level: operations troubleshooting runbook.
- Last Verified Against: 2026-06-28 repo state.
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
CI=true corepack pnpm install --reporter=append-only
```

Then rerun the failed test command.

On Windows PowerShell, use the same pinned pnpm via Corepack:

```powershell
$env:CI = 'true'
corepack pnpm install --reporter=append-only
```

## If It Still Fails

1. Remove the local install and reinstall using the same command above:

```bash
rm -rf node_modules
CI=true corepack pnpm install --reporter=append-only
```

2. Re-run a targeted command to verify:

```bash
CI=true corepack pnpm --filter @esl-pipeline/html-publisher test -- tests/rendering.test.ts
```

## Notes for Agents

- Prefer `corepack pnpm` so recovery uses the repo-pinned package manager version.
- Normal local pnpm commands use `storeDir: .pnpm-store/v11` from `pnpm-workspace.yaml`.
- If store-path drift is suspected, set `PNPM_STORE_DIR` to the repo-local `.pnpm-store/v11`
  explicitly for that recovery run instead of using a machine-specific absolute path.
- If Vitest fails before test discovery with Rollup module errors, treat dependency hydration as the first diagnostic step.
