import { describe, expect, it, vi } from 'vitest';

import { createCommandRegistry, parseCommandText } from '../src/commands.js';
import type { CommandContext } from '../src/types.js';

function createBaseContext(overrides: Partial<CommandContext>): CommandContext {
  return {
    config: {
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
      topicsStateFile: '/tmp/telegram-topics.json',
      topicNames: {
        ops: 'Ops',
        jobs: 'Jobs',
        alerts: 'Alerts',
      },
      appBaseUrl: 'https://app.example.com',
    },
    backend: {
      getOpsStatus: vi.fn(),
      enqueueOpsAction: vi.fn(),
      getOpsActionStatus: vi.fn(),
      getFinishedJobs: vi.fn(),
      getJob: vi.fn(),
    },
    messenger: {
      sendHtmlMessage: vi.fn(async () => {}),
    },
    topicRouter: {
      initialize: vi.fn(async () => {}),
      resolveThreadId: vi.fn(() => 42),
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

describe('telegram commands', () => {
  it('parses slash commands with mentions and args', () => {
    expect(parseCommandText('/backup nightly smoke')).toEqual({
      command: 'backup',
      args: ['nightly', 'smoke'],
      mentionedBot: null,
    });
    expect(parseCommandText('/status@esl_ops_bot')).toEqual({
      command: 'status',
      args: [],
      mentionedBot: 'esl_ops_bot',
    });
    expect(parseCommandText('/status@Another_Bot')).toEqual({
      command: 'status',
      args: [],
      mentionedBot: 'another_bot',
    });
    expect(parseCommandText('hello')).toBeNull();
  });

  it('does not send command-local error response for /status failures', async () => {
    const registry = createCommandRegistry();
    const statusCommand = registry.resolve('status');
    expect(statusCommand).toBeDefined();

    const context = createBaseContext({
      command: 'status',
      args: [],
    });
    const statusMock = context.backend.getOpsStatus as ReturnType<typeof vi.fn>;
    statusMock.mockRejectedValue(new Error('status lookup failed'));

    await expect(statusCommand?.execute(context)).rejects.toThrow('status lookup failed');

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(0);
  });

  it('runs backup command and emits queued response', async () => {
    const registry = createCommandRegistry();
    const backupCommand = registry.resolve('backup');
    expect(backupCommand).toBeDefined();

    const context = createBaseContext({
      command: 'backup',
      args: ['nightly', 'smoke'],
    });

    const enqueueMock = context.backend.enqueueOpsAction as ReturnType<typeof vi.fn>;
    enqueueMock.mockResolvedValue({
      operationId: 'op-1',
      action: 'backup_upload',
      state: 'queued',
      requestedAt: '2026-03-11T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      requestedBy: 'telegram',
      requestedByUserId: 'u1',
      message: 'queued',
      command: 'cmd',
      exitCode: null,
      stdoutTail: null,
      stderrTail: null,
    });

    await backupCommand?.execute(context);

    expect(enqueueMock).toHaveBeenCalledWith({
      action: 'backup_upload',
      label: 'nightly smoke',
    });

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('op-1');

    const auditLogMock = context.audit.log as ReturnType<typeof vi.fn>;
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ops_action_enqueued',
        operationId: 'op-1',
        command: 'backup',
      }),
    );
  });

  it('blocks action commands in read-only mode', async () => {
    const registry = createCommandRegistry();
    const backupCommand = registry.resolve('backup');
    expect(backupCommand).toBeDefined();

    const base = createBaseContext({});
    const context = createBaseContext({
      config: {
        ...base.config,
        enableActionCommands: false,
      },
      command: 'backup',
      args: ['nightly'],
    });

    await backupCommand?.execute(context);

    const enqueueMock = context.backend.enqueueOpsAction as ReturnType<typeof vi.fn>;
    expect(enqueueMock).toHaveBeenCalledTimes(0);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('read-only mode');
  });

  it('runs /op and shows one operation status', async () => {
    const registry = createCommandRegistry();
    const opCommand = registry.resolve('op');
    expect(opCommand).toBeDefined();

    const context = createBaseContext({
      command: 'op',
      args: ['op-123'],
    });
    const getStatusMock = context.backend.getOpsActionStatus as ReturnType<typeof vi.fn>;
    getStatusMock.mockResolvedValue({
      operationId: 'op-123',
      action: 'backup_upload',
      state: 'running',
      requestedAt: '2026-03-11T00:00:00.000Z',
      startedAt: '2026-03-11T00:00:01.000Z',
      finishedAt: null,
      requestedBy: 'telegram',
      requestedByUserId: 'u1',
      message: 'Action started',
      command: 'bash scripts/docker/postgres-backup-s3.sh backup-upload',
      exitCode: null,
      stdoutTail: null,
      stderrTail: null,
    });

    await opCommand?.execute(context);

    expect(getStatusMock).toHaveBeenCalledWith('op-123');
    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('op-123');
    expect(sendMock.mock.calls[0]?.[0].html).toContain('running');
  });
});
