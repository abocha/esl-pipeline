import type { Message, Update } from '@grammyjs/types';

import type { ApprovalReplayStore } from './approval-replay-store.js';
import { type CommandRegistry, createCommandRegistry, parseCommandText } from './commands.js';
import { formatCommandError, formatPrivateOnboardingRedirect } from './formatter.js';
import { handleGuidedCallback } from './guided-ui.js';
import { emitBotMetricCounter } from './metrics.js';
import { TelegramApiError, type TelegramClient } from './telegram-client.js';
import type {
  AuditLogger,
  BackendClient,
  BotDomain,
  BotConfig,
  CommandContext,
  PollLeaderElection,
  TelegramInlineKeyboardMarkup,
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

function hasCallbackQueryData(
  update: Update,
): update is Update & { callback_query: NonNullable<Update['callback_query']> } {
  if (!('callback_query' in update) || !update.callback_query) {
    return false;
  }
  return typeof update.callback_query.data === 'string' && update.callback_query.data.length > 0;
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

function isEditTargetUnavailableError(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) {
    return false;
  }
  if (error.method !== 'editMessageText') {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("message can't be edited") ||
    message.includes('message to edit not found') ||
    message.includes('message identifier is not specified') ||
    message.includes('message thread not found')
  );
}

function isMessageNotModifiedError(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.method === 'editMessageText' &&
    error.message.toLowerCase().includes('message is not modified')
  );
}

function callbackMetricLabel(data: string): string {
  const [, kind, param] = data.split('|');
  switch (kind) {
    case 'h':
      return 'home';
    case 's':
      return 'status';
    case 'f':
      return 'finished';
    case 'r':
      return 'recent_ops';
    case 'j':
      return 'job';
    case 'o':
      return 'op';
    case 'jl':
      return 'job_links';
    case 'js':
      return 'job_share';
    case 'a':
      return param === 'backup' || param === 'drill' ? `action_${param}` : 'action_unknown';
    case 'c':
      return param === 'backup' || param === 'drill' ? `confirm_${param}` : 'confirm_unknown';
    default:
      return 'unknown';
  }
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
      sendHtmlMessage: async ({
        chatId,
        threadId,
        domain,
        html,
        disableLinkPreview,
        replyMarkup,
      }) => {
        if (typeof threadId === 'number' && domain) {
          return this.sendHtmlMessageWithTopicHealing({
            chatId,
            domain,
            threadId,
            html,
            disableLinkPreview,
            replyMarkup,
          });
        }
        return this.telegram.sendHtmlMessage({
          chatId,
          threadId,
          html,
          disableLinkPreview,
          replyMarkup,
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
          allowed_updates: ['message', 'callback_query'],
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
    if (hasCallbackQueryData(update)) {
      await this.processCallbackQuery(update);
      return;
    }

    if (!('message' in update) || !hasTextField(update.message)) {
      return;
    }
    await this.processMessageUpdate(update, update.message as Message.TextMessage);
  }

  private async processMessageUpdate(update: Update, message: Message.TextMessage): Promise<void> {
    const fromUserId = message.from?.id;
    if (typeof fromUserId !== 'number') {
      return;
    }

    const chatId = String(message.chat.id);
    const isPrivateChat = message.chat.type === 'private';
    if (chatId !== this.config.chatId && !isPrivateChat) {
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
        chatId,
        html: '<b>Access denied</b>\n\nYour Telegram user id is not allowed for this bot.',
        threadId,
      });
      return;
    }

    if (isPrivateChat && parsed.command !== 'start' && parsed.command !== 'help') {
      this.audit.log({
        level: 'info',
        event: 'command_rejected_private_chat_scope',
        message: 'Rejected private-chat command outside onboarding scope',
        userId: fromUserId,
        chatId,
        command: parsed.command,
        commandArgs: parsed.args,
      });
      await this.sendSimpleMessage({
        chatId,
        html: formatPrivateOnboardingRedirect(this.config.chatId),
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
        chatId,
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
        chatId,
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
        chatId,
        html: formatCommandError(err),
        threadId,
      });
    }
  }

  private async processCallbackQuery(
    update: Update & { callback_query: NonNullable<Update['callback_query']> },
  ): Promise<void> {
    const callback = update.callback_query;
    const fromUserId = callback.from?.id;
    if (typeof fromUserId !== 'number') {
      return;
    }

    const callbackMessage = callback.message;
    if (!callbackMessage || !('chat' in callbackMessage)) {
      await this.answerCallbackQuery({
        callbackQueryId: callback.id,
      });
      return;
    }
    const callbackData = callback.data;
    if (typeof callbackData !== 'string' || callbackData.length === 0) {
      await this.answerCallbackQuery({
        callbackQueryId: callback.id,
      });
      return;
    }

    const chatId = String(callbackMessage.chat.id);
    const threadId = this.resolveIncomingThreadId(callbackMessage as Message.TextMessage);
    const isPrivateChat = callbackMessage.chat.type === 'private';

    this.audit.log({
      level: 'info',
      event: 'callback_received',
      message: 'Callback query received',
      userId: fromUserId,
      chatId,
      threadId,
      details: {
        data: callbackData,
      },
    });

    emitBotMetricCounter({
      audit: this.audit,
      metric: 'callback_usage',
      labels: {
        action: callbackMetricLabel(callbackData),
      },
    });

    if (chatId !== this.config.chatId || isPrivateChat) {
      await this.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Guided controls only work in the configured ops chat.',
      });
      this.logCallbackOutcome({
        status: 'denied_scope',
        chatId,
        threadId,
        fromUserId,
        data: callbackData,
      });
      return;
    }

    if (!this.config.allowedUserIds.has(fromUserId)) {
      await this.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Access denied.',
      });
      this.logCallbackOutcome({
        status: 'denied_scope',
        chatId,
        threadId,
        fromUserId,
        data: callbackData,
      });
      return;
    }

    if (!this.consumeRateLimit(fromUserId)) {
      await this.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Rate limit hit. Please wait a minute.',
      });
      this.logCallbackOutcome({
        status: 'failed',
        chatId,
        threadId,
        fromUserId,
        data: callbackData,
        reason: 'rate_limited',
      });
      return;
    }

    const callbackStartedAt = Date.now();
    await this.answerCallbackQuery({
      callbackQueryId: callback.id,
    });

    const context: CommandContext = {
      config: this.config,
      backend: this.backend,
      messenger: this.messenger,
      topicRouter: this.topicRouter,
      audit: this.audit,
      update,
      message: callbackMessage as Message.TextMessage,
      fromUserId,
      command: 'help',
      args: [],
    };

    try {
      const result = await handleGuidedCallback({
        data: callbackData,
        context,
        commands: this.registry.commands,
      });
      if (!result) {
        this.logCallbackOutcome({
          status: 'unknown',
          chatId,
          threadId,
          fromUserId,
          data: callbackData,
        });
        return;
      }

      if (result.kind === 'noop') {
        this.logCallbackOutcome({
          status: 'completed',
          chatId,
          threadId,
          fromUserId,
          data: callbackData,
          durationMs: Date.now() - callbackStartedAt,
        });
        return;
      }

      await this.renderCallbackResult({
        chatId,
        threadId,
        domain: result.domain,
        callbackData,
        callbackMessageId: callbackMessage.message_id,
        fromUserId,
        html: result.html,
        replyMarkup: result.replyMarkup,
        disableLinkPreview: result.disableLinkPreview,
        callbackStartedAt,
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error.message : String(error);
      this.audit.log({
        level: 'error',
        event: 'callback_render_failed',
        message: 'Failed to process guided callback query',
        userId: fromUserId,
        chatId,
        threadId,
        details: {
          data: callbackData,
          error: err,
        },
      });
      this.logCallbackOutcome({
        status: 'failed',
        chatId,
        threadId,
        fromUserId,
        data: callbackData,
        durationMs: Date.now() - callbackStartedAt,
        reason: err,
      });
      await this.sendSimpleMessage({
        chatId,
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

  private async sendSimpleMessage(args: {
    chatId?: string;
    html: string;
    threadId?: number;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }) {
    return this.messenger.sendHtmlMessage({
      chatId: args.chatId ?? this.config.chatId,
      threadId: args.threadId,
      html: args.html,
      replyMarkup: args.replyMarkup,
    });
  }

  private async renderCallbackResult(args: {
    chatId: string;
    threadId?: number;
    domain: BotDomain;
    callbackMessageId: number;
    callbackData: string;
    fromUserId: number;
    html: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
    disableLinkPreview?: boolean;
    callbackStartedAt: number;
  }): Promise<void> {
    try {
      await this.telegram.editHtmlMessage({
        chatId: args.chatId,
        messageId: args.callbackMessageId,
        html: args.html,
        disableLinkPreview: args.disableLinkPreview,
        replyMarkup: args.replyMarkup,
      });
      this.audit.log({
        level: 'info',
        event: 'callback_render_completed',
        message: 'Guided callback rendered via message edit',
        userId: args.fromUserId,
        chatId: args.chatId,
        threadId: args.threadId,
        details: {
          data: args.callbackData,
        },
      });
      this.logCallbackOutcome({
        status: 'completed',
        chatId: args.chatId,
        threadId: args.threadId,
        fromUserId: args.fromUserId,
        data: args.callbackData,
        durationMs: Date.now() - args.callbackStartedAt,
      });
      return;
    } catch (error: unknown) {
      if (isMessageNotModifiedError(error)) {
        this.logCallbackOutcome({
          status: 'completed',
          chatId: args.chatId,
          threadId: args.threadId,
          fromUserId: args.fromUserId,
          data: args.callbackData,
          durationMs: Date.now() - args.callbackStartedAt,
        });
        return;
      }
      if (!isEditTargetUnavailableError(error)) {
        throw error;
      }
    }

    if (typeof args.threadId === 'number') {
      await this.sendHtmlMessageWithTopicHealing({
        chatId: args.chatId,
        domain: args.domain,
        threadId: args.threadId,
        html: args.html,
        disableLinkPreview: args.disableLinkPreview,
        replyMarkup: args.replyMarkup,
      });
    } else {
      await this.sendSimpleMessage({
        chatId: args.chatId,
        threadId: args.threadId,
        html: args.html,
        replyMarkup: args.replyMarkup,
      });
    }
    this.audit.log({
      level: 'warn',
      event: 'callback_edit_fallback_used',
      message: 'Guided callback edit failed; sent replacement message',
      userId: args.fromUserId,
      chatId: args.chatId,
      threadId: args.threadId,
      details: {
        data: args.callbackData,
      },
    });
    this.logCallbackOutcome({
      status: 'edit_fallback',
      chatId: args.chatId,
      threadId: args.threadId,
      fromUserId: args.fromUserId,
      data: args.callbackData,
      durationMs: Date.now() - args.callbackStartedAt,
    });
  }

  private async answerCallbackQuery(args: {
    callbackQueryId: string;
    text?: string;
  }): Promise<void> {
    await this.telegram.answerCallbackQuery({
      callback_query_id: args.callbackQueryId,
      ...(args.text ? { text: args.text } : {}),
    });
    this.audit.log({
      level: 'info',
      event: 'callback_answered',
      message: 'Callback query answered',
      chatId: this.config.chatId,
      details: {
        callbackQueryId: args.callbackQueryId,
        answeredWithText: Boolean(args.text),
      },
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

  private logCallbackOutcome(args: {
    status: 'completed' | 'edit_fallback' | 'failed' | 'denied_scope' | 'unknown';
    chatId: string;
    threadId?: number;
    fromUserId: number;
    data: string;
    durationMs?: number;
    reason?: string;
  }): void {
    this.audit.log({
      level: args.status === 'failed' ? 'error' : 'info',
      event: 'callback_outcome',
      message: 'Callback execution outcome recorded',
      userId: args.fromUserId,
      chatId: args.chatId,
      threadId: args.threadId,
      details: {
        status: args.status,
        data: args.data,
        action: callbackMetricLabel(args.data),
        ...(typeof args.durationMs === 'number' ? { durationMs: args.durationMs } : {}),
        ...(args.reason ? { reason: args.reason } : {}),
      },
    });
    emitBotMetricCounter({
      audit: this.audit,
      metric: 'callback_outcome',
      labels: {
        status: args.status,
        action: callbackMetricLabel(args.data),
        ...(args.reason ? { reason: args.reason } : {}),
      },
    });
    if (typeof args.durationMs === 'number') {
      emitBotMetricCounter({
        audit: this.audit,
        metric: 'callback_response_latency_ms',
        value: args.durationMs,
        labels: {
          action: callbackMetricLabel(args.data),
          status: args.status,
        },
      });
    }
  }

  private async sendHtmlMessageWithTopicHealing(args: {
    chatId: string;
    domain: BotDomain;
    threadId: number;
    html: string;
    disableLinkPreview?: boolean;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }) {
    const basePayload = {
      chatId: args.chatId,
      html: args.html,
      disableLinkPreview: args.disableLinkPreview,
      replyMarkup: args.replyMarkup,
    };

    try {
      return await this.telegram.sendHtmlMessage({
        ...basePayload,
        threadId: args.threadId,
      });
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
      return await this.telegram.sendHtmlMessage({
        ...basePayload,
        threadId: retryThreadId,
      });
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

      return this.telegram.sendHtmlMessage({
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
        allowed_updates: ['message', 'callback_query'],
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
