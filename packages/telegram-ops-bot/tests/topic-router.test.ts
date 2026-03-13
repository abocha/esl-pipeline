import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForumTopicRouter } from '../src/topic-router.js';
import type { BotConfig } from '../src/types.js';

function createConfig(stateFile: string): BotConfig {
  return {
    enabled: true,
    token: 'token',
    apiBaseUrl: 'https://api.telegram.org',
    mode: 'polling',
    webhookHost: '0.0.0.0',
    webhookPort: 8091,
    webhookPath: '/telegram/webhook',
    chatId: '-100123',
    backendBaseUrl: 'http://localhost:8080',
    backendEmail: 'bot@example.com',
    backendPassword: 'secret',
    backendTimeoutMs: 1000,
    leaderElectionEnabled: false,
    allowedUserIds: new Set([1]),
    pollIntervalMs: 100,
    pollTimeoutSeconds: 1,
    commandWindowMs: 60_000,
    maxCommandsPerWindow: 20,
    enableActionCommands: true,
    skipPendingUpdatesOnStartup: true,
    topicAutoCreate: true,
    defaultThreadId: 999,
    topicsStateFile: stateFile,
    topicNames: {
      ops: 'Ops',
      jobs: 'Jobs',
      alerts: 'Alerts',
    },
  };
}

describe('topic router', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates missing topics and persists state', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'telegram-topic-router-'));
    const stateFile = path.join(dir, 'topics.json');

    const telegram = {
      getChat: vi.fn(async () => ({ is_forum: true })),
      createForumTopic: vi
        .fn()
        .mockResolvedValueOnce({ message_thread_id: 101 })
        .mockResolvedValueOnce({ message_thread_id: 202 })
        .mockResolvedValueOnce({ message_thread_id: 303 }),
    };

    const audit = { log: vi.fn() };

    const router = new ForumTopicRouter({
      config: createConfig(stateFile),
      telegram: telegram as never,
      audit,
    });

    await router.initialize();

    expect(router.resolveThreadId({ domain: 'ops' })).toBe(101);
    expect(router.resolveThreadId({ domain: 'jobs' })).toBe(202);
    expect(router.resolveThreadId({ domain: 'alerts' })).toBe(303);

    const state = JSON.parse(await readFile(stateFile, 'utf8')) as {
      topics: Record<string, number>;
    };
    expect(state.topics.ops).toBe(101);
    expect(state.topics.jobs).toBe(202);
    expect(state.topics.alerts).toBe(303);
  });

  it('falls back to default thread when chat is not forum-enabled', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'telegram-topic-router-fallback-'));
    const stateFile = path.join(dir, 'topics.json');

    const telegram = {
      getChat: vi.fn(async () => ({ is_forum: false })),
      createForumTopic: vi.fn(),
    };

    const router = new ForumTopicRouter({
      config: createConfig(stateFile),
      telegram: telegram as never,
      audit: { log: vi.fn() },
    });

    await router.initialize();

    expect(router.resolveThreadId({ domain: 'ops' })).toBe(999);
    expect(telegram.createForumTopic).not.toHaveBeenCalled();
  });

  it('heals stale topic by invalidating cached mapping and recreating one topic', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'telegram-topic-router-heal-'));
    const stateFile = path.join(dir, 'topics.json');
    const cachedState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      chatId: '-100123',
      topics: {
        ops: 111,
        jobs: 222,
        alerts: 444,
      },
    };
    await writeFile(stateFile, `${JSON.stringify(cachedState)}\n`, 'utf8');

    const telegram = {
      getChat: vi.fn(async () => ({ is_forum: true })),
      createForumTopic: vi.fn(async () => ({ message_thread_id: 333 })),
    };

    const router = new ForumTopicRouter({
      config: createConfig(stateFile),
      telegram: telegram as never,
      audit: { log: vi.fn() },
    });

    await router.initialize();
    const recreated = await router.healStaleThread({
      domain: 'jobs',
      staleThreadId: 222,
    });

    expect(recreated).toBe(333);
    expect(router.resolveThreadId({ domain: 'jobs' })).toBe(333);
    expect(telegram.createForumTopic).toHaveBeenCalledTimes(1);
  });

  it('persists stale mapping removal when topic recreation fails and returns undefined', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'telegram-topic-router-heal-fail-'));
    const stateFile = path.join(dir, 'topics.json');
    const cachedState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      chatId: '-100123',
      topics: {
        ops: 111,
        jobs: 222,
        alerts: 333,
      },
    };
    await writeFile(stateFile, `${JSON.stringify(cachedState)}\n`, 'utf8');

    const createForumTopic = vi.fn(async () => {
      throw new Error('createForumTopic failed');
    });
    const audit = { log: vi.fn() };
    const telegram = {
      getChat: vi.fn(async () => ({ is_forum: true })),
      createForumTopic,
    };

    const router = new ForumTopicRouter({
      config: createConfig(stateFile),
      telegram: telegram as never,
      audit,
    });

    await router.initialize();
    const recreated = await router.healStaleThread({
      domain: 'jobs',
      staleThreadId: 222,
    });

    expect(recreated).toBeUndefined();
    expect(createForumTopic).toHaveBeenCalledTimes(1);
    expect(router.resolveThreadId({ domain: 'jobs' })).toBe(999);
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as {
      topics: Partial<Record<'ops' | 'jobs' | 'alerts', number>>;
    };
    expect(state.topics.jobs).toBeUndefined();
    expect(state.topics.ops).toBe(111);
    expect(state.topics.alerts).toBe(333);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'topic_router_topic_recreate_failed',
      }),
    );
  });

  it('retries forum detection after transient getChat failures', async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(path.join(tmpdir(), 'telegram-topic-router-retry-'));
    const stateFile = path.join(dir, 'topics.json');

    const telegram = {
      getChat: vi
        .fn()
        .mockRejectedValueOnce(new Error('transient lookup error'))
        .mockResolvedValue({ is_forum: true }),
      createForumTopic: vi.fn(async () => ({ message_thread_id: 555 })),
    };

    const router = new ForumTopicRouter({
      config: createConfig(stateFile),
      telegram: telegram as never,
      audit: { log: vi.fn() },
    });

    await router.initialize();
    expect(telegram.getChat).toHaveBeenCalledTimes(1);
    expect(telegram.createForumTopic).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(31_000);
    const recreated = await router.healStaleThread({
      domain: 'ops',
      staleThreadId: 111,
    });

    expect(recreated).toBe(555);
    expect(telegram.getChat).toHaveBeenCalledTimes(2);
    expect(telegram.createForumTopic).toHaveBeenCalledTimes(1);
  });
});
