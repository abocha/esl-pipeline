# Telegram Ops Control Panel Hardening Plan

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

## Active Docs in This Topic

- [`a-track-ux-audit.md`](a-track-ux-audit.md)
- [`A3-ux-activation.md`](A3-ux-activation.md)
- [`A4-guided-telegram-interaction.md`](A4-guided-telegram-interaction.md)
- [`future-student-facing-roadmap.md`](future-student-facing-roadmap.md)

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
