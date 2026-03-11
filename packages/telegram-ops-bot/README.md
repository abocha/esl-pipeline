# @esl-pipeline/telegram-ops-bot

Telegram operations bot for ESL Pipeline.

## Scope

- Long-polling Telegram bot runtime.
- API-first operations control integration with `@esl-pipeline/batch-backend`.
- Thread/topic routing for ops, jobs, and alerts domains.
- Uses `@grammyjs/types` as the canonical Telegram API type contract.
- Starts in read-only mode by default (`TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false`).
