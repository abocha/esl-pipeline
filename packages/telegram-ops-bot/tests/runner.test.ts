import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobStatusDto, OpsActionStatus } from '@esl-pipeline/contracts';

import { TelegramOpsBotRunner } from '../src/runner.js';
import { resetGuidedConfirmGuardsForTests } from '../src/guided-ui.js';
import { TelegramApiError } from '../src/telegram-client.js';
import type { BotConfig, PollLeaderElection } from '../src/types.js';

function createConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    enabled: true,
    token: 'token',
    apiBaseUrl: 'https://api.telegram.org',
    mode: 'polling',
    webhookHost: '0.0.0.0',
    webhookPort: 8091,
    webhookPath: '/telegram/webhook',
    chatId: '123',
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
    topicAutoCreate: false,
    topicsStateFile: '/tmp/telegram-topic-state.json',
    topicNames: {
      ops: 'Ops',
      jobs: 'Jobs',
      alerts: 'Alerts',
    },
    ...overrides,
  };
}

function createUpdate(
  text: string,
  overrides?: {
    updateId?: number;
    fromUserId?: number;
    chatId?: number;
    chatType?: 'private' | 'supergroup';
    threadId?: number;
  },
) {
  return {
    update_id: overrides?.updateId ?? 1,
    message: {
      message_id: 11,
      date: 1_700_000_000,
      text,
      chat: { id: overrides?.chatId ?? 123, type: overrides?.chatType ?? 'private' },
      from: { id: overrides?.fromUserId ?? 1, is_bot: false, first_name: 'Ops' },
      ...(typeof overrides?.threadId === 'number' ? { message_thread_id: overrides.threadId } : {}),
    },
  };
}

function createCallbackUpdate(
  data: string,
  overrides?: {
    updateId?: number;
    callbackId?: string;
    fromUserId?: number;
    chatId?: number;
    chatType?: 'private' | 'supergroup';
    threadId?: number;
    messageId?: number;
  },
) {
  return {
    update_id: overrides?.updateId ?? 1,
    callback_query: {
      id: overrides?.callbackId ?? 'cb-1',
      from: { id: overrides?.fromUserId ?? 1, is_bot: false, first_name: 'Ops' },
      data,
      message: {
        message_id: overrides?.messageId ?? 42,
        date: 1_700_000_000,
        text: '/help',
        chat: { id: overrides?.chatId ?? 123, type: overrides?.chatType ?? 'supergroup' },
        ...(typeof overrides?.threadId === 'number'
          ? { message_thread_id: overrides.threadId }
          : {}),
      },
    },
  };
}

beforeEach(() => {
  resetGuidedConfirmGuardsForTests();
});

function createJob(overrides: Partial<JobStatusDto> = {}): JobStatusDto {
  return {
    jobId: 'job-1',
    studentId: null,
    md: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    preset: null,
    withTts: null,
    voiceId: null,
    upload: null,
    voiceAccent: null,
    forceTts: null,
    notionDatabase: null,
    publishTarget: null,
    ttsStrategy: null,
    autoPublish: null,
    notionUrl: null,
    anytypeUrl: null,
    htmlUrl: null,
    state: 'succeeded',
    createdAt: '2026-03-11T00:00:00Z',
    updatedAt: '2026-03-11T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
    ...overrides,
  };
}

function createRunner(args?: {
  config?: Partial<BotConfig>;
  sendHtmlMessage?: ReturnType<typeof vi.fn>;
  editHtmlMessage?: ReturnType<typeof vi.fn>;
  answerCallbackQuery?: ReturnType<typeof vi.fn>;
  getUpdates?: ReturnType<typeof vi.fn>;
  getMe?: ReturnType<typeof vi.fn>;
  backend?: Partial<{
    getOpsStatus: ReturnType<typeof vi.fn>;
    enqueueOpsAction: ReturnType<typeof vi.fn>;
    getOpsActionStatus: ReturnType<typeof vi.fn>;
    listOpsActions: ReturnType<typeof vi.fn>;
    getFinishedJobs: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  }>;
  topicRouter?: Partial<{
    initialize: ReturnType<typeof vi.fn>;
    resolveThreadId: ReturnType<typeof vi.fn>;
    healStaleThread: ReturnType<typeof vi.fn>;
  }>;
  auditLog?: ReturnType<typeof vi.fn>;
  leaderElection?: PollLeaderElection;
}): {
  runner: TelegramOpsBotRunner;
  sendHtmlMessage: ReturnType<typeof vi.fn>;
  backend: {
    getOpsStatus: ReturnType<typeof vi.fn>;
    enqueueOpsAction: ReturnType<typeof vi.fn>;
    getOpsActionStatus: ReturnType<typeof vi.fn>;
    listOpsActions: ReturnType<typeof vi.fn>;
    getFinishedJobs: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  };
  topicRouter: {
    initialize: ReturnType<typeof vi.fn>;
    resolveThreadId: ReturnType<typeof vi.fn>;
    healStaleThread: ReturnType<typeof vi.fn>;
  };
  auditLog: ReturnType<typeof vi.fn>;
} {
  const sendHtmlMessage =
    args?.sendHtmlMessage ??
    vi.fn(async (payload: { chatId: string; html: string }) => ({
      message_id: 77,
      date: 1_700_000_000,
      chat: { id: Number(payload.chatId), type: 'supergroup', title: 'Ops Chat' },
      text: payload.html,
    }));
  const getUpdates = args?.getUpdates ?? vi.fn(async () => []);
  const editHtmlMessage = args?.editHtmlMessage ?? vi.fn(async () => true);
  const answerCallbackQuery = args?.answerCallbackQuery ?? vi.fn(async () => true);
  const getMe =
    args?.getMe ??
    vi.fn(async () => ({
      id: 999,
      is_bot: true,
      first_name: 'ESL',
      username: 'esl_ops_bot',
    }));
  const backend = {
    getOpsStatus: args?.backend?.getOpsStatus ?? vi.fn(),
    enqueueOpsAction: args?.backend?.enqueueOpsAction ?? vi.fn(),
    getOpsActionStatus: args?.backend?.getOpsActionStatus ?? vi.fn(),
    listOpsActions: args?.backend?.listOpsActions ?? vi.fn(),
    getFinishedJobs: args?.backend?.getFinishedJobs ?? vi.fn(),
    getJob: args?.backend?.getJob ?? vi.fn(),
  };
  const topicRouter = {
    initialize: args?.topicRouter?.initialize ?? vi.fn(async () => {}),
    resolveThreadId: args?.topicRouter?.resolveThreadId ?? vi.fn(() => 77),
    healStaleThread: args?.topicRouter?.healStaleThread ?? vi.fn(async () => {}),
  };
  const auditLog = args?.auditLog ?? vi.fn();

  const runner = new TelegramOpsBotRunner({
    config: createConfig(args?.config),
    telegram: {
      getUpdates,
      getMe,
      sendHtmlMessage,
      editHtmlMessage,
      answerCallbackQuery,
    } as never,
    backend: backend as never,
    topicRouter: topicRouter as never,
    audit: { log: auditLog } as never,
    leaderElection: args?.leaderElection,
  });

  return {
    runner,
    sendHtmlMessage,
    backend,
    topicRouter,
    auditLog,
  };
}

async function processUpdate(
  runner: TelegramOpsBotRunner,
  update: ReturnType<typeof createUpdate> | ReturnType<typeof createCallbackUpdate>,
) {
  await (
    runner as unknown as {
      processUpdate: (
        u: ReturnType<typeof createUpdate> | ReturnType<typeof createCallbackUpdate>,
      ) => Promise<void>;
    }
  ).processUpdate(update);
}

describe('telegram runner mention handling', () => {
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
    const enqueueOpsAction = vi.fn(
      async (): Promise<OpsActionStatus> => ({
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
      }),
    );
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

    await processUpdate(runner, createUpdate('/status', { fromUserId: 1, chatId: 123, chatType: 'supergroup' }));
    await processUpdate(
      runner,
      createUpdate('/unknown', { fromUserId: 99, updateId: 2, chatId: 123, chatType: 'supergroup' }),
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
    const leaderElection: PollLeaderElection = {
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
    const leaderElection: PollLeaderElection = {
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
    const leaderElection: PollLeaderElection = {
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
    const leaderElection: PollLeaderElection = {
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
});

describe('telegram runner webhook mode', () => {
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

    await processUpdate(runner, createUpdate('/start', { fromUserId: 1, chatId: 999, chatType: 'private' }));

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

    await processUpdate(runner, createUpdate('/backup nightly', { chatId: 999, chatType: 'private' }));

    expect(enqueueOpsAction).toHaveBeenCalledTimes(0);
    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage.mock.calls[0]?.[0].chatId).toBe('999');
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('Private chat is limited to onboarding');
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

  it('renders guided callbacks by editing the existing ops-chat message', async () => {
    const editHtmlMessage = vi.fn(async () => true);
    const answerCallbackQuery = vi.fn(async () => true);
    const getOpsStatus = vi.fn(async () => ({
      checkedAtUtc: '2026-03-13T00:00:00Z',
      overall: { state: 'healthy', reasons: ['ok'] },
      thresholds: {
        backupMaxAgeHours: null,
        drillMaxAgeDays: null,
        keyRotationMaxAgeDays: null,
      },
      backup: {
        state: 'healthy',
        reason: 'ok',
        latestDumpKey: null,
        lastModifiedUtc: null,
        ageHours: null,
      },
      restoreDrill: {
        state: 'healthy',
        reason: 'ok',
        lastReportUtc: null,
        ageDays: null,
        reportStatus: null,
        reportMode: null,
        latestRemoteDumpKey: null,
        drillResult: null,
      },
      keyRotation: {
        state: 'healthy',
        reason: 'ok',
        iamUser: null,
        oldestAccessKeyId: null,
        oldestCreatedUtc: null,
        oldestAgeDays: null,
        oldestLastUsedUtc: null,
      },
    }));
    const { runner, sendHtmlMessage } = createRunner({
      editHtmlMessage,
      answerCallbackQuery,
      backend: {
        getOpsStatus,
      },
    });

    await processUpdate(runner, createCallbackUpdate('a4|s', { chatId: 123, chatType: 'supergroup' }));

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(editHtmlMessage).toHaveBeenCalledTimes(1);
    const firstEditCall = editHtmlMessage.mock.calls[0] as [{ html: string }] | undefined;
    expect(firstEditCall?.[0].html).toContain('Ops Status');
    expect(sendHtmlMessage).toHaveBeenCalledTimes(0);
  });

  it('falls back to a replacement message when callback edits are unavailable', async () => {
    const editHtmlMessage = vi.fn(async () => {
      throw new TelegramApiError("Bad Request: message can't be edited", 'editMessageText', 400);
    });
    const answerCallbackQuery = vi.fn(async () => true);
    const listOpsActions = vi.fn(async () => ({
      actions: [
        {
          operationId: 'op-1',
          action: 'backup_upload',
          state: 'succeeded',
          requestedAt: '2026-03-13T00:00:00Z',
          startedAt: '2026-03-13T00:01:00Z',
          finishedAt: '2026-03-13T00:02:00Z',
          requestedBy: 'ops@example.com',
          requestedByUserId: 'user-1',
          message: 'completed',
          command: 'backup',
          exitCode: 0,
          stdoutTail: null,
          stderrTail: null,
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    }));
    const sendHtmlMessage = vi.fn(async (payload: { chatId: string; html: string }) => ({
      message_id: 88,
      date: 1_700_000_000,
      chat: { id: Number(payload.chatId), type: 'supergroup', title: 'Ops Chat' },
      text: payload.html,
    }));
    const { runner } = createRunner({
      sendHtmlMessage,
      editHtmlMessage,
      answerCallbackQuery,
      backend: {
        listOpsActions,
      },
    });

    await processUpdate(runner, createCallbackUpdate('a4|r', { chatId: 123, chatType: 'supergroup' }));

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(editHtmlMessage).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('Recent operations');
  });

  it('replaces guided confirm panels after the first backup press', async () => {
    const editHtmlMessage = vi.fn(async () => true);
    const answerCallbackQuery = vi.fn(async () => true);
    const enqueueOpsAction = vi.fn(async () => ({
      operationId: 'op-confirm-1',
      action: 'backup_upload' as const,
      state: 'queued' as const,
      requestedAt: '2026-03-13T00:00:00Z',
      startedAt: null,
      finishedAt: null,
      requestedBy: 'telegram',
      requestedByUserId: 'user-1',
      message: 'queued',
      command: 'backup',
      exitCode: null,
      stdoutTail: null,
      stderrTail: null,
    }));
    const sendHtmlMessage = vi.fn(async (payload: { chatId: string; html: string }) => ({
      message_id: 88,
      date: 1_700_000_000,
      chat: { id: Number(payload.chatId), type: 'supergroup', title: 'Ops Chat' },
      text: payload.html,
    }));
    const { runner } = createRunner({
      sendHtmlMessage,
      editHtmlMessage,
      answerCallbackQuery,
      backend: {
        enqueueOpsAction,
      },
    });

    await processUpdate(
      runner,
      createCallbackUpdate('a4|c|backup', { chatId: 123, chatType: 'supergroup' }),
    );

    expect(enqueueOpsAction).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
    const editCall = editHtmlMessage.mock.calls[0] as
      | [{ html: string; replyMarkup?: { inline_keyboard: Array<Array<{ text: string }>> } }]
      | undefined;
    expect(editCall?.[0].html).toContain('request submitted');
    expect(editCall?.[0].replyMarkup?.inline_keyboard).toEqual([[{ text: 'Home', callback_data: 'a4|h' }]]);
  });

  it('deduplicates rapid duplicate confirm callbacks before executing backup side effects', async () => {
    const editHtmlMessage = vi.fn(async () => true);
    const answerCallbackQuery = vi.fn(async () => true);
    const enqueueOpsAction = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        operationId: 'op-confirm-race',
        action: 'backup_upload' as const,
        state: 'queued' as const,
        requestedAt: '2026-03-13T00:00:00Z',
        startedAt: null,
        finishedAt: null,
        requestedBy: 'telegram',
        requestedByUserId: 'user-1',
        message: 'queued',
        command: 'backup',
        exitCode: null,
        stdoutTail: null,
        stderrTail: null,
      };
    });
    const sendHtmlMessage = vi.fn(async (payload: { chatId: string; html: string }) => ({
      message_id: 90,
      date: 1_700_000_000,
      chat: { id: Number(payload.chatId), type: 'supergroup', title: 'Ops Chat' },
      text: payload.html,
    }));
    const { runner } = createRunner({
      sendHtmlMessage,
      editHtmlMessage,
      answerCallbackQuery,
      backend: {
        enqueueOpsAction,
      },
    });

    await Promise.all([
      processUpdate(
        runner,
        createCallbackUpdate('a4|c|backup', {
          callbackId: 'cb-race-1',
          chatId: 123,
          chatType: 'supergroup',
          messageId: 500,
        }),
      ),
      processUpdate(
        runner,
        createCallbackUpdate('a4|c|backup', {
          callbackId: 'cb-race-2',
          chatId: 123,
          chatType: 'supergroup',
          messageId: 500,
        }),
      ),
    ]);

    expect(enqueueOpsAction).toHaveBeenCalledTimes(1);
    expect(answerCallbackQuery).toHaveBeenCalledTimes(2);
    expect(editHtmlMessage).toHaveBeenCalledTimes(2);
  });

  it('routes callback edit fallbacks through topic healing for stale threads', async () => {
    const editHtmlMessage = vi.fn(async () => {
      throw new TelegramApiError('Bad Request: message thread not found', 'editMessageText', 400);
    });
    const answerCallbackQuery = vi.fn(async () => true);
    const getOpsStatus = vi.fn(async () => ({
      checkedAtUtc: '2026-03-13T00:00:00Z',
      overall: { state: 'healthy', reasons: ['ok'] },
      thresholds: {
        backupMaxAgeHours: null,
        drillMaxAgeDays: null,
        keyRotationMaxAgeDays: null,
      },
      backup: {
        state: 'healthy',
        reason: 'ok',
        latestDumpKey: null,
        lastModifiedUtc: null,
        ageHours: null,
      },
      restoreDrill: {
        state: 'healthy',
        reason: 'ok',
        lastReportUtc: null,
        ageDays: null,
        reportStatus: null,
        reportMode: null,
        latestRemoteDumpKey: null,
        drillResult: null,
      },
      keyRotation: {
        state: 'healthy',
        reason: 'ok',
        iamUser: null,
        oldestAccessKeyId: null,
        oldestCreatedUtc: null,
        oldestAgeDays: null,
        oldestLastUsedUtc: null,
      },
    }));
    const sendHtmlMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new TelegramApiError('Bad Request: message thread not found', 'sendMessage', 400),
      )
      .mockResolvedValue({
        message_id: 89,
        date: 1_700_000_000,
        chat: { id: 123, type: 'supergroup', title: 'Ops Chat' },
        text: 'fallback',
      });
    const healStaleThread = vi.fn(async () => 991);
    const { runner, topicRouter, auditLog } = createRunner({
      sendHtmlMessage,
      editHtmlMessage,
      answerCallbackQuery,
      backend: {
        getOpsStatus,
      },
      topicRouter: {
        healStaleThread,
      },
    });

    await processUpdate(
      runner,
      createCallbackUpdate('a4|s', {
        chatId: 123,
        chatType: 'supergroup',
        threadId: 77,
      }),
    );

    expect(healStaleThread).toHaveBeenCalledWith({
      domain: 'ops',
      staleThreadId: 77,
    });
    expect(sendHtmlMessage).toHaveBeenCalledTimes(2);
    expect(sendHtmlMessage.mock.calls[1]?.[0].threadId).toBe(991);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'callback_edit_fallback_used',
      }),
    );
  });
});

describe('telegram runner /share smoke', () => {
  it('uses markdown-first extraction precedence and preserves ordering + preview flags', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><head><title>Fallback Title</title></head><body>ignored</body></html>', {
        status: 200,
      }),
    );

    const { runner, backend, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-md-first',
            md: [
              '---',
              'title: "Homework Assignment: Markdown First"',
              'icon: "📘"',
              '---',
              '[Audio recording: Study Text](https://bucket.s3.amazonaws.com/audio/final/md-first-study.mp3)',
              '[Audio recording: Pronunciation Shadow Sentence](https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/md-first-pron.mp3)',
            ].join('\n'),
            htmlUrl: 'https://example.com/fallback-if-needed.html',
          }),
        ),
      },
    });

    await processUpdate(runner, createUpdate('/share job-md-first', { chatId: 123, chatType: 'supergroup' }));

    expect(backend.getJob).toHaveBeenCalledWith('job-md-first');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendHtmlMessage).toHaveBeenCalledTimes(3);
    expect(sendHtmlMessage.mock.calls[0]?.[0].disableLinkPreview).toBe(true);
    expect(sendHtmlMessage.mock.calls[1]?.[0].disableLinkPreview).toBe(false);
    expect(sendHtmlMessage.mock.calls[2]?.[0].disableLinkPreview).toBe(false);
    expect(sendHtmlMessage.mock.calls[1]?.[0].html).toContain('🎧 Listen 1: Study Text');
    expect(sendHtmlMessage.mock.calls[2]?.[0].html).toContain('🗣️ Listen 2: Pronunciation');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share_path_telemetry',
        details: expect.objectContaining({
          usedHtmlFallback: false,
          studyAudioSource: 'markdown_label',
          pronunciationAudioSource: 'markdown_label',
        }),
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'command_outcome',
        details: expect.objectContaining({
          status: 'completed',
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('falls back to html extraction when markdown content is unavailable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        [
          '<html><head><title>Homework Assignment: Html Fallback</title></head><body>',
          '<div class="hero-emoji">🏢</div>',
          'https://bucket.s3.amazonaws.com/audio/final/html-study.mp3',
          'https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/html-pron.mp3',
          '</body></html>',
        ].join('\n'),
        { status: 200 },
      ),
    );

    const { runner, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-html-fallback',
            md: '/tmp/does-not-exist.md',
            htmlUrl: 'https://example.com/share-fallback.html',
          }),
        ),
      },
    });

    await processUpdate(
      runner,
      createUpdate('/share job-html-fallback', { chatId: 123, chatType: 'supergroup' }),
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(sendHtmlMessage).toHaveBeenCalledTimes(3);
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('🏢 Homework Assignment: Html Fallback');
    expect(sendHtmlMessage.mock.calls[1]?.[0].html).toContain('audio/final/html-study.mp3');
    expect(sendHtmlMessage.mock.calls[2]?.[0].html).toContain(
      'audio/pronunciation-shadow/html-pron.mp3',
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share_path_telemetry',
        details: expect.objectContaining({
          usedHtmlFallback: true,
          studyAudioSource: 'html_path',
          pronunciationAudioSource: 'html_path',
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('keeps markdown path-hint audio precedence over competing html audio urls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        [
          '<html><head><title>Homework Assignment: Html Title</title></head><body>',
          'https://bucket.s3.amazonaws.com/audio/final/html-should-not-win.mp3',
          'https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/html-should-not-win.mp3',
          '</body></html>',
        ].join('\n'),
        { status: 200 },
      ),
    );

    const { runner, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-md-path-precedence',
            md: [
              'content without heading title to trigger html title fallback',
              'https://bucket.s3.amazonaws.com/audio/final/md-path-study.mp3',
              'https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/md-path-pron.mp3',
            ].join('\n'),
            htmlUrl: 'https://example.com/share-md-path-precedence.html',
          }),
        ),
      },
    });

    await processUpdate(
      runner,
      createUpdate('/share job-md-path-precedence', { chatId: 123, chatType: 'supergroup' }),
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(sendHtmlMessage).toHaveBeenCalledTimes(3);
    expect(sendHtmlMessage.mock.calls[0]?.[0].disableLinkPreview).toBe(true);
    expect(sendHtmlMessage.mock.calls[1]?.[0].disableLinkPreview).toBe(false);
    expect(sendHtmlMessage.mock.calls[2]?.[0].disableLinkPreview).toBe(false);
    expect(sendHtmlMessage.mock.calls[1]?.[0].html).toContain('audio/final/md-path-study.mp3');
    expect(sendHtmlMessage.mock.calls[2]?.[0].html).toContain(
      'audio/pronunciation-shadow/md-path-pron.mp3',
    );
    expect(sendHtmlMessage.mock.calls[1]?.[0].html).not.toContain('html-should-not-win.mp3');
    expect(sendHtmlMessage.mock.calls[2]?.[0].html).not.toContain('html-should-not-win.mp3');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share_path_telemetry',
        details: expect.objectContaining({
          studyAudioSource: 'markdown_path',
          pronunciationAudioSource: 'markdown_path',
        }),
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bot_metric',
        details: expect.objectContaining({
          metric: 'share_extraction_source',
          labels: expect.objectContaining({
            source: 'markdown_path',
          }),
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('degrades gracefully when audio links are missing', async () => {
    const { runner, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-no-audio',
            htmlUrl: 'https://example.com/no-audio.html',
          }),
        ),
      },
    });

    await processUpdate(runner, createUpdate('/share job-no-audio', { chatId: 123, chatType: 'supergroup' }));

    expect(sendHtmlMessage).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage.mock.calls[0]?.[0].disableLinkPreview).toBe(true);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share_path_telemetry',
        details: expect.objectContaining({
          missingStudyAudio: true,
          missingPronunciationAudio: true,
          missingAudioCount: 2,
        }),
      }),
    );
  });

  it('heals stale thread with bounded retries and fallback without infinite looping', async () => {
    const sendHtmlMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new TelegramApiError('Bad Request: message thread not found', 'sendMessage', 400),
      )
      .mockRejectedValueOnce(
        new TelegramApiError('Bad Request: message thread not found', 'sendMessage', 400),
      )
      .mockResolvedValueOnce({
        message_id: 33,
      });
    const healStaleThread = vi.fn(async () => {});

    const { runner, auditLog } = createRunner({
      config: {
        defaultThreadId: 999,
      },
      sendHtmlMessage,
      topicRouter: {
        resolveThreadId: vi.fn(() => 333),
        healStaleThread,
      },
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-heal',
            htmlUrl: 'https://example.com/no-audio-heal.html',
          }),
        ),
      },
    });

    await processUpdate(runner, createUpdate('/share job-heal', { chatId: 123, chatType: 'supergroup' }));

    expect(healStaleThread).toHaveBeenCalledWith({
      domain: 'jobs',
      staleThreadId: 333,
    });
    expect(healStaleThread).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage).toHaveBeenCalledTimes(3);
    expect(sendHtmlMessage.mock.calls[0]?.[0].threadId).toBe(333);
    expect(sendHtmlMessage.mock.calls[1]?.[0].threadId).toBe(999);
    expect(sendHtmlMessage.mock.calls[2]?.[0].threadId).toBeUndefined();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'topic_stale_detected',
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'topic_heal_fallback',
      }),
    );
  });

  it('emits topic_recreated event when stale thread healing recreates a topic successfully', async () => {
    const sendHtmlMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new TelegramApiError('Bad Request: message thread not found', 'sendMessage', 400),
      )
      .mockResolvedValueOnce({
        message_id: 44,
      });
    const healStaleThread = vi.fn(async () => 444);

    const { runner, auditLog } = createRunner({
      sendHtmlMessage,
      topicRouter: {
        resolveThreadId: vi.fn(() => 333),
        healStaleThread,
      },
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-heal-success',
            htmlUrl: 'https://example.com/heal-success.html',
          }),
        ),
      },
    });

    await processUpdate(
      runner,
      createUpdate('/share job-heal-success', { chatId: 123, chatType: 'supergroup' }),
    );

    expect(healStaleThread).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage).toHaveBeenCalledTimes(2);
    expect(sendHtmlMessage.mock.calls[0]?.[0].threadId).toBe(333);
    expect(sendHtmlMessage.mock.calls[1]?.[0].threadId).toBe(444);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'topic_recreated',
        threadId: 444,
      }),
    );
  });
});
