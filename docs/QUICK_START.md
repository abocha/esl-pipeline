# Quick Start (Agent Ops)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 4 minutes.
- Authority Level: Operational quickstart.
- Last Verified Against: 2026-07-14 repo state.
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

Use the Node version in [`.nvmrc`](../.nvmrc); `package.json` defines the minimum supported engine.

Local pnpm commands use the repo-local `storeDir: .pnpm-store/v11` setting in
[`pnpm-workspace.yaml`](../pnpm-workspace.yaml); project `.npmrc` is intentionally absent so npm
commands do not inherit pnpm-only config.

Windows PowerShell, Linux, and WSL use the same core setup commands. See
[`docs/operations/windows-linux-dev.md`](operations/windows-linux-dev.md) for line-ending, Docker
bind-mount, and host-vs-Docker dependency notes.

## Repo Checks

```bash
pnpm --silent run check:fast:agent
pnpm docs:check
```

Use `pnpm check:fast` when human-readable lane selection is useful, `pnpm check:pre-pr` for broad
PR validation, and `pnpm check` only for CI reproduction or DB/worker/integration-risk changes.

## Operational Entry Point (Backend-First)

```bash
pnpm dev:batch
```

This starts the API, batch worker, student-memory worker, and frontend on the host. For frontend-only
iteration without a backend, use the mock-auth sandbox documented in
[`packages/batch-frontend/README.md`](../packages/batch-frontend/README.md).

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

Production-style Compose never builds application images. Validate its shape without pulling them:

```bash
pnpm docker:prod:config
```

For image selection, production profiles, deployment, and rollback, read
[`docs/backend-frontend/DEPLOYMENT.md`](backend-frontend/DEPLOYMENT.md).

## Operational Runbooks

- Prompt gallery bootstrap: [`docs/operations/prompt-gallery-bootstrap.md`](operations/prompt-gallery-bootstrap.md)
- Backup and restore: [`docs/operations/postgres-backup-restore.md`](operations/postgres-backup-restore.md)
- [`docs/operations/postgres-backup-s3.md`](operations/postgres-backup-s3.md)
- Ops status and alerts: [`docs/operations/postgres-ops-health.md`](operations/postgres-ops-health.md)
- Cross-platform development: [`docs/operations/windows-linux-dev.md`](operations/windows-linux-dev.md)

## Related

- [`docs/backend-frontend/BATCH_SYSTEM.md`](backend-frontend/BATCH_SYSTEM.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend/backend-frontend-alignment.md)
- [`docs/operations/docker-host-paths.md`](operations/docker-host-paths.md)
