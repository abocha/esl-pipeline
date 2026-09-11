# Telegram Ops Control Panel Runbook

## Meta

- Audience: maintainers and operators running Telegram-based operational controls.
- Read Time: 5 minutes.
- Authority Level: operations runbook.
- Last Verified Against: 2026-08-12 repo state.
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

Backend action execution:

- Telegram action requests pass through the authenticated backend `/ops/actions` endpoint. The
  backend process enqueues the request and executes the configured command with
  `bash -lc <command>` in its own process environment (`PIPELINE_CWD` when set, otherwise the
  backend process working directory).
- `BATCH_BACKEND_ENABLE_OPS_CONTROL` is `false` by default. Status, backup, and restore-drill
  command variables are empty by default, so an operator must explicitly configure each command;
  an unset action command fails closed as unconfigured.
- The long-running backend runtime must not require Docker CLI, AWS CLI, Docker socket mounts, or
  other privileged host access. Do not describe this surface as a host-dispatch mechanism; host
  deployment and backup procedures remain separate operator workflows.

## Current UX Surface

Onboarding:

- `/start`
- `/help`

Read commands:

- `/status`
- `/op <operationId>`
- `/students`
- `/student <name-or-id>`
- `/jobs [filter]`
- `/today`
- `/botstatus`
- `/finished [limit]`
- `/job <jobId>`
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
- operator browsing follows a summary to browse to detail to share flow:
  - `/today` and `/student` open scoped `/jobs` views
  - `/finished` is the recent-succeeded preset for the shared jobs list renderer
  - `/students` is a paged recent-activity browser over `/students/summary`
- `/job` now prefers `Share` as the single visible output action
- `/links` is retired from the visible UX; direct `/links <jobId>` calls are treated as a compatibility alias to `/share` and return a short deprecation note
- job and student timestamps display in explicit UTC (`YYYY-MM-DD HH:mm UTC`)

## Browse Surface

Primary browse entries:

- `/today` for the current UTC-day dashboard and attention lists
- `/students` for recent-activity student browsing
- `/student <name-or-id>` for direct student lookup
- `/jobs [filter]` for canonical filtered job browsing
- `/finished [limit]` for the recent-finished jobs preset

`/jobs` filter behavior:

- structured filters:
  - `state:`
  - `student:`
  - `since:`
  - `before:`
  - `limit:`
  - `order:`
- soft parsing supports common operator shorthand such as:
  - `/jobs failed`
  - `/jobs running today`
  - `/jobs Margarita`
  - `/jobs failed Margarita`
- ad-hoc filtered views preserve their browse context when operators open a job and then use `Back` or `Refresh`

Student browsing behavior:

- `/students` shows unique students ordered by recent lesson activity, with null activity last
- each row includes name, short student id, recent lesson time, and pending drafts count when present
- `/student` highlights latest state, latest UTC time, latest homework title, and recent jobs
- latest homework resolution matches the `/job` and `/share` title extraction path, including markdown file-path and HTML fallback handling

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
pnpm --filter @esl-pipeline/telegram-ops-bot test
pnpm test:integration
bash scripts/smoke/run-telegram-ops-compose-smoke.sh
pnpm ops:telegram:preflight --profile=readonly_canary
```

Use successful hosted PR CI and `CI gate` for the target commit as the comprehensive-validation
prerequisite. The commands above retain only Telegram-specific package, Compose, and rollout
evidence.

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
