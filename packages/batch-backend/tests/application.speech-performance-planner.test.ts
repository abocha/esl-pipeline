import { readFileSync as readAssignmentFixture } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { AssignmentV1 as FixtureAssignmentV1 } from '@esl-pipeline/contracts';
import { serializeAssignmentV1 } from '@esl-pipeline/contracts';
import {
  SPEECH_ANNOTATION_OPEN,
  SpeechPerformancePlannerInvalidOutputError,
} from '@esl-pipeline/tts-core';

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
  const assignment = assignmentFixture();
  return {
    selection: { provider: 'inworld' as const, model: 'inworld-tts-2' as const },
    sourceHash: 'source-hash',
    segments: [{ id: 'segment-1', speaker: 'Maya', text: 'We need a clearer deadline.' }],
    voices: [],
    voiceAssignments: {},
    enhancementContext: { assignment },
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

function createDialoguePrepared() {
  const prepared = createPrepared();
  return {
    ...prepared,
    segments: [
      ...prepared.segments,
      { id: 'segment-2', speaker: 'Leo', text: 'I can revise the plan today.' },
    ],
  };
}

describe('application/speech-performance-planner', () => {
  it('provides complete typed context deterministically without Markdown', () => {
    const assignment = assignmentFixture();
    const prepared = { ...createPrepared(), enhancementContext: { assignment } };
    const first = buildSpeechPlannerRequest(
      prepared,
      'contextual-bracket-annotation-v1',
      'gpt-5.6-luna',
    );
    const next = buildSpeechPlannerRequest(
      prepared,
      'contextual-bracket-annotation-v1',
      'gpt-5.6-luna',
    );
    expect(first).toEqual(next);
    expect(first.prompt).toContain(serializeAssignmentV1(assignment));
    expect(first.prompt).not.toContain(':::study-text');
    expect(first.prompt).toContain(assignment.toolkit.grammar[0]!.name);
  });
  it('builds the immutable contextual-annotation request from complete assignment context', () => {
    const prepared = createDialoguePrepared();
    const request = buildSpeechPlannerRequest(
      prepared,
      'contextual-bracket-annotation-v1',
      'gpt-5.6-luna',
    );

    expect(request.responseSchema.schema.properties.segments.items.required).toEqual([
      'id',
      'synthesisText',
    ]);
    expect(request.prompt).toContain(serializeAssignmentV1(prepared.enhancementContext.assignment));
    expect(request.prompt).toContain(SPEECH_ANNOTATION_OPEN);
    expect(request.prompt).not.toContain('speakerEnvelopes');
    expect(request.prompt).not.toContain('turnAdjustment');
  });

  it.each([
    ['unchanged', ['We need a clearer deadline.', 'I can revise the plan today.']],
    [
      'leading direction',
      [
        '<tts-annotation>Trying not to sound accusatory</tts-annotation>We need a clearer deadline.',
        'I can revise the plan today.',
      ],
    ],
    [
      'inline nonverbal',
      [
        'We need a clearer deadline.',
        'I can revise the plan<tts-annotation>small relieved breath</tts-annotation> today.',
      ],
    ],
  ])('accepts %s annotation output atomically', (_case, synthesisTexts) => {
    const prepared = createDialoguePrepared();
    const candidate = {
      segments: prepared.segments.map((segment, index) => ({
        id: segment.id,
        synthesisText: synthesisTexts[index],
      })),
    };
    const result = evaluateSpeechPlannerRawOutput({
      prepared,
      rawText: JSON.stringify(candidate),
      promptPolicyVersion: 'contextual-bracket-annotation-v1',
      promptHash: 'a'.repeat(64),
      plannerProvider: 'openai',
      plannerModel: 'gpt-5.6-luna',
      generatedAt: '2026-08-04T00:00:00.000Z',
      latencyMs: 10,
    });

    expect(result).toMatchObject({
      validation: { status: 'valid' },
      plan: {
        schemaVersion: 2,
        enhancerVersion: 'contextual-bracket-annotation-v1',
        segments: prepared.segments.map((segment, index) => ({
          ...segment,
          synthesisText: synthesisTexts[index],
        })),
      },
    });
  });

  it('rejects the complete enhancement when only the final segment changes punctuation', () => {
    const prepared = createDialoguePrepared();
    const candidate = {
      segments: [
        { id: 'segment-1', synthesisText: 'We need a clearer deadline.' },
        { id: 'segment-2', synthesisText: 'I can revise the plan today!' },
      ],
    };
    const result = evaluateSpeechPlannerRawOutput({
      prepared,
      rawText: JSON.stringify(candidate),
      promptPolicyVersion: 'contextual-bracket-annotation-v1',
      promptHash: 'a'.repeat(64),
      plannerProvider: 'openai',
      plannerModel: 'gpt-5.6-luna',
      generatedAt: '2026-08-04T00:00:00.000Z',
      latencyMs: 10,
    });

    expect(result).toMatchObject({
      validation: { status: 'invalid' },
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
    });
  });

  it('refuses reserved source delimiters before making a provider request', async () => {
    const prepared = createPrepared();
    prepared.segments[0] = {
      ...prepared.segments[0]!,
      text: `Say ${SPEECH_ANNOTATION_OPEN} literally.`,
    };
    const executor = vi.fn();

    await expect(
      executeSpeechPlannerAttempt({
        config: createEnabledConfig(),
        prepared,
        promptPolicyVersion: 'contextual-bracket-annotation-v1',
        executor,
      }),
    ).resolves.toMatchObject({
      validation: { status: 'invalid' },
      fallback: { reason: 'planner_invalid' },
    });
    expect(executor).not.toHaveBeenCalled();
  });

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
    expect(config.speechPlanner.model).toBe('gpt-5.6-luna');
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
          provider: 'google_ai_studio' as const,
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

  it('uses structured Luna output and preserves authored text', async () => {
    const config = {
      ...loadConfig(),
      generation: {
        ...loadConfig().generation,
        providers: {
          ...loadConfig().generation.providers,
          openai: {
            ...loadConfig().generation.providers.openai,
            apiKey: 'test-openai-key',
          },
        },
      },
      speechPlanner: {
        enabled: true,
        provider: 'openai' as const,
        model: 'gpt-5.6-luna',
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
            synthesisText:
              '<tts-annotation>Trying not to sound accusatory</tts-annotation>We need a clearer deadline.',
          },
        ],
      },
      rawText: JSON.stringify({
        segments: [
          {
            id: 'segment-1',
            synthesisText:
              '<tts-annotation>Trying not to sound accusatory</tts-annotation>We need a clearer deadline.',
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
      schemaVersion: 2,
      mode: 'prompted',
      enhancerVersion: 'contextual-bracket-annotation-v1',
      planner: {
        provider: 'openai',
        model: 'gpt-5.6-luna',
        generatedAt: '2026-05-31T00:00:00.000Z',
        promptPolicyVersion: 'contextual-bracket-annotation-v1',
        promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      segments: [
        {
          id: 'segment-1',
          text: 'We need a clearer deadline.',
          synthesisText:
            '<tts-annotation>Trying not to sound accusatory</tts-annotation>We need a clearer deadline.',
        },
      ],
    });
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          model: 'gpt-5.6-luna',
          maxOutputTokens: 2400,
          responseSchema: expect.objectContaining({ strict: true }),
        }),
      }),
    );
    const prompt = executor.mock.calls[0]?.[0].request.prompt;
    expect(prompt).toContain(serializeAssignmentV1(createPrepared().enhancementContext.assignment));
    expect(prompt).toContain('Unchanged synthesisText is completely valid.');
  });

  it('retains rejected structured output diagnostics when local validation fails', async () => {
    const config = createEnabledConfig();
    const rejectedOutput = {
      segments: [{ id: 'segment-1', synthesisText: 'We need a clearer deadline!' }],
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
      validationMessage: 'Speech annotation text changed the authored text.',
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
});

function createEnabledConfig() {
  const config = loadConfig();
  return {
    ...config,
    generation: {
      ...config.generation,
      providers: {
        ...config.generation.providers,
        openai: {
          ...config.generation.providers.openai,
          apiKey: 'test-openai-key',
        },
      },
    },
    speechPlanner: {
      enabled: true,
      provider: 'openai' as const,
      model: 'gpt-5.6-luna',
      maxOutputTokens: 2400,
      rpmBudget: 100,
      dailyRequestBudget: 1000,
      debugLogPlan: false,
    },
  };
}

function assignmentFixture(): FixtureAssignmentV1 {
  return JSON.parse(
    readAssignmentFixture(
      new URL('../../contracts/tests/assignment-fixture.json', import.meta.url),
      'utf8',
    ),
  ) as FixtureAssignmentV1;
}
