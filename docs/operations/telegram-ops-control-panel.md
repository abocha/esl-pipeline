# Telegram Ops Control Panel Runbook

## Meta

- Audience: maintainers and operators running Telegram-based operational controls.
- Read Time: 6 minutes.
- Authority Level: operations runbook.
- Last Verified Against: 2026-03-11 repo state.
- Owner: backend/ops maintainers + automation agents.
- Review Cadence: monthly or after bot/control-surface changes.
- Status: `runbook`.

## Purpose

- Operate the `@esl-pipeline/telegram-ops-bot` service safely.
- Document command behavior, thread/topic routing, and fallback paths.
- Clarify backend `/ops/*` prerequisites and shared-secret hardening.

## Components

- Bot runtime package: `packages/telegram-ops-bot`
- Backend ops control endpoints:
  - `GET /ops/status`
  - `POST /ops/actions`
  - `GET /ops/actions/:operationId`

## Safety Model

- `/ops/*` endpoints require admin auth.
- Optional defense-in-depth: set `BATCH_BACKEND_OPS_CONTROL_BOT_SECRET`.
  - When set, `/ops/*` also require `x-ops-bot-secret`.
- Telegram bot requires explicit allowlist (`TELEGRAM_OPS_BOT_ALLOWED_USER_IDS`).
- Bot enforces per-user command rate limiting.
- V1 action allowlist is intentionally narrow:
  - `backup_upload`
  - `restore_drill_download_only`

## Threaded Mode

Domain routing:

- `ops`
- `jobs`
- `alerts`

Startup behavior:

1. Bot attempts forum-topic verification for `TELEGRAM_OPS_BOT_CHAT_ID`.
2. If forum-enabled and auto-create is on, bot creates missing domain topics.
3. Topic ids are cached in `TELEGRAM_OPS_BOT_TOPICS_STATE_FILE`.
4. If topic creation/check fails, bot falls back to default routing.

Fallback precedence:

1. incoming command thread (`message_thread_id`) if present
2. mapped domain topic thread id
3. `TELEGRAM_OPS_BOT_DEFAULT_THREAD_ID` if set
4. chat root (no thread id)

## Commands (V1)

Read commands:

- `/help`
- `/status`
- `/finished [limit]`
- `/job <jobId>`
- `/links <jobId>`

Safe action commands:

- `/backup [label]`
- `/drill`

No restart commands are implemented in V1.

## Deployment Notes

- Dev compose service: `telegram-ops-bot` in `docker-compose.yml`.
- Prod compose service: `telegram-ops-bot` in `docker-compose.prod.yml`.
- Bot startup is gated by `TELEGRAM_OPS_BOT_ENABLED=true`.
- Backend control surface is gated by `BATCH_BACKEND_ENABLE_OPS_CONTROL=true`.

## Validation Checklist

1. Confirm backend login works with service account credentials.
2. Run `/status` and verify JSON-backed status summary is returned.
3. Run `/backup` and verify `operationId` is returned.
4. Poll `GET /ops/actions/:operationId` until terminal state.
5. Verify topic routing behavior in a forum-enabled chat and fallback behavior in non-forum chats.

## Related

- `docs/reference/env.md`
- `docs/operations/postgres-backup-s3.md`
- `docs/operations/postgres-ops-health.md`
