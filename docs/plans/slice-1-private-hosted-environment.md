# Slice 1: Private Hosted Environment

## Meta

- Audience: founder/operator, Codex, implementation agents.
- Status: active.
- Last Verified Against: 2026-06-11 repo state.
- Exit Trigger: archive or update after the Slice 1 implementation PR/deploy evidence lands.
- Current Focus: private AWS Lightsail rehearsal with Docker Compose, Caddy HTTPS, AWS S3, health, migrations, backups, transcription workers, and one hosted assignment publish.

## Goal

Deploy the current ESL Pipeline app to a private hosted environment so the founder/operator can use it outside the local machine and complete one hosted end-to-end assignment publish.

This is not a public launch. This is a private rehearsal that proves the app can survive real hosting.

## Current Phase

Hosted deployment plus invite-only tutor signup.

Slice 1 covers only the hosted deployment part.

## Non-Goals

Do not implement these in Slice 1:

- invite-only signup
- workspace creation flow
- first-run onboarding
- admin dashboard expansion
- provider gateway overhaul
- billing/pricing
- public landing page
- Google Calendar sync
- Telegram tutor/student bots
- storage migration from AWS S3
- managed Postgres/Redis migration
- Kubernetes/autoscaling

Allowed exception: a non-goal may be touched only if it blocks the private hosted deployment or end-to-end hosted assignment publish.

## Locked Deployment Decision

Use this topology:

```text
AWS Lightsail VPS
  - Docker Compose
  - Caddy HTTPS edge
  - batch-frontend
  - batch-backend/API
  - batch-worker
  - transcribe-worker
  - Postgres
  - Redis

AWS S3
  - transcripts
  - artifacts
  - audio/MP3 outputs
  - Postgres backups
```

Do not migrate away from AWS S3 during Slice 1.

## Existing Repo Assets to Use

Before changing anything, inspect these files:

```text
docker-compose.prod.yml
package.json
.env.example
docs/backend-frontend/DEPLOYMENT.md
docs/reference/env.md
docs/operations/docker-host-paths.md
docs/operations/postgres-backup-restore.md
docs/operations/postgres-backup-s3.md
docs/operations/postgres-ops-health.md
packages/batch-backend/Dockerfile
packages/batch-frontend/Dockerfile
packages/batch-frontend/nginx.conf
packages/batch-backend/src/transport/http-server.ts
packages/batch-backend/src/transport/worker-runner.ts
packages/batch-backend/src/transport/transcribe-worker.ts
packages/batch-backend/src/infrastructure/migrations.ts
```

Known current facts:

- Root `package.json` contains `pnpm docker:prod`.
- Root `package.json` contains `pnpm docker:prod:ps`.
- Root `package.json` contains Postgres backup/S3/restore commands.
- `docker-compose.prod.yml` already defines `batch-backend`, `batch-frontend`, `batch-worker`,
  `transcribe-worker`, `postgres`, and `redis`.
- `batch-backend` exposes port 8080 to localhost by default.
- `batch-frontend` exposes port 8080 inside the container and maps to host port
  `${BATCH_FRONTEND_BIND_ADDR:-127.0.0.1}:${BATCH_FRONTEND_HOST_PORT:-5173}`.
- `BATCH_FRONTEND_BIND_ADDR=0.0.0.0` is only an explicit private founder-rehearsal override, not a
  real tutor-access shape.
- The frontend API client calls `/api/...` when `VITE_BATCH_BACKEND_URL` is unset.
- `packages/batch-frontend/nginx.conf` proxies `/api/*` to the backend and does not expose raw
  `/jobs` by default.
- Optional Caddy edge mode exposes public `80/443` and reverse proxies to `batch-frontend:8080`.
- Backend has `GET /meta/version` and config-aware `GET /health`.
- Worker runner already logs `Worker started`.
- Transcription jobs require the separate `transcribe-worker` entrypoint. A healthy
  `batch-worker` alone does not consume recording transcription jobs.
- `telegram-ops-bot` appears in `docker-compose.prod.yml` but is profile-gated behind `ops-bot`.
- `docker compose -p esl-pipeline-prod -f docker-compose.prod.yml config --quiet` passed during the
  2026-06-09 doc/repo check.
- The production backend Dockerfile deploys a built runtime image. Runtime-safe migration commands
  must be verified against that image rather than assuming workspace `pnpm` and `tsx` are present.

## Required Deliverables

### 1. Deployment decision doc updated

Update or create docs that record:

- AWS Lightsail selected for compute.
- Existing AWS S3 retained for storage/backups.
- Docker Compose retained.
- Single-server alpha topology.
- Managed Postgres/Redis deferred.
- First deployment is private/internal.

Preferred location:

```text
docs/alpha-deployment-decisions.md
```

### 2. Production environment checklist

Create or update a production env checklist. Do not commit actual secrets.

Preferred location:

```text
docs/operations/production-env-checklist.md
```

The checklist must cover at least:

```text
NODE_ENV=production
BATCH_BACKEND_HTTP_PORT=8080
BATCH_BACKEND_ENABLE_EXTENDED_API=true
PG_ENABLED=true
PG_HOST=postgres
PG_PORT=5432
PG_USER=...
PG_PASSWORD=...
PG_DATABASE=esl_batch
REDIS_ENABLED=true
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=...
JWT_EXPIRES_IN=...
REFRESH_TOKEN_EXPIRES_IN=...
ENABLE_CORS=...
CORS_ORIGIN=...
CORS_CREDENTIALS=...
STORAGE_PROVIDER=s3
AWS_REGION=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET or S3_BUCKET_NAME=...
S3_PATH_PREFIX or STORAGE_PATH_PREFIX=...
PG_BACKUP_S3_BUCKET=...
PG_BACKUP_S3_PREFIX=...
PG_BACKUP_S3_REGION=...
PG_BACKUP_S3_ENV=prod or alpha
PG_BACKUP_S3_SSE=...
PG_BACKUP_S3_KMS_KEY_ID=... if required
GEN/provider keys and budget guardrails as required by current core flow
LOG_LEVEL=info
TELEGRAM_OPS_BOT_ENABLED=false unless explicitly needed
```

Security rules:

- Do not commit `.env` with real values.
- Do not use AWS root credentials.
- Use least-privilege IAM credentials.
- Keep private transcripts/backups private.
- Public artifacts must be intentionally public or intentionally served through signed URLs, not accidentally public.

### 3. Production Compose path verified

Codex must verify and, if needed, fix `docker-compose.prod.yml` for Slice 1.

Minimum requirements:

- `batch-backend` starts reliably.
- `batch-worker` starts reliably.
- `transcribe-worker` starts reliably and consumes recording transcription jobs.
- `batch-frontend` starts reliably.
- `postgres` persists data in a Docker volume.
- `redis` persists if needed and does not expose itself publicly.
- backend, Postgres, and Redis host ports are bound to localhost only unless intentionally exposed.
- frontend/reverse proxy is the only public HTTP entrypoint unless a separate reverse proxy is documented.
- same-origin frontend deployments proxy `/api/*` to `batch-backend:8080`, or the frontend is built
  with an intentional `VITE_BATCH_BACKEND_URL` and matching CORS/cookie settings.
- `restart: unless-stopped` or equivalent exists for long-running services.
- services load production env from a server-local env file.
- `telegram-ops-bot` is not started by default, or it is intentionally enabled with complete
  credentials and documented purpose.

Current route shape to preserve:

`packages/batch-frontend/nginx.conf` proxies `/api/*` to the backend, and the frontend client emits
same-origin `/api/auth/*`, `/api/students/*`, `/api/recordings/*`,
`/api/assignment-sessions/*`, `/api/user/*`, `/api/business/*`, `/api/config/*`,
`/api/meta/version`, and `/api/jobs/*` when no backend base URL is configured.

Codex should verify this route shape through the frontend entrypoint during hosted or edge smoke
checks.

### 4. Health check

Add or verify an unauthenticated health endpoint.

Preferred endpoint:

```text
GET /health
```

Minimum response fields:

```json
{
  "ok": true,
  "service": "batch-backend",
  "checks": {
    "api": { "ok": true },
    "postgres": { "ok": true },
    "redis": { "ok": true }
  }
}
```

Requirements:

- returns 200 only when API, Postgres, and Redis are reachable
- returns non-200 or `ok:false` when a required dependency fails
- does not leak secrets
- is reachable from the hosted environment
- is documented with curl command

Example verification:

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://<host-or-domain>/health
```

If the final public entrypoint does not expose `/health`, document the internal check command instead.

### 5. Worker visibility

Verify existing worker logs and add only the minimum missing visibility.

Required evidence:

- worker startup log is visible through `docker compose logs batch-worker`
- transcribe worker startup log is visible through `docker compose logs transcribe-worker`
- queue connection or worker readiness is visible
- job start/success/failure logs are visible
- failed job can be diagnosed without guessing whether the worker is running

Do not build an admin dashboard in Slice 1.

### 6. Migrations

Use the repo's existing migration command.

Known command inside package:

```bash
pnpm --filter @esl-pipeline/batch-backend db:migrate
```

Codex must document the hosted/container equivalent. The production image is a built runtime image,
so first verify whether the built migration tool is present:

```bash
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js status

docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js migrate

docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js verify
```

If the built command is missing or fails because runtime dependencies are absent, add the smallest
runtime-safe migration entrypoint or adjust the image. Do not invent a second migration system.

Fresh hosted databases also need prompt assets bootstrapped before real assignment generation:

```bash
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js --dry-run

docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js
```

Verify the exact built bootstrap command during Slice 1.

### 7. AWS S3 verification

Since S3 already exists, Slice 1 must prove hosted containers can use it.

Required checks:

- backend/worker can upload an object to the configured S3 bucket/prefix
- backend/worker can read or generate a usable URL for expected outputs
- one generated artifact lands in the expected prefix
- backups land in backup prefix
- transcripts/recordings/backups are private by default
- published artifacts are visible only through the intended mechanism

If no existing S3 smoke command exists, add a small operator-safe smoke command or document a manual check using the existing workflow.

Do not add real secrets to docs.

### 8. Backups and restore path

Use the existing backup scripts.

Known commands from root package scripts:

```bash
pnpm docker:prod:db:backup:s3
pnpm docker:prod:db:list:s3
pnpm docker:prod:db:restore:s3 -- <s3-key-or-s3-uri> --download-only
```

Codex must document hosted variants and verify they work with the prod compose project/container names.

Required evidence:

- backup command creates a backup set
- backup uploads to AWS S3
- list command sees the backup remotely
- restore path is documented
- at minimum, `--download-only` restore drill verifies download and digest

If a full destructive restore drill is unsafe on the only hosted database, document a safe restore drill plan instead of skipping restore documentation.

### 9. Hosted assignment publish

Run one end-to-end hosted assignment publish.

Required evidence to record:

```text
Hosted app URL:
Health check URL or command:
Git commit deployed:
Compose command used:
Migration command used:
Backup command used:
S3 backup key:
Test assignment/student/job ID:
Published artifact URL:
S3 artifact key/path:
API logs inspected:
Worker logs inspected:
Known issues:
```

Preferred evidence file:

```text
docs/operations/hosted-mvp-evidence.md
```

## Suggested Implementation Steps for Codex

### Step A: inspect and report

Codex should first inspect the repo and report:

```text
- current prod compose services
- whether health endpoint exists
- whether frontend/proxy exposes backend routes needed by current UI
- exact migration command inside container
- exact prompt asset bootstrap command inside container
- exact backup command for prod compose
- whether telegram-ops-bot is absent/profile-gated or intentionally enabled
- gaps that block private hosted rehearsal
```

No broad refactor during this step.

### Step B: patch smallest blockers

Expected possible patches:

- add `/health`
- update frontend nginx proxy rules for `/api/*` or document/build a direct-backend URL strategy
- add production env checklist doc
- add hosted evidence template
- adjust `docker-compose.prod.yml` for safe alpha defaults
- add a production deploy runbook if existing docs are too local/dev oriented
- add a runtime-safe migration/bootstrap command if the production image lacks one

### Step C: verify locally with prod compose

Suggested commands to verify, adjusted as needed:

```bash
pnpm install --frozen-lockfile
pnpm check:fast
pnpm docker:prod:config
export CADDY_PUBLIC_HOSTNAME=alpha.example.com
export CADDY_ACME_EMAIL=ops@example.com
pnpm docker:prod:edge:env
pnpm docker:prod:edge:config
pnpm docker:caddy:validate
bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha>
pnpm docker:prod:ps
node scripts/docker/prod-compose.mjs --placeholder-images logs --tail=100 batch-backend
node scripts/docker/prod-compose.mjs --placeholder-images logs --tail=100 batch-worker
node scripts/docker/prod-compose.mjs --placeholder-images logs --tail=100 transcribe-worker
curl -fsS http://127.0.0.1:${BATCH_FRONTEND_HOST_PORT:-5173}/api/meta/version
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/smoke-s3-storage.js
pnpm docker:prod:db:backup:s3 -- alpha_manual_check
pnpm docker:prod:db:list:s3
pnpm docker:prod:db:restore:s3 -- <latest-backup-key.dump> --download-only
```

### Step D: operator deploys to Ubuntu 24.04 VPS

Codex may document commands, but the operator performs real provider setup and secret entry.

Suggested host sequence:

```bash
sudo apt update
sudo apt install -y git ca-certificates curl
# install Docker using official Docker docs

git clone <repo-url> esl-pipeline
cd esl-pipeline
cp .env.example .env
# edit .env with production values, never commit it
export CADDY_PUBLIC_HOSTNAME=<public-hostname>
export CADDY_ACME_EMAIL=<operator-email>
pnpm docker:prepare
pnpm docker:prod:edge:config
pnpm docker:caddy:validate
pnpm docker:prod:edge
pnpm docker:prod:ps
```

If `pnpm` is not available on host, either install Node/Corepack/pnpm or document pure Docker Compose equivalents.

### Step E: record evidence

Fill in:

```text
docs/operations/hosted-mvp-evidence.md
```

## Tests Required

Minimum tests after code changes:

```bash
pnpm check:fast
```

If backend health, DB, Redis, worker, or migrations changed:

```bash
pnpm test:backend:db:worker
```

If frontend proxy/build changed:

```bash
pnpm --filter @esl-pipeline/batch-frontend test:unit
pnpm --filter @esl-pipeline/batch-frontend build
```

If Docker files or Compose changed:

```bash
pnpm docker:lint
pnpm docker:prod
pnpm docker:prod:ps
```

## Manual Verification

Manual verification must include:

- frontend loads from hosted URL
- backend health passes
- `/meta/version` or equivalent version route works
- user/operator can reach the current app surface
- API logs are visible
- worker logs are visible
- transcribe-worker logs are visible
- DB survives container restart
- S3 publish path works
- backup uploads to S3
- restore download drill works
- one assignment publish completes

## Rollback Path

Minimum rollback path:

1. Record current deployed Git commit before deploy.
2. Before risky migration or deploy, run S3 backup.
3. If app deploy fails, checkout previous known-good commit and rerun prod compose.
4. If DB migration/data fails, restore from verified backup if needed.

Document actual commands in hosted runbook after verification.

Candidate commands:

```bash
git rev-parse HEAD
pnpm docker:prod:db:backup:s3 -- pre_deploy_$(date -u +%Y%m%d_%H%M%S)
git checkout <previous-good-commit>
pnpm docker:prod
pnpm docker:prod:db:restore:s3 -- <backup-key.dump> --clean
```

Codex must adjust these to the real repo/server command shape.

## Completion Evidence

Slice 1 is done only when this is true:

```text
- chosen topology is documented
- production env checklist exists
- hosted app URL exists
- backend health check passes
- API container is running
- worker container is running
- transcribe-worker container is running
- Postgres persists after restart/redeploy
- Redis is reachable
- AWS S3 object upload/read/publish path works
- database backup uploads to S3
- restore path is documented
- one hosted assignment publish succeeds
- logs are accessible enough to diagnose failure
```

## Stop Conditions

Stop and report instead of expanding scope if:

- prod compose cannot run the API/worker/DB/Redis shape safely
- required production secrets are unclear
- S3 permissions fail and cannot be resolved safely
- backup works but restore path cannot be documented
- health check would leak secrets or require auth in a way that defeats ops use
- worker cannot start or cannot consume jobs
- transcribe-worker cannot start or transcription jobs remain stuck at `transcribe_queue_waiting`
- hosted publish requires building a deferred feature
- migration risk is unclear and no verified backup exists
