# Batch Backend Deployment Guide (Current)

## Meta

- Audience: maintainers/operators deploying batch services.
- Read Time: 6 minutes.
- Authority Level: Deployment runbook.
- Last Verified Against: 2026-05-17 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after deployment workflow changes.
- Status: `runbook`.

## Purpose

- Provide a practical deployment path for the batch stack.
- Route operators to canonical operations runbooks.

## Canonical Sources

1. [`docs/reference/env.md`](../reference/env.md)
2. [`docs/backend-frontend/batch-backend-ssot.md`](batch-backend-ssot.md)
3. [`docs/operations/docker-host-paths.md`](../operations/docker-host-paths.md)
4. [`docs/operations/postgres-backup-s3.md`](../operations/postgres-backup-s3.md)

## Baseline Requirements

- Node `24.11.1+`
- Docker + Docker Compose
- Postgres 18+
- Redis 8+
- ffmpeg available in backend runtime

## Local Development Stack (Compose)

Prepare and start:

```bash
pnpm docker:prepare
pnpm docker:up
```

Build + start:

```bash
pnpm docker:up:build
```

Stop:

```bash
pnpm docker:dev:down
```

If backend host port `8080` is occupied:

```bash
BATCH_BACKEND_HOST_PORT=8081 pnpm docker:up
```

Troubleshooting guide:
[`docs/operations/docker-host-paths.md`](../operations/docker-host-paths.md)

The dev stack bind-mounts the active checkout for live editing and keeps Docker dependencies in
named volumes separate from host `node_modules`.

## Production-Style Local Stack

Use this before a release candidate when you want image builds instead of the live source bind
mount:

```bash
pnpm docker:prod
pnpm docker:prod:ps
```

Stop it with:

```bash
pnpm docker:prod:down
```

This is still a local/single-host Compose workflow. Keep it portable until the hosting target is
chosen: images should remain deployable by any container host, secrets should come from the host or
provider environment, and Postgres/Redis can later move to managed services without changing app
contracts. The current Docker socket mount is local ops coupling for backup/control workflows; treat
it as something to isolate behind an ops profile or sidecar before a broader production rollout.

## Environment Files

Create/update:

```bash
cp .env.batch-backend.example .env.batch-backend
```

Populate required credentials/keys referenced in:
[`docs/reference/env.md`](../reference/env.md)

## Database Migration Flow

Run before serving production traffic on existing databases:

```bash
pnpm --filter @esl-pipeline/batch-backend db:status
pnpm --filter @esl-pipeline/batch-backend db:migrate
pnpm --filter @esl-pipeline/batch-backend db:verify
```

For fresh environments bootstrapped from the generated schema baseline, verify the baseline stays current when schema work changes:

```bash
pnpm --filter @esl-pipeline/batch-backend db:verify-baseline
```

These baseline commands require a Postgres connection with permission to create and drop temporary databases for verification.

## Prompt Catalog Bootstrap (Required for Fresh Envs)

```bash
pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap:dry
pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap
```

Details: [`docs/operations/prompt-gallery-bootstrap.md`](../operations/prompt-gallery-bootstrap.md)

## Backup and Ops Safety (Recommended)

- Daily backup archival to S3:
  - `pnpm docker:db:backup:s3:scheduled`
- Ops health status:
  - `pnpm ops:status`
- Alert check (Telegram + cooldown/recovery):
  - `pnpm ops:alert:check`
- Telegram control-panel bot (optional, threaded ops commands):
  - enable `TELEGRAM_OPS_BOT_ENABLED=true`
  - ensure `BATCH_BACKEND_ENABLE_OPS_CONTROL=true`
  - run rollout closeout tooling:
    - `pnpm ops:telegram:preflight --profile=readonly_canary`
    - post-deploy `pnpm ops:telegram:verify`

Runbooks:

- [`docs/operations/postgres-backup-restore.md`](../operations/postgres-backup-restore.md)
- [`docs/operations/postgres-backup-s3.md`](../operations/postgres-backup-s3.md)
- [`docs/operations/postgres-ops-health.md`](../operations/postgres-ops-health.md)
- [`docs/operations/telegram-ops-control-panel.md`](../operations/telegram-ops-control-panel.md)

## CI Expectations

Deployment changes should preserve green CI for:

- `static checks (node 24.x)`
- `integration lane (blocking)`
- `backend db + worker integration (blocking)`

Workflow source:
[`/.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
