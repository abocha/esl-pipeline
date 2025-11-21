# Environment Configuration Guide

This repo uses a few env files for different runtimes:

- `.env` (from `.env.example`): for local CLI / orchestrator usage.
- `.env.batch-backend` (from `.env.batch-backend.example`): for the batch backend service (docker-compose).

Node: 24.11.1+ (see `.nvmrc` / `package.json`).

## Core (CLI / Orchestrator)

Set these in `.env` (or your shell) when running `esl` or programmatic API calls:

- `NOTION_TOKEN` — Notion integration token.
- `ELEVENLABS_API_KEY` — ElevenLabs API key for TTS.
- `ELEVENLABS_MODEL_ID` (optional, default `eleven_multilingual_v2`) — ElevenLabs model.
- `ELEVENLABS_OUTPUT_FORMAT` (optional, default `mp3_22050_32`) — Audio format.
- `ELEVENLABS_TTS_MODE` (optional, `auto`|`dialogue`|`monologue`, default `auto`) — TTS mode.
- `ELEVENLABS_DIALOGUE_LANGUAGE` (optional) — Language code for dialogue mode.
- `ELEVENLABS_DIALOGUE_STABILITY` (optional) — Stability for dialogue mode (0–1).
- `ELEVENLABS_DIALOGUE_SEED` (optional) — Seed for dialogue mode.
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — AWS creds for uploads.
- `S3_BUCKET` — Bucket for audio uploads.
- `S3_PREFIX` (optional) — Key prefix for uploads (e.g., `audio/assignments`).
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
- `FILESYSTEM_UPLOAD_DIR` — Local uploads path (shared volume).
- Postgres: `PG_ENABLED`, `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` (or `PG_CONNECTION_STRING`).
- Redis: `REDIS_ENABLED`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (optional).
- BullMQ: `BATCH_JOBS_QUEUE_NAME` — Queue name.
- MinIO (S3-compatible): `MINIO_ENABLED`, `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `S3_ENDPOINT` (if using MinIO endpoints).
- SMTP (optional): `MAIL_ENABLED`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASSWORD`.
- Manifest/config selection: same `ESL_PIPELINE_*` keys as core (see above).
- Optional S3 upload prefix: `S3_PREFIX`.

Notes:

- Keep `.env` focused on CLI usage; `.env.batch-backend` adds DB/Redis/MinIO/SMTP for the service.
- Both orchestrator and batch-backend need `NOTION_TOKEN` and `ELEVENLABS_API_KEY`.
- For S3 manifests or uploads, set the `ESL_PIPELINE_MANIFEST_*` vars and `S3_*`/AWS creds together.
- TTS mode defaults can be provided via `ELEVENLABS_TTS_MODE` and related dialogue options; manifests now persist these for reruns.
