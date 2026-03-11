# Telegram Ops Control Panel Hardening Plan

## Summary

Gap inventory and delivery schedule for post-groundwork hardening of the Telegram Ops Control Panel.

Related draft:
- `future-student-facing-roadmap.md` — exploratory product expansion notes for student-facing Telegram workflows.

## Locked Telegram Bot Version Naming

Canonical version label format for Telegram bot roadmap communication:
- `<Track><Phase>`
- Examples: `A1`, `B1`, `C0`

Tracks:
1. `A` = Ops Control Bot (internal operations)
2. `B` = Teacher Workflow Bot (teacher-facing student workflows)
3. `C` = Student Self-Service Bot (student-facing chat)

Phases:
1. `0` = Discovery / product validation only
2. `1` = Functional V1 (usable baseline)
3. `2` = Hardening / scale / observability

Current mapping:
1. Current PR scope is `A1` with selected `A2` hardening included.
2. Student-shareable card delivery (`/links`, `/share`) is implemented as selected `A2` output hardening.
3. Student-facing expansion draft starts at `B1` candidate.
4. Direct student conversation remains `C0` until explicit go/no-go.

## Delivery Buckets

- `Now` (must complete before broader operator rollout)
- `After Manual V1` (complete after hands-on validation in live ops chat)
- `V2 / Defer` (scaling and durability upgrades)

## Gap Inventory and Schedule

| Gap | Priority | Target Window | Status | Naming Context |
|---|---|---|---|---|
| Skip stale queued Telegram updates on startup to avoid command replay after restarts | P0 | Now | Implemented | `A2` hardening |
| Read-only-by-default bot mode with explicit action enable gate | P0 | Now | Implemented | `A2` hardening |
| Add operation status lookup command in bot UX | P1 | Now | Implemented | `A1` completeness |
| Forwardable student-share cards with separate audio preview messages (`/links`, `/share`) | P1 | Now | Implemented | selected `A2` hardening |
| Cross-user finished-job visibility for service account path (`/admin/jobs`) | P1 | Now | Implemented | `A2` operator UX |
| Add backend transport integration tests for `/ops/*` endpoints | P1 | After Manual V1 | Planned | `A2` hardening |
| Add Docker smoke workflow for Telegram command loop in Compose | P1 | After Manual V1 | Planned | `A2` hardening |
| Add deterministic smoke checks for `/share` card rendering and audio extraction fallback | P1 | After Manual V1 | Planned | `A2` hardening |
| Improve topic cache healing for stale/deleted forum topics | P2 | After Manual V1 | Planned | `A2` hardening |
| Persist ops action history in DB (instead of in-memory only) | P1 | V2 / Defer | Planned | `A2` durability |
| Multi-instance coordination for bot state (rate limit/topic map) | P2 | V2 / Defer | Planned | `A2` scale |
| Webhook mode and advanced controls (restart/maintenance approvals) | P2 | V2 / Defer | Planned | post-`A2` expansion |

## Semver Mapping (Package)

Package:
- `@esl-pipeline/telegram-ops-bot`

Semver use:
1. Keep normal semver for technical/package releases.
2. Use `A/B/C + phase` labels for product-roadmap communication.

Current state:
1. Package version baseline in this PR: `1.1.0`.
2. Roadmap label baseline in this PR: `A1` with selected `A2` hardening.

## Acceptance Gates

### For "Now" completion

1. No duplicate command-replay after bot restart when startup skip is enabled.
2. `/backup` and `/drill` are blocked in read-only mode and enabled only when explicit action gate is on.
3. `/op <operationId>` returns a usable lifecycle view for queued/running/succeeded/failed actions.

### For "After Manual V1"

1. Backend `/ops/*` route integration tests are green in CI.
2. Compose smoke workflow demonstrates thread routing + command safety guards.
3. `/share` smoke checks validate assignment title/icon extraction and audio fallback extraction from published HTML.

## Rollback Notes

- To immediately freeze mutating actions without stopping the bot: set `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false`.
- To preserve legacy startup behavior (not recommended): set `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP=false`.
