import { describe, expect, it, vi } from 'vitest';

import { ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH } from '@esl-pipeline/contracts';

import { fetchYouTubeMaterialTranscript } from '../src/infrastructure/material-transcript.js';

const videoId = 'abc123XYZ_0';
const url = `https://youtu.be/${videoId}`;
const config = { apiKey: 'test-only-key', timeoutMs: 1000 };

describe('YouTube assignment material adapter', () => {
  it('sends only the external video identity and options to the fixed provider origin', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        video_id: videoId,
        language: 'en',
        transcript: [{ text: ' First caption. ' }, { text: 'Second caption.' }],
      }),
    );
    await expect(fetchYouTubeMaterialTranscript(url, config, fetcher)).resolves.toEqual({
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      sourceText: 'First caption.\nSecond caption.',
    });
    const [endpoint, options] = fetcher.mock.calls[0]!;
    expect(String(endpoint)).toBe(
      `https://transcriptapi.com/api/v2/youtube/transcript?video_url=${videoId}&format=json&include_timestamp=false`,
    );
    expect(options).toMatchObject({
      headers: { Authorization: 'Bearer test-only-key', Accept: 'application/json' },
      redirect: 'error',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not call a provider when credentials are absent', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      fetchYouTubeMaterialTranscript(url, { timeoutMs: 100 }, fetcher),
    ).rejects.toMatchObject({ code: 'transcript_unconfigured', statusCode: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'https://youtube.com.evil.test/watch?v=abc123XYZ_0',
    'http://127.0.0.1/watch?v=abc123XYZ_0',
    'https://user:pass@youtube.com/watch?v=abc123XYZ_0',
    'file:///abc123XYZ_0',
    'https://youtube.com/watch?v=short',
    'https://youtube.com/playlist?list=abc123XYZ_0',
  ])('rejects unsafe or unsupported video URL %s without fetching', async (source) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchYouTubeMaterialTranscript(source, config, fetcher)).rejects.toMatchObject({
      code: 'unsupported_video_url',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [402, 'transcript_credits_exhausted', 503],
    [404, 'transcript_unavailable', 422],
    [422, 'transcript_unavailable', 422],
    [429, 'transcript_rate_limited', 429],
    [401, 'transcript_provider_failed', 502],
    [500, 'transcript_provider_failed', 502],
  ])(
    'maps provider %s into a sanitized manual-path failure without retrying',
    async (status, code, httpStatus) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('sensitive provider detail test-only-key', { status }));
      let error: unknown;
      try {
        await fetchYouTubeMaterialTranscript(url, config, fetcher);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code, statusCode: httpStatus });
      expect(String(error)).not.toContain('test-only-key');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { video_id: 'anotherID_0', transcript: [{ text: 'Wrong video.' }] },
    { video_id: videoId, transcript: [] },
    { video_id: videoId, transcript: [{ text: ' ' }] },
    { video_id: videoId, transcript: [{ unexpected: 'caption' }] },
    { video_id: videoId, transcript: 'unexpected text format' },
    null,
  ])('rejects unusable/mismatched JSON without leaking its body', async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(fetchYouTubeMaterialTranscript(url, config, fetcher)).rejects.toMatchObject({
      code: 'transcript_invalid_response',
    });
  });

  it('rejects malformed JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{bad json'));
    await expect(fetchYouTubeMaterialTranscript(url, config, fetcher)).rejects.toMatchObject({
      code: 'transcript_invalid_response',
    });
  });

  it('rejects oversized content rather than truncating it', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        video_id: videoId,
        transcript: [{ text: 'a'.repeat(ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH + 1) }],
      }),
    );
    await expect(fetchYouTubeMaterialTranscript(url, config, fetcher)).rejects.toMatchObject({
      code: 'transcript_too_large',
    });
  });

  it('bounds streamed response bytes even without Content-Length', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('a'.repeat(1_000_001)));
    await expect(fetchYouTubeMaterialTranscript(url, config, fetcher)).rejects.toMatchObject({
      code: 'transcript_too_large',
    });
  });

  it('aborts timed out requests and keeps the failure actionable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted secret detail')),
            { once: true },
          );
        }),
    );
    await expect(
      fetchYouTubeMaterialTranscript(url, { ...config, timeoutMs: 5 }, fetcher),
    ).rejects.toMatchObject({ code: 'transcript_timeout', statusCode: 504 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
