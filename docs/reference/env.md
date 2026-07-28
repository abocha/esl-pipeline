# Environment Configuration Guide

## Meta

- Audience: maintainers and implementing agents.
- Read Time: 5 minutes.
- Authority Level: environment contract reference.
- Last Verified Against: 2026-06-13 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after environment contract changes.
- Status: `reference`.

## Purpose

- Define the canonical env surfaces for the repo.
- Keep policy and defaults here while pushing exhaustive key lookup to the generated env index.

## Canonical Files

- `.env`
  - the sole application configuration file for local development, Compose, backend services,
    workers, host tools, backups, and VPS deployment
- `.secrets/`
  - mounted credential files only; not a dotenv replacement
- `/var/lib/esl-pipeline/deploy/*.env`
  - generated image-state only; never application configuration
- Generated lookup:
  - [`docs/generated/env-surface-index.md`](../generated/env-surface-index.md)

Direct CLI/tool entrypoints accept a legacy `.env.batch-backend` only when `.env` is absent, emit a
deprecation warning, and never merge the two files. That bridge is removed next release. Compose
and production deployment already require `.env`.

## Validation and Migration

```bash
# Local development
pnpm env:validate -- --profile=development

# VPS preflight (also run edge/image validators when those surfaces apply)
pnpm env:validate -- --profile=production
pnpm docker:prod:edge:env
pnpm docker:prod:images:env
```

To migrate an existing VPS: back up `/opt/esl-pipeline/.env.batch-backend`, rename it to `.env`,
run the production validation plus applicable edge/image preflights, then recreate/deploy and verify
the backend, workers, and backup tooling. The validator checks file shape, duplicate keys, selected
profile requirements, and backend-supported values without printing secrets.

## Bootstrap Policy

- New direct executable entrypoints should load env through shared `loadApplicationEnv()` from
  `@esl-pipeline/shared-infrastructure`.
- Do not add ad-hoc dotenv parsing in package entrypoints.
- Host-invoked tools and container runtime are different contexts:
  - Compose-safe defaults like `PG_HOST=postgres` remain canonical for containers.
  - Host tools should adapt internally when they need `127.0.0.1`.

## Runtime Groups

### Shared runtime and orchestrator

Primary groups:

- HTML publishing / manifests:
  - `AWS_*`, `S3_*`, `STORAGE_*`, `ESL_PIPELINE_MANIFEST_*`
- Speech runtime:
  - `ESL_TTS_*`, `ESL_STT_*`, `VOICE_ALIGNMENT_V2_*`
  - Inworld TTS uses `INWORLD_API_KEY` or `ESL_TTS_PROVIDER_INWORLD_API_KEY`, plus optional `ESL_TTS_PROVIDER_INWORLD_*` model/voice/runtime overrides.
  - `ESL_TTS_PROVIDER_INWORLD_TIMEOUT_MS` bounds each in-flight SDK request. The SDK client is lazy
    and reusable, and its internal `maxRetries` is always `0`.
  - `ESL_TTS_PROVIDER_INWORLD_RETRY_MAX` defaults to `3` and is clamped to `0`-`3`. The application
    owns the initial attempt plus up to three retries with 1/2/4-second bases and uniform plus or
    minus 20 percent jitter. Only HTTP 408/429/5xx and typed transient network, reset, disconnect,
    or timeout failures retry; caller cancellation, expired deadlines, auth/permission, invalid
    requests/voices, and other deterministic 4xx failures do not.
  - Caller cancellation and deadlines are observed between SDK calls. The installed SDK cannot
    cancel `generate()` after it starts, so the configured SDK timeout remains the in-flight bound.
    Routine diagnostics use hashes, counts, normalized categories, latency, cache totals, and output
    bytes without learner text or raw provider bodies.
  - Expressive TTS planning uses opt-in `ESL_TTS_SPEECH_PLANNER_ENABLED`, optional `ESL_TTS_SPEECH_PLANNER_MODEL`, optional `ESL_TTS_SPEECH_PLANNER_MAX_OUTPUT_TOKENS`, and separate `ESL_TTS_SPEECH_PLANNER_*_BUDGET` limits. The planner reuses server-side `GEMINI_API_KEY`.
  - Inworld voice planning uses `ESL_TTS_VOICE_RANKER_ENABLED`, optional `ESL_TTS_VOICE_RANKER_MODEL`, optional `ESL_TTS_VOICE_RANKER_MAX_OUTPUT_TOKENS`, and separate `ESL_TTS_VOICE_RANKER_*_BUDGET` limits. The default semantic ranker is `gemma-4-31b-it`.
  - Local planner inspection can opt into full validated or rejected plan logs with `ESL_TTS_SPEECH_PLANNER_DEBUG_LOG_PLAN=true`. Voice-ranker inspection can opt into shortlist and failure details with `ESL_TTS_VOICE_RANKER_DEBUG_LOG_PLAN=true`. Leave these disabled outside short-lived debugging because logs may include learner text.
  - After changing planner env values in a Compose deployment, recreate `batch-backend` and `batch-worker`.
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
  - `GEN_OPENAI_TARGET_MODELS_ENABLED` (defaults to `false`; retained as a compatibility and
    operator-observability signal, while both states use the built-in GPT-5.6 Sol/Luna policy)
  - built-in OpenAI defaults: assignment `gpt-5.6-sol`; memory and profile workloads
    `gpt-5.6-luna`; explicit `GEN_OPENAI_MODEL_*` values override those defaults
- Safety and budgets:
  - `GEN_SAFETY_MODE`, `GEN_STRICT_NO_PAID`, `GEN_ALLOW_PAID_SPEND`, `GEN_*_BUDGET`
- Disabled Batch replay:
  - `STUDENT_MEMORY_OPENAI_BATCH_ENABLED` (defaults to `false`; gates every remote OpenAI Batch
    action for historical student-memory replay and does not alter normal online generation)
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
  - `PG_COMPOSE_PROJECT`, `PG_COMPOSE_FILE`, `PG_CONTAINER_NAME`

Use the `pnpm docker:prod:db:*` wrappers for the closed-alpha production Compose stack; they set
the prod Compose project/file/container defaults before delegating to the shared backup scripts.

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
- Pronunciation synthesis uses the configured provider stack; container images do not provision a
  separate pronunciation helper runtime.
- Budget values of `0` are intentional hard stops, not “unset”.
- Generation battle-testing defaults should stay fail-safe:
  - `GEN_SAFETY_MODE=hard_stop`
  - `GEN_STRICT_NO_PAID=true`
  - `GEN_MAX_OUTPUT_TOKENS_HARD=3200`
- Direct generation provider requests default to 240000 ms unless overridden per provider.
- `GEN_OPENAI_TPM_BUDGET` defaults to `160000`; it is an operator capacity setting, not a billing or
  plan-tier setting.
- The opt-in live generation evaluation entrypoint loads `.env` before it checks
  `GENERATION_LIVE_EVAL_ENABLED=true` and `OPENAI_API_KEY`; both are required before it
  will call OpenAI.
- `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false` is a separate remote-operation gate. `dry-run`
  planning is local only; Batch upload, status, polling, reconciliation, retry, and cancellation
  must remain disabled until an operator explicitly enables this flag.
- Telegram mutating ops stay disabled unless `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=true`.
- Backend ops control is additive and should remain off unless explicitly enabled with
  `BATCH_BACKEND_ENABLE_OPS_CONTROL=true`; command execution also requires explicit
  `BATCH_BACKEND_OPS_CONTROL_*_COMMAND` values and must not depend on Docker/AWS tooling inside the
  long-running backend container.

## Exhaustive Lookup

For full key-by-key lookup, ownership, and next-hop docs, use:

- [`docs/generated/env-surface-index.md`](../generated/env-surface-index.md)

## Related

- [`packages/orchestrator/README.md`](../../packages/orchestrator/README.md)
- [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
- [`packages/telegram-ops-bot/README.md`](../../packages/telegram-ops-bot/README.md)
- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)
