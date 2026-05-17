# A-Track Phase Plan: `A3` UX Activation

## Summary

`A3` is the discoverability and onboarding phase for the internal Telegram ops bot.

Goals:

1. Make the bot self-explanatory with `/start`, onboarding-oriented `/help`, and startup-synced Telegram metadata.
2. Keep the operational surface narrow and additive: no backend contract changes, no broad private-chat parity, and no Mini App work.
3. Reserve `A4` for guided Telegram interaction:
   - inline keyboards
   - callback-query navigation
   - edited-message flows
   - context-aware deep links where there is a real launch source

## Implementation Changes

1. Add `/start` and narrow private-chat onboarding for allowlisted operators.
2. Keep operational commands scoped to the configured ops chat.
3. Make help and Telegram command visibility capability-aware:
   - private onboarding scope: `/start`, `/help`
   - ops chat scope: current read commands plus enabled action commands
   - hide `/approve` unless webhook mode and action commands are enabled
4. Sync Telegram command metadata, descriptions, and menu button at startup on a best-effort basis.
5. Extend UX-health telemetry with `/start`, `/help`, and onboarding/help response latency signals.

## Public Interface Changes

1. New public command: `/start`
2. New runtime behavior:
   - allowlisted private chats may use `/start` and `/help`
   - other operator commands remain scoped to the configured ops chat
3. No backend API or DTO changes

## Test Plan

1. Unit coverage for `/start`, help visibility, and capability-aware command metadata.
2. Runner coverage for private onboarding success and private command redirection.
3. Metadata sync coverage for:
   - private scope registration
   - ops chat scope registration
   - description/menu sync
   - non-fatal sync failures
4. Compose smoke coverage for startup metadata sync plus unchanged command-loop behavior.

## Assumptions

1. `A3` is now an official roadmap phase after `A2`.
2. `A4` is reserved for the audit's guided-interaction backlog and is not implemented here.
3. Localization remains deferred until there is a real multi-language operator requirement.
