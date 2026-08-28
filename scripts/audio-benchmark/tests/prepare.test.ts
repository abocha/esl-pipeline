import { describe, expect, test } from 'vitest';

import { buildDownmixPlan } from '../prepare';

describe('controlled downmix preparation', () => {
  test('builds a fixed mono 16 kHz PCM command without source cleanup', () => {
    const plan = buildDownmixPlan({
      inputPath: 'C:\\bench\\corpus\\lesson.wav',
      outputPath: 'C:\\bench\\prepared\\lesson.wav',
      sourceChannels: 2,
    });

    expect(plan.args).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      'C:\\bench\\corpus\\lesson.wav',
      '-map_metadata',
      '-1',
      '-vn',
      '-af',
      'pan=mono|c0=0.5*c0+0.5*c1',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      'C:\\bench\\prepared\\lesson.wav',
    ]);
    expect(plan.preparationVersion).toBe('downmix-mono-pcm-s16le-16k-v1');
  });

  test('refuses to downmix a source that is not exactly two channel', () => {
    expect(() =>
      buildDownmixPlan({
        inputPath: 'source.wav',
        outputPath: 'prepared.wav',
        sourceChannels: 1,
      }),
    ).toThrow(/exactly two channels/u);
  });
});
