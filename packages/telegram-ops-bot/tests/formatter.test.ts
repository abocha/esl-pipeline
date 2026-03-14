import { describe, expect, it } from 'vitest';

import {
  formatActionStatus,
  formatAudioPlaybackLink,
  formatBotStatusReport,
  formatFinishedJobs,
  formatJobDetails,
  formatJobLinks,
  formatJobsQueryResults,
  formatLocalizedDateTime,
  formatShareJobHeader,
  formatStudentSummary,
  formatStudentsBrowser,
  formatTodaySummary,
} from '../src/formatter.js';

describe('formatter', () => {
  it('renders finished jobs with student names first and localized timestamps', () => {
    const html = formatFinishedJobs({
      jobs: [
        {
          jobId: 'job-1',
          studentId: 'student-1',
          studentName: 'Alice Nguyen',
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

    expect(html).toContain('<b>Jobs · Recent Finished</b>');
    expect(html).toContain('<b>Alice Nguyen (student-)</b>');
    expect(html).toContain(formatLocalizedDateTime('2026-03-14T08:47:06.373Z'));
    expect(html).toContain('<b>Preset</b> general-english');
    expect(html).toContain('<code>job-1</code>');
  });

  it('renders job details with student names, homework title, and localized timestamps', () => {
    const html = formatJobDetails(
      {
        jobId: 'job-1',
        studentId: 'student-1',
        studentName: 'Alice Nguyen',
        md: null,
        recordingId: 'rec-1',
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
      {
        assignmentTitle: 'Homework Assignment: Office Rules & Modal Verbs',
      },
    );

    expect(html).toContain('<b>Job · SUCCEEDED</b>');
    expect(html).toContain('<b>Student</b> Alice Nguyen');
    expect(html).toContain('<b>Homework</b> Office Rules &amp; Modal Verbs');
    expect(html).toContain(formatLocalizedDateTime('2026-03-14T08:46:42.494Z'));
    expect(html).toContain(formatLocalizedDateTime('2026-03-14T08:47:06.373Z'));
  });

  it('renders share header with job metadata', () => {
    const html = formatShareJobHeader(
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
      {
        assignmentTitle: 'Homework Assignment: The Cafe & The Adjective Trap',
      },
    );

    expect(html).toContain('<b>Share package</b>');
    expect(html).toContain('<b>Student</b> Margarita (72444fdf)');
    expect(html).toContain('<b>Job</b> <code>job-1</code>');
    expect(html).toContain('<b>Homework</b> The Cafe &amp; The Adjective Trap');
    expect(html).toContain(formatLocalizedDateTime('2026-03-14T08:47:06.373Z'));
  });

  it('renders operation status details', () => {
    const html = formatActionStatus({
      operationId: 'op-77',
      action: 'backup_upload',
      state: 'running',
      requestedAt: '2026-03-11T00:00:00Z',
      startedAt: '2026-03-11T00:00:01Z',
      finishedAt: null,
      requestedBy: 'telegram',
      requestedByUserId: 'user-1',
      message: 'Action started',
      command: 'bash backup',
      exitCode: null,
      stdoutTail: null,
      stderrTail: null,
    });

    expect(html).toContain('op-77');
    expect(html).toContain('running');
    expect(html).toContain('Action started');
  });

  it('renders available links and app links', () => {
    const html = formatJobLinks(
      {
        jobId: 'job-1',
        studentId: null,
        md: [
          '# Lesson',
          '[Audio recording: Study Text](https://bucket.s3.amazonaws.com/audio/final/study.mp3)',
          '[Audio recording: Pronunciation Shadow Sentence](https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/pron.mp3)',
        ].join('\n'),
        recordingId: 'rec-1',
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
        notionUrl: 'https://notion.so/x',
        anytypeUrl: null,
        htmlUrl: 'https://example.com/html',
        state: 'succeeded',
        createdAt: '2026-03-11T00:00:00Z',
        updatedAt: '2026-03-11T00:00:00Z',
        startedAt: null,
        finishedAt: null,
        error: null,
        manifestPath: null,
      },
      'https://app.example.com',
      {
        assignmentTitle: 'Homework Assignment: Office Rules & Modal Verbs',
        assignmentEmoji: '🏢',
      },
    );

    expect(html).toContain('🏢 Homework Assignment: Office Rules &amp; Modal Verbs');
    expect(html).toContain('https://example.com/html');
    expect(html).toContain('🎧 Listen 1: Study Text');
    expect(html).toContain('https://bucket.s3.amazonaws.com/audio/final/study.mp3');
    expect(html).toContain('🗣️ Listen 2: Pronunciation');
    expect(html).toContain('https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/pron.mp3');
  });

  it('renders one-line audio playback link without duplicate labels', () => {
    const html = formatAudioPlaybackLink(
      '🎧 Listen 1: Study Text',
      'https://example.com/audio/final/a.mp3',
    );
    expect(html).toBe(
      '<a href="https://example.com/audio/final/a.mp3">🎧 Listen 1: Study Text</a>',
    );
  });

  it('renders student summary with explicit UTC timestamps and latest homework', () => {
    const html = formatStudentSummary({
      student: {
        id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
        student: 'Margarita',
      },
      latestJob: {
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
        htmlUrl: null,
        state: 'succeeded',
        createdAt: '2026-03-14T08:46:42.494Z',
        updatedAt: '2026-03-14T08:47:06.373Z',
        startedAt: null,
        finishedAt: '2026-03-14T08:47:06.373Z',
        error: null,
        manifestPath: null,
      },
      latestAssignmentTitle: 'The Cafe & The Adjective Trap',
      recentJobs: [],
    });

    expect(html).toContain('<b>Margarita (72444fdf)</b>');
    expect(html).toContain('<b>Latest homework</b> The Cafe &amp; The Adjective Trap');
    expect(html).toContain('2026-03-14 08:47 UTC');
  });

  it('renders jobs query results with normalized filters and student identity', () => {
    const html = formatJobsQueryResults({
      normalizedFilters: ['state:failed', 'student:Mary Jane', 'limit:5'],
      title: 'Jobs · Failed',
      response: {
        jobs: [
          {
            jobId: 'job-filter-1',
            studentId: 'student1234',
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
      },
    });

    expect(html).toContain('<b>Jobs · Failed</b>');
    expect(html).toContain('<b>Filters</b> state:failed student:Mary Jane limit:5');
    expect(html).toContain('<b>Mary Jane (student1)</b>');
    expect(html).toContain('<b>State</b> failed');
  });

  it('renders paged students browser rows with recent-activity metadata', () => {
    const html = formatStudentsBrowser({
      page: 2,
      response: {
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
        offset: 10,
      },
    });

    expect(html).toContain('<b>Students · Page 2</b>');
    expect(html).toContain('<b>Margarita (72444fdf)</b>');
    expect(html).toContain('Last lesson 2026-03-14 08:47 UTC');
    expect(html).toContain('Pending drafts 2');
  });

  it('renders today and bot status summaries for operator diagnostics', () => {
    const todayHtml = formatTodaySummary({
      dateLabel: '2026-03-14',
      summary: {
        total: 4,
        byState: {
          queued: 1,
          running: 0,
          awaiting_approval: 0,
          succeeded: 3,
          failed: 0,
        },
        pendingApprovals: 0,
        last7Days: {
          total: 4,
          succeeded: 3,
          failed: 0,
        },
        tts: {
          enabled: 3,
          succeeded: 3,
        },
      },
      failedJobs: [],
      runningJobs: [],
      succeededJobs: [],
    });
    const statusHtml = formatBotStatusReport({
      runtimeSnapshot: {
        initialized: false,
        botUsername: 'esl_ops_bot',
        mode: 'polling',
        leadershipState: 'unknown',
      },
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
        leaderElectionEnabled: true,
        allowedUserIds: new Set([1]),
        pollIntervalMs: 100,
        pollTimeoutSeconds: 1,
        commandWindowMs: 60_000,
        maxCommandsPerWindow: 20,
        enableActionCommands: true,
        skipPendingUpdatesOnStartup: true,
        topicAutoCreate: false,
        defaultThreadId: 99,
        topicsStateFile: '/tmp/topics.json',
        topicNames: { ops: 'Ops', jobs: 'Jobs', alerts: 'Alerts' },
      },
      backendReachable: false,
      backendError: 'backend unavailable',
      topicStates: [
        { domain: 'ops', threadId: 42, routing: 'topic' },
        { domain: 'jobs', threadId: 99, routing: 'default' },
        { domain: 'alerts', routing: 'unresolved' },
      ],
    });

    expect(todayHtml).toContain('<b>Today · 2026-03-14 UTC</b>');
    expect(todayHtml).toContain('/jobs state:running');
    expect(statusHtml).toContain('Bot status: degraded');
    expect(statusHtml).toContain('backend unavailable');
    expect(statusHtml).toContain('jobs is using default thread routing');
  });

  it('renders assignment-only card when audio links are disabled', () => {
    const html = formatJobLinks(
      {
        jobId: 'job-2',
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
        htmlUrl: 'https://example.com/assignment.html',
        state: 'succeeded',
        createdAt: '2026-03-11T00:00:00Z',
        updatedAt: '2026-03-11T00:00:00Z',
        startedAt: null,
        finishedAt: null,
        error: null,
        manifestPath: null,
      },
      undefined,
      {
        includeAudioLinks: false,
        assignmentTitle: 'Office Rules & Modal Verbs',
        assignmentEmoji: '🏢',
      },
    );

    expect(html).toBe(
      '<a href="https://example.com/assignment.html">🏢 Homework Assignment: Office Rules &amp; Modal Verbs</a>',
    );
  });
});
