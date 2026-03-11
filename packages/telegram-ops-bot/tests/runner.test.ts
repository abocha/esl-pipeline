import { describe, expect, it, vi } from 'vitest';

import type { OpsActionStatus } from '@esl-pipeline/contracts';

import { TelegramOpsBotRunner } from '../src/runner.js';
import type { BotConfig } from '../src/types.js';

function createConfig(): BotConfig {
  return {
    enabled: true,
    token: 'token',
    chatId: '123',
    backendBaseUrl: 'http://localhost:8080',
    backendEmail: 'bot@example.com',
    backendPassword: 'secret',
    backendTimeoutMs: 1000,
    allowedUserIds: new Set([1]),
    pollIntervalMs: 100,
    pollTimeoutSeconds: 1,
    commandWindowMs: 60_000,
    maxCommandsPerWindow: 20,
    enableActionCommands: true,
    skipPendingUpdatesOnStartup: true,
    topicAutoCreate: false,
    topicsStateFile: '/tmp/telegram-topic-state.json',
    topicNames: {
      ops: 'Ops',
      jobs: 'Jobs',
      alerts: 'Alerts',
    },
  };
}

function createUpdate(text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 11,
      date: 1_700_000_000,
      text,
      chat: { id: 123, type: 'private' },
      from: { id: 1, is_bot: false, first_name: 'Ops' },
    },
  };
}

describe('telegram runner mention handling', () => {
  it('initializes poll offset from latest pending update', async () => {
    const runner = new TelegramOpsBotRunner({
      config: createConfig(),
      telegram: {
        getUpdates: vi.fn(async () => [
          {
            update_id: 101,
            message: {
              message_id: 11,
              date: 1_700_000_000,
              text: '/status',
              chat: { id: 123, type: 'private' },
              from: { id: 1, is_bot: false, first_name: 'Ops' },
            },
          },
        ]),
        getMe: vi.fn(async () => ({ id: 999, is_bot: true, first_name: 'ESL', username: 'esl_ops_bot' })),
        sendHtmlMessage: vi.fn(async () => {}),
      } as never,
      backend: {
        getOpsStatus: vi.fn(),
        enqueueOpsAction: vi.fn(),
        getOpsActionStatus: vi.fn(),
        getFinishedJobs: vi.fn(),
        getJob: vi.fn(),
      },
      topicRouter: {
        initialize: vi.fn(async () => {}),
        resolveThreadId: vi.fn(() => 77),
      },
      audit: { log: vi.fn() },
    });

    await (
      runner as unknown as {
        initializeUpdateOffsetFromLatestPending: () => Promise<void>;
      }
    ).initializeUpdateOffsetFromLatestPending();

    expect((runner as unknown as { updateOffset: number }).updateOffset).toBe(102);
  });

  it('ignores commands explicitly addressed to another bot', async () => {
    const enqueueOpsAction = vi.fn();
    const sendHtmlMessage = vi.fn(async () => {});

    const runner = new TelegramOpsBotRunner({
      config: createConfig(),
      telegram: {
        getUpdates: vi.fn(async () => []),
        getMe: vi.fn(async () => ({ id: 999, is_bot: true, first_name: 'ESL', username: 'esl_ops_bot' })),
        sendHtmlMessage,
      } as never,
      backend: {
        getOpsStatus: vi.fn(),
        enqueueOpsAction,
        getOpsActionStatus: vi.fn(),
        getFinishedJobs: vi.fn(),
        getJob: vi.fn(),
      },
      topicRouter: {
        initialize: vi.fn(async () => {}),
        resolveThreadId: vi.fn(() => 77),
      },
      audit: { log: vi.fn() },
    });

    (runner as unknown as { botUsername: string | null }).botUsername = 'esl_ops_bot';
    await (runner as unknown as { processUpdate: (update: unknown) => Promise<void> }).processUpdate(
      createUpdate('/backup@another_bot nightly'),
    );

    expect(enqueueOpsAction).toHaveBeenCalledTimes(0);
    expect(sendHtmlMessage).toHaveBeenCalledTimes(0);
  });

  it('executes commands addressed to this bot', async () => {
    const enqueueOpsAction = vi.fn(async (): Promise<OpsActionStatus> => ({
      operationId: 'op-1',
      action: 'backup_upload',
      state: 'queued',
      requestedAt: '2026-03-11T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      requestedBy: 'telegram',
      requestedByUserId: 'user-1',
      message: 'queued',
      command: 'echo backup',
      exitCode: null,
      stdoutTail: null,
      stderrTail: null,
    }));
    const sendHtmlMessage = vi.fn(async () => {});

    const runner = new TelegramOpsBotRunner({
      config: createConfig(),
      telegram: {
        getUpdates: vi.fn(async () => []),
        getMe: vi.fn(async () => ({ id: 999, is_bot: true, first_name: 'ESL', username: 'esl_ops_bot' })),
        sendHtmlMessage,
      } as never,
      backend: {
        getOpsStatus: vi.fn(),
        enqueueOpsAction,
        getOpsActionStatus: vi.fn(),
        getFinishedJobs: vi.fn(),
        getJob: vi.fn(),
      },
      topicRouter: {
        initialize: vi.fn(async () => {}),
        resolveThreadId: vi.fn(() => 77),
      },
      audit: { log: vi.fn() },
    });

    (runner as unknown as { botUsername: string | null }).botUsername = 'esl_ops_bot';
    await (runner as unknown as { processUpdate: (update: unknown) => Promise<void> }).processUpdate(
      createUpdate('/backup@esl_ops_bot nightly'),
    );

    expect(enqueueOpsAction).toHaveBeenCalledTimes(1);
    expect(enqueueOpsAction).toHaveBeenCalledWith({
      action: 'backup_upload',
      label: 'nightly',
    });
    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
  });
});
