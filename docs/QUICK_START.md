# Quick Start (Agent Ops)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 4 minutes.
- Authority Level: Operational quickstart.
- Last Verified Against: 2026-09-14 repo state.
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

Use the Node version in [`.nvmrc`](../.nvmrc); `package.json` defines the minimum supported engine
and pins the Corepack-managed pnpm version used by repository installs and production-image builds.

Local pnpm commands use the repo-local `storeDir: .pnpm-store/v11` setting in
[`pnpm-workspace.yaml`](../pnpm-workspace.yaml); project `.npmrc` is intentionally absent so npm
commands do not inherit pnpm-only config.

Windows PowerShell, Linux, and WSL use the same core setup commands. See
[`docs/operations/windows-linux-dev.md`](operations/windows-linux-dev.md) for line-ending, Docker
bind-mount, and host-vs-Docker dependency notes.

## Repo Checks

For cross-layer product rehearsal with isolated local state and providers disabled by default, use
`pnpm smoke:start`, then follow [`Local Product Smoke`](operations/local-product-smoke.md) for
invitation, browser checklist, stop, reset, and deliberate generation. This hybrid path preserves the
full Docker dev stack as a fidelity/debug fallback.

```bash
pnpm --filter @esl-pipeline/<package> test
```

For documentation-only changes, use the [docs-only recipe](reference/TESTING_GUIDELINES.md#docs-only-changes),
which selects PR-mode structural checks. The full `pnpm docs:check` audit retains repository-wide
freshness enforcement and is required before advancing a document's `Last Verified Against` date.

Run the smallest relevant package test, typecheck, lint, or build while editing and before pushing.
Hosted PR CI is the comprehensive merge gate. If a hosted job fails, inspect its logs/artifacts and
reproduce that job's actual command, configuration, and prerequisites. Use
`pnpm test:backend:db:worker` only for a concrete local PostgreSQL/Redis diagnostic.

## Operational Entry Point (Backend-First)

Start each core service in its own terminal:

```bash
pnpm --filter @esl-pipeline/batch-backend dev:api
pnpm --filter @esl-pipeline/batch-backend dev:worker
pnpm --filter @esl-pipeline/batch-backend dev:student-memory-worker
pnpm --filter @esl-pipeline/batch-frontend dev
```

These start the API, batch worker, student-memory worker, and frontend on the host. For frontend-only iteration without a backend,
use the mock-auth sandbox documented in
[`packages/batch-frontend/README.md`](../packages/batch-frontend/README.md).

The commands above do not start the separate transcription worker. When testing OPUS transcription,
start it in another shell:

```bash
pnpm --filter @esl-pipeline/batch-backend dev:transcribe-worker
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

Production-style Compose never builds application images. Validate its shape without pulling them:

```bash
pnpm docker:prod:config
```

For image selection, production profiles, deployment, and rollback, read
[`docs/backend-frontend/DEPLOYMENT.md`](backend-frontend/DEPLOYMENT.md).

## Operational Runbooks

For procedures not listed here, start with the
[`docs/operations/README.md`](operations/README.md) router.

- Prompt gallery bootstrap: [`docs/operations/prompt-gallery-bootstrap.md`](operations/prompt-gallery-bootstrap.md)
- Backup and restore: [`docs/operations/postgres-backup-restore.md`](operations/postgres-backup-restore.md)
- [`docs/operations/postgres-backup-s3.md`](operations/postgres-backup-s3.md)
- Ops status and alerts: [`docs/operations/postgres-ops-health.md`](operations/postgres-ops-health.md)
- Cross-platform development: [`docs/operations/windows-linux-dev.md`](operations/windows-linux-dev.md)

## Related

- [`docs/backend-frontend/BATCH_SYSTEM.md`](backend-frontend/BATCH_SYSTEM.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend/backend-frontend-alignment.md)
- [`docs/operations/docker-host-paths.md`](operations/docker-host-paths.md)
