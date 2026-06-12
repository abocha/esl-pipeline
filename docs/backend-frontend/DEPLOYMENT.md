# Batch Backend Deployment Guide (Current)

## Meta

- Audience: maintainers/operators deploying batch services.
- Read Time: 6 minutes.
- Authority Level: Deployment runbook.
- Last Verified Against: 2026-06-12 repo state.
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

## Operating Model

The intended workflow is:

```text
local development -> Git push -> CI validation and image build -> reviewed deployment -> VPS runtime and smoke checks
```

Use the developer laptop for normal development: code edits, dependency installs, dev servers, hot
reload, debugging, lint/type/test lanes, integration tests, migration tests, and local or synthetic
data. The local Compose stack should reproduce production services where practical while keeping
development affordances such as source mounts, exposed loopback ports, debug logging, and fast
resets.

Use GitHub Actions as the clean validation authority: install dependencies from scratch, lint,
format-check, type-check, run automated tests, test database migrations, and build deployable
production Docker images. The current blocking CI lanes are listed below in
[CI Expectations](#ci-expectations). When a registry-publish workflow is added, published images
should be tagged with the Git commit SHA and deployed by explicit SHA/version, not only by mutable
tags such as `latest`.

Use the AWS Lightsail VPS as production runtime, not as the normal coding machine. SSH is for
deployment, container/service status, logs, CPU/RAM/disk checks, reviewed migrations, backup/restore
operations, production-only diagnosis, and emergency recovery. Avoid routine server-side code
editing, full test suites, hot-reload servers, repeated Docker builds, experiments against the
production database, uncommitted server checkout changes, and manual edits inside running
containers.

Current repo production Compose commands (`pnpm docker:prod`, `pnpm docker:prod:edge`) build local
`:local` images because the repository has not yet added a commit-SHA image publishing workflow.
That path is acceptable for private rehearsal and controlled manual deploys, but the preferred
production direction is CI-built images that the VPS pulls and records by Git SHA/image version.

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

The production frontend host binding is private by default:
`${BATCH_FRONTEND_BIND_ADDR:-127.0.0.1}:${BATCH_FRONTEND_HOST_PORT:-5173}:80`.
Set `BATCH_FRONTEND_BIND_ADDR=0.0.0.0` only for explicit private founder rehearsal over plain HTTP.
Do not use that override for real tutor signup/login or lesson data.

This is still a local/single-host Compose workflow. Keep it portable until the hosting target is
chosen: images should remain deployable by any container host, secrets should come from the host or
provider environment, and Postgres/Redis can later move to managed services without changing app
contracts. The current Docker socket mount is local ops coupling for backup/control workflows; treat
it as something to isolate behind an ops profile or sidecar before a broader production rollout.

## Production HTTPS Edge Profile

For the Ubuntu 24.04 VPS closed-alpha path, use the optional Caddy edge profile after DNS can point
to the host:

```bash
# Export these in the same shell where you run the edge commands; Compose may read `.env`, but the
# Node validator invoked by the pnpm scripts reads the current process environment.
export CADDY_PUBLIC_HOSTNAME=alpha.example.com
export CADDY_ACME_EMAIL=ops@example.com
pnpm docker:prod:edge:config
pnpm docker:caddy:validate
pnpm docker:prod:edge
pnpm docker:prod:ps
```

In edge mode, Caddy is the only intended public entrypoint on ports `80` and `443`. It reverse
proxies to `batch-frontend:80`; the frontend nginx config keeps same-origin `/api/*` traffic routed
to `batch-backend:8080`. Do not expose or proxy the backend directly for the normal alpha path.
Default production Compose also starts the generic `batch-worker` and the dedicated
`transcribe-worker`; the latter is required for recording uploads to leave the
`transcribe_queue_waiting` state.

After DNS points to the VPS, verify:

```bash
curl -I http://<public-hostname>
curl -fsS https://<public-hostname>/
curl -fsS https://<public-hostname>/api/health
curl -fsS https://<public-hostname>/api/meta/version
```

The HTTP check should show Caddy redirecting to HTTPS.
Before real tutor access, set `REFRESH_COOKIE_SECURE=true` and confirm backend, frontend raw host
port, Postgres, Redis, and worker ports are not publicly reachable.

## Production Deployment Flow

A reviewed production deployment should broadly follow:

1. CI passes for the selected commit.
2. Production images are built and published, preferably tagged with the Git commit SHA.
3. The Lightsail VPS pulls the selected image version or otherwise checks out the selected committed
   code for the current Compose-based rehearsal path.
4. A backup is created before risky migrations:
   `pnpm docker:prod:db:backup:s3 -- pre_deploy_<short-sha>`.
5. Database migrations run once from the production backend runtime image.
6. Services are updated with `pnpm docker:prod:edge` or the future image-pull equivalent.
7. Health and smoke checks run for HTTPS, API health, contract metadata, prompt assets, S3 storage,
   workers, and backup download-only restore drills when relevant.
8. If checks fail, roll back to the previous image version or previous committed deployment and use
   the verified backup only when data rollback is required.

Record the deployed Git SHA or image version in
[`docs/operations/hosted-mvp-evidence.md`](../operations/hosted-mvp-evidence.md) or the active
deployment evidence note. Do not leave the VPS in a state where the only working fix is an
uncommitted server edit.

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

For the production Compose runtime image, run the built tools inside `batch-backend` instead of
assuming source `pnpm`/`tsx` are present:

```bash
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js status
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js migrate
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js verify
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

Production Compose runtime equivalent:

```bash
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js --dry-run
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js
```

The production backend image copies `docs/prompt-gallery` into `/app/docs/prompt-gallery`.
Keep `PROMPT_TEMPLATE_PATH` and `PROMPT_PROFILE_PATH` relative to `/app` or explicitly under
`/app/docs/...`; paths such as `/docs/...` point outside the runtime image and fail bootstrap.

Details: [`docs/operations/prompt-gallery-bootstrap.md`](../operations/prompt-gallery-bootstrap.md)

## Object Storage Smoke

Before the first hosted assignment publish, prove the backend runtime can use the configured S3
artifact bucket/prefix:

```bash
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/smoke-s3-storage.js
```

The command uploads a small text object, reads metadata, generates a short-lived presigned URL, then
deletes the object by default. Add `--keep` only when you want a retained evidence object and have
chosen a non-sensitive key.

## Backup and Ops Safety (Recommended)

- Daily backup archival to S3:
  - local/dev stack: `pnpm docker:db:backup:s3:scheduled`
  - production Compose one-shot: `pnpm docker:prod:db:backup:s3 -- <label>`
  - production Compose list/drill: `pnpm docker:prod:db:list:s3` and
    `pnpm docker:prod:db:restore:s3 -- <key.dump> --download-only`
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

Use both Lightsail snapshots for whole-server recovery and logical Postgres backups for
application-data recovery. Store logical backups separately from the main application data where
possible, and periodically test restores in a non-production environment.

Lightsail instances use burstable CPU performance. Short deployment spikes are acceptable, but do
not spend burst capacity on development work, repeated image builds, or full test suites that can
run locally or in CI. Monitor CPU utilization, remaining burst capacity, RAM/swap, disk, container
health, and application health endpoints during and after deploys.

## Redis Queue Runtime

Compose-managed Redis is used as durable queue/event infrastructure for BullMQ, not as a disposable
cache. Keep `maxmemory-policy noeviction` so Redis returns backpressure errors under memory pressure
instead of evicting queue state. Production Compose enables AOF with `appendfsync everysec`; local dev
keeps persistence disabled for fast reset semantics unless you take a manual snapshot before a Redis
container refresh. Latency monitoring is enabled at 100 ms so `LATENCY DOCTOR` and `LATENCY LATEST`
can explain server-side stalls without waiting for a failure window to reproduce.

## CI Expectations

Deployment changes should preserve green CI for:

- `static checks (node 24.x)`
- `integration lane (blocking)`
- `backend db + worker integration (blocking)`

CI must remain separate from the production VPS. Do not install a self-hosted GitHub Actions runner
on the Lightsail server.

Workflow source:
[`/.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
