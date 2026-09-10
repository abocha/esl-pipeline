# Rollup Optional Binary Troubleshooting

## Meta

- Audience: maintainers and AI agents debugging local build/test runtime issues.
- Authority Level: operations troubleshooting runbook.
- Last Verified Against: 2026-08-14 repo state.
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

## Toolchain Assumptions

- Use the Node version in [`.nvmrc`](../../.nvmrc), currently `24.21.0`.
- The root [`package.json`](../../package.json) pins pnpm `11.10.0`; use Corepack so the repository
  package-manager pin is selected.
- Host installs use `storeDir: .pnpm-store/v11` from
  [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml). There is no project `.npmrc` overriding it.
- Windows, Linux, and WSL need separate host `node_modules` trees. Do not copy a host install between
  those environments or into Docker.

## Quick Fix (Recommended)

From repo root:

```bash
corepack pnpm install --force --frozen-lockfile --reporter=append-only
```

Then rerun the failed test command.

On Windows PowerShell, use the same command from the Windows checkout:

```powershell
corepack pnpm install --force --frozen-lockfile --reporter=append-only
```

`--force` rehydrates the optional platform package while `--frozen-lockfile` prevents the recovery
from changing dependency resolution.

## If It Still Fails

1. Remove only the host install for the environment where the failure occurs, then reinstall with the
   same pinned command above.

   Windows PowerShell:

   ```powershell
   Remove-Item -LiteralPath node_modules -Recurse -Force -ErrorAction SilentlyContinue
   corepack pnpm install --force --frozen-lockfile --reporter=append-only
   ```

   Linux or WSL:

   ```bash
   rm -rf -- node_modules
   corepack pnpm install --force --frozen-lockfile --reporter=append-only
   ```

2. Re-run a targeted command to verify:

```bash
corepack pnpm --filter @esl-pipeline/html-publisher test -- tests/rendering.test.ts
```

If the failure occurs inside the Docker dev stack, removing host `node_modules` does not affect the
Docker named volumes. Run `pnpm docker:dev:clean-deps` followed by `pnpm docker:up`; that resets only
the `esl-pipeline` development dependency volumes and lets the `deps` service reinstall them.

## Notes for Agents

- Prefer `corepack pnpm` so recovery uses the repo-pinned package manager version.
- Keep the host store at the repository-local `.pnpm-store/v11`; do not replace it with a
  machine-specific absolute path during routine recovery.
- The missing package name is platform-specific: Windows should hydrate the `win32` optional Rollup
  package, while Linux/WSL should hydrate the matching `linux` package. Do not install a foreign
  platform binary manually.
- If Vitest fails before test discovery with Rollup module errors, treat dependency hydration as the first diagnostic step.
- For the Windows/WSL checkout rule and Docker dependency boundary, see
  [`windows-linux-dev.md`](windows-linux-dev.md) and
  [`docker-host-paths.md`](docker-host-paths.md).
