# Windows and Linux Development

Source review: `.gitattributes` and `.editorconfig` require LF text files; `pnpm-workspace.yaml`
sets the host store to `.pnpm-store/v11` and workspace injection on. Compose mounts the selected
checkout at `/app`, keeps container dependency directories and `/pnpm/store` in named volumes, and
overrides workspace injection off for its non-frozen dependency hydration. That hydration can affect
the bind-mounted lockfile; a host install restores the workspace configuration declared by the repo.
No host-specific files, permissions, running Compose project or dependency state were inspected.

## Meta

- Audience: maintainers and AI agents running the repo from Windows, Linux, or WSL.
- Authority Level: operations runbook.
- Last Verified Against: 2026-06-28 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly or after local workflow changes.
- Status: `runbook`.

The repo has one supported development shape across Windows, Linux, and WSL. Keep the codebase unified; only local state differs by machine.

For ordinary pre-production product rehearsal, prefer the
[`hybrid local smoke workflow`](local-product-smoke.md): host-native pnpm/tsx/Vite with only isolated
PostgreSQL/Redis in Docker. It avoids Windows source bind-mount overhead without moving the checkout.
The full Docker stack below remains available for runtime fidelity and Docker-specific debugging.

## Core Cross-Platform Flow

Run these from the checkout you intend to edit:

```bash
corepack enable
pnpm install
pnpm --filter @esl-pipeline/<package> test
pnpm docker:up
```

On Windows, run the same commands from PowerShell. The root `docker:prepare` script is Node-based, so it does not require Bash. Hosted PR CI is the comprehensive merge gate; use its exact job commands for failure reproduction.

## Docker Bind-Mount Rule

Docker Compose binds the current checkout into `/app`. If you switch between a WSL checkout and a Windows checkout, restart Compose from the checkout you want Docker to use:

```bash
pnpm docker:dev:down
pnpm docker:up
docker compose -p esl-pipeline -f docker-compose.yml ps
```

Compose uses the checkout path from which the command is run; this compose file does not label the
active host checkout path. Check the command's working directory or rendered Compose configuration
when unsure. Do not run Compose from the WSL copy when you expect live reload from the Windows copy.

## Dependency Policy

Host dependencies and Docker dependencies are intentionally separate:

- Host commands use repo-local `node_modules` plus `.pnpm-store/v11`, as set by
  `pnpm-workspace.yaml`.
- Docker dev services use named volumes for `/app/node_modules`, each workspace
  package's `node_modules`, the orchestrator example service `node_modules`, and `/pnpm`.
- Do not copy `node_modules` between Windows, WSL, Linux, and Docker.
- Re-run `pnpm install` on each host checkout you want to use directly.

Docker development and Telegram smoke services disable workspace injection through pnpm's
configuration environment variable, using live workspace symlinks across their separate mounts.
The dependency service runs non-frozen install against the bind mount, so it may update the lockfile's
injection setting. A normal host `pnpm install` reapplies the repository's configured default.
Production packaging retains injected workspace dependencies.

If Docker dependency state is stale or corrupted, reset only the Docker dependency volumes:

```bash
pnpm docker:dev:clean-deps
pnpm docker:up
```

This does not remove host `node_modules`, database volumes, Redis data, uploads, or env files.

## Git Line Endings

This repo expects LF line endings. Recommended local Git settings:

```bash
git config core.autocrlf false
git config core.eol lf
```

`.editorconfig` and `.gitattributes` both specify LF for text files so shell scripts remain usable
after Windows checkout.

## Linux and WSL Ownership Repair

If Docker reports permission errors for this checkout's `uploads/`, first verify the resolved path
and inspect ownership/symlink state. Only if that exact directory belongs to this checkout, repair
host ownership from the Linux/WSL checkout:

```bash
sudo chown -R "$(id -un):$(id -gn)" uploads
pnpm docker:dev:down
pnpm docker:up
```

On Windows, check folder permissions instead of using `chown`.

## Bash-First Ops Commands

Core install, build, lint, fast tests, and Docker dev startup are cross-platform. Some backup, cron, S3, and shell-lint commands still call Bash scripts and should be run from Linux, WSL, or an environment with compatible Bash tooling.
