import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetGuidedConfirmGuardsForTests } from '../src/guided-ui.js';
import { createJob, createRunner, createUpdate, processUpdate } from './telegram-test-fixtures.js';

beforeEach(() => {
  resetGuidedConfirmGuardsForTests();
});
describe('telegram runner historical sharing', () => {
  it('shares durable historical outputs in order without reading Markdown or fetching HTML', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { runner, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'historical',
            md: '/missing/historical.md',
            htmlUrl: 'https://lesson.test/history',
            publication: {
              schemaVersion: 1,
              rendererVersion: 1,
              title: 'History',
              icon: '📘',
              studyTextAudioUrl: 'https://audio.test/study.mp3',
              pronunciationAudioUrl: 'https://audio.test/pronunciation.mp3',
            },
          }),
        ),
      },
    });
    try {
      await processUpdate(
        runner,
        createUpdate('/share historical', { chatId: 123, chatType: 'supergroup' }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sendHtmlMessage).toHaveBeenCalledTimes(4);
      expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('<b>Share package</b>');
      expect(sendHtmlMessage.mock.calls[1]?.[0].html).toContain('History');
      expect(sendHtmlMessage.mock.calls[1]?.[0].disableLinkPreview).toBe(true);
      expect(sendHtmlMessage.mock.calls[2]?.[0].html).toContain('https://audio.test/study.mp3');
      expect(sendHtmlMessage.mock.calls[2]?.[0].disableLinkPreview).toBe(false);
      expect(sendHtmlMessage.mock.calls[3]?.[0].html).toContain(
        'https://audio.test/pronunciation.mp3',
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'share_path_telemetry',
          details: expect.objectContaining({
            studyAudioSource: 'publication',
            pronunciationAudioSource: 'publication',
            htmlFetched: false,
          }),
        }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it('keeps the produced HTML link when metadata is missing without scraping historical content', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { runner, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'missing-metadata',
            md: '# Hidden title\n[Audio recording: Study Text](https://wrong.test/study.mp3)',
            htmlUrl: 'https://lesson.test/history',
          }),
        ),
      },
    });
    try {
      await processUpdate(
        runner,
        createUpdate('/share missing-metadata', { chatId: 123, chatType: 'supergroup' }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sendHtmlMessage).toHaveBeenCalledTimes(2);
      expect(sendHtmlMessage.mock.calls[1]?.[0].html).toContain('https://lesson.test/history');
      const html = sendHtmlMessage.mock.calls.map((c) => c[0].html).join('\n');
      expect(html).not.toContain('Hidden title');
      expect(html).not.toContain('https://wrong.test');
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'share_path_telemetry',
          details: expect.objectContaining({
            missingAudioCount: 2,
            studyAudioSource: 'missing',
            pronunciationAudioSource: 'missing',
          }),
        }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
