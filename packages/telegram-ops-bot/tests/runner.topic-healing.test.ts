import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetGuidedConfirmGuardsForTests } from '../src/guided-ui.js';
import { TelegramApiError } from '../src/telegram-client.js';

import {
  createJob,
  createRunner,
  createCallbackUpdate,
  createUpdate,
  processUpdate,
} from './telegram-test-fixtures.js';

beforeEach(() => {
  resetGuidedConfirmGuardsForTests();
});

describe('telegram runner topic healing', () => {
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
    const { runner, auditLog } = createRunner({
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
    expect(sendHtmlMessage).toHaveBeenCalledTimes(4);
    expect(sendHtmlMessage.mock.calls[0]?.[0].threadId).toBe(333);
    expect(sendHtmlMessage.mock.calls[1]?.[0].threadId).toBe(999);
    expect(sendHtmlMessage.mock.calls[2]?.[0].threadId).toBeUndefined();
    expect(sendHtmlMessage.mock.calls[3]?.[0].threadId).toBe(333);
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
    expect(sendHtmlMessage).toHaveBeenCalledTimes(3);
    expect(sendHtmlMessage.mock.calls[0]?.[0].threadId).toBe(333);
    expect(sendHtmlMessage.mock.calls[1]?.[0].threadId).toBe(444);
    expect(sendHtmlMessage.mock.calls[2]?.[0].threadId).toBe(333);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'topic_recreated',
        threadId: 444,
      }),
    );
  });
});
