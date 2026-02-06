# Environment Configuration Guide

This repo uses a few env files for different runtimes:

- `.env` (from `.env.example`): for local CLI / orchestrator usage.
- `.env.batch-backend` (from `.env.batch-backend.example`): for the batch backend service (docker-compose).

Node: 24.11.1+ (see `.nvmrc` / `package.json`).

## Core (CLI / Orchestrator)

Set these in `.env` (or your shell) when running `esl` or programmatic API calls:

- `NOTION_TOKEN` — Notion integration token.
- `NOTION_CLIENT_TIMEOUT` (optional) — Notion client timeout (ms).
- `NOTION_COLORIZER_THROTTLE_MS`, `NOTION_COLORIZER_MAX_RETRIES`, `NOTION_COLORIZER_RETRY_DELAY_MS` (optional) — Notion colorizer pacing.
- `ELEVENLABS_API_KEY` — ElevenLabs API key for TTS.
- `ELEVENLABS_MODEL_ID` (optional, default `eleven_multilingual_v2`) — ElevenLabs model.
- `ELEVENLABS_OUTPUT_FORMAT` (optional, default `mp3_22050_32`) — Audio format.
- `ELEVENLABS_TTS_STRATEGY` (optional, `auto`|`dialogue`|`tts`, default `auto`) — TTS strategy.
- `ELEVENLABS_TTS_MAX_CHARS` (optional, default `4500`) — Max chars per Text-to-Speech request (chunking).
- `ELEVENLABS_DIALOGUE_LANGUAGE` (optional) — Language code for dialogue strategy.
- `ELEVENLABS_DIALOGUE_STABILITY` (optional) — Stability for dialogue strategy (0–1).
- `ELEVENLABS_DIALOGUE_SEED` (optional) — Seed for dialogue strategy.
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — AWS creds for uploads.
- `S3_BUCKET` — Bucket for audio uploads.
- `S3_PREFIX` (optional) — Key prefix for uploads (e.g., `audio/assignments`).
- `S3_ENDPOINT` (optional) — S3-compatible endpoint (MinIO/etc).
- `S3_UPLOAD_MAX_MB` (optional, default `50`) — Upload size cap in MB for S3 audio uploads.
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
- `LOG_LEVEL` (optional) — Verbosity for CLI logs.
  - Backend logger supports: `trace` | `debug` | `info` | `warn` | `error` | `fatal` | `silent`.

## Batch Backend (docker-compose)

Use `.env.batch-backend` for the service stack. It includes all core keys above plus service-specific settings:

- `NODE_ENV` — `development` for local.
- `BATCH_BACKEND_HTTP_PORT` — HTTP port.
- `BATCH_BACKEND_ENABLE_EXTENDED_API` — Enable uploads/auth/admin routes.
- `FILESYSTEM_UPLOAD_DIR` — Local uploads path (shared volume).
- `DRAFT_LOCAL_EXPORT` (optional, default `true` in dev, `false` otherwise) — Persist materialized draft markdown files under `FILESYSTEM_UPLOAD_DIR/drafts`.
- `PIPELINE_CWD` — Orchestrator working directory for pipeline runs.
- Postgres: `PG_ENABLED`, `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` (or `PG_CONNECTION_STRING`).
- Redis: `REDIS_ENABLED`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (optional).
- BullMQ: `BATCH_JOBS_QUEUE_NAME`, `TRANSCRIBE_QUEUE_NAME`.
- SMTP (optional): `MAIL_ENABLED`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASSWORD`.
- Manifest/config selection: same `ESL_PIPELINE_*` keys as core (see above).
- Prompt templates/profiles: `PROMPT_TEMPLATE_PATH`, `PROMPT_PROFILE_PATH`.
  - Defaults live under `docs/templates` unless overridden.
  - Template/profile allowlists are derived from the directories containing these paths.
- Auth (extended API):
  - `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN`, `BCRYPT_ROUNDS`
  - `REFRESH_COOKIE_NAME`, `REFRESH_COOKIE_SAMESITE`, `REFRESH_COOKIE_SECURE`
  - Optional: `REFRESH_COOKIE_DOMAIN`, `REFRESH_COOKIE_PATH`
- Prompt/job metadata fallbacks:
  - `NOTION_DB_OPTIONS`, `NOTION_DB_ID`, `NOTION_DB_NAME`, `NOTION_DB_LABEL`
  - `ELEVENLABS_VOICES_PATH`, `REPO_ROOT`, `APP_ROOT`, `PROJECT_ROOT`
- Transcription pipeline:
  - `TRANSCRIBE_MODE` (`timeline`|`stack`), `TRANSCRIBE_MAX_CONCURRENCY`
  - `DEEPGRAM_API_KEY`, `DEEPGRAM_ACCESS_TOKEN` (optional), `DEEPGRAM_MODEL`, `DEEPGRAM_LANGUAGE`,
    `DEEPGRAM_STORE_RAW_RESPONSE`
  - `WORKER_CONCURRENCY`, `MAX_CONCURRENT_FFMPEG`
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

- Keep `.env` focused on CLI usage; `.env.batch-backend` adds DB/Redis/storage/SMTP for the service.
- Both orchestrator and batch-backend need `NOTION_TOKEN` and `ELEVENLABS_API_KEY`.
- For S3 manifests or uploads, set the `ESL_PIPELINE_MANIFEST_*` vars and `S3_*`/AWS creds together.
- TTS strategy defaults can be provided via `ELEVENLABS_TTS_STRATEGY` and related dialogue options; manifests now persist these for reruns.
- Batch backend startup validates `FILESYSTEM_UPLOAD_DIR` and `PROMPT_*` allowlists; misconfigured paths fail fast.
- Use `RECORDINGS_MAX_FILE_SIZE` to raise audio upload limits without affecting general markdown uploads.
