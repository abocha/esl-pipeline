# Telegram Ops Control Panel Hardening Plan

## Summary

Feature/durability hardening inventory for the Telegram Ops Control Panel is implemented.  
Current focus is rollout-readiness closeout for polling-mode GA (preflight/verify tooling + operational sign-off evidence).

Related draft:

- `future-student-facing-roadmap.md` — exploratory product expansion notes for student-facing Telegram workflows.
- `a-track-ux-audit.md` — repo-grounded UX audit of the live `A` track bot against current Telegram best practices.
- `A3-ux-activation.md` — discoverability/onboarding implementation plan for `A3`, with `A4` reserved for guided interaction.
- `A4-guided-telegram-interaction.md` — guided interaction/navigation phase for inline controls, callback flows, and recent-ops browsing.

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
4. `3` = UX activation / discoverability
5. `4` = Guided interaction / navigation

Current mapping:

1. `A2` baseline is the hardened internal ops bot with selected output UX already shipped.
2. `A3` is the discoverability activation phase (`/start`, onboarding help, metadata sync, UX-health telemetry).
3. `A4` is reserved for guided Telegram interaction (inline controls, callback flows, edited-message navigation).
4. `A5` is reserved for later context-entry expansion (for example deep links) only if there is a real launch source.
5. Student-facing expansion draft starts at `B1` candidate.
6. Direct student conversation remains `C0` until explicit go/no-go.

## Delivery Buckets

- `Now` (must complete before broader operator rollout)
- `After Manual V1` (complete after hands-on validation in live ops chat)
- `V2 / Defer` (scaling and durability upgrades)

## Gap Inventory and Schedule

| Gap                                                                                       | Priority | Target Window   | Status      | Naming Context          |
| ----------------------------------------------------------------------------------------- | -------- | --------------- | ----------- | ----------------------- |
| Skip stale queued Telegram updates on startup to avoid command replay after restarts      | P0       | Now             | Implemented | `A2` hardening          |
| Read-only-by-default bot mode with explicit action enable gate                            | P0       | Now             | Implemented | `A2` hardening          |
| Add operation status lookup command in bot UX                                             | P1       | Now             | Implemented | `A1` completeness       |
| Forwardable student-share cards with separate audio preview messages (`/links`, `/share`) | P1       | Now             | Implemented | selected `A2` hardening |
| Cross-user finished-job visibility for service account path (`/admin/jobs`)               | P1       | Now             | Implemented | `A2` operator UX        |
| Add backend transport integration tests for `/ops/*` endpoints                            | P1       | After Manual V1 | Implemented | `A2` hardening          |
| Add Docker smoke workflow for Telegram command loop in Compose                            | P1       | After Manual V1 | Implemented | `A2` hardening          |
| Add deterministic smoke checks for `/share` card rendering and audio extraction fallback  | P1       | After Manual V1 | Implemented | `A2` hardening          |
| Improve topic cache healing for stale/deleted forum topics                                | P2       | After Manual V1 | Implemented | `A2` hardening          |
| Persist ops action history in DB (instead of in-memory only)                              | P1       | V2 / Defer      | Implemented | `A2` durability         |
| Multi-instance coordination for bot state (rate limit/topic map)                          | P2       | V2 / Defer      | Implemented | `A2` scale              |
| Webhook mode and advanced controls (restart/maintenance approvals)                        | P2       | V2 / Defer      | Implemented | post-`A2` expansion     |

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

## Polling GA Closeout Gates

Use this rollout-closeout sequence:

1. `pnpm check:fast`
2. `pnpm --filter @esl-pipeline/telegram-ops-bot test`
3. `pnpm test:integration`
4. `bash scripts/smoke/run-telegram-ops-compose-smoke.sh`
5. `pnpm ops:telegram:preflight --profile=readonly_canary`
6. Post-deploy: `pnpm ops:telegram:verify` (+ `--operation-id=<known-operation-id>` after backend restart)

Artifacts:

- `tmp/telegram-ops-go-live/preflight.json`
- `tmp/telegram-ops-go-live/verify.json`
