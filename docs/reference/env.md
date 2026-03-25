# Environment Configuration Guide

## Meta

- Audience: maintainers and implementing agents.
- Read Time: 5 minutes.
- Authority Level: environment contract reference.
- Last Verified Against: 2026-03-13 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after environment contract changes.
- Status: `reference`.

## Purpose

- Define the canonical env surfaces for the repo.
- Keep policy and defaults here while pushing exhaustive key lookup to the generated env index.

## Canonical Files

- `.env`
  - shared executable defaults and orchestrator/library usage
- `.env.batch-backend`
  - local/dev stack for `@esl-pipeline/batch-backend` and related services
- Generated lookup:
  - [`docs/generated/env-surface-index.md`](../generated/env-surface-index.md)

## Bootstrap Policy

- New executable entrypoints should load env through shared `loadCliEnv()` from `@esl-pipeline/shared-infrastructure`, or a thin wrapper that delegates to it.
- Do not add ad-hoc dotenv parsing in package entrypoints.
- Host-invoked tools and container runtime are different contexts:
  - Compose-safe defaults like `PG_HOST=postgres` remain canonical for containers.
  - Host tools should adapt internally when they need `127.0.0.1`.

## Runtime Groups

### Shared runtime and orchestrator

Primary groups:

- Notion / publishing:
  - `NOTION_*`, `ANYTYPE_*`
- Speech runtime:
  - `ESL_TTS_*`, `ESL_STT_*`, `VOICE_ALIGNMENT_V2_*`
- Storage / uploads / manifests:
  - `AWS_*`, `S3_*`, `STORAGE_*`, `ESL_PIPELINE_MANIFEST_*`
- Remote config:
  - `ESL_PIPELINE_CONFIG_*`
- Optional logging/debug:
  - `LOG_LEVEL`

Read next:

- [`packages/orchestrator/README.md`](../../packages/orchestrator/README.md)
- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)

### Batch backend service

Primary groups:

- API/runtime:
  - `NODE_ENV`, `BATCH_BACKEND_HTTP_PORT`, `BATCH_BACKEND_ENABLE_EXTENDED_API`
- Infra:
  - `PG_*`, `REDIS_*`, `BATCH_JOBS_QUEUE_NAME`, `TRANSCRIBE_QUEUE_NAME`
- Worker/runtime:
  - `WORKER_CONCURRENCY`, `MAX_CONCURRENT_FFMPEG`, `FILESYSTEM_UPLOAD_DIR`, `PIPELINE_CWD`
- Auth/security/uploads:
  - `JWT_*`, `REFRESH_*`, `ENABLE_*`, `CORS_*`, upload limits

Read next:

- [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
- [`docs/generated/backend-route-index.md`](../generated/backend-route-index.md)

### Direct generation policy

Primary groups:

- Provider credentials:
  - `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`
- Model selection and fallbacks:
  - `GEN_PROVIDER_*`, `GEN_*_MODEL_*`
- Safety and budgets:
  - `GEN_SAFETY_MODE`, `GEN_STRICT_NO_PAID`, `GEN_ALLOW_PAID_SPEND`, `GEN_*_BUDGET`
- Timeouts/retries:
  - `GEN_*_REQUEST_TIMEOUT_MS`, `GEN_*_RETRY_*`

Read next:

- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)

### Postgres ops and backups

Primary groups:

- Backup/archive:
  - `PG_BACKUP_S3_*`, `PG_BACKUP_LOCAL_RETENTION_DAYS`, `PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS`
- Ops health / alerting:
  - `PG_BACKUP_HEALTH_*`, `PG_BACKUP_KEY_ROTATION_*`, `PG_BACKUP_ALERT_*`
- Container targeting:
  - `PG_CONTAINER_NAME`

Read next:

- [`docs/operations/postgres-backup-restore.md`](../operations/postgres-backup-restore.md)
- [`docs/operations/postgres-backup-s3.md`](../operations/postgres-backup-s3.md)
- [`docs/operations/postgres-ops-health.md`](../operations/postgres-ops-health.md)

### Telegram ops bot

Primary groups:

- Enablement/runtime:
  - `TELEGRAM_OPS_BOT_ENABLED`, `TELEGRAM_OPS_BOT_MODE`, `TELEGRAM_OPS_BOT_API_BASE_URL`
- Safety and routing:
  - `TELEGRAM_OPS_BOT_ALLOWED_USER_IDS`, `TELEGRAM_OPS_BOT_CHAT_ID`, `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS`, `TELEGRAM_OPS_BOT_TOPIC_*`
- Webhook/polling:
  - `TELEGRAM_OPS_BOT_WEBHOOK_*`, `TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED`, `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP`
- Backend bridge:
  - `TELEGRAM_OPS_BOT_BACKEND_*`, `TELEGRAM_OPS_BOT_APPROVAL_REPLAY_*`

Read next:

- [`packages/telegram-ops-bot/README.md`](../../packages/telegram-ops-bot/README.md)
- [`docs/operations/telegram-ops-control-panel.md`](../operations/telegram-ops-control-panel.md)

## Default and Safety Notes

- Prefer namespaced canonical variables over legacy aliases when both exist.
- Budget values of `0` are intentional hard stops, not “unset”.
- Generation battle-testing defaults should stay fail-safe:
  - `GEN_SAFETY_MODE=hard_stop`
  - `GEN_STRICT_NO_PAID=true`
  - `GEN_MAX_OUTPUT_TOKENS_HARD=3200`
- Direct generation provider requests default to 240000 ms unless overridden per provider.
- Telegram mutating ops stay disabled unless `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=true`.
- Backend ops control is additive and should remain off unless explicitly enabled with `BATCH_BACKEND_ENABLE_OPS_CONTROL=true`.

## Exhaustive Lookup

For full key-by-key lookup, ownership, and next-hop docs, use:

- [`docs/generated/env-surface-index.md`](../generated/env-surface-index.md)

## Related

- [`packages/orchestrator/README.md`](../../packages/orchestrator/README.md)
- [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
- [`packages/telegram-ops-bot/README.md`](../../packages/telegram-ops-bot/README.md)
- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)
