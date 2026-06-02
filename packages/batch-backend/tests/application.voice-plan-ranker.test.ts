import { describe, expect, it, vi } from 'vitest';

import { createBackendVoicePlanRanker } from '../src/application/voice-plan-ranker.js';
import { loadConfig } from '../src/config/env.js';

describe('application/voice-plan-ranker', () => {
  it('uses structured Gemini output with the dedicated Gemma model', async () => {
    const base = loadConfig();
    const config = {
      ...base,
      generation: {
        ...base.generation,
        providers: {
          ...base.generation.providers,
          googleAiStudio: {
            ...base.generation.providers.googleAiStudio,
            apiKey: 'test-gemini-key',
          },
        },
      },
    };
    const executor = vi.fn().mockResolvedValue({
      output: {
        selections: [{ speaker: 'Nina', voiceId: 'calm-american' }],
      },
      rawText: '{}',
      usage: { totalTokens: 12 },
    });
    const ranker = createBackendVoicePlanRanker(config, {
      executor,
      now: () => new Date('2026-06-02T00:00:00.000Z'),
    });

    await expect(
      ranker.rank({
        provider: 'inworld',
        model: 'inworld-tts-2',
        speakers: [
          {
            speaker: 'Nina',
            profile: { id: 'Nina', role: 'thoughtful project manager' },
            candidates: [
              {
                voiceId: 'calm-american',
                name: 'Calm American',
                score: 88,
                tags: ['neutral', 'steerable'],
                capabilities: {
                  supportsMetadataInstructions: true,
                  supportsNonVerbals: true,
                  supportsUppercaseEmphasis: true,
                  supportsFreeFormDirection: true,
                },
              },
            ],
          },
        ],
      }),
    ).resolves.toEqual({
      selections: [{ speaker: 'Nina', voiceId: 'calm-american' }],
    });
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          model: 'gemma-4-31b-it',
          maxOutputTokens: 1200,
          prompt: expect.stringContaining('Do not emit Markdown fences, prose, reasons'),
          responseSchema: expect.objectContaining({
            schema: expect.objectContaining({
              properties: expect.objectContaining({
                selections: expect.objectContaining({
                  items: expect.objectContaining({
                    properties: expect.not.objectContaining({
                      reason: expect.anything(),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });
});
