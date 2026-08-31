import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createElevenLabsSttProvider } from '../src/index.js';

describe('stt-provider-elevenlabs', () => {
  it('uses exactly one diarized Scribe v2 request for mixed audio', async () => {
    const convert = vi.fn(async () => ({
      text: 'Hello hi',
      words: [
        { text: 'Hello', speakerId: 'speaker_1', start: 0.1, end: 0.3 },
        { text: 'hi', speakerId: 'speaker_0', start: 0.5, end: 0.7 },
      ],
    }));

    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert,
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
      config: {
        apiKey: 'test',
      },
    });

    expect(result.fallbackUsed).toBe(false);
    expect(result.provider).toBe('elevenlabs');
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments[0]?.speaker).toBe(1);
    expect(result.segments[1]?.speaker).toBe(0);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(convert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'scribe_v2',
        useMultiChannel: false,
        diarize: true,
        numSpeakers: 2,
        timestampsGranularity: 'word',
        noVerbatim: false,
      }),
    );
  });

  it('does not make a fallback request when the one mixed request fails', async () => {
    const convert = vi.fn().mockRejectedValueOnce(new Error('provider unavailable'));

    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert,
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
        config: {
          apiKey: 'test',
        },
      }),
    ).rejects.toThrow('provider unavailable');
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it('requires api key', async () => {
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          async convert() {
            return {};
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
        config: {
          apiKey: '',
        },
      }),
    ).rejects.toThrow(/ELEVENLABS_API_KEY is required/i);
  });
});
