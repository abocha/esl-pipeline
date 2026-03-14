import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryApprovalReplayStore } from '../src/approval-replay-store.js';
import {
  createCommandRegistry,
  getAdvertisedCommands,
  loadFinishedJobsView,
  loadJobsView,
  loadJobsViewFromKey,
  parseCommandText,
  resetAdvancedControlApprovalsForTests,
} from '../src/commands.js';
import type { CommandContext } from '../src/types.js';

function createBaseContext(overrides: Partial<CommandContext>): CommandContext {
  return {
    config: {
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

describe('telegram commands', () => {
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

  it('renders finished job buttons with student name and short student id', async () => {
    const context = createBaseContext({
      command: 'finished',
      args: [],
    });
    const getFinishedJobsMock = context.backend.getFinishedJobs as ReturnType<typeof vi.fn>;
    getFinishedJobsMock.mockResolvedValue({
      jobs: [
        {
          jobId: 'job-1',
          studentId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
          studentName: 'Margarita',
          md: null,
          recordingId: null,
          transcriptId: null,
          promptPackageId: null,
          draftId: null,
          preset: null,
          learningPresetId: 'general-english',
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
          state: 'succeeded',
          createdAt: '2026-03-14T08:46:42.494Z',
          updatedAt: '2026-03-14T08:47:06.373Z',
          startedAt: null,
          finishedAt: '2026-03-14T08:47:06.373Z',
          error: null,
          manifestPath: null,
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });

    const view = await loadFinishedJobsView(context);

    expect(view.replyMarkup).toEqual(
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [
            expect.objectContaining({
              text: 'Margarita · 72444fdf',
            }),
          ],
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

    const readOnlyOpsCommands = getAdvertisedCommands(registry.commands, {
      ...base.config,
      enableActionCommands: false,
      mode: 'polling',
    }, 'ops_chat').map((command) => command.command);
    expect(readOnlyOpsCommands).toContain('help');
    expect(readOnlyOpsCommands).toContain('status');
    expect(readOnlyOpsCommands).toContain('students');
    expect(readOnlyOpsCommands).toContain('today');
    expect(readOnlyOpsCommands).not.toContain('start');
    expect(readOnlyOpsCommands).not.toContain('links');
    expect(readOnlyOpsCommands).not.toContain('backup');
    expect(readOnlyOpsCommands).not.toContain('drill');
    expect(readOnlyOpsCommands).not.toContain('approve');

    const webhookOpsCommands = getAdvertisedCommands(registry.commands, {
      ...base.config,
      enableActionCommands: true,
      mode: 'webhook',
    }, 'ops_chat').map((command) => command.command);
    expect(webhookOpsCommands).toContain('backup');
    expect(webhookOpsCommands).toContain('drill');
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

  it('runs /job with Share but not Links in the detail keyboard', async () => {
    const registry = createCommandRegistry();
    const jobCommand = registry.resolve('job');
    expect(jobCommand).toBeDefined();

    const context = createBaseContext({
      command: 'job',
      args: ['job-42'],
    });

    const getJobMock = context.backend.getJob as ReturnType<typeof vi.fn>;
    getJobMock.mockResolvedValue({
      jobId: 'job-42',
      studentId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
      studentName: 'Margarita',
      md: null,
      recordingId: null,
      transcriptId: null,
      promptPackageId: null,
      draftId: null,
      preset: null,
      learningPresetId: 'general-english',
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
      createdAt: '2026-03-14T08:46:42.494Z',
      updatedAt: '2026-03-14T08:47:06.373Z',
      startedAt: null,
      finishedAt: '2026-03-14T08:47:06.373Z',
      error: null,
      manifestPath: null,
    });

    await jobCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    const markup = sendMock.mock.calls[0]?.[0].replyMarkup;
    const buttonTexts =
      markup?.inline_keyboard
        .flat()
        .map((button: { text: string }) => button.text) ?? [];
    expect(buttonTexts).toContain('Share');
    expect(buttonTexts).not.toContain('Links');
  });

  it('routes /links through the /share flow with deprecation copy', async () => {
    const registry = createCommandRegistry();
    const linksCommand = registry.resolve('links');
    expect(linksCommand).toBeDefined();

    const context = createBaseContext({
      command: 'links',
      args: ['job-42'],
    });

    const getJobMock = context.backend.getJob as ReturnType<typeof vi.fn>;
    getJobMock.mockResolvedValue({
      jobId: 'job-42',
      studentId: null,
      md: '[Audio recording: Study Text](https://bucket.s3.amazonaws.com/audio/final/study.mp3)',
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
      notionUrl: 'https://notion.so/assignment',
      anytypeUrl: null,
      htmlUrl: null,
      state: 'succeeded',
      createdAt: '2026-03-11T00:00:00Z',
      updatedAt: '2026-03-11T00:00:00Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    await linksCommand?.execute(context);

    expect(getJobMock).toHaveBeenCalledWith('job-42');
    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(4);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('Use <code>/share</code> going forward.');
    expect(sendMock.mock.calls[1]?.[0].html).toContain('<b>Share package</b>');
    expect(sendMock.mock.calls[2]?.[0].disableLinkPreview).toBe(true);
    expect(sendMock.mock.calls[2]?.[0].html).toContain(
      '<a href="https://notion.so/assignment">Homework Assignment',
    );
    expect(sendMock.mock.calls[3]?.[0].disableLinkPreview).toBe(false);
    expect(sendMock.mock.calls[3]?.[0].html).toContain('🎧 Listen 1: Study Text');
    expect(sendMock.mock.calls[3]?.[0].html).toContain('audio/final/study.mp3');
  });

  it('runs /links and falls back to htmlUrl when md is a file path', async () => {
    const registry = createCommandRegistry();
    const linksCommand = registry.resolve('links');
    expect(linksCommand).toBeDefined();

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          [
            '<html><head><title>Homework Assignment: Office Rules &amp; Modal Verbs</title></head><body>',
            '<div class="hero-emoji">🏢</div>',
            'https://bucket.s3.amazonaws.com/audio/final/from-html-study.mp3',
            'https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/from-html-pron.mp3',
            '</body></html>',
          ].join('\n'),
          { status: 200 },
        ),
      );

    const context = createBaseContext({
      command: 'links',
      args: ['job-77'],
    });

    const getJobMock = context.backend.getJob as ReturnType<typeof vi.fn>;
    getJobMock.mockResolvedValue({
      jobId: 'job-77',
      studentId: null,
      md: '/app/uploads/drafts/not-present.md',
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
      htmlUrl: 'https://example.com/assignment.html',
      state: 'succeeded',
      createdAt: '2026-03-11T00:00:00Z',
      updatedAt: '2026-03-11T00:00:00Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    await linksCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(5);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('Use <code>/share</code> going forward.');
    expect(sendMock.mock.calls[2]?.[0].disableLinkPreview).toBe(true);
    expect(sendMock.mock.calls[2]?.[0].html).toContain(
      '<a href="https://example.com/assignment.html">🏢 Homework Assignment: Office Rules &amp; Modal Verbs</a>',
    );
    expect(sendMock.mock.calls[3]?.[0].disableLinkPreview).toBe(false);
    expect(sendMock.mock.calls[4]?.[0].disableLinkPreview).toBe(false);
    expect(sendMock.mock.calls[3]?.[0].html).toContain('🎧 Listen 1: Study Text');
    expect(sendMock.mock.calls[4]?.[0].html).toContain('🗣️ Listen 2: Pronunciation');
    expect(sendMock.mock.calls[3]?.[0].html).toContain('audio/final/from-html-study.mp3');
    expect(sendMock.mock.calls[4]?.[0].html).toContain(
      'audio/pronunciation-shadow/from-html-pron.mp3',
    );

    fetchSpy.mockRestore();
  });

  it('runs /links without html fallback when markdown already has title and audio links', async () => {
    const registry = createCommandRegistry();
    const linksCommand = registry.resolve('links');
    expect(linksCommand).toBeDefined();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><head><title>Fallback Title</title></head><body>ignored</body></html>', {
        status: 200,
      }),
    );

    const context = createBaseContext({
      command: 'links',
      args: ['job-101'],
    });

    const getJobMock = context.backend.getJob as ReturnType<typeof vi.fn>;
    getJobMock.mockResolvedValue({
      jobId: 'job-101',
      studentId: null,
      md: [
        '---',
        'title: "Homework Assignment: Office Rules & Modal Verbs"',
        '---',
        '[Study clip](https://bucket.s3.amazonaws.com/audio/final/from-md-study.mp3)',
        '[Pron clip](https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/from-md-pron.mp3)',
      ].join('\n'),
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
      notionUrl: 'https://notion.so/assignment-101',
      anytypeUrl: null,
      htmlUrl: 'https://example.com/fallback-only-if-needed.html',
      state: 'succeeded',
      createdAt: '2026-03-11T00:00:00Z',
      updatedAt: '2026-03-11T00:00:00Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    await linksCommand?.execute(context);

    expect(fetchSpy).not.toHaveBeenCalled();

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(5);
    expect(sendMock.mock.calls[2]?.[0].html).toContain(
      '<a href="https://example.com/fallback-only-if-needed.html">Homework Assignment: Office Rules &amp; Modal Verbs</a>',
    );
    expect(sendMock.mock.calls[3]?.[0].html).toContain('audio/final/from-md-study.mp3');
    expect(sendMock.mock.calls[4]?.[0].html).toContain(
      'audio/pronunciation-shadow/from-md-pron.mp3',
    );

    fetchSpy.mockRestore();
  });

  it('runs /links and avoids trailing delimiters in fallback audio URL extraction', async () => {
    const registry = createCommandRegistry();
    const linksCommand = registry.resolve('links');
    expect(linksCommand).toBeDefined();

    const context = createBaseContext({
      command: 'links',
      args: ['job-102'],
    });

    const getJobMock = context.backend.getJob as ReturnType<typeof vi.fn>;
    getJobMock.mockResolvedValue({
      jobId: 'job-102',
      studentId: null,
      md: [
        '---',
        'title: "Homework Assignment: Delimiter Regression"',
        '---',
        '[Audio](https://bucket.s3.amazonaws.com/audio/final/delimited-study.mp3?token=abc123)',
      ].join('\n'),
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
      notionUrl: 'https://notion.so/assignment-102',
      anytypeUrl: null,
      htmlUrl: null,
      state: 'succeeded',
      createdAt: '2026-03-11T00:00:00Z',
      updatedAt: '2026-03-11T00:00:00Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    await linksCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(4);
    expect(sendMock.mock.calls[3]?.[0].html).toContain(
      'href="https://bucket.s3.amazonaws.com/audio/final/delimited-study.mp3?token=abc123"',
    );
    expect(sendMock.mock.calls[3]?.[0].html).not.toContain('token=abc123)');
  });

  it('runs /share and mirrors student-share output', async () => {
    const registry = createCommandRegistry();
    const shareCommand = registry.resolve('share');
    expect(shareCommand).toBeDefined();

    const context = createBaseContext({
      command: 'share',
      args: ['job-88'],
    });

    const getJobMock = context.backend.getJob as ReturnType<typeof vi.fn>;
    getJobMock.mockResolvedValue({
      jobId: 'job-88',
      studentId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
      studentName: 'Margarita',
      md: '[Audio recording: Study Text](https://bucket.s3.amazonaws.com/audio/final/share-study.mp3)',
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
      notionUrl: 'https://notion.so/share-assignment',
      anytypeUrl: null,
      htmlUrl: null,
      state: 'succeeded',
      createdAt: '2026-03-11T00:00:00Z',
      updatedAt: '2026-03-11T00:00:00Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    await shareCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('<b>Share package</b>');
    expect(sendMock.mock.calls[0]?.[0].html).toContain('<b>Student</b> Margarita (72444fdf)');
    expect(sendMock.mock.calls[1]?.[0].html).toContain(
      '<a href="https://notion.so/share-assignment">Homework Assignment',
    );
    expect(sendMock.mock.calls[2]?.[0].html).toContain('🎧 Listen 1: Study Text');

    const auditLogMock = context.audit.log as ReturnType<typeof vi.fn>;
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share_path_telemetry',
        details: expect.objectContaining({
          studyAudioSource: 'markdown_label',
          missingPronunciationAudio: true,
          missingAudioCount: 1,
        }),
      }),
    );
  });

  it('shows usage guidance for /student without arguments', async () => {
    const registry = createCommandRegistry();
    const studentCommand = registry.resolve('student');
    expect(studentCommand).toBeDefined();

    const context = createBaseContext({
      command: 'student',
      args: [],
    });

    await studentCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain(
      'Usage: /student &lt;name-or-id&gt;',
    );
  });

  it('renders /student disambiguation with inline buttons for multiple matches', async () => {
    const registry = createCommandRegistry();
    const studentCommand = registry.resolve('student');
    expect(studentCommand).toBeDefined();

    const context = createBaseContext({
      command: 'student',
      args: ['Margarita'],
    });
    const searchStudentsMock = context.backend.searchStudents as ReturnType<typeof vi.fn>;
    searchStudentsMock.mockResolvedValue({
      items: [
        { id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb', student: 'Margarita' },
        { id: '6480bb4a-e087-4d35-aac6-b050d9e893ac', student: 'Margarita' },
      ],
      total: 2,
      limit: 10,
      offset: 0,
      order: 'asc',
    });

    await studentCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Multiple students matched');
    expect(sendMock.mock.calls[0]?.[0].replyMarkup).toEqual(
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [expect.objectContaining({ text: 'Margarita · 72444fdf', callback_data: 'a4|st|72444fdf-4abe-43ce-9166-5a1529c2e6cb' })],
          [expect.objectContaining({ text: 'Margarita · 6480bb4a', callback_data: 'a4|st|6480bb4a-e087-4d35-aac6-b050d9e893ac' })],
        ]),
      }),
    );
  });

  it('renders /student summary with latest job actions', async () => {
    const registry = createCommandRegistry();
    const studentCommand = registry.resolve('student');
    expect(studentCommand).toBeDefined();

    const context = createBaseContext({
      command: 'student',
      args: ['72444fdf'],
    });
    const searchStudentsMock = context.backend.searchStudents as ReturnType<typeof vi.fn>;
    const listJobsMock = context.backend.listJobs as ReturnType<typeof vi.fn>;
    searchStudentsMock
      .mockResolvedValueOnce({
        items: [{ id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb', student: 'Margarita' }],
        total: 1,
        limit: 10,
        offset: 0,
        order: 'asc',
      })
      .mockResolvedValueOnce({
        items: [{ id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb', student: 'Margarita' }],
        total: 1,
        limit: 10,
        offset: 0,
        order: 'asc',
      });
    listJobsMock.mockResolvedValue({
      jobs: [
        {
          jobId: 'job-student-1',
          studentId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
          studentName: 'Margarita',
          md: '# Homework Assignment: The Cafe & The Adjective Trap',
          recordingId: null,
          transcriptId: null,
          promptPackageId: null,
          draftId: null,
          preset: null,
          learningPresetId: 'general-english',
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
          createdAt: '2026-03-14T08:46:42.494Z',
          updatedAt: '2026-03-14T08:47:06.373Z',
          startedAt: null,
          finishedAt: '2026-03-14T08:47:06.373Z',
          error: null,
          manifestPath: null,
        },
      ],
      total: 1,
      limit: 5,
      offset: 0,
    });

    await studentCommand?.execute(context);

    expect(listJobsMock).toHaveBeenCalledWith({
      studentId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
      order: 'desc',
      limit: 5,
    });
    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Margarita (72444fdf)');
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('The Cafe &amp; The Adjective Trap');
    expect(sendMock.mock.calls[0]?.[0].replyMarkup).toEqual(
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({ text: 'Recent Jobs', callback_data: 'a4|v|sr:72444fdf-4ab' }),
            expect.objectContaining({ text: 'Failed', callback_data: 'a4|v|sf:72444fdf-4ab' }),
            expect.objectContaining({ text: 'Succeeded', callback_data: 'a4|v|ss:72444fdf-4ab' }),
          ]),
          expect.arrayContaining([
            expect.objectContaining({ text: 'Latest Job', callback_data: 'a4|j|job-student-1|sr:72444fdf-4ab' }),
            expect.objectContaining({ text: 'Share Latest', callback_data: 'a4|js|job-student-1' }),
          ]),
          expect.arrayContaining([
            expect.objectContaining({ text: 'Refresh', callback_data: 'a4|st|72444fdf-4abe-43ce-9166-5a1529c2e6cb' }),
          ]),
        ]),
      }),
    );
  });

  it('renders /student latest homework from markdown file paths', async () => {
    const registry = createCommandRegistry();
    const studentCommand = registry.resolve('student');
    expect(studentCommand).toBeDefined();

    const tempDir = await mkdtemp(join(tmpdir(), 'telegram-ops-student-'));
    const markdownPath = join(tempDir, 'latest-assignment.md');
    await writeFile(markdownPath, '# Homework Assignment: File Path Title\n', 'utf8');

    const context = createBaseContext({
      command: 'student',
      args: ['72444fdf'],
    });
    const searchStudentsMock = context.backend.searchStudents as ReturnType<typeof vi.fn>;
    const listJobsMock = context.backend.listJobs as ReturnType<typeof vi.fn>;
    searchStudentsMock
      .mockResolvedValueOnce({
        items: [{ id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb', student: 'Margarita' }],
        total: 1,
        limit: 10,
        offset: 0,
        order: 'asc',
      })
      .mockResolvedValueOnce({
        items: [{ id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb', student: 'Margarita' }],
        total: 1,
        limit: 10,
        offset: 0,
        order: 'asc',
      });
    listJobsMock.mockResolvedValue({
      jobs: [
        {
          jobId: 'job-student-file',
          studentId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
          studentName: 'Margarita',
          md: markdownPath,
          recordingId: null,
          transcriptId: null,
          promptPackageId: null,
          draftId: null,
          preset: null,
          learningPresetId: 'general-english',
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
          createdAt: '2026-03-14T08:46:42.494Z',
          updatedAt: '2026-03-14T08:47:06.373Z',
          startedAt: null,
          finishedAt: '2026-03-14T08:47:06.373Z',
          error: null,
          manifestPath: null,
        },
      ],
      total: 1,
      limit: 5,
      offset: 0,
    });

    try {
      await studentCommand?.execute(context);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('File Path Title');
  });

  it('parses /jobs filters, resolves the student, and renders job buttons', async () => {
    const registry = createCommandRegistry();
    const jobsCommand = registry.resolve('jobs');
    expect(jobsCommand).toBeDefined();

    const context = createBaseContext({
      command: 'jobs',
      args: ['state:failed,running', 'student:"Mary', 'Jane"', 'since:today', 'limit:5', 'order:asc'],
    });
    const searchStudentsMock = context.backend.searchStudents as ReturnType<typeof vi.fn>;
    const listJobsMock = context.backend.listJobs as ReturnType<typeof vi.fn>;
    searchStudentsMock.mockResolvedValue({
      items: [
        { id: 'student-2', student: 'Mary Jane A' },
        { id: 'student-3', student: 'Mary Jane B' },
        { id: 'student-4', student: 'Mary Jane C' },
        { id: 'student-5', student: 'Mary Jane D' },
        { id: 'student-6', student: 'Mary Jane E' },
        { id: 'student-7', student: 'Mary Jane F' },
        { id: 'student-8', student: 'Mary Jane G' },
        { id: 'student-9', student: 'Mary Jane H' },
        { id: 'student-10', student: 'Mary Jane I' },
        { id: 'student-11', student: 'Mary Jane J' },
        { id: 'student-1', student: 'Mary Jane' },
      ],
      total: 11,
      limit: 500,
      offset: 0,
      order: 'asc',
    });
    listJobsMock.mockResolvedValue({
      jobs: [
        {
          jobId: 'job-filter-1',
          studentId: 'student-1',
          studentName: 'Mary Jane',
          md: null,
          recordingId: null,
          transcriptId: null,
          promptPackageId: null,
          draftId: null,
          preset: null,
          learningPresetId: 'general-english',
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
          state: 'failed',
          createdAt: '2026-03-14T08:46:42.494Z',
          updatedAt: '2026-03-14T08:47:06.373Z',
          startedAt: null,
          finishedAt: null,
          error: 'voice mismatch',
          manifestPath: null,
        },
      ],
      total: 1,
      limit: 5,
      offset: 0,
    });

    await jobsCommand?.execute(context);

    expect(searchStudentsMock).toHaveBeenCalledWith('Mary Jane', 500);
    expect(listJobsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        states: ['failed', 'running'],
        studentId: 'student-1',
        limit: 5,
        order: 'asc',
      }),
    );
    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Filters');
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('student:Mary Jane');
    expect(sendMock.mock.calls[0]?.[0].replyMarkup).toEqual(
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [
            expect.objectContaining({
              text: 'Mary Jane · student-',
              callback_data: expect.stringMatching(/^a4\|j\|job-filter-1\|q:[a-z0-9_-]{22}$/),
            }),
          ],
        ]),
      }),
    );
  });

  it('reopens ad-hoc /jobs views from durable q keys after reset', async () => {
    const context = createBaseContext({});
    const listJobsMock = context.backend.listJobs as ReturnType<typeof vi.fn>;
    const searchStudentsMock = context.backend.searchStudents as ReturnType<typeof vi.fn>;
    searchStudentsMock.mockResolvedValue({
      items: [{ id: 'student-1', student: 'Mary Jane' }],
      total: 1,
      limit: 500,
      offset: 0,
      order: 'asc',
    });
    listJobsMock.mockResolvedValueOnce({
      jobs: [
        {
          jobId: 'job-filter-1',
          studentId: 'student-1',
          studentName: 'Mary Jane',
          md: null,
          recordingId: null,
          transcriptId: null,
          promptPackageId: null,
          draftId: null,
          preset: null,
          learningPresetId: 'general-english',
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
          state: 'failed',
          createdAt: '2026-03-14T08:46:42.494Z',
          updatedAt: '2026-03-14T08:47:06.373Z',
          startedAt: null,
          finishedAt: null,
          error: 'voice mismatch',
          manifestPath: null,
        },
      ],
      total: 1,
      limit: 5,
      offset: 0,
    });

    const firstView = await loadJobsView(
      context,
      {
        states: ['failed'],
        studentQuery: 'Mary Jane',
        limit: 5,
        order: 'desc',
        normalizedTokens: ['state:failed', 'student:Mary Jane', 'limit:5'],
      },
      {
        title: 'Jobs',
        keyboardScope: 'global',
      },
    );

    const callbackData = firstView.replyMarkup.inline_keyboard[0]?.[0]?.callback_data as
      | string
      | undefined;
    const viewKey = callbackData?.split('|')[3];
    expect(viewKey).toMatch(/^q:[a-z0-9_-]{22}$/);

    resetAdvancedControlApprovalsForTests();

    listJobsMock.mockResolvedValueOnce({
      jobs: [],
      total: 0,
      limit: 5,
      offset: 0,
    });

    const reopened = await loadJobsViewFromKey(context, viewKey as `q:${string}`);
    expect(reopened.html).toContain('state:failed');
    expect(reopened.html).toContain('student:Mary Jane');
    expect(searchStudentsMock).toHaveBeenCalledWith('Mary Jane', 500);
    expect(searchStudentsMock).toHaveBeenCalledWith('student-1', 500);
  });

  it('renders bare /jobs as a browse surface with examples and quick filters', async () => {
    const registry = createCommandRegistry();
    const jobsCommand = registry.resolve('jobs');
    expect(jobsCommand).toBeDefined();

    const context = createBaseContext({
      command: 'jobs',
      args: [],
    });
    const listJobsMock = context.backend.listJobs as ReturnType<typeof vi.fn>;
    listJobsMock.mockResolvedValue({
      jobs: [],
      total: 0,
      limit: 10,
      offset: 0,
    });

    await jobsCommand?.execute(context);

    expect(listJobsMock).toHaveBeenCalledWith({
      states: null,
      studentId: null,
      from: null,
      to: null,
      limit: 10,
      offset: 0,
      order: 'desc',
    });
    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Browse Jobs');
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Try /jobs failed');
    expect(sendMock.mock.calls[0]?.[0].replyMarkup).toEqual(
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({ text: 'Failed' }),
            expect.objectContaining({ text: 'Running' }),
            expect.objectContaining({ text: 'Succeeded' }),
            expect.objectContaining({ text: 'Today' }),
          ]),
        ]),
      }),
    );
  });

  it('soft-parses /jobs failed Margarita into state plus student query', async () => {
    const registry = createCommandRegistry();
    const jobsCommand = registry.resolve('jobs');
    expect(jobsCommand).toBeDefined();

    const context = createBaseContext({
      command: 'jobs',
      args: ['failed', 'Margarita'],
    });
    const searchStudentsMock = context.backend.searchStudents as ReturnType<typeof vi.fn>;
    const listJobsMock = context.backend.listJobs as ReturnType<typeof vi.fn>;
    searchStudentsMock.mockResolvedValue({
      items: [{ id: 'student-1', student: 'Margarita' }],
      total: 1,
      limit: 10,
      offset: 0,
      order: 'asc',
    });
    listJobsMock.mockResolvedValue({
      jobs: [],
      total: 0,
      limit: 10,
      offset: 0,
    });

    await jobsCommand?.execute(context);

    expect(searchStudentsMock).toHaveBeenCalledWith('Margarita', 500);
    expect(listJobsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        states: ['failed'],
        studentId: 'student-1',
      }),
    );
    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('state:failed');
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('student:Margarita');
  });

  it('renders /students with paging controls', async () => {
    const registry = createCommandRegistry();
    const studentsCommand = registry.resolve('students');
    expect(studentsCommand).toBeDefined();

    const context = createBaseContext({
      command: 'students',
      args: [],
    });
    const listStudentSummariesMock = context.backend.listStudentSummaries as ReturnType<typeof vi.fn>;
    listStudentSummariesMock.mockResolvedValue({
      items: [
        {
          id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
          name: 'Margarita',
          lastLessonAt: '2026-03-14T08:47:06.373Z',
          pendingDrafts: 2,
        },
      ],
      total: 11,
      limit: 10,
      offset: 0,
    });

    await studentsCommand?.execute(context);

    expect(listStudentSummariesMock).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
      order: 'desc',
    });
    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Students · Page 1');
    expect(sendMock.mock.calls[0]?.[0].replyMarkup).toEqual(
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [expect.objectContaining({ text: 'Margarita · 72444fdf', callback_data: 'a4|st|72444fdf-4abe-43ce-9166-5a1529c2e6cb' })],
          expect.arrayContaining([expect.objectContaining({ text: 'Next' })]),
        ]),
      }),
    );
  });

  it('shows /jobs ambiguity guidance instead of querying jobs', async () => {
    const registry = createCommandRegistry();
    const jobsCommand = registry.resolve('jobs');
    expect(jobsCommand).toBeDefined();

    const context = createBaseContext({
      command: 'jobs',
      args: ['student:Margarita'],
    });
    const searchStudentsMock = context.backend.searchStudents as ReturnType<typeof vi.fn>;
    const listJobsMock = context.backend.listJobs as ReturnType<typeof vi.fn>;
    searchStudentsMock.mockResolvedValue({
      items: [
        { id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb', student: 'Margarita' },
        { id: '6480bb4a-e087-4d35-aac6-b050d9e893ac', student: 'Margarita' },
      ],
      total: 2,
      limit: 10,
      offset: 0,
      order: 'asc',
    });

    await jobsCommand?.execute(context);

    expect(listJobsMock).not.toHaveBeenCalled();
    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Re-run /jobs with an exact student ID');
  });

  it('renders /today with UTC window and follow-up commands', async () => {
    const registry = createCommandRegistry();
    const todayCommand = registry.resolve('today');
    expect(todayCommand).toBeDefined();

    const context = createBaseContext({
      command: 'today',
      args: [],
    });
    const summaryMock = context.backend.getAdminJobSummary as ReturnType<typeof vi.fn>;
    const listJobsMock = context.backend.listJobs as ReturnType<typeof vi.fn>;
    summaryMock.mockResolvedValue({
      total: 7,
      byState: {
        queued: 1,
        running: 0,
        awaiting_approval: 0,
        succeeded: 5,
        failed: 1,
      },
      pendingApprovals: 0,
      last7Days: { total: 7, succeeded: 5, failed: 1 },
      tts: { enabled: 4, succeeded: 3 },
    });
    listJobsMock
      .mockResolvedValueOnce({
        jobs: [],
        total: 0,
        limit: 3,
        offset: 0,
      })
      .mockResolvedValueOnce({
        jobs: [],
        total: 0,
        limit: 3,
        offset: 0,
      })
      .mockResolvedValueOnce({
        jobs: [
          {
            jobId: 'job-today-1',
            studentId: 'student-1',
            studentName: 'Mary Jane',
            md: null,
            recordingId: null,
            transcriptId: null,
            promptPackageId: null,
            draftId: null,
            preset: null,
            learningPresetId: 'general-english',
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
            createdAt: '2026-03-14T08:46:42.494Z',
            updatedAt: '2026-03-14T08:47:06.373Z',
            startedAt: null,
            finishedAt: '2026-03-14T08:47:06.373Z',
            error: null,
            manifestPath: null,
          },
        ],
        total: 1,
        limit: 5,
        offset: 0,
      });

    await todayCommand?.execute(context);

    expect(summaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.stringMatching(/^.*T00:00:00\.000Z$/),
        to: expect.any(String),
      }),
    );
    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Today');
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('/jobs state:failed since:today');
    expect(sendMock.mock.calls[0]?.[0].replyMarkup).toEqual(
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ text: 'Failed' })]),
        ]),
      }),
    );
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
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('jobs is using default thread routing');
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('alerts has no resolved topic/default thread');
  });

  it('requires /approve token for /backup in webhook mode', async () => {
    const registry = createCommandRegistry();
    const backupCommand = registry.resolve('backup');
    expect(backupCommand).toBeDefined();

    const context = createBaseContext({
      config: {
        ...createBaseContext({}).config,
        mode: 'webhook',
      },
      command: 'backup',
      args: ['nightly', 'smoke'],
    });

    await backupCommand?.execute(context);

    const enqueueMock = context.backend.enqueueOpsAction as ReturnType<typeof vi.fn>;
    expect(enqueueMock).toHaveBeenCalledTimes(0);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('Approval required');
    expect(sendMock.mock.calls[0]?.[0].html).toContain('/approve');
  });

  it('applies /approve token and enqueues pending action in webhook mode', async () => {
    const registry = createCommandRegistry();
    const backupCommand = registry.resolve('backup');
    const approveCommand = registry.resolve('approve');
    expect(backupCommand).toBeDefined();
    expect(approveCommand).toBeDefined();

    const enqueueMock = vi.fn(async () => ({
      operationId: 'op-approved',
      action: 'backup_upload' as const,
      state: 'queued' as const,
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
    }));

    const webhookConfig = {
      ...createBaseContext({}).config,
      mode: 'webhook' as const,
    };
    const backupContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'backup',
      args: ['nightly', 'smoke'],
    });
    await backupCommand?.execute(backupContext);

    const backupSendMock = backupContext.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    const approvalMessage = String(backupSendMock.mock.calls[0]?.[0].html ?? '');
    const tokenMatch = approvalMessage.match(/\/approve\s+([A-Za-z0-9._-]+)/);
    expect(tokenMatch?.[1]).toBeTruthy();
    const token = tokenMatch?.[1] ?? '';

    const approveContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'approve',
      args: [token],
    });
    await approveCommand?.execute(approveContext);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith({
      action: 'backup_upload',
      label: 'nightly smoke',
    });

    const approveSendMock = approveContext.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(approveSendMock).toHaveBeenCalledTimes(1);
    expect(String(approveSendMock.mock.calls[0]?.[0].html)).toContain('op-approved');
  });

  it('rejects replayed /approve token after first successful use', async () => {
    const registry = createCommandRegistry();
    const backupCommand = registry.resolve('backup');
    const approveCommand = registry.resolve('approve');
    expect(backupCommand).toBeDefined();
    expect(approveCommand).toBeDefined();

    const enqueueMock = vi.fn(async () => ({
      operationId: 'op-approved-once',
      action: 'backup_upload' as const,
      state: 'queued' as const,
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
    }));

    const webhookConfig = {
      ...createBaseContext({}).config,
      mode: 'webhook' as const,
    };
    const backupContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'backup',
      args: ['nightly'],
    });
    await backupCommand?.execute(backupContext);

    const backupSendMock = backupContext.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    const approvalMessage = String(backupSendMock.mock.calls[0]?.[0].html ?? '');
    const tokenMatch = approvalMessage.match(/\/approve\s+([A-Za-z0-9._-]+)/);
    expect(tokenMatch?.[1]).toBeTruthy();
    const token = tokenMatch?.[1] ?? '';

    const firstApproveContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'approve',
      args: [token],
    });
    await approveCommand?.execute(firstApproveContext);

    const secondApproveContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'approve',
      args: [token],
    });
    await approveCommand?.execute(secondApproveContext);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const secondSendMock = secondApproveContext.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(secondSendMock).toHaveBeenCalledTimes(1);
    expect(String(secondSendMock.mock.calls[0]?.[0].html)).toContain('already been used');
  });

  it('keeps approval token consumed when enqueue confirmation fails ambiguously', async () => {
    const registry = createCommandRegistry();
    const backupCommand = registry.resolve('backup');
    const approveCommand = registry.resolve('approve');
    expect(backupCommand).toBeDefined();
    expect(approveCommand).toBeDefined();

    const enqueueMock = vi.fn(async () => {
      throw new Error('network timeout after request write');
    });

    const webhookConfig = {
      ...createBaseContext({}).config,
      mode: 'webhook' as const,
    };
    const backupContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'backup',
      args: ['nightly'],
    });
    await backupCommand?.execute(backupContext);

    const backupSendMock = backupContext.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    const approvalMessage = String(backupSendMock.mock.calls[0]?.[0].html ?? '');
    const tokenMatch = approvalMessage.match(/\/approve\s+([A-Za-z0-9._-]+)/);
    expect(tokenMatch?.[1]).toBeTruthy();
    const token = tokenMatch?.[1] ?? '';

    const firstApproveContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'approve',
      args: [token],
    });
    await expect(approveCommand?.execute(firstApproveContext)).rejects.toThrow(
      'Approval enqueue confirmation failed after token was consumed',
    );

    const secondApproveContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'approve',
      args: [token],
    });
    await approveCommand?.execute(secondApproveContext);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const secondSendMock = secondApproveContext.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(secondSendMock).toHaveBeenCalledTimes(1);
    expect(String(secondSendMock.mock.calls[0]?.[0].html)).toContain('already been used');
  });

  it('accepts /approve token across registry instances (restart-safe)', async () => {
    const replayStore = new InMemoryApprovalReplayStore();
    const registryA = createCommandRegistry({ replayStore });
    const registryB = createCommandRegistry({ replayStore });
    const backupCommand = registryA.resolve('backup');
    const approveCommand = registryB.resolve('approve');
    expect(backupCommand).toBeDefined();
    expect(approveCommand).toBeDefined();

    const enqueueMock = vi.fn(async () => ({
      operationId: 'op-approved-restart-safe',
      action: 'backup_upload' as const,
      state: 'queued' as const,
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
    }));

    const webhookConfig = {
      ...createBaseContext({}).config,
      mode: 'webhook' as const,
    };
    const backupContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'backup',
      args: ['nightly'],
    });
    await backupCommand?.execute(backupContext);

    const backupSendMock = backupContext.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    const approvalMessage = String(backupSendMock.mock.calls[0]?.[0].html ?? '');
    const tokenMatch = approvalMessage.match(/\/approve\s+([A-Za-z0-9._-]+)/);
    expect(tokenMatch?.[1]).toBeTruthy();
    const token = tokenMatch?.[1] ?? '';

    const approveContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'approve',
      args: [token],
    });
    await approveCommand?.execute(approveContext);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith({
      action: 'backup_upload',
      label: 'nightly',
    });
  });

  it('rejects replayed /approve token across registry instances when sharing replay store', async () => {
    const replayStore = new InMemoryApprovalReplayStore();
    const registryA = createCommandRegistry({ replayStore });
    const registryB = createCommandRegistry({ replayStore });
    const backupCommand = registryA.resolve('backup');
    const approveCommand = registryB.resolve('approve');
    expect(backupCommand).toBeDefined();
    expect(approveCommand).toBeDefined();

    const enqueueMock = vi.fn(async () => ({
      operationId: 'op-approved-shared-store',
      action: 'backup_upload' as const,
      state: 'queued' as const,
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
    }));

    const webhookConfig = {
      ...createBaseContext({}).config,
      mode: 'webhook' as const,
    };
    const backupContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'backup',
      args: ['nightly'],
    });
    await backupCommand?.execute(backupContext);

    const backupSendMock = backupContext.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    const approvalMessage = String(backupSendMock.mock.calls[0]?.[0].html ?? '');
    const tokenMatch = approvalMessage.match(/\/approve\s+([A-Za-z0-9._-]+)/);
    expect(tokenMatch?.[1]).toBeTruthy();
    const token = tokenMatch?.[1] ?? '';

    const firstApproveContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'approve',
      args: [token],
    });
    await approveCommand?.execute(firstApproveContext);

    const secondApproveContext = createBaseContext({
      config: webhookConfig,
      backend: {
        ...createBaseContext({}).backend,
        enqueueOpsAction: enqueueMock,
      },
      command: 'approve',
      args: [token],
    });
    await approveCommand?.execute(secondApproveContext);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const secondSendMock = secondApproveContext.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(secondSendMock).toHaveBeenCalledTimes(1);
    expect(String(secondSendMock.mock.calls[0]?.[0].html)).toContain('already been used');
  });
});
