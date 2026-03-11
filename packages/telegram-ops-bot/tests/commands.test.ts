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

  it('runs /links with student-share summary and one audio preview message', async () => {
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
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[0].disableLinkPreview).toBe(true);
    expect(sendMock.mock.calls[0]?.[0].html).toContain('<a href="https://notion.so/assignment">Homework Assignment');
    expect(sendMock.mock.calls[1]?.[0].disableLinkPreview).toBe(false);
    expect(sendMock.mock.calls[1]?.[0].html).toContain('🎧 Listen 1: Study Text');
    expect(sendMock.mock.calls[1]?.[0].html).toContain('audio/final/study.mp3');
  });

  it('runs /links and falls back to htmlUrl when md is a file path', async () => {
    const registry = createCommandRegistry();
    const linksCommand = registry.resolve('links');
    expect(linksCommand).toBeDefined();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock.mock.calls[0]?.[0].disableLinkPreview).toBe(true);
    expect(sendMock.mock.calls[0]?.[0].html).toContain(
      '<a href="https://example.com/assignment.html">🏢 Homework Assignment: Office Rules &amp; Modal Verbs</a>',
    );
    expect(sendMock.mock.calls[1]?.[0].disableLinkPreview).toBe(false);
    expect(sendMock.mock.calls[2]?.[0].disableLinkPreview).toBe(false);
    expect(sendMock.mock.calls[1]?.[0].html).toContain('🎧 Listen 1: Study Text');
    expect(sendMock.mock.calls[2]?.[0].html).toContain('🗣️ Listen 2: Pronunciation');
    expect(sendMock.mock.calls[1]?.[0].html).toContain('audio/final/from-html-study.mp3');
    expect(sendMock.mock.calls[2]?.[0].html).toContain('audio/pronunciation-shadow/from-html-pron.mp3');

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
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock.mock.calls[0]?.[0].html).toContain(
      '<a href="https://example.com/fallback-only-if-needed.html">Homework Assignment: Office Rules &amp; Modal Verbs</a>',
    );
    expect(sendMock.mock.calls[1]?.[0].html).toContain('audio/final/from-md-study.mp3');
    expect(sendMock.mock.calls[2]?.[0].html).toContain('audio/pronunciation-shadow/from-md-pron.mp3');

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
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1]?.[0].html).toContain(
      'href="https://bucket.s3.amazonaws.com/audio/final/delimited-study.mp3?token=abc123"',
    );
    expect(sendMock.mock.calls[1]?.[0].html).not.toContain('token=abc123)');
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
      studentId: null,
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
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[0].html).toContain(
      '<a href="https://notion.so/share-assignment">Homework Assignment',
    );
    expect(sendMock.mock.calls[1]?.[0].html).toContain('🎧 Listen 1: Study Text');
  });
});
