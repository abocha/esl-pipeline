# A-Track Telegram UX Audit

## Meta

- Audience: maintainers and agents evaluating the live Telegram operator UX.
- Read Time: 8 minutes.
- Authority Level: evaluative planning artifact.
- Last Verified Against: 2026-03-13 repo state and official Telegram docs available on 2026-03-13.
- Owner: backend/ops maintainers + automation agents.
- Review Cadence: revisit after major Telegram UX or transport changes.
- Status: `active audit`.

## Summary

This audit covers the live `A` track only: the internal ops control bot at `A1` baseline plus shipped `A2` hardening already present in `@esl-pipeline/telegram-ops-bot`.

The current UX is intentionally command-first and operator-focused. That is a reasonable product choice for `A` scope today. The main gap is not operational safety. It is discoverability and guided interaction. The bot is already fairly strong on transport safety, thread routing, rate limiting, and auditability, but it exposes almost none of Telegram's modern in-chat affordances for onboarding, navigation, or low-friction control.

Primary repo sources:

- [`docs/operations/telegram-ops-control-panel.md`](../../operations/telegram-ops-control-panel.md)
- [`docs/plans/telegram-ops-control-panel-hardening/README.md`](README.md)
- [`packages/telegram-ops-bot/src/runner.ts`](../../../packages/telegram-ops-bot/src/runner.ts)
- [`packages/telegram-ops-bot/src/commands.ts`](../../../packages/telegram-ops-bot/src/commands.ts)
- [`packages/telegram-ops-bot/src/formatter.ts`](../../../packages/telegram-ops-bot/src/formatter.ts)
- [`packages/telegram-ops-bot/src/config.ts`](../../../packages/telegram-ops-bot/src/config.ts)
- [`packages/telegram-ops-bot/src/webhook-server.ts`](../../../packages/telegram-ops-bot/src/webhook-server.ts)
- [`packages/telegram-ops-bot/src/telegram-client.ts`](../../../packages/telegram-ops-bot/src/telegram-client.ts)
- [`packages/telegram-ops-bot/src/topic-router.ts`](../../../packages/telegram-ops-bot/src/topic-router.ts)
- [`packages/telegram-ops-bot/src/metrics.ts`](../../../packages/telegram-ops-bot/src/metrics.ts)

## 1. Current A-Scope UX

### Scope and interaction model

Current `A` scope is the internal ops control bot, not teacher-facing `B` workflows and not student-facing `C` chat. The live UX is built around slash commands and threaded routing:

- Read commands: `/help`, `/status`, `/op`, `/finished`, `/job`, `/links`, `/share`
- Safe action commands: `/backup`, `/drill`
- Approval command for webhook-only advanced flow: `/approve`

The command registry is defined directly in [`packages/telegram-ops-bot/src/commands.ts`](../../../packages/telegram-ops-bot/src/commands.ts). There is no `/start` command and no `/settings` command in the current package. Help is delivered as a formatted command list generated from the in-process registry rather than from Telegram command metadata.

### How the UX is made

The current UX is composed from a few simple layers:

- Command parsing and dispatch live in [`runner.ts`](../../../packages/telegram-ops-bot/src/runner.ts). The runner accepts only `message` updates, parses slash commands, enforces allowlist and rate limiting, and records command outcome telemetry.
- Interaction behavior lives in [`commands.ts`](../../../packages/telegram-ops-bot/src/commands.ts). Commands route to domains (`ops`, `jobs`, `alerts`), fetch backend data, enqueue actions, and build `/share` cards.
- Rendering lives in [`formatter.ts`](../../../packages/telegram-ops-bot/src/formatter.ts). Responses are HTML-formatted Telegram messages, not structured keyboards or callback-driven widgets.
- Runtime and transport behavior live in [`config.ts`](../../../packages/telegram-ops-bot/src/config.ts), [`webhook-server.ts`](../../../packages/telegram-ops-bot/src/webhook-server.ts), and [`telegram-client.ts`](../../../packages/telegram-ops-bot/src/telegram-client.ts). The bot supports polling or webhook mode, webhook secret-token validation, and startup replay protection.
- Forum-topic routing and healing live in [`topic-router.ts`](../../../packages/telegram-ops-bot/src/topic-router.ts). The bot maps traffic into `ops`, `jobs`, and `alerts` topics, persists topic ids, and can heal stale/deleted topics on send failure.

### UX characteristics that are already present

- Slash-command-first UX with strict mention matching for group safety.
- Forum-topic routing by domain with fallback precedence from incoming thread to mapped topic to default thread to root chat.
- Explicit allowlist and per-user command rate limiting.
- Read-only-by-default posture for mutating commands.
- Webhook-mode approval token flow for higher-risk actions.
- `/share` and `/links` optimized as forwardable, multi-message share cards:
  - assignment card first with preview disabled
  - audio preview cards after with preview enabled
- Log-based UX and runtime telemetry via `bot_metric` events and structured audit logs.

### Current user scenarios the bot handles well

- Operator already knows the command set and needs fast direct execution.
- Operator works inside a forum-enabled ops chat and benefits from stable domain threads.
- Operator needs low-risk read actions with clear auditability.
- Operator needs a forwardable student-share artifact without opening the web UI.
- Maintainers need operational evidence around replay guard, stale-topic healing, and command outcomes.

## 2. Best-Practice Benchmark

This benchmark uses current official Telegram docs plus the synthesis supplied in the request. The product direction Telegram signals most clearly is: discoverable commands, guided controls where useful, quick callback response, and production-safe transport handling.

Benchmark buckets used in this audit:

- Discoverability and onboarding
  - commands should be self-explanatory in chat
  - `/start` is the expected first-run anchor
  - menu button and bot descriptions should reduce guesswork
- Guided interaction vs. freeform parsing
  - keyboards, inline controls, and `ForceReply` are preferred for stepwise flows
  - editing existing messages is preferred over spamming new ones for navigation/toggles
- Command and menu metadata
  - Telegram supports command registration, scopes, localized command lists, descriptions, and menu-button configuration
- Transport and update-handling safety
  - one update mode at a time
  - proper `offset` progression
  - use of `allowed_updates`
  - controlled use of `drop_pending_updates`
  - webhook hardening and monitoring
- Callback latency and low-friction controls
  - callback queries should be answered immediately to clear client spinners
- Localization
  - language-aware text and command metadata where multi-language UX matters
- Privacy mode assumptions
  - keep privacy mode on unless the bot truly requires more group visibility
- Operability and UX health
  - response and callback health should be observable, not treated as invisible plumbing
- Mini Apps threshold
  - use chat-first UX until flows become cramped, stateful, or multi-step enough to justify richer UI

Official Telegram sources used for this benchmark:

- [Telegram Bot Features](https://core.telegram.org/bots/features)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Bots FAQ](https://core.telegram.org/bots/faq)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Bot Menu Button Docs](https://core.telegram.org/api/bots/menu)

## 3. Alignment Assessment

### Status matrix

| Area                                | Status             | Repo-grounded assessment                                                                                                          |
| ----------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Single transport mode at a time     | Aligned            | Config enforces `polling` or `webhook`, and runtime chooses one path per process.                                                 |
| Update filtering and replay safety  | Aligned            | Polling uses `allowed_updates: ['message']`, advances `offset` with `last_update_id + 1`, and supports startup replay skipping.   |
| Webhook secret-token hardening      | Aligned            | Webhook listener validates `x-telegram-bot-api-secret-token` when configured.                                                     |
| Topic/thread routing resilience     | Aligned            | Domain topics, persisted topic ids, stale-thread healing, and fallback routing are implemented.                                   |
| Rate limiting and command telemetry | Aligned            | Per-user rate limiting and additive log-based metrics are already present.                                                        |
| Basic in-chat help                  | Partially aligned  | `/help` exists and is readable, but onboarding still depends on users already knowing to ask for it.                              |
| Discoverability and onboarding      | Partially aligned  | No `/start`, no first-run orientation flow, and no evidence of Telegram-level menu/description setup in this package.             |
| Command registration and scoping    | Partially aligned  | Commands exist in code, but command metadata registration, command scopes, and localized command lists are not surfaced here.     |
| Guided interaction controls         | Not aligned        | No reply keyboards, inline keyboards, `ForceReply`, callback queries, or edited-message navigation exist in the live bot package. |
| Callback responsiveness             | Not aligned        | There is no callback-query flow, so there is also no `answerCallbackQuery` handling.                                              |
| Localization                        | Not aligned        | No `language_code`-aware text, command metadata, or help branching is implemented in the package.                                 |
| Deep-link onboarding                | Not aligned        | No `start`/`startgroup` deep-link entry path is surfaced in the code.                                                             |
| Privacy-mode stance                 | Not applicable yet | Current bot is allowlisted and command-driven; privacy-mode tuning is not a visible product issue in this internal scope.         |
| Mini Apps adoption                  | Not applicable yet | Current internal ops workflows do not yet appear cramped enough to justify a Mini App.                                            |

### What is already strong

The best-aligned parts of the current bot are the parts that matter most for operational safety:

- transport selection is explicit
- polling behavior is conservative and filtered
- webhook ingress can be hardened
- stale updates can be skipped on startup
- topic failures are healed or degraded safely
- mutating commands are gated
- metrics and audit logs already exist

This means the current `A` track is stronger on reliability than on discoverability.

### Main gaps

The main UX gaps are not bugs. They are missing affordances:

- no `/start` anchor for first contact
- no menu-button or bot-description configuration surfaced in code
- no guided keyboard-driven shortcuts for common read flows
- no callback-based navigation with message editing
- no localization path
- no deep-link entry strategy for fast context-aware starts

### Important product interpretation

Telegram best practice in general is not the same as best practice for this bot today. The current command-first design is still defensible because `A` scope is internal, operator-driven, and intentionally narrow. The bot does not need to become a rich consumer chat app to be good. It does need to become more self-explanatory.

## 4. Ranked Improvement Backlog

### Now

These are low-risk, high-discoverability improvements that fit the current ops product shape:

1. Add `/start` as the first-run entry point.
   - Keep it short.
   - Explain what the bot is for.
   - Point directly to `/help`.
   - Mention the main read actions and whether mutating commands are enabled.

2. Register Telegram command metadata rather than relying only on in-process help text.
   - Add command registration flow for the live command set.
   - Use specific descriptions.
   - Apply scopes where appropriate so the wrong commands do not appear in the wrong contexts.

3. Configure menu button plus short and long bot descriptions.
   - Make the bot understandable before the first command is typed.
   - Treat this as onboarding infrastructure, not polish.

4. Expand telemetry framing from command outcomes to UX health.
   - Keep current metrics.
   - Add first-response latency, help/start usage, unknown-command rate, and eventually callback success if guided controls are added.

### Next

These changes add guided UX without changing the product scope:

1. Add inline-keyboard shortcuts for common read actions.
   - `Status`
   - `Finished`
   - `Recent operations`
   - `Share latest job` only if a safe lookup exists

2. Use callback-query flows for non-destructive navigation and toggles.
   - Navigation should stay in place when possible.
   - Answer callback queries immediately.

3. Edit existing messages for lightweight navigation instead of emitting extra chat noise.
   - This matters most for drill-down flows like `status -> recent ops -> operation detail`.

4. Add deep-link entry points only where there is a real launch source.
   - Good examples would be internal runbooks, dashboards, or alerts that open the bot into a specific context.
   - Do not add deep links just because Telegram supports them.

### Later

These are larger or more conditional bets:

1. Localize commands and help text only if the operator audience genuinely needs multiple languages.
   - Current repo evidence does not justify this as an immediate `A` track priority.

2. Evaluate a Mini App only if `A` track becomes stateful enough that chat is doing the wrong job.
   - Likely triggers: approval inboxes, long action history browsing, filterable status dashboards, or multi-step maintenance workflows.
   - Until then, a better chat UX is probably cheaper and clearer than a hybrid chat-plus-app surface.

## 5. Recommendation Framing

### Best practice for Telegram generally

Telegram's modern direction favors self-explanatory in-chat bots, discoverable commands, guided controls, quick callback handling, and operational reliability. On that benchmark, the current `A` track is incomplete because it mostly exposes raw command power and almost none of the platform's onboarding and guided-interaction layer.

### Best practice for this product today

For this repo's `A` track, command-first is still acceptable. The bot is internal, allowlisted, and narrow in purpose. A full keyboard-first redesign or Mini App push would be premature. The right near-term move is to keep the stable command core and add a thin discoverability layer around it.

### Recommended direction

The highest-leverage path is:

1. keep the current transport and safety model
2. make the bot self-explanatory with `/start`, command metadata, and menu descriptions
3. add guided inline controls for the most common read-only flows
4. postpone bigger UX expansion until `A` scope clearly outgrows chat

That approach aligns the bot more closely with Telegram best practices without turning an ops tool into a heavier product than it needs to be.
