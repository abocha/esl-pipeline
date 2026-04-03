import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createDeepgramSttProvider, type DeepgramSttConfig } from '../src/index.js';

function baseConfig(): DeepgramSttConfig {
  return {
    apiKey: 'test-key',
    model: 'nova-3',
    language: 'multi',
    retryBaseDelayMs: 0,
    retryMax: 1,
  };
}

describe('stt-provider-deepgram', () => {
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
        async getStream() {
          return Readable.from(Buffer.from('audio'));
        },
      },
      config: baseConfig(),
    });

    expect(result.provider).toBe('deepgram');
    expect(result.fallbackUsed).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(transcribeFile).toHaveBeenCalledTimes(1);
  });

  it('falls back to diarize when primary fails', async () => {
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

    expect(result.fallbackUsed).toBe(true);
    expect(transcribeFile).toHaveBeenCalledTimes(2);
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
    ).rejects.toThrow(/async accepted response/i);
  });
});
