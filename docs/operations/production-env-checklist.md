# Production Environment Checklist for Private Alpha

## Meta

- Audience: founder/operator and Codex.
- Status: template/checklist. Do not store real secrets here.
- Related historical plan: `docs/archive/plans/standalone/slice-1-private-hosted-environment.md`.

## Purpose

This file lists the production environment values that must be decided and set on the hosted server before the private alpha deployment can be considered real.

Do not commit real `.env` values.

## Deployment Policy

The development and deployment boundary is:

```text
local development -> Git push -> CI validation and image build -> reviewed deployment -> VPS runtime and smoke checks
```

- Do normal development locally: code edits, dependency installs, dev servers, hot reload, debugging,
  lint/type/test lanes, integration tests, migration tests, and synthetic-data experiments.
- Use Git and CI as the authoritative source for deployable code. Avoid production states that
  depend on uncommitted server checkout changes.
- Use the Lightsail VPS for production runtime only: pulling or running selected images, reviewed
  migrations, service updates, health checks, logs, backups, and emergency recovery.
- Do not install a self-hosted GitHub Actions runner on the production VPS.
- Deploy CI-built Docker images tagged with the Git commit SHA. Record the exact deployed image refs
  and resolved digests in `/var/lib/esl-pipeline/deploy/deployments.log`.
- If an emergency server edit is unavoidable, reproduce it locally, commit it, and redeploy through
  the normal path as soon as possible.

## Runtime Mode

```bash
NODE_ENV=production
LOG_LEVEL=info
```

## Backend/API

```bash
BATCH_BACKEND_HTTP_PORT=8080
BATCH_BACKEND_ENABLE_EXTENDED_API=true
BATCH_BACKEND_ENABLE_OPS_CONTROL=false
```

## Postgres

For Docker Compose internal networking:

```bash
PG_ENABLED=true
PG_HOST=postgres
PG_PORT=5432
PG_USER=<production-db-user>
PG_PASSWORD=<production-db-password>
PG_DATABASE=esl_batch
PG_APPLICATION_NAME=esl-pipeline-batch-backend
PG_POOL_MAX=8
PG_IDLE_TIMEOUT_MS=30000
PG_CONNECTION_TIMEOUT_MS=5000
```

Migration settings, if used:

```bash
PG_AUTO_MIGRATE_ON_BOOT=false
PG_MIGRATION_LOCK_KEY=910001
```

Prefer manual migration command during Slice 1 unless auto-migrate is explicitly verified and desired.

## Redis

```bash
REDIS_ENABLED=true
REDIS_HOST=redis
REDIS_PORT=6379
# REDIS_PASSWORD=<only if configured>
```

Redis must not be publicly exposed.

## Auth and Sessions

```bash
JWT_SECRET=<long-random-secret>
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
REFRESH_COOKIE_NAME=esl_refresh
REFRESH_COOKIE_SAMESITE=lax
REFRESH_COOKIE_SECURE=true
# REFRESH_COOKIE_DOMAIN=<set only if needed>
REFRESH_COOKIE_PATH=/
BCRYPT_ROUNDS=12
```

Rules:

- Use a generated secret, not the example value.
- Do not reuse local/dev secrets.
- Do not commit this file with real values.
- Plain HTTP is acceptable only for private founder/operator rehearsal. Do not ask real invited
  tutors to register, log in, or submit lesson/student data until HTTPS is configured.
- If the private deployment is temporarily HTTP-only, `REFRESH_COOKIE_SECURE=false` may be needed
  for local smoke testing, but switch it to `true` before HTTPS tutor access.

## CORS and URLs

For same-origin frontend proxy, CORS may remain disabled and `VITE_BATCH_BACKEND_URL` should stay
unset at frontend build time. In that mode the frontend client calls `/api/...`, so the public
reverse proxy or frontend nginx container must proxy `/api/*` to the backend.

If frontend and backend are served from different origins, configure both the frontend build-time URL
and backend CORS explicitly.

```bash
ENABLE_CORS=<true-or-false>
CORS_ORIGIN=<hosted-frontend-origin>
CORS_CREDENTIALS=<true-if-cookie-auth-cross-origin>
VITE_BATCH_BACKEND_URL=<only-if-frontend-calls-backend-directly>
```

Codex must verify the actual frontend/backend routing shape before deciding these values.

## Public HTTPS Edge

Default production Compose binds the frontend to loopback:

```bash
BATCH_FRONTEND_BIND_ADDR=127.0.0.1
BATCH_FRONTEND_HOST_PORT=5173
```

`BATCH_FRONTEND_BIND_ADDR=0.0.0.0` is only an explicit private founder-rehearsal
override for temporary HTTP access. It is not acceptable for real tutor signup, login, or lesson
data entry. Real tutor access must use the Caddy edge profile, HTTPS, and
`REFRESH_COOKIE_SECURE=true`.

Configure the edge profile only after DNS can point at the Ubuntu 24.04 VPS:

```bash
CADDY_PUBLIC_HOSTNAME=<alpha-public-hostname>
CADDY_ACME_EMAIL=<operator-email-for-acme-notices>
```

Export these values in the same shell that runs `pnpm docker:prod:edge:*`. Docker Compose reads
`.env`, but the Node validator behind the pnpm edge scripts reads the current process environment.
For the production deploy script on the VPS, the same values may live in server-local
`/opt/esl-pipeline/.env`; `scripts/deploy/deploy-prod-images.sh` reads them from that
file when shell exports are absent, and explicit shell exports still override the file.

Edge-mode public traffic flow:

```text
browser -> Caddy :80/:443 -> batch-frontend nginx :8080 -> /api/* -> batch-backend :8080
```

Do not configure Caddy to proxy the backend directly.

For the optional MCP OAuth foundation, Caddy forwards the original HTTPS scheme to frontend nginx,
and nginx preserves it on the private `/api/*` backend hop. The provider alone trusts this forwarded
scheme so it can issue Secure interaction cookies and advertise HTTPS discovery endpoints under
`/api/oauth`. Keep the backend and frontend service ports on their existing loopback/private-network
boundaries; do not expose the backend directly to untrusted clients supplying forwarded headers.

## AWS S3 Object Storage

Keep existing AWS S3.

```bash
STORAGE_PROVIDER=s3
AWS_REGION=<existing-region>
AWS_ACCESS_KEY_ID=<least-privilege-access-key>
AWS_SECRET_ACCESS_KEY=<least-privilege-secret-key>
S3_BUCKET=<existing-artifact-bucket>
S3_PATH_PREFIX=<existing-or-alpha-prefix>
```

Accepted aliases may include `S3_BUCKET_NAME`, `STORAGE_BUCKET_NAME`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. Prefer one canonical set after verifying `docs/reference/env.md` and `docs/generated/env-surface-index.md`.

Security rules:

- Do not use AWS root credentials.
- Use least-privilege IAM.
- Keep transcripts, recordings, and backups private.
- Published artifacts must have intentional visibility only.

## Postgres Backups to S3

```bash
PG_BACKUP_S3_BUCKET=<existing-backup-bucket>
PG_BACKUP_S3_PREFIX=backups/postgres
PG_BACKUP_S3_REGION=<existing-region>
PG_BACKUP_S3_ENV=prod
PG_BACKUP_HOST_STATE_DIR=/var/lib/esl-pipeline/ops
PG_BACKUP_S3_SSE=<aws:kms-or-AES256-or-current-choice>
PG_BACKUP_S3_KMS_KEY_ID=<required-if-SSE-is-aws:kms>
PG_BACKUP_LOCAL_RETENTION_DAYS=30
PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS=14
PG_BACKUP_LOG_RETENTION_DAYS=30
PG_BACKUP_ALLOW_EMPTY_SOURCE=false
```

Container targeting for prod compose uses an explicit project name and absolute compose path:

```bash
PG_COMPOSE_PROJECT=esl-pipeline-prod
PG_COMPOSE_FILE=/opt/esl-pipeline/docker-compose.prod.yml
PG_CONTAINER_NAME=esl-pipeline-prod-postgres-1
```

The root `pnpm docker:prod:db:*` scripts set those production Compose targeting values for normal
host-side backup/list/restore commands.

Codex must verify actual container name from:

```bash
pnpm docker:prod:ps
```

Backup/restore completion Telegram notifications use `PG_BACKUP_ALERT_TELEGRAM_*`, not
`TELEGRAM_OPS_BOT_*`. During manual restore or deploy work, set
`PG_BACKUP_ALERT_TELEGRAM_DISABLE=true` unless the bot token, chat id, and optional forum thread id
have all been verified. Only set `PG_BACKUP_ALERT_TELEGRAM_THREAD_ID` when that exact Telegram
topic exists.

## Deployment Images and State

Production app images are supplied through image environment values, not production `build:` blocks:

```bash
BATCH_BACKEND_IMAGE=ghcr.io/abocha/esl-pipeline/batch-backend:<40-char-git-sha>
BATCH_FRONTEND_IMAGE=ghcr.io/abocha/esl-pipeline/batch-frontend:<40-char-git-sha>
TELEGRAM_OPS_BOT_IMAGE=ghcr.io/abocha/esl-pipeline/telegram-ops-bot:<40-char-git-sha>
```

The release workflow publishes a complete three-image GHCR bundle for every deployable release.
Affected images are CI-built from Debian 13 slim Node stages for the backend, frontend builder, and
Telegram bot, plus the controlled rootless nginx frontend runtime. Unaffected manifests are retagged
server-side from the previous release. The VPS never runs `docker build` or pnpm install/build; it may
add the new SHA tag to an already-local image when the resolved digest is unchanged. PostgreSQL and
Redis keep their existing official Alpine families and persistent volumes.

If image publication fails after a release tag exists, do not deploy that release until all three
SHA/version image refs are verified. Follow the fail-closed `Recover Release Image Bundle` procedure
in [`DEPLOYMENT.md`](../backend-frontend/DEPLOYMENT.md); do not repair tags ad hoc on the VPS.

The manual deploy script writes image refs and digests only under:

```text
/var/lib/esl-pipeline/deploy/current-images.env
/var/lib/esl-pipeline/deploy/previous-images.env
/var/lib/esl-pipeline/deploy/known-good-images.env
/var/lib/esl-pipeline/deploy/deployments.log
```

The image state files also record `CADDY_CONFIG_DIGEST`. On the first deployment after upgrading an
older state file, the missing digest intentionally causes one Caddy recreation.

Do not put application secrets in those state files. Keep `.env` in the application
checkout with restrictive permissions. Authenticate to GHCR on the VPS with a read-only production
credential where possible:

```bash
echo '<read-only-token>' | docker login ghcr.io -u '<github-user-or-bot>' --password-stdin
```

Deploy after CI publishes images:

```bash
cd /opt/esl-pipeline
bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha>
```

The command is unchanged. Read the printed plan before completion: database backup/migration runs
only when the backend digest changes, and Compose recreates only the affected dependency set. A
release whose images and Caddy configuration are unchanged performs local SHA aliasing, state
promotion, and bounded health checks without restarting services.

## Provider Keys and Cost Guardrails

Set only providers required by the current core hosted assignment flow.

Canonical examples to verify against current code/docs:

```bash
OPENAI_API_KEY=<if direct generation uses OpenAI>
GEMINI_API_KEY=<if direct generation, speech planning, or Google AI Studio fallback uses Gemini>
OPENROUTER_API_KEY=<if OpenRouter fallback is enabled>
ESL_STT_DEFAULT_PROVIDER=elevenlabs
ESL_STT_TRUSTED_SPLIT_PROVIDER=deepgram
ESL_STT_PROVIDER_ELEVENLABS_API_KEY=<required for ordinary mixed recordings>
ESL_STT_PROVIDER_DEEPGRAM_API_KEY=<required for trusted OBS split recordings>
ESL_TTS_DEFAULT_PROVIDER=elevenlabs
ESL_TTS_PROVIDER_ELEVENLABS_API_KEY=<if ElevenLabs TTS is enabled>
GOOGLE_STT_PROJECT_ID=<if Google STT is enabled>
GOOGLE_STT_GCS_STAGING_BUCKET=<if Google STT handles non-gs uploads>
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json
```

Budget/safety policy must remain fail-safe for alpha. Verify current names in `docs/reference/GENERATION_PROVIDER_POLICY.md` and `.env.example`.
Pronunciation audio should use the configured ElevenLabs, Google, or Inworld provider paths.

Important:

- Do not enable expensive provider paths accidentally.
- Do not log provider request payloads with sensitive student data unless explicitly debugging and short-lived.
- Keep any debug logging disabled by default.
- If Google STT/TTS uses a service-account file, keep the real file server-local at
  `/opt/esl-pipeline/.secrets/google-service-account.json`. Production Compose mounts `./.secrets`
  read-only at `/app/secrets` for backend-image services; do not commit or overwrite `.secrets` from
  git.

## Telegram Ops Bot

Telegram bot features are deferred for current alpha slices unless already explicitly needed for existing backup alerts.

```bash
TELEGRAM_OPS_BOT_ENABLED=false
TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false
BATCH_BACKEND_ENABLE_OPS_CONTROL=false
```

Backup alert Telegram variables may be used separately if already configured by the operator.

Important compose note: `telegram-ops-bot` is profile-gated behind the `ops-bot` Compose profile.
Do not run that profile unless the bot is intentionally enabled with complete credentials.

## Prompt Assets

Fresh or restored hosted databases need DB prompt assets bootstrapped before real assignment
generation. The production backend image runs from `/app` and copies runtime-owned prompt assets to
`/app/packages/batch-backend/prompt-assets`, so keep prompt paths relative to `/app` or explicitly
under `/app/packages/batch-backend/prompt-assets`.

```bash
PROMPT_TEMPLATE_PATH=packages/batch-backend/prompt-assets/templates/hw_prompt_assignment_v1.md
```

Do not use `/docs/...` paths in production containers.

## Host-Level Checklist

On the Ubuntu 24.04 VPS:

```text
- SSH key access works.
- Firewall allows SSH, HTTP, HTTPS only.
- Docker and Docker Compose are installed.
- Repo is cloned.
- Server checkout is on the reviewed deployment commit; no uncommitted server edits remain.
- `.env` exists on server and is not committed.
- `.secrets/google-service-account.json` exists on server if Google STT/TTS service-account auth is
  enabled, and Compose mounts it read-only at `/app/secrets/google-service-account.json`.
- `uploads/` host path exists if compose bind mount requires it.
- Docker volumes exist for Postgres and Redis.
- Backups can be uploaded to S3.
- Repository-owned production backup, integrity, restore-drill, and ops-alert systemd units are
  installed and their timers are enabled; see
  [`postgres-ops-health.md`](postgres-ops-health.md#production-systemd-units).
- Logs can be viewed through Docker Compose.
- Container log rotation is configured at the Docker daemon or service level.
- `batch-worker`, `transcribe-worker`, and `student-memory-worker` are running; recording uploads
  require the dedicated transcribe worker, and memory artifacts require the dedicated
  student-memory worker.
- In edge mode, public HTTP/HTTPS goes through Caddy only.
- Backend, frontend, Postgres, and Redis host ports stay bound to `127.0.0.1` unless deliberately
  exposed for private founder rehearsal.
- PostgreSQL, Redis, MinIO/internal storage, internal APIs, and development ports are not publicly
  exposed.
- Persistent production data lives in Docker volumes or dedicated host paths, not inside mutable
  container filesystems or ad hoc source-tree edits.
```

## Lightsail Resource Checks

The Lightsail instance is burstable. During and after deployment, check:

```text
- CPU utilization.
- Remaining burst capacity.
- RAM and swap usage.
- Disk space.
- Container health.
- Application health endpoints.
```

Short deployment spikes are acceptable. Sustained burst-capacity depletion means development work,
image builds, test suites, or other CPU-heavy tasks should move back to the laptop/CI, or the
instance should be resized.

## Verification Commands

Local/CI verification that does not require a real VPS or DNS:

```bash
pnpm docker:prepare
pnpm docker:prod:config
export CADDY_PUBLIC_HOSTNAME=alpha.example.com
export CADDY_ACME_EMAIL=ops@example.com
pnpm docker:prod:edge:env
pnpm docker:prod:edge:config
pnpm docker:prod:ops-bot:config
pnpm docker:caddy:validate
```

Private founder-rehearsal smoke checks:

```bash
bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha>
pnpm docker:prod:ps
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/meta/version
curl -fsS http://127.0.0.1:${BATCH_FRONTEND_HOST_PORT:-5173}/api/meta/version
curl -fsS http://127.0.0.1:${BATCH_FRONTEND_HOST_PORT:-5173}/api/health
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  ps student-memory-worker
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  logs --tail=120 student-memory-worker
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/migrate-db.js status
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/migrate-db.js verify
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/bootstrap-prompt-assets.js --dry-run
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/bootstrap-prompt-assets.js
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/smoke-s3-storage.js
pnpm docker:prod:db:backup:s3 -- production_manual_check
pnpm docker:prod:db:list:s3
pnpm docker:prod:db:artifact-integrity -- <latest-backup-key.dump>
pnpm docker:prod:db:restore-drill -- <latest-backup-key.dump>
```

Deferred HTTPS checks after DNS points to the real VPS:

```bash
curl -I http://<public-hostname>
curl -fsS https://<public-hostname>/
curl -fsS https://<public-hostname>/api/health
curl -fsS https://<public-hostname>/api/meta/version
```

The HTTP check should show Caddy redirecting to HTTPS.
Also verify from outside the VPS that raw frontend, backend, Postgres, Redis, and worker ports are
not publicly reachable, that `transcribe-worker` and `student-memory-worker` have no public ports,
and that the `caddy_data` and `caddy_config` Docker volumes persist across container recreation.

The production image copies `packages/batch-backend/prompt-assets` into
`/app/packages/batch-backend/prompt-assets` so prompt asset bootstrap can use the documented
runtime-owned paths inside the container.

## Backup Recovery Model

Use both:

- Lightsail snapshots for whole-server recovery.
- Logical Postgres backups for application-data recovery.

Keep logical backups separate from the main application data where possible and periodically test
restore into a non-production environment. Before risky migrations, create and verify a logical
backup with the production Compose wrapper:

```bash
pnpm docker:prod:db:backup:s3 -- pre_migration_<short-sha>
pnpm docker:prod:db:list:s3
pnpm docker:prod:db:artifact-integrity -- <latest-backup-key.dump>
```

Application rollback and database rollback are separate. The deployment script prints previous-image
restart instructions only when its compatibility preflight permits that runtime on the planned
schema. Incompatible or unclassified boundaries stop application writers before the verified backup
and migration, then block unsafe previous-image recovery even if migration or verification fails.
Read `rollback-compatibility.json` alongside `previous-images.env`; never treat the image state file
alone as permission to restart an old runtime. Use a schema-compatible image, or choose database
restore separately and verify the target backup before restarting the previous runtime. See the
[schema compatibility and recovery contract](../backend-frontend/DEPLOYMENT.md#schema-compatibility-and-recovery),
including `--plan`, metadata requirements, and stopped-service failure behavior. PostgreSQL restore
is never automatic.

Do not copy real production student, invoice, transcript, or credential data into local development
unless it has been anonymized.

## Do Not Store Here

Never write these into committed docs:

- real AWS keys
- real provider keys
- real JWT secrets
- real database passwords
- real tutor/student data
- private S3 object URLs with sensitive data
