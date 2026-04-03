import { loadTopicState, saveTopicState } from './state.js';
import type { TelegramClient } from './telegram-client.js';
import type { AuditLogger, BotConfig, BotDomain, TopicRouter } from './types.js';

const FORUM_STATUS_RETRY_DELAY_MS = 30_000;

export class ForumTopicRouter implements TopicRouter {
  private readonly config: BotConfig;
  private readonly telegram: TelegramClient;
  private readonly audit: AuditLogger;
  private topicIds: Partial<Record<BotDomain, number>> = {};
  private isForumEnabled: boolean | null = null;
  private forumStatusRetryNotBeforeMs = 0;

  constructor(args: { config: BotConfig; telegram: TelegramClient; audit: AuditLogger }) {
    this.config = args.config;
    this.telegram = args.telegram;
    this.audit = args.audit;
  }

  async initialize(): Promise<void> {
    const cached = await loadTopicState(this.config.topicsStateFile);
    if (cached && cached.chatId === this.config.chatId) {
      this.topicIds = { ...cached.topics };
    }

    if (!this.config.topicAutoCreate) {
      this.audit.log({
        level: 'info',
        event: 'topic_router_initialized',
        message: 'Topic auto-create disabled; using cached/default thread routing only',
      });
      return;
    }

    if (!(await this.ensureForumEnabled())) {
      return;
    }

    for (const domain of ['ops', 'jobs', 'alerts'] as const) {
      if (this.topicIds[domain]) continue;
      try {
        const topic = await this.telegram.createForumTopic({
          chat_id: this.config.chatId,
          name: this.config.topicNames[domain],
        });
        this.topicIds[domain] = topic.message_thread_id;
        this.audit.log({
          level: 'info',
          event: 'topic_router_topic_created',
          message: `Created topic for ${domain}`,
          chatId: this.config.chatId,
          threadId: topic.message_thread_id,
          details: {
            domain,
          },
        });
      } catch (error: unknown) {
        this.audit.log({
          level: 'warn',
          event: 'topic_router_topic_create_failed',
          message: `Failed creating topic for ${domain}; using fallback thread routing`,
          chatId: this.config.chatId,
          details: {
            domain,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    await this.persistState();

    this.audit.log({
      level: 'info',
      event: 'topic_router_initialized',
      message: 'Topic routing initialized',
      chatId: this.config.chatId,
      details: {
        topics: this.topicIds,
      },
    });
  }

  resolveThreadId(args: { domain: BotDomain; incomingThreadId?: number }): number | undefined {
    if (typeof args.incomingThreadId === 'number' && args.incomingThreadId > 0) {
      return args.incomingThreadId;
    }
    return this.topicIds[args.domain] ?? this.config.defaultThreadId;
  }

  async healStaleThread(args: {
    domain: BotDomain;
    staleThreadId: number;
  }): Promise<number | undefined> {
    if (this.topicIds[args.domain] === args.staleThreadId) {
      delete this.topicIds[args.domain];
    }
    await this.persistState();

    if (!this.config.topicAutoCreate) {
      return undefined;
    }
    if (!(await this.ensureForumEnabled())) {
      return undefined;
    }

    try {
      const topic = await this.telegram.createForumTopic({
        chat_id: this.config.chatId,
        name: this.config.topicNames[args.domain],
      });
      this.topicIds[args.domain] = topic.message_thread_id;
      await this.persistState();
      return topic.message_thread_id;
    } catch (error: unknown) {
      this.audit.log({
        level: 'warn',
        event: 'topic_router_topic_recreate_failed',
        message: `Failed recreating topic for ${args.domain}; using fallback thread routing`,
        chatId: this.config.chatId,
        details: {
          domain: args.domain,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return undefined;
    }
  }

  private async ensureForumEnabled(): Promise<boolean> {
    if (this.isForumEnabled === true) {
      return true;
    }
    if (this.isForumEnabled === false) {
      return false;
    }
    if (Date.now() < this.forumStatusRetryNotBeforeMs) {
      return false;
    }

    try {
      const chat = await this.telegram.getChat({ chat_id: this.config.chatId });
      this.isForumEnabled = chat.is_forum === true;
      this.forumStatusRetryNotBeforeMs = 0;
      if (!this.isForumEnabled) {
        this.audit.log({
          level: 'warn',
          event: 'topic_router_fallback_non_forum',
          message: 'Chat is not forum-enabled; falling back to default thread routing',
          chatId: this.config.chatId,
        });
      }
      return this.isForumEnabled;
    } catch (error: unknown) {
      this.forumStatusRetryNotBeforeMs = Date.now() + FORUM_STATUS_RETRY_DELAY_MS;
      this.audit.log({
        level: 'warn',
        event: 'topic_router_chat_lookup_failed',
        message: 'Could not verify forum status; falling back to cached/default thread routing',
        chatId: this.config.chatId,
        details: {
          retryAfterMs: FORUM_STATUS_RETRY_DELAY_MS,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  private async persistState(): Promise<void> {
    await saveTopicState(this.config.topicsStateFile, {
      version: 1,
      updatedAt: new Date().toISOString(),
      chatId: this.config.chatId,
      topics: this.topicIds,
    });
  }
}
