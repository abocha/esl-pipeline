import { describe, expect, it, vi } from 'vitest';

import type { BotConfig } from '../src/types.js';
import { startWebhookUpdateServer } from '../src/webhook-server.js';

function createConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    enabled: true,
    token: 'token',
    apiBaseUrl: 'https://api.telegram.org',
    mode: 'webhook',
    webhookHost: '127.0.0.1',
    webhookPort: 0,
    webhookPath: '/telegram/webhook',
    chatId: '123',
    backendBaseUrl: 'http://localhost:8080',
    backendEmail: 'bot@example.com',
    backendPassword: 'secret',
    backendTimeoutMs: 1_000,
    leaderElectionEnabled: false,
    allowedUserIds: new Set([1]),
    pollIntervalMs: 100,
    pollTimeoutSeconds: 1,
    commandWindowMs: 60_000,
    maxCommandsPerWindow: 20,
    enableActionCommands: false,
    skipPendingUpdatesOnStartup: true,
    topicAutoCreate: false,
    topicsStateFile: '/tmp/state.json',
    topicNames: {
      ops: 'Ops',
      jobs: 'Jobs',
      alerts: 'Alerts',
    },
    ...overrides,
  };
}

describe('webhook update server', () => {
  it('processes valid webhook updates', async () => {
    const onUpdate = vi.fn(async () => {});
    const audit = { log: vi.fn() };
    const server = await startWebhookUpdateServer({
      config: createConfig(),
      audit,
      onUpdate,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}${server.path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          update_id: 100,
          message: {
            message_id: 1,
            date: 1_700_000_000,
            text: '/status',
            chat: { id: 123, type: 'private' },
            from: { id: 1, is_bot: false, first_name: 'Ops' },
          },
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(onUpdate).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'webhook_listener_started',
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'webhook_listener_stopped',
      }),
    );
  });

  it('rejects invalid json payloads', async () => {
    const onUpdate = vi.fn(async () => {});
    const server = await startWebhookUpdateServer({
      config: createConfig(),
      audit: { log: vi.fn() },
      onUpdate,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}${server.path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: '{"update_id":',
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: 'invalid_json',
      });
      expect(onUpdate).toHaveBeenCalledTimes(0);
    } finally {
      await server.close();
    }
  });

  it('rejects webhook requests with missing/wrong secret token when configured', async () => {
    const onUpdate = vi.fn(async () => {});
    const server = await startWebhookUpdateServer({
      config: createConfig({
        webhookSecretToken: 'expected-token',
      }),
      audit: { log: vi.fn() },
      onUpdate,
    });

    try {
      const missing = await fetch(`http://127.0.0.1:${server.port}${server.path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(missing.status).toBe(403);

      const wrong = await fetch(`http://127.0.0.1:${server.port}${server.path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'wrong',
        },
        body: JSON.stringify({ update_id: 2 }),
      });
      expect(wrong.status).toBe(403);

      const right = await fetch(`http://127.0.0.1:${server.port}${server.path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'expected-token',
        },
        body: JSON.stringify({ update_id: 3 }),
      });
      expect(right.status).toBe(200);
      expect(onUpdate).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });
});
