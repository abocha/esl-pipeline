# Environment Configuration Guide

## Meta

- Audience: maintainers and implementing agents.
- Read Time: 8 minutes.
- Authority Level: environment contract reference.
- Last Verified Against: 2026-03-10 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after environment contract changes.
- Status: `active`.

This repo uses a few env files for different runtimes:

- `.env` (from `.env.example`): for orchestrator library usage and shared executable defaults.
- `.env.batch-backend` (from `.env.batch-backend.example`): for the batch backend service (docker-compose).

Node: 24.11.1+ (see `.nvmrc` / `package.json`).

## Bootstrap Policy for Executables

- New executable entrypoints (CLI, workers, one-off tools) should bootstrap environment through
  shared `loadCliEnv()` from `@esl-pipeline/shared-infrastructure` (or a thin package wrapper that
  delegates to it), not ad-hoc dotenv parsing.
- `loadCliEnv()` resolves workspace/root `.env` files consistently and supports optional memoized
  loading behavior.

## Core (Orchestrator Library)

Set these in `.env` (or your shell) when running orchestrator programmatic API calls and backend runtime flows:

- `NOTION_TOKEN` — Notion integration token.
- `NOTION_CLIENT_TIMEOUT` (optional) — Notion client timeout (ms).
- `NOTION_COLORIZER_THROTTLE_MS`, `NOTION_COLORIZER_MAX_RETRIES`, `NOTION_COLORIZER_RETRY_DELAY_MS` (optional) — Notion colorizer pacing.
- `ESL_TTS_DEFAULT_PROVIDER` (optional, `elevenlabs`|`google`, default `elevenlabs`) — primary TTS provider.
- `ESL_TTS_PROVIDER_ORDER` (optional, comma-separated) — fallback provider order.
- `ESL_TTS_PROVIDER_ELEVENLABS_API_KEY` — ElevenLabs API key when ElevenLabs is enabled.
- `ESL_TTS_PROVIDER_ELEVENLABS_MODEL_ID` (optional, default `eleven_multilingual_v2`) — ElevenLabs model.
- `ESL_TTS_PROVIDER_ELEVENLABS_OUTPUT_FORMAT` (optional, default `mp3_22050_32`) — ElevenLabs audio format.
- `ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY` (optional, `auto`|`dialogue`|`tts`, default `auto`) — ElevenLabs strategy.
- `ESL_TTS_PROVIDER_ELEVENLABS_MAX_CHARS` (optional, default `4500`) — ElevenLabs max chars per request.
- `ESL_TTS_PROVIDER_ELEVENLABS_DIALOGUE_LANGUAGE` (optional) — ElevenLabs dialogue language code.
- `ESL_TTS_PROVIDER_ELEVENLABS_DIALOGUE_STABILITY` (optional) — ElevenLabs dialogue stability (0–1).
- `ESL_TTS_PROVIDER_ELEVENLABS_DIALOGUE_SEED` (optional) — ElevenLabs dialogue seed.
- `ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH` (optional) — path to ElevenLabs voices catalog JSON.
- `ESL_TTS_PROVIDER_GOOGLE_MODEL` (optional, default `chirp3_hd`) — Google model family (`chirp3_hd|studio|neural2|wavenet`).
- `ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE` (optional) — Google language code.
- `ESL_TTS_PROVIDER_GOOGLE_API_ENDPOINT` (optional) — Google endpoint override.
- `ESL_TTS_PROVIDER_GOOGLE_LOCATION` (optional, `us|eu`) — Google regional endpoint shortcut.
- `ESL_TTS_PROVIDER_GOOGLE_MODEL_NAME` (optional) — Google model name override sent to API.
- `ESL_TTS_PROVIDER_GOOGLE_MAX_BYTES` (optional, default `5000`) — Google chunk byte limit.
- `ESL_TTS_PROVIDER_GOOGLE_VOICE_CHIRP3_HD` (optional) — default `chirp3_hd` voice.
- `ESL_TTS_PROVIDER_GOOGLE_VOICE_STUDIO` (optional) — default `studio` voice.
- `ESL_TTS_PROVIDER_GOOGLE_VOICE_NEURAL2` (optional) — default `neural2` voice.
- `ESL_TTS_PROVIDER_GOOGLE_VOICE_WAVENET` (optional) — default `wavenet` voice.
- Google catalog and assignment notes:
  - Google provider loads voices from live `listVoices` and caches in process (15m TTL).
  - Auto-assignment currently scopes to English locales (`en-*`).
  - Explicit `speaker_profiles.voice` / `voices.yml` mappings must match selected Google model family.
- `VOICE_ALIGNMENT_V2_ENABLED` (optional, default `false`) — Enables v2 voice-alignment pipeline behavior.
- `VOICE_ALIGNMENT_V2_STRICT_VALIDATION` (optional, default `false`) — Promotes voice metadata compatibility checks to hard validation errors.
- `VOICE_ALIGNMENT_V2_MIN_SCORE` (optional, default `20`) — Minimum heuristic score accepted for strict auto voice assignment.
- `VOICE_ALIGNMENT_V2_PROMPT` (optional, default `false`) — Enables prompt snapshot `hw_prompt_v4-4_voice-aligned`.
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — AWS creds for uploads.
- `S3_BUCKET` — Bucket for audio uploads.
- `S3_PREFIX` (optional) — Key prefix for uploads (e.g., `audio/assignments`).
- `S3_ENDPOINT` (optional) — S3-compatible endpoint (MinIO/etc).
- `S3_UPLOAD_MAX_MB` (optional, default `50`) — Upload size cap in MB for S3 audio uploads.
- Postgres backup archival (optional, S3):
  - `PG_BACKUP_S3_BUCKET` — Dedicated bucket for DB backup objects.
  - `PG_BACKUP_S3_PREFIX` (optional, default `backups/postgres`) — Base key prefix.
  - `PG_BACKUP_S3_REGION` (optional, default from `AWS_REGION`) — Region for backup S3 operations.
  - `PG_BACKUP_S3_SSE` (optional, default `aws:kms`) — Object encryption mode.
  - `PG_BACKUP_S3_KMS_KEY_ID` (required when `PG_BACKUP_S3_SSE=aws:kms`) — KMS key ARN/ID.
  - `PG_BACKUP_S3_ENV` (optional, default `dev`) — Environment segment in backup key paths.
  - `PG_BACKUP_S3_PROFILE` (optional) — AWS CLI profile override for backup scripts.
  - `PG_BACKUP_ALLOW_EMPTY_SOURCE` (optional, default `false`) — Blocks backup creation when anchor tables (`users`,`jobs`,`transcripts`) are all empty; set `true` only for intentional empty snapshots.
  - Scheduler wrapper vars:
    - `PG_BACKUP_ENV_FILE` (optional, default `.env.batch-backend`) — Env file loaded by backup S3 scripts.
    - `PG_BACKUP_LOG_DIR` (optional, default `tmp/logs/backup`) — Backup scheduler log location.
    - `PG_BACKUP_LOG_RETENTION_DAYS` (optional, default `30`) — Local scheduler log retention.
    - `PG_BACKUP_SCHEDULE_LABEL` (optional, default `nightly`) — Label passed to daily backup runs.
    - `PG_BACKUP_LOCAL_RETENTION_DAYS` (optional, default `30`) — Days to keep local backup sets in `tmp/backups/postgres`.
    - `PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS` (optional, default `14`) — Days to keep local `remote-restore` download artifacts.
    - `PG_BACKUP_RESTORE_DRILL_AUTO` (optional, default `false`) — Auto-run monthly reminder as a `--download-only` restore drill.
    - `PG_BACKUP_RESTORE_DRILL_REPORT_LATEST` (optional) — Override path for latest restore-drill JSON report pointer.
  - Ops health/alert vars:
    - `PG_BACKUP_HEALTH_MAX_BACKUP_AGE_HOURS` (optional, default `26`) — Backup freshness threshold for ops alerts.
    - `PG_BACKUP_HEALTH_MAX_DRILL_AGE_DAYS` (optional, default `35`) — Restore-drill freshness threshold for ops alerts.
    - `PG_BACKUP_KEY_ROTATION_MAX_AGE_DAYS` (optional, default `80`) — Active AWS key-age threshold.
    - `PG_BACKUP_ALERT_COOLDOWN_MINUTES` (optional, default `360`) — Suppress repeated unhealthy alerts until cooldown expires.
    - `PG_BACKUP_IAM_USER` (optional) — Explicit IAM username for key-age checks (auto-derived from STS caller when omitted).
    - `PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN` (optional) — Telegram bot token for ops alerts and backup/restore completion notifications.
    - `PG_BACKUP_ALERT_TELEGRAM_CHAT_ID` (optional) — Telegram target chat/channel id for alerts and completion notifications.
    - `PG_BACKUP_ALERT_TELEGRAM_THREAD_ID` (optional) — Telegram forum thread id.
    - `PG_BACKUP_ALERT_TELEGRAM_DISABLE` (optional, default `false`) — Disable Telegram delivery while keeping local status checks active.
- `ESL_PIPELINE_MANIFEST_STORE` (optional, `filesystem`|`s3`, default `filesystem`) — Manifest backend.
- `ESL_PIPELINE_MANIFEST_BUCKET` (when store=`s3`) — Bucket for manifests.
- `ESL_PIPELINE_MANIFEST_PREFIX` (optional) — Manifest key prefix.
- `ESL_PIPELINE_MANIFEST_ROOT` (optional) — Local root for manifest path derivation.
- `ESL_PIPELINE_CONFIG_PROVIDER` (optional, `local`|`http`, default `local`) — Config provider.
- `ESL_PIPELINE_CONFIG_ENDPOINT` (when provider=`http`) — Remote config base URL.
- `ESL_PIPELINE_CONFIG_TOKEN` (optional) — Auth token for remote config.
- `ESL_PIPELINE_CONFIG_PRESETS_PATH` (optional) — Remote presets path.
- `ESL_PIPELINE_CONFIG_STUDENTS_PATH` (optional) — Remote students path.
- `ESL_PIPELINE_CONFIG_VOICES_PATH` (optional) — Remote voices path.
- `ESL_PIPELINE_CONFIG_CACHE_TTL_MS` (optional, default `60000`) — In-process cache TTL for remote config responses.
- `ESL_PIPELINE_CONFIG_CACHE_STALE_IF_ERROR_MS` (optional, default `300000`) — How long stale remote config may be served when upstream fetches fail.
- `ESL_PIPELINE_CONFIG_CONDITIONAL_REQUESTS` (optional, default `true`) — Enables conditional requests (`If-None-Match` / `If-Modified-Since`) for remote config revalidation.
- `ESL_PIPELINE_CACHE_ENV` (optional, default `false`) — Enables memoized env loading in
  `loadCliEnv()` for executable entrypoints.
- `LOG_LEVEL` (optional) — Verbosity for executable runtime logs.
  - Backend logger supports: `trace` | `debug` | `info` | `warn` | `error` | `fatal` | `silent`.

## Generation Provider and Safety Vars (WS2B + WS3.5)

These keys are active for direct draft generation and safety guardrails.

- `GEN_PROVIDER_DEFAULT` — Default provider key (`openai`, `google_ai_studio`, `openrouter`).
- `GEN_PROVIDER_FALLBACKS` — Comma-separated provider fallback order after default.
- `GEN_QUOTA_SOURCE_MODE` (default `hybrid`) — Quota display mode (`configured`|`provider`|`hybrid`).

Model defaults:

- `GEN_OPENAI_MODEL_PRIMARY` / `GEN_OPENAI_MODEL_FALLBACK`
- `GEN_GOOGLE_MODEL_PRIMARY` / `GEN_GOOGLE_MODEL_FALLBACK` / `GEN_GOOGLE_MODEL_TERTIARY`
- `GEN_OPENROUTER_MODEL_PRIMARY` / `GEN_OPENROUTER_MODEL_FALLBACK`

Strict model allowlists (used when `GEN_STRICT_NO_PAID=true`):

- `GEN_ALLOWED_MODELS_OPENAI`
- `GEN_ALLOWED_MODELS_GOOGLE`
- `GEN_ALLOWED_MODELS_OPENROUTER`

Safety mode and hard caps:

- `GEN_SAFETY_MODE` (`off`|`warn`|`hard_stop`, default `hard_stop`)
- `GEN_STRICT_NO_PAID` (default `true`)
- `GEN_MAX_OUTPUT_TOKENS_HARD` (default `1200`)
- `GEN_ALLOW_PAID_SPEND` (default `false`; floodgates switch that bypasses strict allowlists + hard budget checks)

Fail-safe testing defaults (recommended local baseline):

- `GEN_SAFETY_MODE=hard_stop`
- `GEN_STRICT_NO_PAID=true`
- `GEN_MAX_OUTPUT_TOKENS_HARD=1200`

Provider runtime policy (provider-specific values):

- `GEN_OPENAI_REQUEST_TIMEOUT_MS`, `GEN_OPENAI_RETRY_MAX`, `GEN_OPENAI_RETRY_BACKOFF_MS`
- `GEN_GOOGLE_REQUEST_TIMEOUT_MS`, `GEN_GOOGLE_RETRY_MAX`, `GEN_GOOGLE_RETRY_BACKOFF_MS`
- `GEN_OPENROUTER_REQUEST_TIMEOUT_MS`, `GEN_OPENROUTER_RETRY_MAX`, `GEN_OPENROUTER_RETRY_BACKOFF_MS`
- `GEN_OPENAI_DAILY_TOKEN_BUDGET` (max OpenAI tokens/day under local safety policy)
- `GEN_OPENAI_DAILY_REQUEST_BUDGET` (max OpenAI requests/day under local safety policy)
- `GEN_OPENAI_RPM_BUDGET` (max OpenAI requests/minute under local safety policy)
- `GEN_GOOGLE_DAILY_REQUEST_BUDGET` (max Google requests/day under local safety policy)
- `GEN_GOOGLE_RPM_BUDGET` (max Google requests/minute under local safety policy)
- `GEN_OPENROUTER_DAILY_TOKEN_BUDGET` (max OpenRouter tokens/day under local safety policy)
- `GEN_OPENROUTER_DAILY_REQUEST_BUDGET` (max OpenRouter requests/day under local safety policy)
- `GEN_OPENROUTER_RPM_BUDGET` (max OpenRouter requests/minute under local safety policy)

Budget behavior note:

- Setting a budget to `0` intentionally hard-blocks that dimension until configuration is changed.

Provider auth/runtime identity vars:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY` (Google AI Studio API key for `@google/genai`)
- `OPENROUTER_API_KEY`

Operator note for key rotation:

- To switch Google AI Studio accounts/tiers, update only `GEMINI_API_KEY` in `.env.batch-backend`,
  then recreate `batch-backend` and `batch-worker` so runtime config reloads:
  `docker compose -f docker-compose.yml up -d --force-recreate batch-backend batch-worker`.
- `OPENROUTER_HTTP_REFERER` (optional telemetry/ranking header)
- `OPENROUTER_X_TITLE` (optional telemetry/ranking header)

See `docs/reference/GENERATION_PROVIDER_POLICY.md` for canonical provider/model/quota decisions.
See `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md` for OpenAI request/response/error contract details.
See `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md` for Google request/response/error contract details.
See `docs/reference/OPENROUTER_WS2B_PROFILE.md` for OpenRouter request/response/error contract details.

## Batch Backend (docker-compose)

Use `.env.batch-backend` for the service stack. It includes all core keys above plus service-specific settings:

- `NODE_ENV` — `development` for local.
- `BATCH_BACKEND_HTTP_PORT` — HTTP port.
- `BATCH_BACKEND_ENABLE_EXTENDED_API` — Enable uploads/auth/admin routes.
- Ops control API (additive, admin-auth, optional):
  - `BATCH_BACKEND_ENABLE_OPS_CONTROL` (default `false`) — Enables `/ops/status`, `/ops/actions`, `/ops/actions/:operationId`.
  - `BATCH_BACKEND_OPS_CONTROL_BOT_SECRET` (optional) — Requires matching `x-ops-bot-secret` header for `/ops/*`.
  - `BATCH_BACKEND_OPS_CONTROL_STATUS_COMMAND` (default `bash scripts/docker/postgres-ops-status.sh --json`) — Command wrapper used by `GET /ops/status`.
  - `BATCH_BACKEND_OPS_CONTROL_BACKUP_COMMAND` (default `bash scripts/docker/postgres-backup-s3.sh backup-upload`) — Command wrapper for `backup_upload`.
  - `BATCH_BACKEND_OPS_CONTROL_RESTORE_DRILL_COMMAND` (default `PG_BACKUP_RESTORE_DRILL_AUTO=true bash scripts/docker/run-postgres-restore-drill-reminder.sh`) — Command wrapper for `restore_drill_download_only`.
  - `BATCH_BACKEND_OPS_CONTROL_ACTION_TIMEOUT_MS` (default `600000`) — Timeout per ops command execution.
  - `BATCH_BACKEND_OPS_CONTROL_ACTION_HISTORY_LIMIT` (default `100`) — In-memory bounded history size for ops action statuses.
- Telegram ops bot runtime (separate package/service, optional):
  - `TELEGRAM_OPS_BOT_ENABLED` (default `false`) — Starts/stops bot runtime.
  - `TELEGRAM_OPS_BOT_TOKEN` — Telegram bot token.
  - `TELEGRAM_OPS_BOT_CHAT_ID` — Target chat id (forum supergroup or regular chat id).
  - `TELEGRAM_OPS_BOT_ALLOWED_USER_IDS` — Comma-separated operator Telegram user ids.
  - `TELEGRAM_OPS_BOT_BACKEND_URL` (default `http://batch-backend:8080`) — Backend base URL.
  - `TELEGRAM_OPS_BOT_BACKEND_EMAIL`, `TELEGRAM_OPS_BOT_BACKEND_PASSWORD` — Service-account login credentials.
  - `TELEGRAM_OPS_BOT_BACKEND_TIMEOUT_MS` (default `15000`) — Backend request timeout.
  - `TELEGRAM_OPS_BOT_BACKEND_SHARED_SECRET` (optional) — Shared secret sent as `x-ops-bot-secret` for `/ops/*`.
  - `TELEGRAM_OPS_BOT_POLL_INTERVAL_MS` (default `1500`) — Retry/sleep interval between polling iterations.
  - `TELEGRAM_OPS_BOT_POLL_TIMEOUT_SECONDS` (default `20`) — Telegram long-poll timeout.
  - `TELEGRAM_OPS_BOT_COMMAND_WINDOW_MS` (default `60000`) — Per-user rate-limit window.
  - `TELEGRAM_OPS_BOT_MAX_COMMANDS_PER_WINDOW` (default `20`) — Max commands per user in rate-limit window.
  - `TELEGRAM_OPS_BOT_TOPIC_AUTO_CREATE` (default `true`) — Try creating domain topics (`ops`, `jobs`, `alerts`) on startup.
  - `TELEGRAM_OPS_BOT_DEFAULT_THREAD_ID` (optional) — Fallback thread when topic routing is unavailable.
  - `TELEGRAM_OPS_BOT_TOPICS_STATE_FILE` (default `tmp/state/telegram-ops-topics.json`) — Cached topic mapping state.
  - `TELEGRAM_OPS_BOT_TOPIC_NAME_OPS`, `TELEGRAM_OPS_BOT_TOPIC_NAME_JOBS`, `TELEGRAM_OPS_BOT_TOPIC_NAME_ALERTS` — Auto-created topic names.
  - `TELEGRAM_OPS_BOT_APP_BASE_URL` (optional) — Base URL for pretty links in bot messages.
- `FILESYSTEM_UPLOAD_DIR` — Local uploads path (shared volume).
- `DRAFT_LOCAL_EXPORT` (optional, default `true` in dev, `false` otherwise) — Persist materialized draft markdown files under `FILESYSTEM_UPLOAD_DIR/drafts`.
- `PIPELINE_CWD` — Orchestrator working directory for pipeline runs.
- Postgres: `PG_ENABLED`, `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` (or `PG_CONNECTION_STRING`),
  `PG_POOL_MAX`, `PG_IDLE_TIMEOUT_MS`, `PG_CONNECTION_TIMEOUT_MS`, `PG_AUTO_MIGRATE_ON_BOOT`,
  `PG_MIGRATION_LOCK_KEY`, `PG_MIGRATIONS_DIR`.
- Redis: `REDIS_ENABLED`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (optional).
- BullMQ: `BATCH_JOBS_QUEUE_NAME`, `TRANSCRIBE_QUEUE_NAME`.
- SMTP (optional): `MAIL_ENABLED`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASSWORD`.
- Manifest/config selection: same `ESL_PIPELINE_*` keys as core (see above).
- Prompt templates/profiles: `PROMPT_TEMPLATE_PATH`, `PROMPT_PROFILE_PATH`.
  - Defaults live under `docs/templates` unless overridden.
  - Template/profile allowlists are derived from the directories containing these paths.
- Voice-alignment rollout:
  - `VOICE_ALIGNMENT_V2_ENABLED`
  - `VOICE_ALIGNMENT_V2_STRICT_VALIDATION`
  - `VOICE_ALIGNMENT_V2_MIN_SCORE`
  - `VOICE_ALIGNMENT_V2_PROMPT`
  - Shadow mode behavior: when `VOICE_ALIGNMENT_V2_ENABLED=true` and strict validation is off,
    markdown validation remains non-blocking but emits `voiceDiagnostics.shadowMode` mismatch classes.
- Auth (extended API):
  - `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN`, `BCRYPT_ROUNDS`
  - `REFRESH_COOKIE_NAME`, `REFRESH_COOKIE_SAMESITE`, `REFRESH_COOKIE_SECURE`
  - Optional: `REFRESH_COOKIE_DOMAIN`, `REFRESH_COOKIE_PATH`
- Prompt/job metadata fallbacks:
  - `NOTION_DB_OPTIONS`, `NOTION_DB_ID`, `NOTION_DB_NAME`, `NOTION_DB_LABEL`
  - `ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH`, `REPO_ROOT`, `APP_ROOT`, `PROJECT_ROOT`
- Transcription pipeline:
  - `TRANSCRIBE_MODE` (`timeline`|`stack`), `TRANSCRIBE_MAX_CONCURRENCY`
  - Provider selection:
    - `STT_PROVIDER` (default provider override, `deepgram`|`elevenlabs`|`google`)
    - `ESL_STT_DEFAULT_PROVIDER` (canonical default provider key)
    - `ESL_STT_PROVIDER_ORDER` (comma-separated provider priority list used for metadata/default resolution)
  - Provider namespaced STT settings:
    - Deepgram:
      - `ESL_STT_PROVIDER_DEEPGRAM_API_KEY`
      - `ESL_STT_PROVIDER_DEEPGRAM_ACCESS_TOKEN` (optional)
      - `ESL_STT_PROVIDER_DEEPGRAM_MODEL` (default `nova-3`)
      - `ESL_STT_PROVIDER_DEEPGRAM_LANGUAGE` (default `multi`)
    - ElevenLabs (Scribe):
      - `ESL_STT_PROVIDER_ELEVENLABS_API_KEY` (or `ESL_STT_PROVIDER_ELEVENLABS_API_TOKEN`)
      - `ESL_STT_PROVIDER_ELEVENLABS_MODEL` (default `scribe_v2`)
    - Google Cloud STT V2:
      - `GOOGLE_STT_PROJECT_ID`
      - `GOOGLE_STT_LOCATION` (default `us`)
      - `GOOGLE_STT_RECOGNIZER` (optional recognizer path override)
      - `GOOGLE_STT_MODEL` (default `latest_long`)
      - `GOOGLE_STT_LANGUAGE_CODES` (comma-separated, default `en-US`)
      - `GOOGLE_STT_GCS_STAGING_BUCKET` (required when `STT_PROVIDER=google`)
      - `GOOGLE_STT_GCS_STAGING_PREFIX` (default `stt-staging`)
  - STT runtime flags:
    - `ESL_STT_STORE_RAW_RESPONSE` (default `true`; controls raw STT response persistence)
  - Legacy STT aliases remain supported with deprecation warnings:
    - `DEEPGRAM_API_KEY`, `DEEPGRAM_ACCESS_TOKEN`, `DEEPGRAM_MODEL`, `DEEPGRAM_LANGUAGE`, `DEEPGRAM_STORE_RAW_RESPONSE`
    - `ELEVENLABS_API_KEY`, `ELEVENLABS_API_TOKEN`
  - `WORKER_CONCURRENCY`, `MAX_CONCURRENT_FFMPEG`
  - ElevenLabs TTS cache controls:
    - `BATCH_TTS_CACHE_DIR` (default `./tmp/tts-cache`) — persistent audio cache directory used by worker pipeline runs.
    - `BATCH_TTS_CACHE_MAX_AGE_DAYS` (default `30`) — age-based pruning threshold for cached artifacts.
    - `BATCH_TTS_CACHE_MAX_BYTES` (default `10737418240`) — size cap (10 GB) for cache pruning.
    - `BATCH_TTS_CACHE_MAINTENANCE_INTERVAL_MINUTES` (default `60`) — minimum interval between cache cleanup passes.
    - `BATCH_TTS_CACHE_MAINTENANCE_LOCK_KEY` (default `910021`) — Postgres advisory lock key used to coordinate cache cleanup across worker processes.
- Storage (recordings, transcripts, drafts):
  - `STORAGE_PROVIDER` (`filesystem`|`s3`, auto-selects when unset)
  - `S3_REGION` or `AWS_REGION`
  - `S3_BUCKET_NAME` or `S3_BUCKET` or `STORAGE_BUCKET_NAME`
  - `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
  - `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`
  - `S3_PATH_PREFIX` or `STORAGE_PATH_PREFIX`
  - `PRESIGNED_URL_EXPIRES_IN`
  - `ENABLE_MULTIPART_UPLOADS`, `MAX_MULTIPART_SIZE`
- Upload + security controls:
  - `MAX_FILE_SIZE`, `RECORDINGS_MAX_FILE_SIZE`, `ALLOWED_MIME_TYPES`
  - `UPLOAD_RATE_LIMIT`, `UPLOAD_BURST_LIMIT`, `UPLOAD_QUOTA_PER_USER`
  - `ENABLE_FILE_VALIDATION`, `ENABLE_FILE_SANITIZATION`, `ENABLE_RATE_LIMITING`, `ENABLE_SECURITY_LOGGING`
  - `JOB_SUBMISSION_RATE_LIMIT`
  - `ENABLE_CORS`, `CORS_CREDENTIALS`, `CORS_ORIGIN`
  - `SECURITY_HEADERS_ENABLED`, `HSTS_MAX_AGE`

Notes:

- Keep `.env` focused on shared library/runtime credentials; `.env.batch-backend` adds DB/Redis/storage/SMTP for the service.
- Both orchestrator and batch-backend need `NOTION_TOKEN` and the provider-specific TTS credentials
  for whichever provider is selected.
- For S3 manifests or uploads, set the `ESL_PIPELINE_MANIFEST_*` vars and `S3_*`/AWS creds together.
- Worker runtime does not downgrade manifest storage to filesystem; missing/invalid manifest bucket configuration fails fast.
- TTS strategy defaults can be provided via `ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY` and related provider-scoped options; manifests now persist these for reruns.
- Batch-backend persistence for `user_settings.tts_provider` is canonical-only (`elevenlabs` or `google`); legacy stored values (`openai`, `azure`) are migration-cleanup only.
- Batch backend startup validates `FILESYSTEM_UPLOAD_DIR`, `PROMPT_*` allowlists, and active STT provider prerequisites (credentials + Google staging requirements); misconfigured paths fail fast.
- Use `RECORDINGS_MAX_FILE_SIZE` to raise audio upload limits without affecting general markdown uploads.
- Postgres backup archival scripts read `PG_BACKUP_S3_*` variables; keep backup bucket/prefix separate from runtime `S3_BUCKET` upload paths.
- Backup/restore scripts and ops status/alert helpers (`postgres-backup-restore.sh`, `postgres-backup-s3.sh`, `postgres-ops-status.sh`, `run-postgres-ops-alert.sh`, `run-aws-key-rotation-reminder.sh`) reuse `.env.batch-backend` and the `PG_BACKUP_*` thresholds above.
- For voice-alignment operations and rollout, see `docs/operations/voice-alignment-v2-runbook.md`.
