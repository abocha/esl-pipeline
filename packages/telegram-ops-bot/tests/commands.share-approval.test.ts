import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryApprovalReplayStore } from '../src/approval-replay-store.js';
import { createCommandRegistry, resetAdvancedControlApprovalsForTests } from '../src/commands.js';
import { createBaseContext } from './telegram-test-fixtures.js';

describe('telegram commands - share and approval', () => {
  beforeEach(() => {
    resetAdvancedControlApprovalsForTests();
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
      publishTarget: null,
      ttsStrategy: null,
      autoPublish: null,
      htmlUrl: 'https://example.com/assignment',
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
      '<a href="https://example.com/assignment">Homework Assignment',
    );
    expect(sendMock.mock.calls[3]?.[0].disableLinkPreview).toBe(false);
    expect(sendMock.mock.calls[3]?.[0].html).toContain('🎧 Listen 1: Study Text');
    expect(sendMock.mock.calls[3]?.[0].html).toContain('audio/final/study.mp3');
  });

  it('does not send a pronunciation attachment when only item clips are present', async () => {
    const registry = createCommandRegistry();
    const linksCommand = registry.resolve('links');
    expect(linksCommand).toBeDefined();

    const context = createBaseContext({
      command: 'links',
      args: ['job-chunks-only'],
    });

    const getJobMock = context.backend.getJob as ReturnType<typeof vi.fn>;
    getJobMock.mockResolvedValue({
      jobId: 'job-chunks-only',
      studentId: null,
      md: [
        '# Homework Assignment: Chunk Practice',
        '[Study](https://bucket.s3.amazonaws.com/audio/final/study.mp3)',
        '[Chunk](https://bucket.s3.amazonaws.com/audio/pronunciation-item/chunk.mp3)',
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
      publishTarget: null,
      ttsStrategy: null,
      autoPublish: null,
      htmlUrl: null,
      state: 'succeeded',
      createdAt: '2026-06-02T00:00:00Z',
      updatedAt: '2026-06-02T00:00:00Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    await linksCommand?.execute(context);

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    const sentHtml = sendMock.mock.calls.map((call) => call[0].html).join('\n');
    expect(sentHtml).toContain('audio/final/study.mp3');
    expect(sentHtml).not.toContain('audio/pronunciation-item/chunk.mp3');
    expect(sentHtml).not.toContain('Listen 2: Pronunciation');
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
            'https://bucket.s3.amazonaws.com/audio/pronunciation/from-html-pron.mp3',
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
      publishTarget: null,
      ttsStrategy: null,
      autoPublish: null,
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
    expect(sendMock.mock.calls[4]?.[0].html).toContain('audio/pronunciation/from-html-pron.mp3');

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
        '[Pron clip](https://bucket.s3.amazonaws.com/audio/pronunciation/from-md-pron.mp3)',
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
      publishTarget: null,
      ttsStrategy: null,
      autoPublish: null,
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

    expect(fetchSpy).not.toHaveBeenCalled();

    const sendMock = context.messenger.sendHtmlMessage as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(5);
    expect(sendMock.mock.calls[2]?.[0].html).toContain(
      '<a href="https://app.example.com/jobs/job-101">Homework Assignment: Office Rules &amp; Modal Verbs</a>',
    );
    expect(sendMock.mock.calls[3]?.[0].html).toContain('audio/final/from-md-study.mp3');
    expect(sendMock.mock.calls[4]?.[0].html).toContain('audio/pronunciation/from-md-pron.mp3');

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
      publishTarget: null,
      ttsStrategy: null,
      autoPublish: null,
      htmlUrl: 'https://example.com/assignment-102',
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
      publishTarget: null,
      ttsStrategy: null,
      autoPublish: null,
      htmlUrl: 'https://example.com/share-assignment',
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
      '<a href="https://example.com/share-assignment">Homework Assignment',
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
    const secondSendMock = secondApproveContext.messenger.sendHtmlMessage as ReturnType<
      typeof vi.fn
    >;
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
    const secondSendMock = secondApproveContext.messenger.sendHtmlMessage as ReturnType<
      typeof vi.fn
    >;
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
    const secondSendMock = secondApproveContext.messenger.sendHtmlMessage as ReturnType<
      typeof vi.fn
    >;
    expect(secondSendMock).toHaveBeenCalledTimes(1);
    expect(String(secondSendMock.mock.calls[0]?.[0].html)).toContain('already been used');
  });
});
