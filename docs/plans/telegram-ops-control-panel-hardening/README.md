# Telegram Ops Control Panel Hardening Plan

## Meta

- Audience: maintainers and Telegram ops agents.
- Authority Level: active rollout-closeout roadmap.
- Last Verified Against: 2026-05-17 repo state.
- Owner: founder-maintainer + ops maintainers.
- Review Cadence: after Telegram ops bot UX or rollout PRs.
- Status: `roadmap`.
- Exit Trigger: archive after remaining rollout-closeout evidence lands and the live operator procedure is fully represented in the Telegram ops runbook.
- Current Focus: use this README for rollout-closeout evidence; archived A-track docs are historical phase trace.

## Summary

The core `A`-track hardening work is implemented. This topic now exists mainly to route readers to the shipped audit and phase plans, plus the remaining rollout-closeout evidence path.

## Version Naming

Roadmap labels use `<Track><Phase>`:

- `A` = ops control bot
- `B` = teacher workflow bot
- `C` = student self-service bot

Current `A`-track map:

- `A2` hardened ops baseline
- `A3` discoverability activation
- `A4` guided Telegram interaction
- `A5` reserved for later context-entry expansion if needed

## Historical Trace

Archived A-track details remain available for rollout rationale, but this README is the active edit
surface.

- [`a-track-ux-audit.md`](../../archive/plans/telegram-ops-control-panel-hardening/a-track-ux-audit.md)
- [`A2-closeout.md`](../../archive/plans/telegram-ops-control-panel-hardening/A2-closeout.md)
- [`A3-ux-activation.md`](../../archive/plans/telegram-ops-control-panel-hardening/A3-ux-activation.md)
- [`A4-guided-telegram-interaction.md`](../../archive/plans/telegram-ops-control-panel-hardening/A4-guided-telegram-interaction.md)
- [`future-student-facing-roadmap.md`](../../archive/plans/telegram-ops-control-panel-hardening/future-student-facing-roadmap.md)
- [`new-operations.md`](../../archive/plans/telegram-ops-control-panel-hardening/new-operations.md)
- [`ux-v2.md`](../../archive/plans/telegram-ops-control-panel-hardening/ux-v2.md)

## Current State

- hardening inventory items are implemented
- current remaining work is rollout-readiness closeout and ongoing operator evidence
- rollback remains straightforward:
  - disable mutating actions with `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false`
  - preserve legacy startup behavior only if absolutely required via `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP=false`

## Rollout Gates

```bash
pnpm check:fast
pnpm --filter @esl-pipeline/telegram-ops-bot test
pnpm test:integration
bash scripts/smoke/run-telegram-ops-compose-smoke.sh
pnpm ops:telegram:preflight --profile=readonly_canary
pnpm ops:telegram:verify
```

Artifacts:

- `tmp/telegram-ops-go-live/preflight.json`
- `tmp/telegram-ops-go-live/verify.json`
