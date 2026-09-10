import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createDeepgramSttProvider, type DeepgramSttConfig } from '../src/index.js';

function baseConfig(): DeepgramSttConfig {
  return {
    apiKey: 'test-key',
    model: 'nova-3',
    language: 'multi',
  };
}

describe('stt-provider-deepgram', () => {
  it('uses the installed SDK transport once for a retryable 503', async () => {
    const originalFetch = globalThis.fetch;
    const dispatch = vi.fn(async () => new Response('unavailable', { status: 503 }));
    globalThis.fetch = dispatch;
    try {
      const provider = createDeepgramSttProvider();
      await expect(
        provider.transcribe({
          context: {
            recordingId: 'recording-sdk-retry',
            storageUri: 'local://recordings/recording-sdk-retry.wav',
            getStream: async () => Readable.from(['audio']),
          },
          config: baseConfig(),
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_RETRYABLE_HTTP', status: 503 });
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails closed when a trusted split response does not preserve both channels', async () => {
    const transcribeFile = vi.fn(async () => ({
      metadata: { channels: 1 },
      results: { channels: [{ alternatives: [{ transcript: 'collapsed audio' }] }] },
    }));
    const provider = createDeepgramSttProvider({
      clientFactory: () => ({ listen: { v1: { media: { transcribeFile } } } }),
    });

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'recording-1',
          storageUri: 'local://recordings/recording-1.wav',
          getStream: async () => Readable.from(['audio']),
        },
        config: { ...baseConfig(), trustedSplitChannels: true },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
    expect(transcribeFile).toHaveBeenCalledTimes(1);
  });

  it('does not treat diarization speakers as trusted channel provenance', async () => {
    const transcribeFile = vi.fn(async () => ({
      metadata: { channels: 2 },
      results: {
        utterances: [
          { transcript: 'Tutor turn', speaker: 0, start: 0, end: 0.5 },
          { transcript: 'Student turn', speaker: 1, start: 1, end: 1.5 },
        ],
        channels: [
          { alternatives: [{ transcript: 'Tutor turn' }] },
          { alternatives: [{ transcript: 'Student turn' }] },
        ],
      },
    }));
    const provider = createDeepgramSttProvider({
      clientFactory: () => ({ listen: { v1: { media: { transcribeFile } } } }),
    });

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'recording-1',
          storageUri: 'local://recordings/recording-1.wav',
          getStream: async () => Readable.from(['audio']),
        },
        config: { ...baseConfig(), trustedSplitChannels: true },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
    expect(transcribeFile).toHaveBeenCalledTimes(1);
  });

  it('fails closed for unexpected trusted channel identities', async () => {
    const transcribeFile = vi.fn(async () => ({
      metadata: { channels: 2 },
      results: {
        utterances: [
          { transcript: 'Tutor turn', channel: 0, start: 0, end: 0.5 },
          { transcript: 'Unexpected turn', channel: 2, start: 1, end: 1.5 },
        ],
        channels: [
          { alternatives: [{ transcript: 'Tutor turn' }] },
          { alternatives: [{ transcript: 'Unexpected turn' }] },
        ],
      },
    }));
    const provider = createDeepgramSttProvider({
      clientFactory: () => ({ listen: { v1: { media: { transcribeFile } } } }),
    });

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'recording-1',
          storageUri: 'local://recordings/recording-1.wav',
          getStream: async () => Readable.from(['audio']),
        },
        config: { ...baseConfig(), trustedSplitChannels: true },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
  });

  it('transcribes with multichannel primary path', async () => {
    const transcribeFile = vi.fn(async () => ({
      metadata: { channels: 2 },
      results: {
        utterances: [
          { transcript: 'Hello', speaker: 0, start: 0, end: 0.5 },
          { transcript: 'Hi', speaker: 1, start: 1, end: 1.4 },
        ],
        channels: [{ alternatives: [{ transcript: 'Hello Hi' }] }],
      },
    }));

    const getStream = vi.fn(async () => Readable.from(Buffer.from('audio')));
    const provider = createDeepgramSttProvider({
      clientFactory: () => ({
        listen: {
          v1: {
            media: {
              transcribeFile,
            },
          },
        },
      }),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-1',
        storageUri: 'local://audio.wav',
        getStream,
      },
      config: baseConfig(),
    });

    expect(result.provider).toBe('deepgram');
    expect(result.fallbackUsed).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(transcribeFile).toHaveBeenCalledTimes(1);
    expect(getStream).toHaveBeenCalledTimes(1);
  });

  it('preserves a missing lexical speaker instead of inheriting speaker 0', async () => {
    const provider = createDeepgramSttProvider({
      clientFactory: () => ({
        listen: {
          v1: {
            media: {
              async transcribeFile() {
                return {
                  results: {
                    utterances: [
                      { transcript: 'Tutor', speaker: 0, start: 0, end: 0.2 },
                      { transcript: 'Unknown', start: 0.3, end: 0.5 },
                      { transcript: 'Student', speaker: 1, start: 0.6, end: 0.8 },
                    ],
                    channels: [{ alternatives: [{ transcript: 'Tutor Unknown Student' }] }],
                  },
                };
              },
            },
          },
        },
      }),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-speaker-provenance',
        storageUri: 'local://audio.wav',
        getStream: async () => Readable.from(['audio']),
      },
      config: baseConfig(),
    });

    expect(result.segments.map((segment) => segment.speaker)).toEqual([0, undefined, 1]);
  });

  it('does not hide a second Deepgram submission behind adapter fallback', async () => {
    const transcribeFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('terminated'))
      .mockResolvedValueOnce({
        metadata: { channels: 1 },
        results: {
          utterances: [{ transcript: 'Fallback', speaker: 0, start: 0.2, end: 0.9 }],
          channels: [{ alternatives: [{ transcript: 'Fallback' }] }],
        },
      });

    const provider = createDeepgramSttProvider({
      clientFactory: () => ({
        listen: {
          v1: {
            media: {
              transcribeFile,
            },
          },
        },
      }),
    });

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'rec-1',
          storageUri: 'local://audio.wav',
          async getStream() {
            return Readable.from(Buffer.from('audio'));
          },
        },
        config: baseConfig(),
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TRANSPORT_ERROR' });

    expect(transcribeFile).toHaveBeenCalledTimes(1);
  });

  it('throws on async accepted responses', async () => {
    const provider = createDeepgramSttProvider({
      clientFactory: () => ({
        listen: {
          v1: {
            media: {
              async transcribeFile() {
                return { request_id: 'req-123' };
              },
            },
          },
        },
      }),
    });

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'rec-1',
          storageUri: 'local://audio.wav',
          async getStream() {
            return Readable.from(Buffer.from('audio'));
          },
        },
        config: baseConfig(),
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
  });

  it('uses the actual SDK injected fetch and prevents a cancelled continuation from dispatching', async () => {
    const dispatch = vi.fn<typeof fetch>(async () => new Response('{}'));
    const controller = new AbortController();
    controller.abort();
    const guardedFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (controller.signal.aborted || init?.signal?.aborted) {
        throw Object.assign(new Error('dispatch cancelled'), {
          code: 'AMBIGUOUS_PROVIDER_OUTCOME',
        });
      }
      return dispatch(input, init);
    });
    const provider = createDeepgramSttProvider();

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'rec-stale-sdk-preparation',
          storageUri: 'local://audio.wav',
          getStream: async () => Readable.from(['audio']),
          providerTransport: { fetch: guardedFetch, signal: controller.signal },
        },
        config: baseConfig(),
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TRANSPORT_ERROR' });
    expect(guardedFetch).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('normalizes Deepgram Spanish-looking aha in returned segments', async () => {
    const provider = createDeepgramSttProvider({
      clientFactory: () => ({
        listen: {
          v1: {
            media: {
              async transcribeFile() {
                return {
                  metadata: { channels: 2 },
                  results: {
                    utterances: [{ transcript: 'Ajá, got it.', speaker: 1, start: 1, end: 1.4 }],
                    channels: [{ alternatives: [{ transcript: 'Ajá, got it.' }] }],
                  },
                };
              },
            },
          },
        },
      }),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-1',
        storageUri: 'local://audio.wav',
        async getStream() {
          return Readable.from(Buffer.from('audio'));
        },
      },
      config: baseConfig(),
    });

    expect(result.text).toBe('Ага, got it.');
    expect(result.segments[0]?.text).toBe('Ага, got it.');
  });
});
