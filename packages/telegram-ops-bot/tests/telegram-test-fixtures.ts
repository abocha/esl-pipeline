import { vi } from 'vitest';

import type { JobStatusDto } from '@esl-pipeline/contracts';

import { TelegramOpsBotRunner } from '../src/runner.js';
import type { BotConfig, CommandContext, PollLeaderElection } from '../src/types.js';

export function createConfig(overrides: Partial<BotConfig> = {}): BotConfig {
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
    appBaseUrl: 'https://app.example.com',
    ...overrides,
  };
}

export function createBaseContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    config: createConfig(),
    backend: {
      getOpsStatus: vi.fn(),
      enqueueOpsAction: vi.fn(),
      getOpsActionStatus: vi.fn(),
      listOpsActions: vi.fn(),
      listJobs: vi.fn(),
      getAdminJobSummary: vi.fn(),
      listStudentSummaries: vi.fn(),
      searchStudents: vi.fn(),
      getFinishedJobs: vi.fn(),
      getJob: vi.fn(),
    },
    runtimeSnapshot: {
      initialized: true,
      botUsername: 'esl_ops_bot',
      mode: 'polling',
      leadershipState: 'not_applicable',
    },
    messenger: {
      sendHtmlMessage: vi.fn(async (args) => ({
        message_id: 99,
        date: 1,
        chat: { id: Number(args.chatId), type: 'supergroup', title: 'Ops Chat' },
        text: args.html,
      })),
    },
    topicRouter: {
      initialize: vi.fn(async () => {}),
      resolveThreadId: vi.fn(() => 42),
      healStaleThread: vi.fn(async () => {}),
    },
    audit: {
      log: vi.fn(),
    },
    update: {
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        text: '/help',
        chat: { id: 123, type: 'private' },
        from: { id: 1, is_bot: false, first_name: 'Ops' },
      },
    },
    message: {
      message_id: 1,
      date: 1,
      text: '/help',
      chat: { id: 123, type: 'private' },
      from: { id: 1, is_bot: false, first_name: 'Ops' },
    },
    fromUserId: 1,
    command: 'help',
    args: [],
    ...overrides,
  } as CommandContext;
}

export function createUpdate(
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

export function createCallbackUpdate(
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

export function createJob(overrides: Partial<JobStatusDto> = {}): JobStatusDto {
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

export function createRunner(args?: {
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
    listJobs: ReturnType<typeof vi.fn>;
    getAdminJobSummary: ReturnType<typeof vi.fn>;
    listStudentSummaries: ReturnType<typeof vi.fn>;
    searchStudents: ReturnType<typeof vi.fn>;
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
    listJobs: ReturnType<typeof vi.fn>;
    getAdminJobSummary: ReturnType<typeof vi.fn>;
    listStudentSummaries: ReturnType<typeof vi.fn>;
    searchStudents: ReturnType<typeof vi.fn>;
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
    listJobs: args?.backend?.listJobs ?? vi.fn(),
    getAdminJobSummary: args?.backend?.getAdminJobSummary ?? vi.fn(),
    listStudentSummaries: args?.backend?.listStudentSummaries ?? vi.fn(),
    searchStudents: args?.backend?.searchStudents ?? vi.fn(),
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

export async function processUpdate(
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
