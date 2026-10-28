import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createCommandRegistry,
  loadFinishedJobsView,
  loadJobsView,
  loadJobsViewFromKey,
} from '../src/commands.js';
import { createBaseContext } from './telegram-test-fixtures.js';

describe('telegram commands - jobs and students', () => {
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
          publishTarget: null,
          ttsStrategy: null,
          autoPublish: null,
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
      publishTarget: null,
      ttsStrategy: null,
      autoPublish: null,
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
      markup?.inline_keyboard.flat().map((button: { text: string }) => button.text) ?? [];
    expect(buttonTexts).toContain('Share');
    expect(buttonTexts).not.toContain('Links');
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
          [
            expect.objectContaining({
              text: 'Margarita · 72444fdf',
              callback_data: 'a4|st|72444fdf-4abe-43ce-9166-5a1529c2e6cb',
            }),
          ],
          [
            expect.objectContaining({
              text: 'Margarita · 6480bb4a',
              callback_data: 'a4|st|6480bb4a-e087-4d35-aac6-b050d9e893ac',
            }),
          ],
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
          publication: {
            schemaVersion: 1,
            rendererVersion: 1,
            title: 'Homework Assignment: The Cafe & The Adjective Trap',
            icon: '',
            studyTextAudioUrl: null,
            pronunciationAudioUrl: null,
          },
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
          publishTarget: null,
          ttsStrategy: null,
          autoPublish: null,
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
            expect.objectContaining({
              text: 'Latest Job',
              callback_data: 'a4|j|job-student-1|sr:72444fdf-4ab',
            }),
            expect.objectContaining({ text: 'Share Latest', callback_data: 'a4|js|job-student-1' }),
          ]),
          expect.arrayContaining([
            expect.objectContaining({
              text: 'Refresh',
              callback_data: 'a4|st|72444fdf-4abe-43ce-9166-5a1529c2e6cb',
            }),
          ]),
        ]),
      }),
    );
  });

  it('renders /student latest homework from persisted publication metadata', async () => {
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
          publication: {
            schemaVersion: 1,
            rendererVersion: 1,
            title: 'Persisted Title',
            icon: '',
            studyTextAudioUrl: null,
            pronunciationAudioUrl: null,
          },
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
          publishTarget: null,
          ttsStrategy: null,
          autoPublish: null,
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
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain('Persisted Title');
    expect(String(sendMock.mock.calls[0]?.[0].html)).not.toContain('File Path Title');
  });

  it('parses /jobs filters, resolves the student, and renders job buttons', async () => {
    const registry = createCommandRegistry();
    const jobsCommand = registry.resolve('jobs');
    expect(jobsCommand).toBeDefined();

    const context = createBaseContext({
      command: 'jobs',
      args: [
        'state:failed,running',
        'student:"Mary',
        'Jane"',
        'since:today',
        'limit:5',
        'order:asc',
      ],
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
          publishTarget: null,
          ttsStrategy: null,
          autoPublish: null,
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
              callback_data: expect.stringMatching(/^a4\|j\|job-filter-1\|q:[a-z0-9_-]{28}$/),
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
          publishTarget: null,
          ttsStrategy: null,
          autoPublish: null,
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
    expect(viewKey).toMatch(/^q:[a-z0-9_-]{28}$/);

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
    const listStudentSummariesMock = context.backend.listStudentSummaries as ReturnType<
      typeof vi.fn
    >;
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
          [
            expect.objectContaining({
              text: 'Margarita · 72444fdf',
              callback_data: 'a4|st|72444fdf-4abe-43ce-9166-5a1529c2e6cb',
            }),
          ],
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
    expect(String(sendMock.mock.calls[0]?.[0].html)).toContain(
      'Re-run /jobs with an exact student ID',
    );
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
            publishTarget: null,
            ttsStrategy: null,
            autoPublish: null,
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
});
