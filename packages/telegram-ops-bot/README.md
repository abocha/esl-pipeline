# @esl-pipeline/telegram-ops-bot

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and runtime usage guide.
- Last Verified Against: 2026-05-12 repo state.
- Owner: backend/ops maintainers + automation agents.
- Review Cadence: monthly or after control-surface changes.
- Status: `active`.

Telegram control surface for internal ESL Pipeline operations.

## Role

This package provides:

- allowlisted operator onboarding via `/start` and `/help`
- guided ops-chat controls for status, student/job browsing, recent ops, and safe actions
- topic-aware routing across `ops`, `jobs`, and `alerts`
- share-card output through `/share`

It depends on `@esl-pipeline/batch-backend` for job and `/ops/*` data. Deeper operational detail lives in:

- [`docs/operations/telegram-ops-control-panel.md`](../../docs/operations/telegram-ops-control-panel.md)
- [`docs/plans/telegram-ops-control-panel-hardening/README.md`](../../docs/plans/telegram-ops-control-panel-hardening/README.md)

## Current Surface

Commands:

- onboarding: `/start`, `/help`
- reads: `/status`, `/op`, `/students`, `/student`, `/jobs`, `/today`, `/botstatus`, `/finished`, `/job`, `/share`
- gated actions: `/backup`, `/integrity`, `/approve`

Browse model:

- summary to browse to detail to share
- `/today` and `/student` pivot into filtered `/jobs` list views
- `/finished` is a recent-succeeded jobs preset over the shared jobs renderer
- `/students` is a paged recent-activity browser backed by `/students/summary`
- `/job` exposes `Share` as the primary output action
- `/links` is retired from the visible UX and remains only as a temporary compatibility alias to `/share`

Display notes:

- operator-facing timestamps are rendered in explicit UTC as `YYYY-MM-DD HH:mm UTC`
- job and student surfaces lead with human-readable identity and use short ids as supporting context
- `/share` includes the optional pronunciation playback link only for the published primary
  pronunciation recording; chunk-only pronunciation clips stay inside the HTML assignment

Runtime modes:

- polling by default
- optional webhook mode
- private chat remains onboarding-only
- configured ops chat gets the full guided panel and routed command surface

## Environment and Runtime Notes

High-signal env groups:

- enablement and routing:
  - `TELEGRAM_OPS_BOT_ENABLED`, `TELEGRAM_OPS_BOT_CHAT_ID`, `TELEGRAM_OPS_BOT_ALLOWED_USER_IDS`
- backend bridge:
  - `TELEGRAM_OPS_BOT_BACKEND_*`
- safety:
  - `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS`, `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP`
- transport:
  - `TELEGRAM_OPS_BOT_MODE`, `TELEGRAM_OPS_BOT_WEBHOOK_*`, `TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED`

Use these docs for exhaustive detail:

- [`docs/reference/env.md`](../../docs/reference/env.md)
- [`docs/generated/env-surface-index.md`](../../docs/generated/env-surface-index.md)
- [`docs/operations/telegram-ops-control-panel.md`](../../docs/operations/telegram-ops-control-panel.md)

## Validation

```bash
pnpm --filter @esl-pipeline/telegram-ops-bot build
pnpm --filter @esl-pipeline/telegram-ops-bot test
bash scripts/smoke/run-telegram-ops-compose-smoke.sh
```

## Related

- [`packages/batch-backend/README.md`](../batch-backend/README.md)
- [`docs/operations/telegram-ops-control-panel.md`](../../docs/operations/telegram-ops-control-panel.md)
