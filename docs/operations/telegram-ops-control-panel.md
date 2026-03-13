# Telegram Ops Control Panel Runbook

## Meta

- Audience: maintainers and operators running Telegram-based operational controls.
- Read Time: 5 minutes.
- Authority Level: operations runbook.
- Last Verified Against: 2026-03-13 repo state.
- Owner: backend/ops maintainers + automation agents.
- Review Cadence: monthly or after bot/control-surface changes.
- Status: `runbook`.

## Purpose

- Operate `@esl-pipeline/telegram-ops-bot` safely.
- Keep the safety model, routing behavior, and troubleshooting signals in one place.

## Components

- bot package: `packages/telegram-ops-bot`
- backend endpoints:
  - `GET /ops/status`
  - `GET /ops/actions`
  - `POST /ops/actions`
  - `GET /ops/actions/:operationId`

## Safety Model

- `/ops/*` requires admin auth.
- Optional defense-in-depth:
  - `BATCH_BACKEND_OPS_CONTROL_BOT_SECRET`
- Bot access is allowlisted by Telegram user id.
- Per-user command rate limiting is enforced.
- Mutating commands remain off by default:
  - `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false`
- Action allowlist remains intentionally narrow:
  - `backup_upload`
  - `restore_drill_download_only`

Backend prerequisites for action commands:

- `bash`, `aws`, and `docker` CLI available
- GNU-compatible `date`/`find`
- `scripts/docker/*` present in the runtime image
- Docker socket access plus `PG_CONTAINER_NAME` for deterministic targeting

## Current UX Surface

Onboarding:

- `/start`
- `/help`

Read commands:

- `/status`
- `/op <operationId>`
- `/finished [limit]`
- `/job <jobId>`
- `/links <jobId>`
- `/share <jobId>`

Safe actions:

- `/backup [label]`
- `/drill`
- `/approve <token>` in webhook approval flows

Behavior notes:

- private chat is onboarding-only
- configured ops chat gets the full routed/guided surface
- `/help` opens the guided control panel in the ops chat
- guided action flows are confirm-first and must preserve the existing approval model

## Routing and Transport

Domains:

- `ops`
- `jobs`
- `alerts`

Fallback order:

1. incoming thread id
2. mapped topic id
3. configured default thread
4. chat root

Transport notes:

- polling is default
- webhook is opt-in
- polling requests both `message` and `callback_query` updates
- startup metadata sync is best-effort and non-fatal

## Operational Checks

Rollout/readiness sequence:

```bash
pnpm check:fast
pnpm --filter @esl-pipeline/telegram-ops-bot test
pnpm test:integration
bash scripts/smoke/run-telegram-ops-compose-smoke.sh
pnpm ops:telegram:preflight --profile=readonly_canary
```

Post-deploy:

```bash
pnpm ops:telegram:verify
```

Artifacts:

- `tmp/telegram-ops-go-live/preflight.json`
- `tmp/telegram-ops-go-live/verify.json`

## Troubleshooting

### Startup replay protection

Keep `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP=true`.

Key events:

- `poll_offset_initialized_from_latest`
- `poll_offset_initialize_failed`
- `startup_replay_guard_skipped_standby`
- `startup_replay_guard_skipped_unavailable`
- `webhook_listener_started`
- `webhook_listener_start_failed`

### Topic healing

If forum topics drift:

1. clear `TELEGRAM_OPS_BOT_TOPICS_STATE_FILE`
2. ensure `TELEGRAM_OPS_BOT_TOPIC_AUTO_CREATE=true`
3. restart the bot

Key events:

- `topic_router_topic_created`
- `topic_router_topic_create_failed`
- `topic_stale_detected`
- `topic_recreated`
- `topic_heal_fallback`

### Share fallback diagnostics

Check:

- job payload still exposes `md` or reachable `htmlUrl`
- published HTML still contains expected audio paths
- compose smoke still passes

### Telemetry signals

Primary counters/events:

- `command_outcome`
- `ux_entry_usage`
- `ux_response_latency_ms`
- `callback_usage`
- `callback_outcome`
- `callback_response_latency_ms`
- `share_extraction_source`
- `share_missing_audio`
- `telegram_metadata_sync_succeeded`
- `telegram_metadata_sync_failed`

## Related

- [`packages/telegram-ops-bot/README.md`](../../packages/telegram-ops-bot/README.md)
- [`docs/reference/env.md`](../reference/env.md)
- [`docs/plans/telegram-ops-control-panel-hardening/README.md`](../plans/telegram-ops-control-panel-hardening/README.md)
