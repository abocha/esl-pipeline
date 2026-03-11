import type { Message, Update } from '@grammyjs/types';

import { formatCommandError } from './formatter.js';
import type { AuditLogger, BackendClient, BotConfig, CommandContext, TelegramMessenger, TopicRouter } from './types.js';
import { createCommandRegistry, parseCommandText, type CommandRegistry } from './commands.js';
import type { TelegramClient } from './telegram-client.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasTextField(message: Update['message']): message is NonNullable<Update['message']> {
  if (!message || typeof message !== 'object') {
    return false;
  }
  return typeof (message as { text?: unknown }).text === 'string';
}

export class TelegramOpsBotRunner {
  private readonly config: BotConfig;
  private readonly telegram: TelegramClient;
  private readonly backend: BackendClient;
  private readonly topicRouter: TopicRouter;
  private readonly audit: AuditLogger;
  private readonly registry: CommandRegistry;
  private readonly messenger: TelegramMessenger;
  private readonly userCommandTimestamps = new Map<number, number[]>();

  private running = false;
  private updateOffset = 0;
  private botUsername: string | null = null;

  constructor(args: {
    config: BotConfig;
    telegram: TelegramClient;
    backend: BackendClient;
    topicRouter: TopicRouter;
    audit: AuditLogger;
  }) {
    this.config = args.config;
    this.telegram = args.telegram;
    this.backend = args.backend;
    this.topicRouter = args.topicRouter;
    this.audit = args.audit;
    this.registry = createCommandRegistry();
    this.messenger = {
      sendHtmlMessage: async ({ chatId, threadId, html }) => {
        await this.telegram.sendHtmlMessage({
          chatId,
          threadId,
          html,
        });
      },
    };
  }

  async start(): Promise<void> {
    this.running = true;
    await this.resolveBotUsername();
    if (this.config.skipPendingUpdatesOnStartup) {
      await this.initializeUpdateOffsetFromLatestPending();
    }
    await this.topicRouter.initialize();

    this.audit.log({
      level: 'info',
      event: 'telegram_bot_started',
      message: 'Telegram ops bot started (long polling)',
      chatId: this.config.chatId,
    });

    while (this.running) {
      try {
        const updates = await this.telegram.getUpdates({
          offset: this.updateOffset,
          timeout: this.config.pollTimeoutSeconds,
          allowed_updates: ['message'],
        });

        for (const update of updates) {
          this.updateOffset = Math.max(this.updateOffset, update.update_id + 1);
          await this.processUpdate(update);
        }
      } catch (error: unknown) {
        this.audit.log({
          level: 'error',
          event: 'telegram_poll_failed',
          message: 'Polling failed; retrying',
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        await sleep(this.config.pollIntervalMs);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private async processUpdate(update: Update): Promise<void> {
    if (!('message' in update) || !hasTextField(update.message)) {
      return;
    }

    const message = update.message as Message.TextMessage;
    const fromUserId = message.from?.id;
    if (typeof fromUserId !== 'number') {
      return;
    }

    const chatId = String(message.chat.id);
    if (chatId !== this.config.chatId) {
      return;
    }

    const parsed = parseCommandText(message.text);
    if (!parsed) {
      return;
    }

    const threadId = this.resolveIncomingThreadId(message);

    if (parsed.mentionedBot && (!this.botUsername || parsed.mentionedBot !== this.botUsername)) {
      this.audit.log({
        level: 'info',
        event: 'command_ignored_mention_mismatch',
        message: 'Ignored command addressed to a different bot',
        userId: fromUserId,
        chatId,
        threadId,
        command: parsed.command,
        commandArgs: parsed.args,
        details: {
          addressedBot: parsed.mentionedBot,
          thisBot: this.botUsername,
        },
      });
      return;
    }

    if (!this.config.allowedUserIds.has(fromUserId)) {
      this.audit.log({
        level: 'warn',
        event: 'command_rejected_user_not_allowed',
        message: 'Rejected command from non-allowlisted user',
        userId: fromUserId,
        chatId,
        threadId,
        command: parsed.command,
      });
      await this.sendSimpleMessage({
        html: '<b>Access denied</b>\n\nYour Telegram user id is not allowed for this bot.',
        threadId,
      });
      return;
    }

    if (!this.consumeRateLimit(fromUserId)) {
      this.audit.log({
        level: 'warn',
        event: 'command_rejected_rate_limited',
        message: 'Rejected command due to rate limit',
        userId: fromUserId,
        chatId,
        threadId,
        command: parsed.command,
      });
      await this.sendSimpleMessage({
        html: '<b>Rate limit</b>\n\nPlease wait a minute before sending more commands.',
        threadId,
      });
      return;
    }

    const command = this.registry.resolve(parsed.command);
    if (!command) {
      await this.sendSimpleMessage({
        html: `<b>Unknown command</b>\n\nUse <code>/help</code> to list commands.`,
        threadId,
      });
      return;
    }

    const context: CommandContext = {
      config: this.config,
      backend: this.backend,
      messenger: this.messenger,
      topicRouter: this.topicRouter,
      audit: this.audit,
      update,
      message,
      fromUserId,
      command: parsed.command,
      args: parsed.args,
    };

    this.audit.log({
      level: 'info',
      event: 'command_received',
      message: 'Command received',
      userId: fromUserId,
      chatId,
      threadId,
      command: parsed.command,
      commandArgs: parsed.args,
    });

    try {
      await command.execute(context);
      this.audit.log({
        level: 'info',
        event: 'command_completed',
        message: 'Command completed',
        userId: fromUserId,
        chatId,
        threadId,
        command: parsed.command,
        commandArgs: parsed.args,
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error.message : String(error);
      this.audit.log({
        level: 'error',
        event: 'command_failed',
        message: 'Command failed',
        userId: fromUserId,
        chatId,
        threadId,
        command: parsed.command,
        commandArgs: parsed.args,
        details: {
          error: err,
        },
      });
      await this.sendSimpleMessage({
        html: formatCommandError(err),
        threadId,
      });
    }
  }

  private consumeRateLimit(userId: number): boolean {
    const now = Date.now();
    const windowStart = now - this.config.commandWindowMs;
    const existing = this.userCommandTimestamps.get(userId) ?? [];
    const filtered = existing.filter((timestamp) => timestamp >= windowStart);
    if (filtered.length >= this.config.maxCommandsPerWindow) {
      this.userCommandTimestamps.set(userId, filtered);
      return false;
    }
    filtered.push(now);
    this.userCommandTimestamps.set(userId, filtered);
    return true;
  }

  private resolveIncomingThreadId(message: Message.TextMessage): number | undefined {
    const value = message.message_thread_id;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }
    return undefined;
  }

  private async sendSimpleMessage(args: { html: string; threadId?: number }): Promise<void> {
    await this.messenger.sendHtmlMessage({
      chatId: this.config.chatId,
      threadId: args.threadId,
      html: args.html,
    });
  }

  private async resolveBotUsername(): Promise<void> {
    try {
      const me = await this.telegram.getMe();
      const username = typeof me.username === 'string' ? me.username.trim().toLowerCase() : '';
      this.botUsername = username || null;
      if (!this.botUsername) {
        this.audit.log({
          level: 'warn',
          event: 'bot_username_unavailable',
          message: 'Bot username is unavailable; mention-addressed commands will be ignored',
          chatId: this.config.chatId,
        });
      }
    } catch (error: unknown) {
      this.botUsername = null;
      this.audit.log({
        level: 'warn',
        event: 'bot_identity_lookup_failed',
        message: 'Failed to resolve bot identity; mention-addressed commands will be ignored',
        chatId: this.config.chatId,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async initializeUpdateOffsetFromLatestPending(): Promise<void> {
    try {
      const updates = await this.telegram.getUpdates({
        offset: -1,
        limit: 1,
        timeout: 0,
        allowed_updates: ['message'],
      });
      const latest = updates.at(-1);
      if (!latest) {
        this.audit.log({
          level: 'info',
          event: 'poll_offset_initialized_empty',
          message: 'No pending Telegram updates found on startup',
          chatId: this.config.chatId,
        });
        return;
      }

      this.updateOffset = latest.update_id + 1;
      this.audit.log({
        level: 'info',
        event: 'poll_offset_initialized_from_latest',
        message: 'Skipped pending updates on startup',
        chatId: this.config.chatId,
        details: {
          latestUpdateId: latest.update_id,
          nextOffset: this.updateOffset,
        },
      });
    } catch (error: unknown) {
      this.audit.log({
        level: 'warn',
        event: 'poll_offset_initialize_failed',
        message: 'Failed to initialize startup poll offset; continuing from default offset',
        chatId: this.config.chatId,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}
