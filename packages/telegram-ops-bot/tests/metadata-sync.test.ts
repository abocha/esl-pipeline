import { describe, expect, it, vi } from 'vitest';

import { createCommandRegistry } from '../src/commands.js';
import { syncTelegramMetadataBestEffort } from '../src/metadata-sync.js';

describe('telegram metadata sync', () => {
  it('syncs private and ops command scopes plus descriptions and menu button', async () => {
    const telegram = {
      setMyCommands: vi.fn(async () => true),
      setMyDescription: vi.fn(async () => true),
      setMyShortDescription: vi.fn(async () => true),
      setChatMenuButton: vi.fn(async () => true),
    };
    const audit = { log: vi.fn() };
    const registry = createCommandRegistry();

    await syncTelegramMetadataBestEffort({
      telegram: telegram as never,
      config: {
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
        enableActionCommands: false,
        skipPendingUpdatesOnStartup: true,
        topicAutoCreate: false,
        topicsStateFile: '/tmp/topics.json',
        topicNames: { ops: 'Ops', jobs: 'Jobs', alerts: 'Alerts' },
      },
      audit,
      registry,
    });

    expect(telegram.setMyCommands).toHaveBeenCalledTimes(2);
    expect(telegram.setMyCommands).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        scope: { type: 'all_private_chats' },
        commands: [
          expect.objectContaining({ command: 'start' }),
          expect.objectContaining({ command: 'help' }),
        ],
      }),
    );
    expect(telegram.setMyCommands).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        scope: { type: 'chat', chat_id: '-100123' },
      }),
    );
    expect(telegram.setMyShortDescription).toHaveBeenCalledTimes(1);
    expect(telegram.setMyDescription).toHaveBeenCalledTimes(1);
    expect(telegram.setChatMenuButton).toHaveBeenCalledWith({
      menu_button: { type: 'commands' },
    });
  });

  it('logs warning-level failures and continues remaining sync steps', async () => {
    const telegram = {
      setMyCommands: vi
        .fn()
        .mockRejectedValueOnce(new Error('commands failed'))
        .mockResolvedValueOnce(true),
      setMyDescription: vi.fn(async () => true),
      setMyShortDescription: vi.fn(async () => true),
      setChatMenuButton: vi.fn(async () => true),
    };
    const audit = { log: vi.fn() };

    await syncTelegramMetadataBestEffort({
      telegram: telegram as never,
      config: {
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
        enableActionCommands: false,
        skipPendingUpdatesOnStartup: true,
        topicAutoCreate: false,
        topicsStateFile: '/tmp/topics.json',
        topicNames: { ops: 'Ops', jobs: 'Jobs', alerts: 'Alerts' },
      },
      audit,
      registry: createCommandRegistry(),
    });

    expect(telegram.setMyCommands).toHaveBeenCalledTimes(2);
    expect(telegram.setMyShortDescription).toHaveBeenCalledTimes(1);
    expect(telegram.setMyDescription).toHaveBeenCalledTimes(1);
    expect(telegram.setChatMenuButton).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'telegram_metadata_sync_failed',
        details: expect.objectContaining({
          step: 'set_my_commands_private',
        }),
      }),
    );
  });
});

