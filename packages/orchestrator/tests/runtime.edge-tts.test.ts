import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PipelineLogger } from '@esl-pipeline/contracts';

import { synthesizeEdgeTtsClip } from '../src/runtime/edge-tts.js';

function createLogger(logs: unknown[]): PipelineLogger {
  return {
    log: (entry) => logs.push(entry),
  } as PipelineLogger;
}

describe('runtime/edge-tts', () => {
  const originalVoice = process.env.ESL_EDGE_TTS_VOICE;

  beforeEach(() => {
    delete process.env.ESL_EDGE_TTS_VOICE;
  });

  afterEach(() => {
    if (originalVoice === undefined) {
      delete process.env.ESL_EDGE_TTS_VOICE;
      return;
    }
    process.env.ESL_EDGE_TTS_VOICE = originalVoice;
  });

  it('defaults to the canonical English voice when no override is set', async () => {
    const logs: unknown[] = [];
    const result = await synthesizeEdgeTtsClip({
      text: 'ship',
      outPath: '/tmp',
      fileStem: 'default-voice',
      preview: true,
      logger: createLogger(logs),
    });

    expect(result.voice).toBe('en-US-AriaNeural');
    expect(logs).toEqual([]);
  });

  it('accepts explicit en-GB overrides', async () => {
    process.env.ESL_EDGE_TTS_VOICE = 'en-GB-SoniaNeural';
    const result = await synthesizeEdgeTtsClip({
      text: 'sheep',
      outPath: '/tmp',
      fileStem: 'en-gb-voice',
      preview: true,
      logger: createLogger([]),
    });

    expect(result.voice).toBe('en-GB-SoniaNeural');
  });

  it('falls back to the default English voice for invalid overrides', async () => {
    process.env.ESL_EDGE_TTS_VOICE = 'de-DE-KatjaNeural';
    const logs: unknown[] = [];
    const result = await synthesizeEdgeTtsClip({
      text: 'pronunciation',
      outPath: '/tmp',
      fileStem: 'invalid-voice',
      preview: true,
      logger: createLogger(logs),
    });

    expect(result.voice).toBe('en-US-AriaNeural');
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          stage: 'tts',
          message: 'Invalid edge-tts voice override; falling back to default English voice',
          detail: expect.objectContaining({
            requestedVoice: 'de-DE-KatjaNeural',
            fallbackVoice: 'en-US-AriaNeural',
          }),
        }),
      ]),
    );
  });
});
