# Quick Start (Agent Ops)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 4 minutes.
- Authority Level: Operational quickstart.
- Last Verified Against: 2026-03-04 repo state.
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
cp .env.batch-backend.example .env.batch-backend
```

## Repo Checks

```bash
pnpm check:fast
pnpm docs:check
```

## Orchestrator CLI

```bash
pnpm esl --interactive
pnpm esl --md ./lessons/mission.md --preset b1-default --with-tts --upload s3
pnpm esl status --md ./lessons/mission.md
```

## Batch System (Optional)

```bash
pnpm docker:up
```

Open `http://localhost:5173`.

If host port `8080` is unavailable:

```bash
BATCH_BACKEND_HOST_PORT=8081 pnpm docker:up
```

Common cause: another app (for example qBittorrent Web UI) uses `8080`.

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

- [`docs/operations/postgres-backup-s3.md`](operations/postgres-backup-s3.md)
- [`docs/operations/postgres-ops-health.md`](operations/postgres-ops-health.md)

## Related

- [`docs/backend-frontend/BATCH_SYSTEM.md`](backend-frontend/BATCH_SYSTEM.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend/backend-frontend-alignment.md)
- [`docs/operations/docker-host-paths.md`](operations/docker-host-paths.md)
