import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createElevenLabsSttProvider } from '../src/index.js';

describe('stt-provider-elevenlabs', () => {
  it('uses multichannel response when available and interleaves speakers', async () => {
    const convert = vi.fn(async () => ({
      transcripts: [
        {
          channelIndex: 0,
          text: 'Teacher hello',
          words: [
            { text: 'Teacher', start: 0.1, end: 0.3, channelIndex: 0 },
            { text: 'hello', start: 0.31, end: 0.45, channelIndex: 0 },
          ],
        },
        {
          channelIndex: 1,
          text: 'Student hi',
          words: [
            { text: 'Student', start: 0.5, end: 0.7, channelIndex: 1 },
            { text: 'hi', start: 0.71, end: 0.8, channelIndex: 1 },
          ],
        },
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
    expect(result.segments[0]?.speaker).toBe(0);
    expect(result.segments[1]?.speaker).toBe(1);
  });

  it('falls back to diarized mode when multichannel request fails', async () => {
    const convert = vi
      .fn()
      .mockRejectedValueOnce(new Error('multichannel unsupported'))
      .mockResolvedValueOnce({
        text: 'Hello there',
        words: [
          { text: 'Hello', speakerId: 'speaker_0', start: 0.1, end: 0.4 },
          { text: 'there', speaker_id: 'speaker_1', start: 1, end: 1.3 },
        ],
      });

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

    expect(result.fallbackUsed).toBe(true);
    expect(result.segments[0]?.speaker).toBe(0);
    expect(result.segments[1]?.speaker).toBe(1);
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
