import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetGuidedConfirmGuardsForTests } from '../src/guided-ui.js';
import { TelegramApiError } from '../src/telegram-client.js';

import {
  createCallbackUpdate,
  createJob,
  createRunner,
  createUpdate,
  processUpdate,
} from './telegram-test-fixtures.js';

beforeEach(() => {
  resetGuidedConfirmGuardsForTests();
});

describe('telegram runner callbacks', () => {
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

  it('renders guided student callbacks by editing the existing jobs message', async () => {
    const editHtmlMessage = vi.fn(async () => true);
    const answerCallbackQuery = vi.fn(async () => true);
    const searchStudents = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb', student: 'Margarita' }],
        total: 1,
        limit: 10,
        offset: 0,
        order: 'asc',
      });
    const listJobs = vi.fn(async () => ({
      jobs: [
        createJob({
          jobId: 'job-student-1',
          studentId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
          studentName: 'Margarita',
          md: '# Homework Assignment: The Cafe & The Adjective Trap',
          learningPresetId: 'general-english',
          finishedAt: '2026-03-14T08:47:06.373Z',
        }),
      ],
      total: 1,
      limit: 5,
      offset: 0,
    }));
    const { runner, sendHtmlMessage } = createRunner({
      editHtmlMessage,
      answerCallbackQuery,
      backend: {
        searchStudents,
        listJobs,
      },
    });

    await processUpdate(
      runner,
      createCallbackUpdate('a4|st|72444fdf-4abe-43ce-9166-5a1529c2e6cb', {
        chatId: 123,
        chatType: 'supergroup',
      }),
    );

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(searchStudents).toHaveBeenCalledWith('72444fdf-4abe-43ce-9166-5a1529c2e6cb', 500);
    expect(listJobs).toHaveBeenCalledWith({
      studentId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
      order: 'desc',
      limit: 5,
    });
    expect(editHtmlMessage).toHaveBeenCalledTimes(1);
    const firstEditCall = editHtmlMessage.mock.calls[0] as
      | [{ html: string; replyMarkup?: { inline_keyboard: { text: string }[][] } }]
      | undefined;
    expect(firstEditCall?.[0].html).toContain('Margarita (72444fdf)');
    expect(firstEditCall?.[0].replyMarkup?.inline_keyboard).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ text: 'Recent Jobs' }),
          expect.objectContaining({ text: 'Failed' }),
          expect.objectContaining({ text: 'Succeeded' }),
        ]),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Latest Job' }),
          expect.objectContaining({ text: 'Share Latest' }),
        ]),
      ]),
    );
    expect(sendHtmlMessage).toHaveBeenCalledTimes(0);
  });

  it('preserves filtered /jobs context when opening job details', async () => {
    const searchStudents = vi.fn(async () => ({
      items: [{ id: 'student-1', student: 'Mary Jane' }],
      total: 1,
      limit: 500,
      offset: 0,
      order: 'asc',
    }));
    const listJobs = vi.fn(async () => ({
      jobs: [
        createJob({
          jobId: 'job-filter-1',
          studentId: 'student-1',
          studentName: 'Mary Jane',
          state: 'failed',
        }),
      ],
      total: 1,
      limit: 10,
      offset: 0,
    }));
    const getJob = vi.fn(async () =>
      createJob({
        jobId: 'job-filter-1',
        studentId: 'student-1',
        studentName: 'Mary Jane',
        state: 'failed',
      }),
    );
    const editHtmlMessage = vi.fn(async () => true);
    const answerCallbackQuery = vi.fn(async () => true);
    const { runner, sendHtmlMessage } = createRunner({
      editHtmlMessage,
      answerCallbackQuery,
      backend: {
        searchStudents,
        listJobs,
        getJob,
      },
    });

    await processUpdate(
      runner,
      createUpdate('/jobs state:failed student:"Mary Jane"', {
        chatId: 123,
        chatType: 'supergroup',
      }),
    );

    const firstReplyMarkup = sendHtmlMessage.mock.calls[0]?.[0]?.replyMarkup as
      | { inline_keyboard: { callback_data: string }[][] }
      | undefined;
    const jobCallbackData = firstReplyMarkup?.inline_keyboard[0]?.[0]?.callback_data;
    expect(jobCallbackData).toMatch(/^a4\|j\|job-filter-1\|q:[a-z0-9_-]{22}$/);

    await processUpdate(
      runner,
      createCallbackUpdate(jobCallbackData ?? '', {
        chatId: 123,
        chatType: 'supergroup',
      }),
    );

    const firstEditCall = editHtmlMessage.mock.calls[0] as
      | [{ replyMarkup?: { inline_keyboard: { text: string; callback_data: string }[][] } }]
      | undefined;
    const jobDetailsMarkup = firstEditCall?.[0]?.replyMarkup;
    const backButton = jobDetailsMarkup?.inline_keyboard[1]?.find((button) => button.text === 'Back');
    expect(backButton?.callback_data).toMatch(/^a4\|v\|q:[a-z0-9_-]{22}$/);
  });

  it('renders guided students browser callbacks with paging controls', async () => {
    const editHtmlMessage = vi.fn(async () => true);
    const answerCallbackQuery = vi.fn(async () => true);
    const listStudentSummaries = vi.fn(async () => ({
      items: [
        {
          id: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
          name: 'Margarita',
          lastLessonAt: '2026-03-14T08:47:06.373Z',
          pendingDrafts: 1,
        },
      ],
      total: 11,
      limit: 10,
      offset: 0,
    }));
    const { runner } = createRunner({
      editHtmlMessage,
      answerCallbackQuery,
      backend: {
        listStudentSummaries,
      },
    });

    await processUpdate(
      runner,
      createCallbackUpdate('a4|sh', {
        chatId: 123,
        chatType: 'supergroup',
      }),
    );

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(listStudentSummaries).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
      order: 'desc',
    });
    const firstEditCall = editHtmlMessage.mock.calls[0] as
      | [{ html: string; replyMarkup?: { inline_keyboard: { text: string }[][] } }]
      | undefined;
    expect(firstEditCall?.[0].html).toContain('Students · Page 1');
    expect(firstEditCall?.[0].replyMarkup?.inline_keyboard).toEqual(
      expect.arrayContaining([
        [expect.objectContaining({ text: 'Margarita · 72444fdf' })],
        expect.arrayContaining([expect.objectContaining({ text: 'Next' })]),
      ]),
    );
  });

  it('keeps legacy job_links callbacks working by routing them through share', async () => {
    const answerCallbackQuery = vi.fn(async () => true);
    const sendHtmlMessage = vi.fn(async (payload: { chatId: string; html: string }) => ({
      message_id: 88,
      date: 1_700_000_000,
      chat: { id: Number(payload.chatId), type: 'supergroup', title: 'Ops Chat' },
      text: payload.html,
    }));
    const { runner } = createRunner({
      sendHtmlMessage,
      answerCallbackQuery,
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-legacy-links',
            htmlUrl: 'https://example.com/share.html',
            studentId: 'student-1',
            studentName: 'Mary Jane',
          }),
        ),
      },
    });

    await processUpdate(
      runner,
      createCallbackUpdate('a4|jl|job-legacy-links', {
        chatId: 123,
        chatType: 'supergroup',
      }),
    );

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(sendHtmlMessage).toHaveBeenCalledTimes(3);
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('Use <code>/share</code> going forward.');
    expect(sendHtmlMessage.mock.calls[1]?.[0].html).toContain('<b>Share package</b>');
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
      | [{ html: string; replyMarkup?: { inline_keyboard: { text: string }[][] } }]
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
});
