import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createGoogleSttProvider } from '../src/index.js';

describe('stt-provider-google', () => {
  it('uses gs:// input directly without staging upload', async () => {
    const recognize = vi.fn(async () => [
      {
        results: [
          {
            channelTag: 0,
            alternatives: [
              {
                words: [{ word: 'Hello', startOffset: '0.1s', endOffset: '0.5s', channelTag: 0 }],
              },
            ],
          },
          {
            channelTag: 1,
            alternatives: [
              {
                words: [{ word: 'Hi', startOffset: '1.0s', endOffset: '1.4s', channelTag: 1 }],
              },
            ],
          },
        ],
      },
    ]);
    const save = vi.fn(async () => {});

    const provider = createGoogleSttProvider({
      speechClientFactory: () => ({ recognize }),
      storageClientFactory: () => ({
        bucket: () => ({
          file: () => ({ save }),
        }),
      }),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-1',
        storageUri: 'gs://input-bucket/rec.wav',
        async getStream() {
          return Readable.from(Buffer.from('audio'));
        },
      },
      config: {
        projectId: 'proj',
        location: 'us-central1',
        gcsStagingBucket: 'staging-bucket',
      },
    });

    expect(result.provider).toBe('google');
    expect(result.fallbackUsed).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
  });

  it('stages non-gs URI input and falls back when primary collapses to one channel', async () => {
    const recognize = vi
      .fn()
      .mockResolvedValueOnce([
        {
          results: [
            {
              channelTag: 0,
              alternatives: [
                {
                  words: [{ word: 'Hello', startOffset: '0.1s', endOffset: '0.5s', channelTag: 0 }],
                },
              ],
            },
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          results: [
            {
              alternatives: [
                {
                  words: [
                    { word: 'Hello', startOffset: '0.1s', endOffset: '0.5s', speakerLabel: 'speaker_0' },
                    { word: 'Hi', startOffset: '1.0s', endOffset: '1.5s', speakerLabel: 'speaker_1' },
                  ],
                },
              ],
            },
          ],
        },
      ]);

    const save = vi.fn(async () => {});

    const provider = createGoogleSttProvider({
      speechClientFactory: () => ({ recognize }),
      storageClientFactory: () => ({
        bucket: () => ({
          file: () => ({ save }),
        }),
      }),
      now: () => new Date('2026-03-10T00:00:00.000Z'),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-1',
        storageUri: 'local://uploads/rec.wav',
        async getStream() {
          return Readable.from(Buffer.from('audio'));
        },
      },
      config: {
        projectId: 'proj',
        location: 'us-central1',
        gcsStagingBucket: 'staging-bucket',
      },
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.fallbackUsed).toBe(true);
    expect(result.segments[0]?.speaker).toBe(0);
    expect(result.segments[1]?.speaker).toBe(1);
  });

  it('requires staging bucket', async () => {
    const provider = createGoogleSttProvider({
      speechClientFactory: () => ({
        async recognize() {
          return [{ results: [] }];
        },
      }),
      storageClientFactory: () => ({
        bucket: () => ({
          file: () => ({
            async save() {
              return;
            },
          }),
        }),
      }),
    });

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'rec-1',
          storageUri: 'local://uploads/rec.wav',
          async getStream() {
            return Readable.from(Buffer.from('audio'));
          },
        },
        config: {
          projectId: 'proj',
          location: 'us-central1',
          gcsStagingBucket: '',
        },
      }),
    ).rejects.toThrow(/GOOGLE_STT_GCS_STAGING_BUCKET is required/i);
  });
});
