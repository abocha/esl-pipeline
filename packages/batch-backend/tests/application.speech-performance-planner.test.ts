import { describe, expect, it, vi } from 'vitest';

import { SpeechPerformancePlannerInvalidOutputError } from '@esl-pipeline/tts-core';

import {
  createBackendSpeechPerformancePlanner,
  evaluateSpeechPlannerRawOutput,
  executeSpeechPlannerAttempt,
} from '../src/application/speech-performance-planner.js';
import {
  buildSpeechPlannerRequest,
  SPEECH_PERFORMANCE_PROMPT_POLICIES,
} from '../src/application/speech-performance-prompt.js';
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
      mode: 'deterministic' as const,
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
  it('preserves the immutable v1 prompt bytes and hash', () => {
    const expectedPrompt = [
      'Create restrained, natural speech-performance cues for this ESL study text.',
      'Do not rewrite words, add dialogue, or change segment order.',
      'Use non-verbal cues sparingly. Prefer clarity over theatrical delivery.',
      'Maintain a natural, consistent conversational tempo across adjacent segments.',
      'Omit pace for ordinary dialogue.',
      'Use slow, measured, or brisk only when a non-natural tempo is explicitly justified by the authored scene or learning goal.',
      'Do not use pace merely to reinforce emotion, seriousness, regret, reflection, or intonation.',
      'Only set freeFormDirection for segments whose selected voice supportsFreeFormDirection.',
      JSON.stringify({
        segments: createPrepared().segments,
        voiceAssignments: createPrepared().voicePlan.assignments,
      }),
    ].join('\n\n');

    expect(
      buildSpeechPlannerRequest(
        createPrepared(),
        'speech-performance-v1-restrained-natural',
        'gemini-3.1-flash-lite',
      ),
    ).toMatchObject({
      prompt: expectedPrompt,
      promptHash: 'a3f4e2a544f8594bb4af2550bce555353fe77f79f0053f6575e68f9b5cb23fc2',
      promptPolicyVersion: 'speech-performance-v1-restrained-natural',
      responseSchema: expect.objectContaining({ strict: true }),
    });
    expect(
      buildSpeechPlannerRequest(
        createPrepared(),
        'speech-performance-v1-restrained-natural',
        'gemini-3.1-flash-lite',
      ).responseSchema.schema.properties.segments.items.properties,
    ).toMatchObject({
      pauseBeforeMs: { maximum: 3000 },
      pauseAfterMs: { maximum: 3000 },
    });
  });

  it('defines the complete Inworld TTS-2 prompt policy', () => {
    const policy =
      SPEECH_PERFORMANCE_PROMPT_POLICIES['speech-performance-v2-inworld-tts2'].join('\n');

    expect(policy).toContain('authored words and segment order are immutable');
    expect(policy).toContain('one complete free-form direction');
    expect(policy).toContain('emotion, articulation, intonation, volume, pitch, range, speed');
    expect(policy).toContain('Do not combine conflicting directions');
    expect(policy).toContain('Optional cues must be sparse');
    expect(policy).toContain('1000 ms');
    expect(policy).toContain('one nonverbal cue total');
    expect(policy).toContain('Omit pace for ordinary dialogue');
    expect(policy).toContain('deliveryMode must remain BALANCED');
  });

  it('stays disabled by default', () => {
    const config = loadConfig();
    expect(config.speechPlanner.enabled).toBe(false);
    expect(config.speechPlanner.model).toBe('gemini-3.1-flash-lite');
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
      rawText: JSON.stringify({
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
      }),
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
        promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
        promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
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
    const prompt = executor.mock.calls[0]?.[0].request.prompt;
    expect(prompt).toContain('"supportsFreeFormDirection":true');
    expect(prompt).toContain(
      'Maintain a natural, consistent conversational tempo across adjacent segments.',
    );
    expect(prompt).toContain('Omit pace for ordinary dialogue.');
    expect(prompt).toContain(
      'Use slow, measured, or brisk only when a non-natural tempo is explicitly justified by the authored scene or learning goal.',
    );
    expect(prompt).toContain(
      'Do not use pace merely to reinforce emotion, seriousness, regret, reflection, or intonation.',
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
      validationMessage: 'planner_pause_exceeds_cap',
      rejectedOutput,
      rawText,
    } satisfies Partial<SpeechPerformancePlannerInvalidOutputError>);
  });

  it('records the production identity fallback without crediting an invalid prompted plan', async () => {
    const config = createEnabledConfig();
    const rejectedOutput = {
      segments: [{ id: 'segment-1', pauseAfterMs: 4000 }],
    };
    const rawText = JSON.stringify(rejectedOutput);

    await expect(
      executeSpeechPlannerAttempt({
        config,
        prepared: createPrepared(),
        promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
        executor: vi.fn().mockResolvedValue({
          output: rejectedOutput,
          rawText,
          usage: { totalTokens: 12 },
        }),
        now: () => new Date('2026-05-31T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
      promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      rawText,
      parsedCandidate: rejectedOutput,
      validation: { status: 'invalid' },
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
      usage: { totalTokens: 12 },
      latencyMs: 0,
    });
  });

  it('classifies wrapped and malformed offline output through the shared parser', () => {
    const common = {
      prepared: createPrepared(),
      promptPolicyVersion: 'speech-performance-v2-inworld-tts2' as const,
      promptHash: 'a'.repeat(64),
      plannerModel: 'gemini-3.5-flash-lite',
      generatedAt: '2026-07-29T00:00:00.000Z',
      latencyMs: 0,
    };
    expect(
      evaluateSpeechPlannerRawOutput({
        ...common,
        rawText: 'wrapped {"segments":[{"id":"segment-1"}]} output',
      }),
    ).toMatchObject({
      rawParse: { status: 'parsed' },
      validation: { status: 'valid' },
      plan: expect.objectContaining({ mode: 'prompted' }),
    });
    expect(
      evaluateSpeechPlannerRawOutput({
        ...common,
        rawText: 'not json',
        usage: { inputTokens: 4, outputTokens: 2, reasoningTokens: 1 },
      }),
    ).toMatchObject({
      rawParse: { status: 'malformed', reason: 'invalid_json' },
      validation: { status: 'invalid', reason: 'malformed_structured_output' },
      usage: { inputTokens: 4, outputTokens: 2, reasoningTokens: 1 },
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
    });
  });

  it('retains candidate analysis before duplicate IDs can be merged away', async () => {
    const config = createEnabledConfig();
    const duplicateIds = {
      segments: [{ id: 'segment-1' }, { id: 'segment-1' }],
    };

    const attempt = await executeSpeechPlannerAttempt({
      config,
      prepared: createPrepared(),
      promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
      executor: vi.fn().mockResolvedValue({
        output: duplicateIds,
        rawText: JSON.stringify(duplicateIds),
      }),
    });
    expect(attempt).toMatchObject({
      validation: { status: 'invalid' },
      parsedCandidate: duplicateIds,
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
    });
    expect(attempt.candidateAnalysis?.hardFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_segment_id', segmentId: 'segment-1' }),
      ]),
    );
  });

  it('classifies an overlong live-eval cue without retaining the rejected text', () => {
    const intonation =
      'rising at the end of the first sentence, slightly surprised at the end of the second';
    expect([...intonation].length).toBe(84);

    const result = evaluateSpeechPlannerRawOutput({
      prepared: {
        ...createPrepared(),
        segments: [
          {
            id: 'segment-1',
            speaker: 'Maya',
            text: 'You still remember that tiny café?',
          },
        ],
      },
      rawText: JSON.stringify({ segments: [{ id: 'segment-1', intonation }] }),
      promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
      promptHash: 'a'.repeat(64),
      plannerModel: 'gemini-3.1-flash-lite',
      generatedAt: '2026-07-29T00:00:00.000Z',
      latencyMs: 0,
    });

    expect(result).toMatchObject({
      validation: { status: 'invalid', reason: 'cue_text_too_long' },
      candidateAnalysis: {
        hardFailures: [
          {
            severity: 'hard_failure',
            code: 'cue_text_too_long',
            segmentId: 'segment-1',
            detail: { field: 'intonation', limit: 80, observedCodePoints: 84 },
          },
        ],
      },
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
    });
    expect(JSON.stringify(result.candidateAnalysis)).not.toContain(intonation);
  });

  it('uses the 1000ms planner schema cap and normalizes sparse optional cues', async () => {
    const config = createEnabledConfig();
    const executor = vi.fn().mockResolvedValue({
      output: {
        segments: [
          {
            id: 'segment-1',
            emotion: '   ',
            emphasis: ['we', 'WE'],
            nonVerbalsBefore: ['sigh'],
          },
        ],
      },
      rawText: JSON.stringify({
        segments: [
          {
            id: 'segment-1',
            emotion: '   ',
            emphasis: ['we', 'WE'],
            nonVerbalsBefore: ['sigh'],
          },
        ],
      }),
    });
    const binding = createBackendSpeechPerformancePlanner(config, { executor });

    await expect(binding.planner!.plan(createPrepared())).resolves.toMatchObject({
      segments: [
        expect.objectContaining({
          emphasis: ['We'],
          nonVerbalsBefore: ['sigh'],
          emotion: undefined,
        }),
      ],
    });
    expect(
      executor.mock.calls[0]?.[0].request.responseSchema.schema.properties.segments.items
        .properties,
    ).toMatchObject({
      pauseBeforeMs: { maximum: 1000 },
      pauseAfterMs: { maximum: 1000 },
    });
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
      rpmBudget: 100,
      dailyRequestBudget: 1000,
      debugLogPlan: false,
    },
  };
}
