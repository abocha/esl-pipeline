import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetGuidedConfirmGuardsForTests } from '../src/guided-ui.js';

import { createJob, createRunner, createUpdate, processUpdate } from './telegram-test-fixtures.js';

beforeEach(() => {
  resetGuidedConfirmGuardsForTests();
});

describe('telegram runner share smoke', () => {
  it('uses markdown-first extraction precedence and preserves ordering + preview flags', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><head><title>Fallback Title</title></head><body>ignored</body></html>', {
        status: 200,
      }),
    );

    const { runner, backend, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-md-first',
            md: [
              '---',
              'title: "Homework Assignment: Markdown First"',
              'icon: "📘"',
              '---',
              '[Audio recording: Study Text](https://bucket.s3.amazonaws.com/audio/final/md-first-study.mp3)',
              '[Audio recording: Pronunciation Practice](https://bucket.s3.amazonaws.com/audio/pronunciation/md-first-pron.mp3)',
            ].join('\n'),
            htmlUrl: 'https://example.com/fallback-if-needed.html',
          }),
        ),
      },
    });

    await processUpdate(runner, createUpdate('/share job-md-first', { chatId: 123, chatType: 'supergroup' }));

    expect(backend.getJob).toHaveBeenCalledWith('job-md-first');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendHtmlMessage).toHaveBeenCalledTimes(4);
    expect(sendHtmlMessage.mock.calls[0]?.[0].disableLinkPreview).toBe(true);
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('<b>Share package</b>');
    expect(sendHtmlMessage.mock.calls[1]?.[0].disableLinkPreview).toBe(true);
    expect(sendHtmlMessage.mock.calls[2]?.[0].disableLinkPreview).toBe(false);
    expect(sendHtmlMessage.mock.calls[3]?.[0].disableLinkPreview).toBe(false);
    expect(sendHtmlMessage.mock.calls[2]?.[0].html).toContain('🎧 Listen 1: Study Text');
    expect(sendHtmlMessage.mock.calls[3]?.[0].html).toContain('🗣️ Listen 2: Pronunciation');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share_path_telemetry',
        details: expect.objectContaining({
          usedHtmlFallback: false,
          studyAudioSource: 'markdown_label',
          pronunciationAudioSource: 'markdown_label',
        }),
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'command_outcome',
        details: expect.objectContaining({
          status: 'completed',
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('falls back to html extraction when markdown content is unavailable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        [
          '<html><head><title>Homework Assignment: Html Fallback</title></head><body>',
          '<div class="hero-emoji">🏢</div>',
          'https://bucket.s3.amazonaws.com/audio/final/html-study.mp3',
          'https://bucket.s3.amazonaws.com/audio/pronunciation/html-pron.mp3',
          '</body></html>',
        ].join('\n'),
        { status: 200 },
      ),
    );

    const { runner, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-html-fallback',
            md: '/tmp/does-not-exist.md',
            htmlUrl: 'https://example.com/share-fallback.html',
          }),
        ),
      },
    });

    await processUpdate(
      runner,
      createUpdate('/share job-html-fallback', { chatId: 123, chatType: 'supergroup' }),
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(sendHtmlMessage).toHaveBeenCalledTimes(4);
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('<b>Share package</b>');
    expect(sendHtmlMessage.mock.calls[1]?.[0].html).toContain('🏢 Homework Assignment: Html Fallback');
    expect(sendHtmlMessage.mock.calls[2]?.[0].html).toContain('audio/final/html-study.mp3');
    expect(sendHtmlMessage.mock.calls[3]?.[0].html).toContain('audio/pronunciation/html-pron.mp3');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share_path_telemetry',
        details: expect.objectContaining({
          usedHtmlFallback: true,
          studyAudioSource: 'html_path',
          pronunciationAudioSource: 'html_path',
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('keeps markdown path-hint audio precedence over competing html audio urls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        [
          '<html><head><title>Homework Assignment: Html Title</title></head><body>',
          'https://bucket.s3.amazonaws.com/audio/final/html-should-not-win.mp3',
          'https://bucket.s3.amazonaws.com/audio/pronunciation/html-should-not-win.mp3',
          '</body></html>',
        ].join('\n'),
        { status: 200 },
      ),
    );

    const { runner, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-md-path-precedence',
            md: [
              'content without heading title to trigger html title fallback',
              'https://bucket.s3.amazonaws.com/audio/final/md-path-study.mp3',
              'https://bucket.s3.amazonaws.com/audio/pronunciation/md-path-pron.mp3',
            ].join('\n'),
            htmlUrl: 'https://example.com/share-md-path-precedence.html',
          }),
        ),
      },
    });

    await processUpdate(
      runner,
      createUpdate('/share job-md-path-precedence', { chatId: 123, chatType: 'supergroup' }),
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(sendHtmlMessage).toHaveBeenCalledTimes(4);
    expect(sendHtmlMessage.mock.calls[0]?.[0].disableLinkPreview).toBe(true);
    expect(sendHtmlMessage.mock.calls[1]?.[0].disableLinkPreview).toBe(true);
    expect(sendHtmlMessage.mock.calls[2]?.[0].disableLinkPreview).toBe(false);
    expect(sendHtmlMessage.mock.calls[3]?.[0].disableLinkPreview).toBe(false);
    expect(sendHtmlMessage.mock.calls[2]?.[0].html).toContain('audio/final/md-path-study.mp3');
    expect(sendHtmlMessage.mock.calls[3]?.[0].html).toContain('audio/pronunciation/md-path-pron.mp3');
    expect(sendHtmlMessage.mock.calls[2]?.[0].html).not.toContain('html-should-not-win.mp3');
    expect(sendHtmlMessage.mock.calls[3]?.[0].html).not.toContain('html-should-not-win.mp3');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share_path_telemetry',
        details: expect.objectContaining({
          studyAudioSource: 'markdown_path',
          pronunciationAudioSource: 'markdown_path',
        }),
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bot_metric',
        details: expect.objectContaining({
          metric: 'share_extraction_source',
          labels: expect.objectContaining({
            source: 'markdown_path',
          }),
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('degrades gracefully when audio links are missing', async () => {
    const { runner, sendHtmlMessage, auditLog } = createRunner({
      backend: {
        getJob: vi.fn(async () =>
          createJob({
            jobId: 'job-no-audio',
            htmlUrl: 'https://example.com/no-audio.html',
          }),
        ),
      },
    });

    await processUpdate(runner, createUpdate('/share job-no-audio', { chatId: 123, chatType: 'supergroup' }));

    expect(sendHtmlMessage).toHaveBeenCalledTimes(2);
    expect(sendHtmlMessage.mock.calls[0]?.[0].html).toContain('<b>Share package</b>');
    expect(sendHtmlMessage.mock.calls[1]?.[0].disableLinkPreview).toBe(true);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share_path_telemetry',
        details: expect.objectContaining({
          missingStudyAudio: true,
          missingPronunciationAudio: true,
          missingAudioCount: 2,
        }),
      }),
    );
  });
});
