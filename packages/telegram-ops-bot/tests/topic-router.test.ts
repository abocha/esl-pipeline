import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import { ForumTopicRouter } from '../src/topic-router.js';
import type { BotConfig } from '../src/types.js';

function createConfig(stateFile: string): BotConfig {
  return {
    enabled: true,
    token: 'token',
    chatId: '-100123',
    backendBaseUrl: 'http://localhost:8080',
    backendEmail: 'bot@example.com',
    backendPassword: 'secret',
    backendTimeoutMs: 1000,
    allowedUserIds: new Set([1]),
    pollIntervalMs: 100,
    pollTimeoutSeconds: 1,
    commandWindowMs: 60_000,
    maxCommandsPerWindow: 20,
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

    const state = JSON.parse(await readFile(stateFile, 'utf8')) as { topics: Record<string, number> };
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
});
