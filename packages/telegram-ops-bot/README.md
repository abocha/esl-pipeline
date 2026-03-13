# @esl-pipeline/telegram-ops-bot

Telegram operations + sharing bot for ESL Pipeline.

## Scope

- Long-polling Telegram bot runtime (default) with optional webhook transport.
- API-first integration with `@esl-pipeline/batch-backend`.
- Topic/thread routing across `ops`, `jobs`, and `alerts` domains.
- Safe-by-default operations surface (read-only until explicitly enabled).
- Student-forwardable assignment sharing cards (`/links`, `/share`).

## Command Surface

Read commands:

- `/help` — list commands.
- `/status` — run backend ops health snapshot.
- `/op <operationId>` — check one ops action lifecycle state.
- `/finished [limit]` — list latest succeeded jobs.
- `/job <jobId>` — detailed job status.
- `/links <jobId>` — emit shareable assignment + audio cards.
- `/share <jobId>` — alias of `/links` for student-forward workflow.

Action commands (gated by `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=true`):

- `/backup [label]`
- `/drill`

## Sharing Behavior (`/links` and `/share`)

The bot emits up to three messages:

1. Assignment card (single clickable link):
   - Link text format: `<emoji> Homework Assignment: <full title>`
   - Emoji/title extraction order:
     - Markdown/frontmatter (including file-path resolution when `md` points to a local `.md` file)
     - HTML fallback (`<title>` + `.hero-emoji`)
2. Study text audio card (if found):
   - `🎧 Listen 1: Study Text`
3. Pronunciation audio card (if found):
   - `🗣️ Listen 2: Pronunciation`

Audio URL extraction order:

- Generated markdown links (`Audio recording: Study Text`, `Audio recording: Pronunciation Shadow Sentence`)
- Path-based markdown fallback (`/audio/final/`, `/audio/pronunciation-shadow/`)
- Published HTML fallback (`htmlUrl`) with the same path hints.

Link-preview behavior:

- Assignment card is sent with preview disabled (clean compact card).
- Audio cards are sent with preview enabled (Telegram renders playable audio preview).

## Backend Expectations

The bot authenticates to batch-backend using a service account and requires:

- Extended API auth routes (`/auth/login`) enabled.
- Ops control routes enabled for `/status`, `/backup`, `/drill` paths.
- Admin role for the service account.
- `/admin/jobs` access for cross-user `/finished` listing.

## Environment Settings

Required when `TELEGRAM_OPS_BOT_ENABLED=true`:

- `TELEGRAM_OPS_BOT_TOKEN`
- `TELEGRAM_OPS_BOT_CHAT_ID`
- `TELEGRAM_OPS_BOT_ALLOWED_USER_IDS`
- `TELEGRAM_OPS_BOT_BACKEND_EMAIL`
- `TELEGRAM_OPS_BOT_BACKEND_PASSWORD`

Core optional settings:

- `TELEGRAM_OPS_BOT_BACKEND_URL` (default `http://batch-backend:8080`)
- `TELEGRAM_OPS_BOT_BACKEND_TIMEOUT_MS` (default `15000`)
- `TELEGRAM_OPS_BOT_BACKEND_SHARED_SECRET` (for `/ops/*` shared-secret hardening)
- `TELEGRAM_OPS_BOT_API_BASE_URL` (default `https://api.telegram.org`)
- `TELEGRAM_OPS_BOT_MODE` (`polling` default, or `webhook`)
- `TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED` (default `false`; polling-mode only)
- `TELEGRAM_OPS_BOT_APPROVAL_REPLAY_DATABASE_URL` (optional; shared Postgres replay guard for `/approve`, defaults to leader-election/`PG_*` settings)
- `TELEGRAM_OPS_BOT_APPROVAL_REPLAY_PRUNE_INTERVAL_MS` (default `60000`)
- `TELEGRAM_OPS_BOT_WEBHOOK_HOST` (default `0.0.0.0`; webhook-mode only)
- `TELEGRAM_OPS_BOT_WEBHOOK_PORT` (default `8091`; webhook-mode only)
- `TELEGRAM_OPS_BOT_WEBHOOK_PATH` (default `/telegram/webhook`; webhook-mode only)
- `TELEGRAM_OPS_BOT_WEBHOOK_SECRET_TOKEN` (optional; webhook-mode only)
- `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS` (default `false`)
- `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP` (default `true`)

Postgres coordination notes:

- Uses Postgres advisory lock for polling leader selection when enabled.
- DB connection config is sourced from `TELEGRAM_OPS_BOT_LEADER_ELECTION_DATABASE_URL` (if set) or standard `PG_CONNECTION_STRING` / `PG_*` env vars.
- `/approve` replay protection is persisted in Postgres so duplicate approvals are blocked across replicas and restarts.

Routing and topic settings:

- `TELEGRAM_OPS_BOT_TOPIC_AUTO_CREATE` (default `true`)
- `TELEGRAM_OPS_BOT_DEFAULT_THREAD_ID`
- `TELEGRAM_OPS_BOT_TOPICS_STATE_FILE`
- `TELEGRAM_OPS_BOT_TOPIC_NAME_OPS` (default `Ops Control`)
- `TELEGRAM_OPS_BOT_TOPIC_NAME_JOBS` (default `Jobs`)
- `TELEGRAM_OPS_BOT_TOPIC_NAME_ALERTS` (default `Alerts`)

Rate-limit / polling controls:

- `TELEGRAM_OPS_BOT_POLL_INTERVAL_MS`
- `TELEGRAM_OPS_BOT_POLL_TIMEOUT_SECONDS`
- `TELEGRAM_OPS_BOT_COMMAND_WINDOW_MS`
- `TELEGRAM_OPS_BOT_MAX_COMMANDS_PER_WINDOW`

Related env/runbook docs:

- `docs/reference/env.md`
- `docs/operations/telegram-ops-control-panel.md`

## Local Dev

- Run with compose stack: `pnpm dev:batch`
- Target tests:
  - `pnpm --filter @esl-pipeline/telegram-ops-bot test -- tests/formatter.test.ts tests/commands.test.ts`

## Polling GA Rollout Closeout

Release/readiness commands (repo root):

1. `pnpm check:fast`
2. `pnpm --filter @esl-pipeline/telegram-ops-bot test`
3. `pnpm test:integration`
4. `bash scripts/smoke/run-telegram-ops-compose-smoke.sh`
5. `pnpm ops:telegram:preflight --profile=readonly_canary`
6. Post-deploy: `pnpm ops:telegram:verify`

Convenience command:

- `pnpm ops:telegram:ga:gates`

Artifacts:

- `tmp/telegram-ops-go-live/preflight.json`
- `tmp/telegram-ops-go-live/verify.json`

## Further Development Plan

Roadmap docs:

- `docs/plans/telegram-ops-control-panel-hardening/README.md`
- `docs/plans/telegram-ops-control-panel-hardening/future-student-facing-roadmap.md`

Current planned improvements:

1. Promote webhook mode from embedded listener to managed production ingress wiring where needed.
2. Continue reducing HTML fallback dependency by adding richer share metadata fields in backend DTOs.
3. Track counter-based reliability trends from `bot_metric` events in ops dashboards.
