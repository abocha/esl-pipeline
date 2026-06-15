# Batch Backend Deployment Guide (Current)

## Meta

- Audience: maintainers/operators deploying batch services.
- Read Time: 6 minutes.
- Authority Level: Deployment runbook.
- Last Verified Against: 2026-06-15 repo state.
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
production Docker images. The blocking CI lanes are listed below in
[CI Expectations](#ci-expectations). CI publishes custom production images to GHCR on `main` after
validation succeeds. Images are tagged with the full Git commit SHA and deployed by explicit
SHA-tagged refs, not mutable tags such as `latest`.

Use the AWS Lightsail VPS as production runtime, not as the normal coding machine. SSH is for
deployment, container/service status, logs, CPU/RAM/disk checks, reviewed migrations, backup/restore
operations, production-only diagnosis, and emergency recovery. Avoid routine server-side code
editing, full test suites, hot-reload servers, repeated Docker builds, experiments against the
production database, uncommitted server checkout changes, and manual edits inside running
containers.

Production Compose is pull-based for app services. Backend, frontend, worker, transcribe-worker,
student-memory-worker, and optional Telegram bot images come from GHCR image refs supplied by
environment/state files. Do not use the VPS for routine image builds, and do not restore production
`build:`, `:local`, `pull_policy: never`, or `up --build` paths for app services.

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

## Production Compose Image Inputs

Production Compose requires SHA-tagged app image refs. The manual deployment script writes these to
`/var/lib/esl-pipeline/deploy/current-images.env`; ad hoc Compose commands may export them directly:

```bash
export BATCH_BACKEND_IMAGE=ghcr.io/abocha/esl-pipeline/batch-backend:<40-char-git-sha>
export BATCH_FRONTEND_IMAGE=ghcr.io/abocha/esl-pipeline/batch-frontend:<40-char-git-sha>

# Required only when the ops-bot profile is intentionally enabled.
export TELEGRAM_OPS_BOT_IMAGE=ghcr.io/abocha/esl-pipeline/telegram-ops-bot:<40-char-git-sha>
```

Validate production Compose with placeholder image refs:

```bash
pnpm docker:prod:config
pnpm docker:prod:edge:config
pnpm docker:prod:ops-bot:config
```

The production frontend host binding is private by default:
`${BATCH_FRONTEND_BIND_ADDR:-127.0.0.1}:${BATCH_FRONTEND_HOST_PORT:-5173}:8080`.
Set `BATCH_FRONTEND_BIND_ADDR=0.0.0.0` only for explicit private founder rehearsal over plain HTTP.
Do not use that override for real tutor signup/login or lesson data.

Production app images are not built by these commands. For local production-image validation, build
or pull explicit image refs first, export the image variables above, then run `pnpm docker:prod` or
`pnpm docker:prod:edge`.

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
proxies to `batch-frontend:8080`; the frontend nginx config keeps same-origin `/api/*` traffic routed
to `batch-backend:8080`. Do not expose or proxy the backend directly for the normal alpha path.
Default production Compose also starts the generic `batch-worker`, the dedicated
`transcribe-worker`, and the dedicated `student-memory-worker`. The transcribe worker is required for
recording uploads to leave the `transcribe_queue_waiting` state. The student-memory worker is
required for queued lesson-memory, homework-memory, and student-memory snapshot jobs to become ready
after normal tutor activity.

Backend-image services that may touch Google STT/TTS mount the server-local `.secrets` directory
read-only at `/app/secrets`. Keep the real service-account file on the VPS at
`/opt/esl-pipeline/.secrets/google-service-account.json`; production containers use
`GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json`. Do not commit `.secrets`
or replace it from git during deploys.

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
2. CI publishes the backend, frontend, and Telegram bot images to GHCR with the full Git SHA tag.
3. SSH to the VPS checkout and run:

   ```bash
   cd /opt/esl-pipeline
   bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha>
   ```

4. The script pulls the requested images, records image refs and digests under
   `/var/lib/esl-pipeline/deploy`, checks disk space, verifies Postgres health, creates and verifies a
   pre-migration backup, runs migrations once, updates services, and runs bounded smoke checks.
5. If checks fail after services update, follow the script's application rollback instructions using
   `/var/lib/esl-pipeline/deploy/previous-images.env`.

Post-deploy service evidence should include the dedicated memory worker:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  ps student-memory-worker
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  logs --tail=120 student-memory-worker
```

Treat missing `student-memory-worker` logs or a non-running container as a production readiness
blocker for student-memory features; `batch-worker` does not consume those BullMQ jobs.

Record the deployed Git SHA or image version in
[`docs/operations/hosted-mvp-evidence.md`](../operations/hosted-mvp-evidence.md) or the active
deployment evidence note. Do not leave the VPS in a state where the only working fix is an
uncommitted server edit.

Application-image rollback and database restore are separate operations. The deployment script does
not automatically restore PostgreSQL when an application health check fails. Prefer
backward-compatible, additive migrations; an older application image may not work after a schema
migration if the migration was not compatible with the previous runtime.

## Environment Files

Create/update:

```bash
cp .env.batch-backend.example .env.batch-backend
```

Populate required credentials/keys referenced in:
[`docs/reference/env.md`](../reference/env.md)

If Google STT/TTS uses a service-account file, create it outside git on the VPS before deployment:

```bash
mkdir -p /opt/esl-pipeline/.secrets
# Place google-service-account.json in /opt/esl-pipeline/.secrets with restricted permissions.
```

Production Compose mounts that directory into backend-image services as read-only `/app/secrets`;
the container path is
`GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json`.

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
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/migrate-db.js status
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/migrate-db.js migrate
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/migrate-db.js verify
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
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/bootstrap-prompt-assets.js --dry-run
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/bootstrap-prompt-assets.js
```

The production backend image copies `docs/prompt-gallery` into `/app/docs/prompt-gallery`.
Keep `PROMPT_TEMPLATE_PATH` and `PROMPT_PROFILE_PATH` relative to `/app` or explicitly under
`/app/docs/...`; paths such as `/docs/...` point outside the runtime image and fail bootstrap.

Details: [`docs/operations/prompt-gallery-bootstrap.md`](../operations/prompt-gallery-bootstrap.md)

## Object Storage Smoke

Before the first hosted assignment publish, prove the backend runtime can use the configured S3
artifact bucket/prefix:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/smoke-s3-storage.js
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
  - keep `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false` unless a reviewed host-side command runner
    has been deployed
  - only enable `BATCH_BACKEND_ENABLE_OPS_CONTROL=true` with explicit
    `BATCH_BACKEND_OPS_CONTROL_*_COMMAND` values that do not require Docker/AWS tooling inside the
    long-running backend container
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
- `telegram command-loop compose smoke`
- `production container images`

CI must remain separate from the production VPS. Do not install a self-hosted GitHub Actions runner
on the Lightsail server.

Workflow source:
[`/.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
