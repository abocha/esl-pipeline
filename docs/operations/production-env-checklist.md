# Production Environment Checklist for Private Alpha

## Meta

- Audience: founder/operator and Codex.
- Status: template/checklist. Do not store real secrets here.
- Related plan: `docs/plans/slice-1-private-hosted-environment.md`.

## Purpose

This file lists the production environment values that must be decided and set on the hosted server before the private alpha deployment can be considered real.

Do not commit real `.env.batch-backend` values.

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
PG_BACKUP_S3_ENV=alpha
PG_BACKUP_S3_SSE=<aws:kms-or-AES256-or-current-choice>
PG_BACKUP_S3_KMS_KEY_ID=<required-if-SSE-is-aws:kms>
PG_BACKUP_LOCAL_RETENTION_DAYS=30
PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS=14
PG_BACKUP_LOG_RETENTION_DAYS=30
PG_BACKUP_ALLOW_EMPTY_SOURCE=false
```

Container targeting for prod compose may need:

```bash
PG_CONTAINER_NAME=esl-pipeline-prod-postgres-1
```

Codex must verify actual container name from:

```bash
pnpm docker:prod:ps
```

## Provider Keys and Cost Guardrails

Set only providers required by the current core hosted assignment flow.

Canonical examples to verify against current code/docs:

```bash
OPENAI_API_KEY=<if direct generation uses OpenAI>
GEMINI_API_KEY=<if direct generation, speech planning, or Google AI Studio fallback uses Gemini>
OPENROUTER_API_KEY=<if OpenRouter fallback is enabled>
ESL_STT_DEFAULT_PROVIDER=deepgram
ESL_STT_PROVIDER_DEEPGRAM_API_KEY=<if Deepgram STT is enabled>
ESL_TTS_DEFAULT_PROVIDER=elevenlabs
ESL_TTS_PROVIDER_ELEVENLABS_API_KEY=<if ElevenLabs TTS is enabled>
GOOGLE_STT_PROJECT_ID=<if Google STT is enabled>
GOOGLE_STT_GCS_STAGING_BUCKET=<if Google STT handles non-gs uploads>
GOOGLE_APPLICATION_CREDENTIALS=<if Google STT/TTS uses a service account file>
```

Budget/safety policy must remain fail-safe for alpha. Verify current names in `docs/reference/GENERATION_PROVIDER_POLICY.md` and `.env.batch-backend.example`.

Important:

- Do not enable expensive provider paths accidentally.
- Do not log provider request payloads with sensitive student data unless explicitly debugging and short-lived.
- Keep any debug logging disabled by default.

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

## Host-Level Checklist

On the Droplet:

```text
- SSH key access works.
- Firewall allows SSH, HTTP, HTTPS only.
- Docker and Docker Compose are installed.
- Repo is cloned.
- `.env.batch-backend` exists on server and is not committed.
- `uploads/` host path exists if compose bind mount requires it.
- Docker volumes exist for Postgres and Redis.
- Backups can be uploaded to S3.
- Logs can be viewed through Docker Compose.
- Public HTTP goes through one entrypoint. Backend, Postgres, and Redis host ports stay bound to
  `127.0.0.1` unless deliberately exposed.
```

## Verification Commands

Adjust after Codex confirms exact command shape:

```bash
pnpm docker:prepare
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml config --quiet
pnpm docker:prod
pnpm docker:prod:ps
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/meta/version
curl -fsS http://127.0.0.1:${BATCH_FRONTEND_HOST_PORT:-5173}/api/meta/version
curl -fsS http://127.0.0.1:${BATCH_FRONTEND_HOST_PORT:-5173}/api/health
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js status
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js migrate
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js verify
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js --dry-run
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js
pnpm docker:db:backup:s3 -- alpha_manual_check
pnpm docker:db:list:s3
pnpm docker:db:restore:s3 -- <latest-backup-key.dump> --download-only
```

The production image copies `docs/prompt-gallery` into `/app/docs/prompt-gallery` so prompt asset
bootstrap can use the documented prompt-gallery paths inside the runtime container.

## Do Not Store Here

Never write these into committed docs:

- real AWS keys
- real provider keys
- real JWT secrets
- real database passwords
- real tutor/student data
- private S3 object URLs with sensitive data
