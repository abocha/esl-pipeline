import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCommandRegistry,
  getAdvertisedCommands,
  parseCommandText,
  resetAdvancedControlApprovalsForTests,
} from '../src/commands.js';
import type { CommandContext } from '../src/types.js';
import { createBaseContext } from './telegram-test-fixtures.js';

describe('telegram commands - core', () => {
  beforeEach(() => {
    resetAdvancedControlApprovalsForTests();
  });

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

  it('runs /start with onboarding guidance in read-only mode', async () => {
    const registry = createCommandRegistry();
    const startCommand = registry.resolve('start');
    expect(startCommand).toBeDefined();

    const base = createBaseContext({});
    const context = createBaseContext({
      config: {
        ...base.config,
        enableActionCommands: false,
      },
      command: 'start',
      args: [],
    });

    await startCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('internal Telegram control surface');
    expect(sendMock.mock.calls[0]?.[0].html).toContain('read-only mode');
    expect(sendMock.mock.calls[0]?.[0].html).toContain('/help');

    const auditLogMock = context.audit.log as ReturnType<typeof vi.fn>;
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bot_metric',
        details: expect.objectContaining({
          metric: 'ux_entry_usage',
          labels: expect.objectContaining({
            command: 'start',
          }),
        }),
      }),
    );
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bot_metric',
        details: expect.objectContaining({
          metric: 'ux_response_latency_ms',
          labels: expect.objectContaining({
            command: 'start',
          }),
        }),
      }),
    );
  });

  it('renders guided /help in the ops chat with inline controls', async () => {
    const registry = createCommandRegistry();
    const helpCommand = registry.resolve('help');
    expect(helpCommand).toBeDefined();

    const context = createBaseContext({
      update: {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: '/help',
          chat: { id: 123, type: 'supergroup', title: 'Ops Chat', is_forum: true },
          from: { id: 1, is_bot: false, first_name: 'Ops' },
        },
      },
      message: {
        message_id: 1,
        date: 1,
        text: '/help',
        chat: { id: 123, type: 'supergroup', title: 'Ops Chat', is_forum: true },
        from: { id: 1, is_bot: false, first_name: 'Ops' },
      } as CommandContext['message'],
    });

    await helpCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('ESL Ops Control Panel');
    expect(sendMock.mock.calls[0]?.[0].replyMarkup).toEqual(
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({ text: 'Today' }),
            expect.objectContaining({ text: 'Students' }),
          ]),
        ]),
      }),
    );
  });

  it('filters advertised commands by runtime capability and audience', () => {
    const registry = createCommandRegistry();
    const base = createBaseContext({});

    const privateCommands = getAdvertisedCommands(
      registry.commands,
      base.config,
      'private_onboarding',
    ).map((command) => command.command);
    expect(privateCommands).toEqual(['start', 'help']);

    const readOnlyOpsCommands = getAdvertisedCommands(
      registry.commands,
      {
        ...base.config,
        enableActionCommands: false,
        mode: 'polling',
      },
      'ops_chat',
    ).map((command) => command.command);
    expect(readOnlyOpsCommands).toContain('help');
    expect(readOnlyOpsCommands).toContain('status');
    expect(readOnlyOpsCommands).toContain('students');
    expect(readOnlyOpsCommands).toContain('today');
    expect(readOnlyOpsCommands).not.toContain('start');
    expect(readOnlyOpsCommands).not.toContain('links');
    expect(readOnlyOpsCommands).not.toContain('backup');
    expect(readOnlyOpsCommands).not.toContain('integrity');
    expect(readOnlyOpsCommands).not.toContain('approve');

    const webhookOpsCommands = getAdvertisedCommands(
      registry.commands,
      {
        ...base.config,
        enableActionCommands: true,
        mode: 'webhook',
      },
      'ops_chat',
    ).map((command) => command.command);
    expect(webhookOpsCommands).toContain('backup');
    expect(webhookOpsCommands).toContain('integrity');
    expect(webhookOpsCommands).toContain('approve');
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

  it('renders /botstatus with degraded backend diagnostics', async () => {
    const registry = createCommandRegistry();
    const botstatusCommand = registry.resolve('botstatus');
    expect(botstatusCommand).toBeDefined();

    const base = createBaseContext({});
    const resolveThreadId = vi
      .fn()
      .mockImplementation(({ domain }: { domain: 'ops' | 'jobs' | 'alerts' }) =>
        domain === 'ops' ? 42 : domain === 'jobs' ? 99 : undefined,
      );
    const context = createBaseContext({
      config: {
        ...base.config,
        leaderElectionEnabled: true,
        defaultThreadId: 99,
      },
      runtimeSnapshot: {
        initialized: false,
        botUsername: 'esl_ops_bot',
        mode: 'polling',
        leadershipState: 'unknown',
      },
      topicRouter: {
        ...base.topicRouter,
        resolveThreadId,
      },
      command: 'botstatus',
      args: [],
    });
    const statusMock = context.backend.getOpsStatus as ReturnType<typeof vi.fn>;
    statusMock.mockRejectedValue(new Error('backend unavailable'));

    await botstatusCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Bot status: degraded');
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('backend unavailable');
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain(
      'jobs is using default thread routing',
    );
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain(
      'alerts has no resolved topic/default thread',
    );
  });
});
