import type { Message, Update } from '@grammyjs/types';

import type { ApprovalReplayStore } from './approval-replay-store.js';
import { type CommandRegistry, createCommandRegistry, parseCommandText } from './commands.js';
import { formatCommandError } from './formatter.js';
import { emitBotMetricCounter } from './metrics.js';
import { TelegramApiError, type TelegramClient } from './telegram-client.js';
import type {
  AuditLogger,
  BackendClient,
  BotDomain,
  BotConfig,
  CommandContext,
  PollLeaderElection,
  TelegramMessenger,
  TopicRouter,
} from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasTextField(message: Update['message']): message is NonNullable<Update['message']> {
  if (!message || typeof message !== 'object') {
    return false;
  }
  return typeof (message as { text?: unknown }).text === 'string';
}

function isStaleOrDeletedThreadError(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) {
    return false;
  }
  if (error.method !== 'sendMessage') {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('message thread not found') ||
    message.includes('message thread is not found') ||
    message.includes('message thread not exists') ||
    message.includes('message thread is closed') ||
    message.includes('topic closed') ||
    message.includes('topic deleted')
  );
}

type LeadershipState = 'leader' | 'follower' | null;

export class TelegramOpsBotRunner {
  private readonly config: BotConfig;
  private readonly telegram: TelegramClient;
  private readonly backend: BackendClient;
  private readonly topicRouter: TopicRouter;
  private readonly audit: AuditLogger;
  private readonly registry: CommandRegistry;
  private readonly messenger: TelegramMessenger;
  private readonly leaderElection?: PollLeaderElection;
  private readonly approvalReplayStore?: ApprovalReplayStore;
  private readonly userCommandTimestamps = new Map<number, number[]>();

  private running = false;
  private initialized = false;
  private updateOffset = 0;
  private botUsername: string | null = null;
  private leadershipState: LeadershipState = null;
  private startupReplayDecisionFinalized = false;

  constructor(args: {
    config: BotConfig;
    telegram: TelegramClient;
    backend: BackendClient;
    topicRouter: TopicRouter;
    audit: AuditLogger;
    leaderElection?: PollLeaderElection;
    approvalReplayStore?: ApprovalReplayStore;
  }) {
    this.config = args.config;
    this.telegram = args.telegram;
    this.backend = args.backend;
    this.topicRouter = args.topicRouter;
    this.audit = args.audit;
    this.leaderElection = args.leaderElection;
    this.approvalReplayStore = args.approvalReplayStore;
    this.registry = createCommandRegistry({
      replayStore: this.approvalReplayStore,
    });
    this.messenger = {
      sendHtmlMessage: async ({ chatId, threadId, domain, html, disableLinkPreview }) => {
        if (typeof threadId === 'number' && domain) {
          await this.sendHtmlMessageWithTopicHealing({
            chatId,
            domain,
            threadId,
            html,
            disableLinkPreview,
          });
          return;
        }
        await this.telegram.sendHtmlMessage({
          chatId,
          threadId,
          html,
          disableLinkPreview,
        });
      },
    };
  }

  async start(): Promise<void> {
    this.running = true;
    await this.initializeRuntime();

    if (this.config.mode === 'webhook') {
      this.audit.log({
        level: 'info',
        event: 'telegram_bot_started',
        message: 'Telegram ops bot started (webhook mode)',
        chatId: this.config.chatId,
      });
      await this.runWebhookMode();
      return;
    }

    this.audit.log({
      level: 'info',
      event: 'telegram_bot_started',
      message: 'Telegram ops bot started (long polling)',
      chatId: this.config.chatId,
      details: {
        leaderElectionEnabled: Boolean(this.leaderElection),
      },
    });

    try {
      await this.runPollingMode();
    } finally {
      if (this.leaderElection) {
        await this.leaderElection.close();
      }
    }
  }

  async prepareForWebhookUpdates(): Promise<void> {
    if (this.config.mode !== 'webhook') {
      return;
    }
    await this.initializeRuntime();
  }

  async handleWebhookUpdate(update: Update): Promise<void> {
    if (this.config.mode !== 'webhook') {
      throw new Error('handleWebhookUpdate can only be used when TELEGRAM_OPS_BOT_MODE=webhook');
    }
    await this.processUpdate(update);
  }

  private async runWebhookMode(): Promise<void> {
    while (this.running) {
      await sleep(Math.min(1_000, this.config.pollIntervalMs));
    }
  }

  private async runPollingMode(): Promise<void> {
    while (this.running) {
      const canPollThisCycle = await this.shouldPollThisCycle();
      await this.maybeApplyStartupReplayGuard(canPollThisCycle);
      if (!canPollThisCycle) {
        await sleep(this.config.pollIntervalMs);
        continue;
      }

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

  private async initializeRuntime(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.resolveBotUsername();
    if (
      this.config.mode === 'polling' &&
      this.config.skipPendingUpdatesOnStartup &&
      !this.leaderElection
    ) {
      await this.initializeUpdateOffsetFromLatestPending();
      this.startupReplayDecisionFinalized = true;
    }
    await this.topicRouter.initialize();
    this.initialized = true;
  }

  private async maybeApplyStartupReplayGuard(canPollThisCycle: boolean): Promise<void> {
    if (!this.config.skipPendingUpdatesOnStartup || this.startupReplayDecisionFinalized) {
      return;
    }
    if (!this.leaderElection) {
      return;
    }

    if (canPollThisCycle) {
      await this.initializeUpdateOffsetFromLatestPending();
      this.startupReplayDecisionFinalized = true;
      return;
    }

    this.startupReplayDecisionFinalized = true;
    if (this.leadershipState === 'follower') {
      this.audit.log({
        level: 'info',
        event: 'startup_replay_guard_skipped_standby',
        message:
          'Skipped startup pending-update replay guard because this instance started in standby',
        chatId: this.config.chatId,
      });
      return;
    }

    this.audit.log({
      level: 'warn',
      event: 'startup_replay_guard_skipped_unavailable',
      message:
        'Skipped startup pending-update replay guard because leader-election checks were unavailable during startup',
      chatId: this.config.chatId,
    });
  }

  stop(): void {
    this.running = false;
  }

  private async shouldPollThisCycle(): Promise<boolean> {
    if (!this.leaderElection) {
      return true;
    }
    try {
      const leader = await this.leaderElection.isLeader();
      const nextState: LeadershipState = leader ? 'leader' : 'follower';
      if (this.leadershipState !== nextState) {
        this.audit.log({
          level: 'info',
          event: leader ? 'poll_leader_acquired' : 'poll_leader_standby',
          message: leader
            ? 'Acquired polling leadership; this instance will poll updates'
            : 'Polling leadership is held by another instance; standing by',
          chatId: this.config.chatId,
        });
        this.leadershipState = nextState;
      }
      return leader;
    } catch (error: unknown) {
      this.audit.log({
        level: 'warn',
        event: 'poll_leader_check_failed',
        message: 'Leader-election check failed; skipping this poll cycle',
        chatId: this.config.chatId,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.leadershipState = null;
      return false;
    }
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
      emitBotMetricCounter({
        audit: this.audit,
        metric: 'command_outcome',
        labels: {
          status: 'denied_not_allowed',
          command: parsed.command,
        },
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
      emitBotMetricCounter({
        audit: this.audit,
        metric: 'command_outcome',
        labels: {
          status: 'denied_rate_limited',
          command: parsed.command,
        },
      });
      await this.sendSimpleMessage({
        html: '<b>Rate limit</b>\n\nPlease wait a minute before sending more commands.',
        threadId,
      });
      return;
    }

    const command = this.registry.resolve(parsed.command);
    if (!command) {
      emitBotMetricCounter({
        audit: this.audit,
        metric: 'command_outcome',
        labels: {
          status: 'unknown',
          command: parsed.command,
        },
      });
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

    const startedAt = Date.now();

    try {
      await command.execute(context);
      const durationMs = Date.now() - startedAt;
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
      this.logCommandOutcome({
        level: 'info',
        fromUserId,
        chatId,
        threadId,
        command: parsed.command,
        commandArgs: parsed.args,
        durationMs,
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
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
      this.logCommandOutcome({
        level: 'error',
        fromUserId,
        chatId,
        threadId,
        command: parsed.command,
        commandArgs: parsed.args,
        durationMs,
        error: err,
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

  private logCommandOutcome(args: {
    level: 'info' | 'error';
    fromUserId: number;
    chatId: string;
    threadId?: number;
    command: string;
    commandArgs: string[];
    durationMs: number;
    error?: string;
  }): void {
    const status = args.error ? 'failed' : 'completed';
    this.audit.log({
      level: args.level,
      event: 'command_outcome',
      message: 'Command execution outcome recorded',
      userId: args.fromUserId,
      chatId: args.chatId,
      threadId: args.threadId,
      command: args.command,
      commandArgs: args.commandArgs,
      details: {
        status,
        durationMs: args.durationMs,
        ...(args.error ? { error: args.error } : {}),
      },
    });
    emitBotMetricCounter({
      audit: this.audit,
      metric: 'command_outcome',
      labels: {
        status,
        command: args.command,
      },
    });
  }

  private async sendHtmlMessageWithTopicHealing(args: {
    chatId: string;
    domain: BotDomain;
    threadId: number;
    html: string;
    disableLinkPreview?: boolean;
  }): Promise<void> {
    const basePayload = {
      chatId: args.chatId,
      html: args.html,
      disableLinkPreview: args.disableLinkPreview,
    };

    try {
      await this.telegram.sendHtmlMessage({
        ...basePayload,
        threadId: args.threadId,
      });
      return;
    } catch (error: unknown) {
      if (!isStaleOrDeletedThreadError(error)) {
        throw error;
      }
    }

    this.audit.log({
      level: 'warn',
      event: 'topic_stale_detected',
      message: 'Detected stale/deleted topic thread; attempting topic heal',
      chatId: args.chatId,
      threadId: args.threadId,
      details: {
        domain: args.domain,
      },
    });

    const recreatedThreadId = await this.topicRouter.healStaleThread({
      domain: args.domain,
      staleThreadId: args.threadId,
    });
    if (typeof recreatedThreadId === 'number') {
      this.audit.log({
        level: 'info',
        event: 'topic_recreated',
        message: 'Recreated Telegram forum topic after stale-thread detection',
        chatId: args.chatId,
        threadId: recreatedThreadId,
        details: {
          domain: args.domain,
          staleThreadId: args.threadId,
        },
      });
    }

    const retryThreadId =
      typeof recreatedThreadId === 'number'
        ? recreatedThreadId
        : this.config.defaultThreadId === args.threadId
          ? undefined
          : this.config.defaultThreadId;

    try {
      await this.telegram.sendHtmlMessage({
        ...basePayload,
        threadId: retryThreadId,
      });
      return;
    } catch (retryError: unknown) {
      const fallbackThreadId =
        retryThreadId === this.config.defaultThreadId ? undefined : this.config.defaultThreadId;
      if (fallbackThreadId === retryThreadId) {
        throw retryError;
      }

      this.audit.log({
        level: 'warn',
        event: 'topic_heal_fallback',
        message: 'Topic heal retry failed; falling back to default/root thread',
        chatId: args.chatId,
        threadId: fallbackThreadId,
        details: {
          domain: args.domain,
          staleThreadId: args.threadId,
          retryThreadId,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        },
      });

      await this.telegram.sendHtmlMessage({
        ...basePayload,
        threadId: fallbackThreadId,
      });
    }
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
