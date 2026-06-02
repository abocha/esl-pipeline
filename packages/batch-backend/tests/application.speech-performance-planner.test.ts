import { describe, expect, it, vi } from 'vitest';

import { SpeechPerformancePlannerInvalidOutputError } from '@esl-pipeline/tts-core';

import { createBackendSpeechPerformancePlanner } from '../src/application/speech-performance-planner.js';
import { loadConfig } from '../src/config/env.js';

function createPrepared() {
  return {
    selection: { provider: 'inworld' as const, model: 'inworld-tts-2' as const },
    sourceHash: 'source-hash',
    segments: [{ id: 'segment-1', speaker: 'Maya', text: 'We need a clearer deadline.' }],
    voices: [],
    voiceAssignments: {},
    voicePlan: {
      schemaVersion: 1 as const,
      mode: 'resolved' as const,
      provider: 'inworld' as const,
      model: 'inworld-tts-2' as const,
      sourceHash: 'source-hash',
      assignments: [
        {
          speaker: 'Maya',
          voiceId: 'Steerable Maya',
          source: 'auto' as const,
          capabilities: {
            supportsMetadataInstructions: true,
            supportsNonVerbals: true,
            supportsUppercaseEmphasis: true,
            supportsFreeFormDirection: true,
          },
        },
      ],
    },
  };
}

describe('application/speech-performance-planner', () => {
  it('stays disabled by default', () => {
    const config = loadConfig();
    expect(config.speechPlanner.enabled).toBe(false);
    expect(createBackendSpeechPerformancePlanner(config)).toEqual({
      unavailableReason: 'planner_disabled',
    });
  });

  it('reports missing credentials when enabled without a Gemini API key', () => {
    const config = loadConfig();

    expect(
      createBackendSpeechPerformancePlanner({
        ...config,
        generation: {
          ...config.generation,
          providers: {
            ...config.generation.providers,
            googleAiStudio: {
              ...config.generation.providers.googleAiStudio,
              apiKey: undefined,
            },
          },
        },
        speechPlanner: {
          enabled: true,
          model: 'gemini-3.1-flash-lite',
          maxOutputTokens: 2400,
          rpmBudget: 4,
          dailyRequestBudget: 120,
          debugLogPlan: false,
        },
      }),
    ).toEqual({
      unavailableReason: 'planner_missing_credentials',
    });
  });

  it('uses structured Gemini output and preserves authored text', async () => {
    const config = {
      ...loadConfig(),
      generation: {
        ...loadConfig().generation,
        providers: {
          ...loadConfig().generation.providers,
          googleAiStudio: {
            ...loadConfig().generation.providers.googleAiStudio,
            apiKey: 'test-gemini-key',
          },
        },
      },
      speechPlanner: {
        enabled: true,
        model: 'gemini-3.1-flash-lite',
        maxOutputTokens: 2400,
        rpmBudget: 4,
        dailyRequestBudget: 120,
        debugLogPlan: false,
      },
    };
    const executor = vi.fn().mockResolvedValue({
      output: {
        segments: [
          {
            id: 'segment-1',
            emotion: 'calm concern',
            intonation: 'firm but collaborative',
            pace: 'measured',
            deliveryMode: 'BALANCED',
            freeFormDirection: 'Speak with grounded concern.',
          },
        ],
      },
      rawText: '{}',
      usage: { totalTokens: 24 },
    });
    const binding = createBackendSpeechPerformancePlanner(config, {
      executor,
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(binding.unavailableReason).toBeUndefined();
    expect(binding.planner).toBeDefined();
    await expect(binding.planner!.plan(createPrepared())).resolves.toMatchObject({
      schemaVersion: 1,
      mode: 'prompted',
      planner: {
        provider: 'google_ai_studio',
        model: 'gemini-3.1-flash-lite',
        generatedAt: '2026-05-31T00:00:00.000Z',
      },
      segments: [
        {
          id: 'segment-1',
          text: 'We need a clearer deadline.',
          emotion: 'calm concern',
          intonation: 'firm but collaborative',
          pace: 'measured',
          deliveryMode: 'BALANCED',
          freeFormDirection: 'Speak with grounded concern.',
        },
      ],
    });
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          model: 'gemini-3.1-flash-lite',
          maxOutputTokens: 2400,
          responseSchema: expect.objectContaining({ strict: true }),
        }),
      }),
    );
    expect(executor.mock.calls[0]?.[0].request.prompt).toContain(
      '"supportsFreeFormDirection":true',
    );
  });

  it('canonicalizes lowercase Gemini emphasis to the authored text casing', async () => {
    const config = createEnabledConfig();
    const executor = vi.fn().mockResolvedValue({
      output: {
        segments: [{ id: 'segment-1', emphasis: ['we'] }],
      },
      rawText: '{"segments":[{"id":"segment-1","emphasis":["we"]}]}',
      usage: { totalTokens: 12 },
    });
    const binding = createBackendSpeechPerformancePlanner(config, { executor });

    await expect(binding.planner!.plan(createPrepared())).resolves.toMatchObject({
      segments: [{ id: 'segment-1', emphasis: ['We'] }],
    });
  });

  it('drops invalid optional Gemini emphasis while preserving valid authored phrases', async () => {
    const config = createEnabledConfig();
    const executor = vi.fn().mockResolvedValue({
      output: {
        segments: [{ id: 'segment-1', emphasis: ['deadline', 'no strong reason', ''] }],
      },
      rawText: '{"segments":[{"id":"segment-1","emphasis":["deadline","no strong reason",""]}]}',
      usage: { totalTokens: 12 },
    });
    const binding = createBackendSpeechPerformancePlanner(config, { executor });

    await expect(binding.planner!.plan(createPrepared())).resolves.toMatchObject({
      mode: 'prompted',
      segments: [{ id: 'segment-1', emphasis: ['deadline'] }],
    });
  });

  it('retains rejected structured output diagnostics when local validation fails', async () => {
    const config = createEnabledConfig();
    const rejectedOutput = {
      segments: [{ id: 'segment-1', pauseAfterMs: 4000 }],
    };
    const rawText = JSON.stringify(rejectedOutput);
    const executor = vi.fn().mockResolvedValue({
      output: rejectedOutput,
      rawText,
      usage: { totalTokens: 12 },
    });
    const binding = createBackendSpeechPerformancePlanner(config, { executor });

    await expect(binding.planner!.plan(createPrepared())).rejects.toMatchObject({
      name: 'SpeechPerformancePlannerInvalidOutputError',
      validationMessage:
        'Speech plan segment "segment-1" pause must be an integer from 0 to 3000ms.',
      rejectedOutput,
      rawText,
    } satisfies Partial<SpeechPerformancePlannerInvalidOutputError>);
  });
});

function createEnabledConfig() {
  const config = loadConfig();
  return {
    ...config,
    generation: {
      ...config.generation,
      providers: {
        ...config.generation.providers,
        googleAiStudio: {
          ...config.generation.providers.googleAiStudio,
          apiKey: 'test-gemini-key',
        },
      },
    },
    speechPlanner: {
      enabled: true,
      model: 'gemini-3.1-flash-lite',
      maxOutputTokens: 2400,
      rpmBudget: 4,
      dailyRequestBudget: 120,
      debugLogPlan: false,
    },
  };
}
