# Telegram Ops Control Panel Hardening Plan

## Summary

Gap inventory and delivery schedule for post-groundwork hardening of the Telegram Ops Control Panel.

## Delivery Buckets

- `Now` (must complete before broader operator rollout)
- `After Manual V1` (complete after hands-on validation in live ops chat)
- `V2 / Defer` (scaling and durability upgrades)

## Gap Inventory and Schedule

| Gap | Priority | Target Window | Status | Notes |
|---|---|---|---|---|
| Skip stale queued Telegram updates on startup to avoid command replay after restarts | P0 | Now | Implemented | `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP=true` (default). |
| Read-only-by-default bot mode with explicit action enable gate | P0 | Now | Implemented | `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false` (default). |
| Add operation status lookup command in bot UX | P1 | Now | Implemented | `/op <operationId>` mapped to backend `GET /ops/actions/:operationId`. |
| Add backend transport integration tests for `/ops/*` endpoints | P1 | After Manual V1 | Planned | Cover auth, secret header, allowlist action validation, lifecycle responses. |
| Add Docker smoke workflow for Telegram command loop in Compose | P1 | After Manual V1 | Planned | Validate `/status`, `/finished`, `/links`, `/backup`, `/drill`, `/op` end-to-end. |
| Improve topic cache healing for stale/deleted forum topics | P2 | After Manual V1 | Planned | Detect invalid `message_thread_id` and re-create/rebind. |
| Persist ops action history in DB (instead of in-memory only) | P1 | V2 / Defer | Planned | Enables restart-safe operation history and richer auditing. |
| Multi-instance coordination for bot state (rate limit/topic map) | P2 | V2 / Defer | Planned | Needed if bot is horizontally scaled. |
| Webhook mode and advanced controls (restart/maintenance approvals) | P2 | V2 / Defer | Planned | Explicitly out of V1 low-blast-radius scope. |

## Acceptance Gates

### For "Now" completion

1. No duplicate command-replay after bot restart when startup skip is enabled.
2. `/backup` and `/drill` are blocked in read-only mode and enabled only when explicit action gate is on.
3. `/op <operationId>` returns a usable lifecycle view for queued/running/succeeded/failed actions.

### For "After Manual V1"

1. Backend `/ops/*` route integration tests are green in CI.
2. Compose smoke workflow demonstrates thread routing + command safety guards.

## Rollback Notes

- To immediately freeze mutating actions without stopping the bot: set `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false`.
- To preserve legacy startup behavior (not recommended): set `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP=false`.
