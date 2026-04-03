import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetGuidedConfirmGuardsForTests } from '../src/guided-ui.js';
import { createRunner, createUpdate, processUpdate } from './telegram-test-fixtures.js';

beforeEach(() => {
  resetGuidedConfirmGuardsForTests();
});

describe('telegram runner polling and auth', () => {
  it('initializes poll offset from latest pending update', async () => {
    const { runner } = createRunner({
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
    const { runner, sendHtmlMessage } = createRunner({
      backend: {
        enqueueOpsAction,
      },
    });

    (runner as unknown as { botUsername: string | null }).botUsername = 'esl_ops_bot';
    await processUpdate(
      runner,
      createUpdate('/backup@another_bot nightly', { chatId: 123, chatType: 'supergroup' }),
    );

    expect(enqueueOpsAction).toHaveBeenCalledTimes(0);
    expect(sendHtmlMessage).toHaveBeenCalledTimes(0);
  });

  it('executes commands addressed to this bot', async () => {
    const enqueueOpsAction = vi.fn(async () => ({
      operationId: 'op-1',
      action: 'backup_upload' as const,
      state: 'queued' as const,
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
    const { runner, sendHtmlMessage } = createRunner({
      backend: {
        enqueueOpsAction,
      },
    });

    (runner as unknown as { botUsername: string | null }).botUsername = 'esl_ops_bot';
    await processUpdate(
      runner,
      createUpdate('/backup@esl_ops_bot nightly', { chatId: 123, chatType: 'supergroup' }),
    );

    expect(enqueueOpsAction).toHaveBeenCalledWith({
      action: 'backup_upload',
      label: 'nightly',
    });
    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
  });

  it('emits denied and unknown command outcome metrics', async () => {
    const { runner, auditLog } = createRunner({
      config: {
        allowedUserIds: new Set([99]),
      },
    });

    await processUpdate(
      runner,
      createUpdate('/status', { fromUserId: 1, chatId: 123, chatType: 'supergroup' }),
    );
    await processUpdate(
      runner,
      createUpdate('/unknown', {
        fromUserId: 99,
        updateId: 2,
        chatId: 123,
        chatType: 'supergroup',
      }),
    );

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bot_metric',
        details: expect.objectContaining({
          metric: 'command_outcome',
          labels: expect.objectContaining({
            status: 'denied_not_allowed',
            command: 'status',
          }),
        }),
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bot_metric',
        details: expect.objectContaining({
          metric: 'command_outcome',
          labels: expect.objectContaining({
            status: 'unknown',
            command: 'unknown',
          }),
        }),
      }),
    );
  });

  it('emits denied_rate_limited command outcome metric', async () => {
    const { runner, auditLog } = createRunner({
      config: {
        maxCommandsPerWindow: 1,
      },
    });

    await processUpdate(
      runner,
      createUpdate('/help', { fromUserId: 1, updateId: 10, chatId: 123, chatType: 'supergroup' }),
    );
    await processUpdate(
      runner,
      createUpdate('/help', { fromUserId: 1, updateId: 11, chatId: 123, chatType: 'supergroup' }),
    );

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bot_metric',
        details: expect.objectContaining({
          metric: 'command_outcome',
          labels: expect.objectContaining({
            status: 'denied_rate_limited',
            command: 'help',
          }),
        }),
      }),
    );
  });

  it('does not initialize startup replay offset while this replica is standby follower', async () => {
    const getUpdates = vi.fn(async () => []);
    const leaderElection = {
      isLeader: vi.fn(async () => false),
      close: vi.fn(async () => {}),
    };
    const { runner } = createRunner({
      config: {
        mode: 'polling',
        skipPendingUpdatesOnStartup: true,
        pollIntervalMs: 10,
      },
      getUpdates,
      leaderElection,
    });

    const startPromise = runner.start();
    await new Promise((resolve) => setTimeout(resolve, 35));
    runner.stop();
    await startPromise;

    expect(getUpdates).toHaveBeenCalledTimes(0);
  });

  it('initializes startup replay offset when this replica starts as leader', async () => {
    const getUpdates = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [];
    });
    const leaderElection = {
      isLeader: vi.fn(async () => true),
      close: vi.fn(async () => {}),
    };
    const { runner } = createRunner({
      config: {
        mode: 'polling',
        skipPendingUpdatesOnStartup: true,
        pollIntervalMs: 10,
      },
      getUpdates,
      leaderElection,
    });

    const startPromise = runner.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    runner.stop();
    await startPromise;

    const calls = getUpdates.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls.some(([params]) => params.offset === -1 && params.limit === 1)).toBe(true);
  });

  it('does not treat pre-failover updates as startup backlog after becoming leader', async () => {
    const getUpdates = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [];
    });
    const isLeader = vi.fn(async () => false);
    isLeader.mockResolvedValueOnce(false);
    isLeader.mockResolvedValueOnce(false);
    isLeader.mockResolvedValue(true);
    const leaderElection = {
      isLeader,
      close: vi.fn(async () => {}),
    };
    const { runner } = createRunner({
      config: {
        mode: 'polling',
        skipPendingUpdatesOnStartup: true,
        pollIntervalMs: 10,
      },
      getUpdates,
      leaderElection,
    });

    const startPromise = runner.start();
    await new Promise((resolve) => setTimeout(resolve, 70));
    runner.stop();
    await startPromise;

    const calls = getUpdates.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls.some(([params]) => params.offset === -1 && params.limit === 1)).toBe(false);
    expect(calls.some(([params]) => typeof params.timeout === 'number')).toBe(true);
  });

  it('finalizes startup replay handling after leader-check failure and never late-skips backlog', async () => {
    const getUpdates = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [];
    });
    const isLeader = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('pg unavailable during startup'))
      .mockResolvedValue(true)
      .mockResolvedValue(true);
    const leaderElection = {
      isLeader,
      close: vi.fn(async () => {}),
    };
    const { runner, auditLog } = createRunner({
      config: {
        mode: 'polling',
        skipPendingUpdatesOnStartup: true,
        pollIntervalMs: 10,
      },
      getUpdates,
      leaderElection,
    });

    const startPromise = runner.start();
    await new Promise((resolve) => setTimeout(resolve, 75));
    runner.stop();
    await startPromise;

    const calls = getUpdates.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls.some(([params]) => params.offset === -1 && params.limit === 1)).toBe(false);
    expect(calls.some(([params]) => typeof params.timeout === 'number')).toBe(true);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'startup_replay_guard_skipped_unavailable',
      }),
    );
  });

  it('does not poll Telegram updates in webhook mode', async () => {
    const getUpdates = vi.fn(async () => []);
    const { runner } = createRunner({
      config: {
        mode: 'webhook',
        pollIntervalMs: 10,
      },
      getUpdates,
    });

    const startPromise = runner.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    runner.stop();
    await startPromise;

    expect(getUpdates).toHaveBeenCalledTimes(0);
  });

  it('allows private-chat /start for allowlisted operators', async () => {
    const { runner, sendHtmlMessage, auditLog } = createRunner();

    await processUpdate(runner, createUpdate('/start', { chatId: 999, chatType: 'private' }));

    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage.mock.calls[0]?.[0].chatId).toBe('999');
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('internal Telegram control surface');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bot_metric',
        details: expect.objectContaining({
          metric: 'ux_entry_usage',
          labels: expect.objectContaining({
            command: 'start',
            audience: 'private_onboarding',
          }),
        }),
      }),
    );
  });

  it('replies to non-allowlisted private-chat onboarding attempts in the DM only', async () => {
    const { runner, sendHtmlMessage, auditLog } = createRunner({
      config: {
        allowedUserIds: new Set([99]),
      },
    });

    await processUpdate(
      runner,
      createUpdate('/start', { fromUserId: 1, chatId: 999, chatType: 'private' }),
    );

    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage.mock.calls[0]?.[0].chatId).toBe('999');
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('Access denied');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'command_rejected_user_not_allowed',
        chatId: '999',
      }),
    );
  });

  it('rejects private-chat operational commands with a redirect', async () => {
    const enqueueOpsAction = vi.fn();
    const { runner, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        enqueueOpsAction,
      },
    });

    await processUpdate(
      runner,
      createUpdate('/backup nightly', { chatId: 999, chatType: 'private' }),
    );

    expect(enqueueOpsAction).toHaveBeenCalledTimes(0);
    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage.mock.calls[0]?.[0].chatId).toBe('999');
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain(
      'Private chat is limited to onboarding',
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'command_rejected_private_chat_scope',
      }),
    );
  });

  it('allows private-chat /help with onboarding-oriented copy', async () => {
    const { runner, sendHtmlMessage } = createRunner();

    await processUpdate(runner, createUpdate('/help', { chatId: 999, chatType: 'private' }));

    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage.mock.calls[0]?.[0].chatId).toBe('999');
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('ESL Ops Control Onboarding');
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('/start');
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('/help');
  });
});
