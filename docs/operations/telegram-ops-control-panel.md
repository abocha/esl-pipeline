# Telegram Ops Control Panel Runbook

## Meta

- Audience: maintainers and operators running Telegram-based operational controls.
- Read Time: 6 minutes.
- Authority Level: operations runbook.
- Last Verified Against: 2026-03-13 repo state.
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
- Backend runtime must include `bash`, `aws`, and `docker` CLI for default ops command wrappers.
- Backend runtime must include GNU-compatible `date`/`find` tooling (`coreutils`, `findutils`) used by backup/status scripts.
- Backend runtime must include `scripts/docker/*` at `/app/scripts/docker/*` (default wrapper paths).
- For action commands (`/backup`, `/drill`), backend container must have Docker socket access (`/var/run/docker.sock`) and set `PG_CONTAINER_NAME` to target Postgres deterministically.
- In dev compose where backend runs as non-root user, set `DOCKER_GID` to host socket group id so Docker CLI can access `/var/run/docker.sock`.
- AWS auth for status/backup/drill scripts is env-based (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, plus `PG_BACKUP_S3_*`); no interactive `aws configure` step is used.
- Telegram bot requires explicit allowlist (`TELEGRAM_OPS_BOT_ALLOWED_USER_IDS`).
- Bot enforces per-user command rate limiting.
- Bot defaults to read-only mode (`TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false`) until operators explicitly enable action commands.
- V1 action allowlist is intentionally narrow:
  - `backup_upload`
  - `restore_drill_download_only`

## Threaded Mode

Domain routing:

- `ops`
- `jobs`
- `alerts`

Startup behavior:

1. Bot resolves its own username (`getMe`) for strict command mention matching.
2. If `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP=true`, bot starts polling from the latest pending update to avoid replaying stale commands.
3. Bot attempts forum-topic verification for `TELEGRAM_OPS_BOT_CHAT_ID`.
4. If forum-enabled and auto-create is on, bot creates missing domain topics.
5. Topic ids are cached in `TELEGRAM_OPS_BOT_TOPICS_STATE_FILE`.
6. If topic creation/check fails, bot falls back to default routing.

Fallback precedence:

1. incoming command thread (`message_thread_id`) if present
2. mapped domain topic thread id
3. `TELEGRAM_OPS_BOT_DEFAULT_THREAD_ID` if set
4. chat root (no thread id)

## Commands (V1)

Read commands:

- `/help`
- `/status`
- `/op <operationId>`
- `/finished [limit]` (admin service-account path; lists latest succeeded jobs across users)
- `/job <jobId>`
- `/links <jobId>`
- `/share <jobId>` (student-forward alias of `/links`)

Safe action commands:

- `/backup [label]`
- `/drill`

No restart commands are implemented in V1.

## Share Card Behavior (`/links`, `/share`)

Bot output is optimized for forwarding to students:

1. Assignment card (preview disabled):
   - Single clickable link only.
   - Link text: `<emoji> Homework Assignment: <full title>`.
   - Emoji/title extraction priority:
     - markdown frontmatter/H1 (including local `.md` file-path resolution),
     - published HTML fallback (`<title>` + `.hero-emoji`).
2. Audio card 1 (preview enabled, if available):
   - `🎧 Listen 1: Study Text`
3. Audio card 2 (preview enabled, if available):
   - `🗣️ Listen 2: Pronunciation`

Audio URL extraction priority:

1. generated markdown links (`Audio recording: Study Text`, `Audio recording: Pronunciation Shadow Sentence`)
2. markdown path hints (`/audio/final/`, `/audio/pronunciation-shadow/`)
3. published HTML fallback (`htmlUrl`) with same path hints

## Deployment Notes

- Dev compose service: `telegram-ops-bot` in `docker-compose.yml`.
- Prod compose service: `telegram-ops-bot` in `docker-compose.prod.yml`.
- Bot startup is gated by `TELEGRAM_OPS_BOT_ENABLED=true`.
- For deterministic smoke/fake API runs, point `TELEGRAM_OPS_BOT_API_BASE_URL` at the test API endpoint.
- Polling transport defaults to `TELEGRAM_OPS_BOT_MODE=polling`; set `TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED=true` only when multi-instance polling coordination is configured.
- `/approve` replay protection is persisted in Postgres; configure `TELEGRAM_OPS_BOT_APPROVAL_REPLAY_DATABASE_URL` if replay-state storage should use a dedicated DSN.
- Webhook transport is opt-in (`TELEGRAM_OPS_BOT_MODE=webhook`) and uses:
  - `TELEGRAM_OPS_BOT_WEBHOOK_HOST`
  - `TELEGRAM_OPS_BOT_WEBHOOK_PORT`
  - `TELEGRAM_OPS_BOT_WEBHOOK_PATH`
  - Optional hardening: `TELEGRAM_OPS_BOT_WEBHOOK_SECRET_TOKEN` (enforces inbound `x-telegram-bot-api-secret-token`).
- Backend control surface is gated by `BATCH_BACKEND_ENABLE_OPS_CONTROL=true`.

## Polling GA Closeout Commands

Run this sequence for rollout-readiness evidence (from repo root):

1. `pnpm check:fast`
2. `pnpm --filter @esl-pipeline/telegram-ops-bot test`
3. `pnpm test:integration`
4. `bash scripts/smoke/run-telegram-ops-compose-smoke.sh`
5. `pnpm ops:telegram:preflight --profile=readonly_canary`

Optional helper command for the same sequence:

- `pnpm ops:telegram:ga:gates`

Preflight artifact path:

- `tmp/telegram-ops-go-live/preflight.json`

Post-deploy verification:

1. `pnpm ops:telegram:verify`
2. Restart backend.
3. Re-run continuity check with an existing operation id:
   - `pnpm ops:telegram:verify --operation-id=<known-operation-id>`

Post-deploy verify artifact path:

- `tmp/telegram-ops-go-live/verify.json`

Profiles:

- `readonly_canary` (default): requires `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false`.
- `mutable_ops`: allows mutating commands only with strict shared-secret/auth checks passing.

## Troubleshooting

### Startup Replay Protection

- Keep `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP=true` to avoid replaying stale queued commands after restarts.
- Under leader-election startup failures, startup replay skipping is finalized as skipped to avoid dropping live updates once connectivity recovers.
- Validate startup logs:
  - `poll_offset_initialized_from_latest` means replay guard is active.
  - `poll_offset_initialize_failed` means offset init failed and polling falls back to default offset.
  - `startup_replay_guard_skipped_standby` means this replica started as standby and intentionally skipped startup backlog trimming.
  - `startup_replay_guard_skipped_unavailable` means leader-election was unavailable during startup and backlog trimming was intentionally skipped.
  - In webhook mode, `webhook_listener_started` confirms bind success; `webhook_listener_start_failed` indicates listener bind failure.
- In deterministic compose smoke, stale pre-start commands should not emit outbound messages once fresh commands are injected.

### Topic Healing and Stale Cache Recovery

- If forum topics are deleted/renamed, clear `TELEGRAM_OPS_BOT_TOPICS_STATE_FILE` and restart to force topic re-discovery/re-creation.
- Ensure `TELEGRAM_OPS_BOT_TOPIC_AUTO_CREATE=true` for automatic healing in forum chats.
- Review startup logs for:
  - `topic_router_topic_created`
  - `topic_router_topic_create_failed`
  - `topic_router_chat_lookup_failed`
  - `topic_router_fallback_non_forum`
- Review runtime healing logs for:
  - `topic_stale_detected`
  - `topic_recreated`
  - `topic_heal_fallback`
- Fallback routing remains: incoming thread -> mapped topic -> `TELEGRAM_OPS_BOT_DEFAULT_THREAD_ID` -> chat root.

### Share Fallback Diagnostics (`/links`, `/share`)

- Missing assignment title/icon usually means markdown had no frontmatter/H1 and `htmlUrl` fallback was unreachable or lacked `<title>` / `.hero-emoji`.
- Missing pronunciation/study audio links usually means both markdown labels/path hints and published HTML fallback links were absent.
- Verify from bot runtime network:
  - `GET /jobs/:jobId` returns `md` and/or reachable `htmlUrl`.
  - Published HTML contains expected `/audio/final/` and `/audio/pronunciation-shadow/` paths.
- Run deterministic smoke for command-loop + routing + fallback coverage:
  - `bash scripts/smoke/run-telegram-ops-compose-smoke.sh`

### Telemetry Counters (Log-Based)

- Bot emits additive counter-style telemetry under `event=bot_metric`.
- Primary metric names:
  - `command_outcome` with statuses `completed`, `failed`, `denied_not_allowed`, `denied_rate_limited`, `unknown`
  - `share_extraction_source` with source labels (`markdown_label`, `markdown_path`, `html_path`)
  - `share_missing_audio` with kinds (`missing_study`, `missing_pronunciation`, `missing_any`)
  - `share_fallback_source` with source label (`html`)
- Keep existing structured events (`command_outcome`, `share_path_telemetry`) for detailed debugging context.

## Soak Playbook (Blocking Sign-Off)

Escalation owner:

- Backend/ops maintainer on-call for this deployment window.

Fixed soak sequence:

1. Keep canary profile active (`TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false`) and confirm `/status`, `/op`, `/share` behavior in the target chat.
2. Confirm startup/leadership/replay events in bot logs as operational checks:
   - `poll_offset_initialized_from_latest`
   - `poll_leader_acquired` / `poll_leader_standby`
   - `startup_replay_guard_skipped_standby` / `startup_replay_guard_skipped_unavailable` (if relevant)
3. Run a real ops action and capture `operationId`, then restart backend and verify lookup continuity with:
   - `pnpm ops:telegram:verify --operation-id=<known-operation-id>`
4. Validate `/share` output ordering and extraction precedence in the live chat:
   - assignment card first (preview disabled)
   - audio cards after (preview enabled)

Blocking soak checks:

1. No unhealed stale-topic incidents.
2. No `/share` precedence regressions.
3. Persisted ops action continuity across backend restart.

Rollback toggles:

1. Freeze mutating commands: `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false`.
2. Disable bot process: `TELEGRAM_OPS_BOT_ENABLED=false`.
3. Disable backend control surface: `BATCH_BACKEND_ENABLE_OPS_CONTROL=false`.

Expected outcomes:

1. Preflight and post-deploy verify reports are green.
2. Manual soak checks pass without blocking incidents.
3. Artifact bundle under `tmp/telegram-ops-go-live/` is available for release evidence.

## Webhook Pilot Checklist (Non-Blocking)

Webhook transport is explicitly non-blocking for polling GA closeout. For pilot readiness only:

1. Configure webhook listener settings:
   - `TELEGRAM_OPS_BOT_MODE=webhook`
   - `TELEGRAM_OPS_BOT_WEBHOOK_HOST`
   - `TELEGRAM_OPS_BOT_WEBHOOK_PORT`
   - `TELEGRAM_OPS_BOT_WEBHOOK_PATH`
2. Configure inbound secret validation:
   - `TELEGRAM_OPS_BOT_WEBHOOK_SECRET_TOKEN`
   - Ensure ingress forwards `x-telegram-bot-api-secret-token`.
3. Ensure replay-store DB permissions for approval token replay protection:
   - `TELEGRAM_OPS_BOT_APPROVAL_REPLAY_DATABASE_URL` (optional override)
   - Table create/insert/delete access for `telegram_approval_replay_tokens`.

## Validation Checklist

1. Confirm backend login works with service account credentials.
2. Run `/status` and verify JSON-backed status summary is returned.
3. Run `/op <operationId>` and verify lifecycle response is returned.
4. Verify topic routing behavior in a forum-enabled chat and fallback behavior in non-forum chats.
5. If action load exceeds `BATCH_BACKEND_OPS_CONTROL_ACTION_HISTORY_LIMIT`, expect temporary status-history overflow while actions are active; terminal history is pruned first.

## Related

- `docs/reference/env.md`
- `docs/operations/postgres-backup-s3.md`
- `docs/operations/postgres-ops-health.md`
