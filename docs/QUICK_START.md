# Quick Start (Agent Ops)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 4 minutes.
- Authority Level: Operational quickstart.
- Last Verified Against: 2026-06-17 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly.
- Status: `active`.

## Purpose

- Provide a minimal command path to install, validate, and run core workflows.

## Canonical Sources

1. [`AGENTS.md`](../AGENTS.md)
2. [`docs/reference/agents-ssot.md`](reference/agents-ssot.md)
3. [`docs/reference/env.md`](reference/env.md)

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm env:validate -- --profile=development
```

Local pnpm commands use the repo-local `storeDir: .pnpm-store/v10` setting in
[`pnpm-workspace.yaml`](../pnpm-workspace.yaml); project `.npmrc` is intentionally absent so npm
commands do not inherit pnpm-only config.

Windows PowerShell, Linux, and WSL use the same core setup commands. See
[`docs/operations/windows-linux-dev.md`](operations/windows-linux-dev.md) for line-ending, Docker
bind-mount, and host-vs-Docker dependency notes.

## Repo Checks

```bash
pnpm check:fast
pnpm docs:check
```

## Operational Entry Point (Backend-First)

```bash
pnpm dev:batch
```

## Orchestrator Usage (Library-Only)

Use orchestrator through programmatic APIs (`createPipeline` + execution methods) from backend and service code.
Do not add or depend on CLI entrypoints in orchestrator.

## Batch System (Local Docker)

Live-edit development stack:

```bash
pnpm docker:up
```

Open `http://localhost:5173`.

If host port `8080` is unavailable:

```bash
BATCH_BACKEND_HOST_PORT=8081 pnpm docker:up
```

Common cause: another app (for example qBittorrent Web UI) uses `8080`.

Production-style local Compose never builds application images. Validate its shape without images:

```bash
pnpm docker:prod:config
```

To run it locally, first build or pull the exact SHA-tagged images, export `BATCH_BACKEND_IMAGE`
and `BATCH_FRONTEND_IMAGE`, then run `pnpm docker:prod`. Use `pnpm docker:prod:down` to stop it.
For the production image and deployment flow, read
[`docs/backend-frontend/DEPLOYMENT.md`](backend-frontend/DEPLOYMENT.md).

## Prompt Gallery Bootstrap (DB-Canonical)

After deploying backend code to a fresh environment:

```bash
pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap:dry
pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap
```

## Backup/Ops Commands

```bash
pnpm docker:db:backup
pnpm docker:db:backup:s3 -- quickstart_checkpoint
pnpm ops:status
pnpm ops:alert:check
```

Full runbooks:

- [`docs/operations/windows-linux-dev.md`](operations/windows-linux-dev.md)
- [`docs/operations/postgres-backup-s3.md`](operations/postgres-backup-s3.md)
- [`docs/operations/postgres-ops-health.md`](operations/postgres-ops-health.md)
- [`docs/operations/rollup-optional-binary-troubleshooting.md`](operations/rollup-optional-binary-troubleshooting.md)

## Related

- [`docs/backend-frontend/BATCH_SYSTEM.md`](backend-frontend/BATCH_SYSTEM.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend/backend-frontend-alignment.md)
- [`docs/operations/docker-host-paths.md`](operations/docker-host-paths.md)
