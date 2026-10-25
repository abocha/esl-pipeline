import { describe, expect, it, vi } from 'vitest';

import {
  createIdentitySpeechPerformancePlan,
  type PreparedStudyTextSynthesis,
  SpeechPerformancePlannerInvalidOutputError,
} from '@esl-pipeline/tts-core';

import { resolveSpeechPerformancePlan } from '../src/runtime/speech-performance.js';

function createPrepared(): PreparedStudyTextSynthesis {
  return {
    selection: { provider: 'inworld', model: 'inworld-tts-2' },
    sourceHash: 'source-hash',
    segments: [{ id: 'segment-1', speaker: 'Maya', text: 'We need a clearer deadline.' }],
    voices: [],
    voiceAssignments: {},
  };
}

describe('runtime/speech-performance', () => {
  it.each(['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'] as const)(
    'retains the speech-plan stage without dispatching a planner for %s',
    async (model) => {
      const prepared = { ...createPrepared(), selection: { provider: 'gemini' as const, model } };
      const plan = vi.fn().mockRejectedValue(new Error('Must not dispatch'));
      const result = await resolveSpeechPerformancePlan({ prepared, planner: { plan } });
      expect(plan).not.toHaveBeenCalled();
      expect(result.plan).toMatchObject({
        provider: 'gemini',
        model,
        mode: 'identity',
        sourceHash: 'source-hash',
      });
      expect(result.plan.segments).toEqual(prepared.segments);
    },
  );
  it('rejects one malformed annotation segment with assignment-wide identity fallback', async () => {
    const prepared: PreparedStudyTextSynthesis = {
      ...createPrepared(),
      segments: [
        ...createPrepared().segments,
        { id: 'segment-2', speaker: 'Leo', text: 'I can revise the plan today.' },
      ],
    };
    const result = await resolveSpeechPerformancePlan({
      prepared,
      planner: {
        async plan() {
          return {
            schemaVersion: 2,
            mode: 'prompted',
            provider: 'inworld',
            model: 'inworld-tts-2',
            sourceHash: prepared.sourceHash,
            enhancerVersion: 'contextual-bracket-annotation-v1',
            planner: {
              provider: 'openai',
              model: 'gpt-5.6-luna',
              generatedAt: '2026-08-04T00:00:00.000Z',
              promptPolicyVersion: 'contextual-bracket-annotation-v1',
            },
            segments: [
              { ...prepared.segments[0]!, synthesisText: prepared.segments[0]!.text },
              { ...prepared.segments[1]!, synthesisText: 'I can revise the plan tomorrow.' },
            ],
          };
        },
      },
    });

    expect(result.plan).toMatchObject({
      schemaVersion: 1,
      mode: 'identity',
      fallbackReason: 'planner_invalid',
      segments: prepared.segments,
    });
  });

  it('logs contextual annotation counts without annotation bodies by default', async () => {
    const prepared = createPrepared();
    const logger = { log: vi.fn() };
    const result = await resolveSpeechPerformancePlan({
      prepared,
      logger,
      planner: {
        async plan() {
          return {
            schemaVersion: 2,
            mode: 'prompted',
            provider: 'inworld',
            model: 'inworld-tts-2',
            sourceHash: prepared.sourceHash,
            enhancerVersion: 'contextual-bracket-annotation-v1',
            planner: {
              provider: 'openai',
              model: 'gpt-5.6-luna',
              generatedAt: '2026-08-04T00:00:00.000Z',
              promptPolicyVersion: 'contextual-bracket-annotation-v1',
              promptHash: 'a'.repeat(64),
            },
            segments: [
              {
                ...prepared.segments[0]!,
                synthesisText:
                  '<tts-annotation>Trying not to sound accusatory</tts-annotation>We need a clearer deadline.',
              },
            ],
          };
        },
      },
    });

    expect(result.plan.schemaVersion).toBe(2);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          enhancerVersion: 'contextual-bracket-annotation-v1',
          annotatedSegmentCount: 1,
          annotationCount: 1,
        }),
      }),
    );
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('Trying not to sound accusatory');
  });

  it('records identity fallback when a prompted model has no injected planner', async () => {
    const result = await resolveSpeechPerformancePlan({ prepared: createPrepared() });

    expect(result.plan).toMatchObject({
      mode: 'identity',
      fallbackReason: 'planner_unavailable',
    });
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves the injected planner unavailable reason', async () => {
    const result = await resolveSpeechPerformancePlan({
      prepared: createPrepared(),
      plannerUnavailableReason: 'planner_disabled',
    });

    expect(result.plan).toMatchObject({
      mode: 'identity',
      fallbackReason: 'planner_disabled',
    });
  });

  it('uses and validates an injected planner for prompted models', async () => {
    const prepared = createPrepared();
    const identity = createIdentitySpeechPerformancePlan(prepared);
    const logger = { log: vi.fn() };
    const result = await resolveSpeechPerformancePlan({
      prepared,
      logger,
      planner: {
        async plan() {
          return {
            ...identity,
            mode: 'prompted',
            planner: {
              provider: 'openai',
              model: 'gpt-5.6',
              generatedAt: '2026-07-28T00:00:00.000Z',
              promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
              promptHash: 'a'.repeat(64),
            },
            segments: [{ ...identity.segments[0]!, emotion: 'calm concern' }],
          };
        },
      },
    });

    expect(result.plan).toMatchObject({
      mode: 'prompted',
      segments: [{ emotion: 'calm concern' }],
    });
    expect(logger.log).toHaveBeenCalledWith({
      level: 'info',
      stage: 'speech-plan',
      message: 'Speech performance planner produced a prompted plan',
      detail: {
        provider: 'inworld',
        model: 'inworld-tts-2',
        speechPlanHash: result.hash,
        promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
        promptHash: 'a'.repeat(64),
        segmentCount: 1,
        qualityIssueCount: 0,
        qualityIssueCodes: [],
        cueCounts: {
          emotion: 1,
          intonation: 0,
          pace: 0,
          emphasis: 0,
          pauses: 0,
          nonVerbals: 0,
          deliveryMode: 0,
          freeFormDirection: 0,
        },
      },
    });
    expect(logger.log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Speech performance planner validated plan debug payload',
      }),
    );
  });

  it('logs the complete validated prompted plan only when debug logging is enabled', async () => {
    const prepared = createPrepared();
    const identity = createIdentitySpeechPerformancePlan(prepared);
    const logger = { log: vi.fn() };
    const result = await resolveSpeechPerformancePlan({
      prepared,
      logger,
      debugLogPlan: true,
      planner: {
        async plan() {
          return {
            ...identity,
            mode: 'prompted',
            segments: [
              {
                ...identity.segments[0]!,
                emotion: 'calm concern',
                pauseAfterMs: 250,
              },
            ],
          };
        },
      },
    });

    expect(logger.log).toHaveBeenCalledWith({
      level: 'info',
      stage: 'speech-plan',
      message: 'Speech performance planner validated plan debug payload',
      detail: {
        speechPlanHash: result.hash,
        speechPlan: result.plan,
      },
    });
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Speech performance planner produced a prompted plan',
        detail: expect.objectContaining({
          promptPolicyVersion: 'legacy-unversioned-v1',
          promptHash: null,
        }),
      }),
    );
  });

  it('falls back when planner output violates source immutability', async () => {
    const prepared = createPrepared();
    const identity = createIdentitySpeechPerformancePlan(prepared);
    const result = await resolveSpeechPerformancePlan({
      prepared,
      planner: {
        async plan() {
          return {
            ...identity,
            mode: 'prompted',
            segments: [{ ...identity.segments[0]!, text: 'Changed words.' }],
          };
        },
      },
    });

    expect(result.plan).toMatchObject({
      mode: 'identity',
      fallbackReason: 'planner_invalid',
    });
  });

  it('distinguishes planner execution failures from invalid output', async () => {
    const logger = { log: vi.fn() };
    const result = await resolveSpeechPerformancePlan({
      prepared: createPrepared(),
      logger,
      planner: {
        async plan() {
          throw new Error('provider unavailable');
        },
      },
    });

    expect(result.plan).toMatchObject({
      mode: 'identity',
      fallbackReason: 'planner_execution_failed',
    });
    expect(logger.log).toHaveBeenCalledWith({
      level: 'warn',
      stage: 'speech-plan',
      message: 'Speech performance planner fell back to an identity plan',
      detail: {
        fallbackReason: 'planner_execution_failed',
        errorName: 'Error',
      },
    });
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('provider unavailable');
  });

  it('reports budget exhaustion separately from provider execution failures', async () => {
    const error = new Error('budget exhausted');
    error.name = 'GenerationBudgetExceededError';
    const result = await resolveSpeechPerformancePlan({
      prepared: createPrepared(),
      planner: {
        async plan() {
          throw error;
        },
      },
    });

    expect(result.plan).toMatchObject({
      mode: 'identity',
      fallbackReason: 'planner_budget_exceeded',
    });
  });

  it('logs invalid planner reasons without rejected learner text by default', async () => {
    const logger = { log: vi.fn() };
    const error = new SpeechPerformancePlannerInvalidOutputError(
      'Speech planner output failed validation.',
      {
        validationMessage: 'emphasis "what" is not present in authored text.',
        rejectedOutput: { segments: [{ id: 'segment-1', emphasis: ['what'] }] },
        rawText: '{"segments":[{"id":"segment-1","emphasis":["what"]}]}',
      },
    );

    await resolveSpeechPerformancePlan({
      prepared: createPrepared(),
      logger,
      planner: {
        async plan() {
          throw error;
        },
      },
    });

    expect(logger.log).toHaveBeenCalledWith({
      level: 'warn',
      stage: 'speech-plan',
      message: 'Speech performance planner fell back to an identity plan',
      detail: {
        fallbackReason: 'planner_invalid',
        errorName: 'SpeechPerformancePlannerInvalidOutputError',
        qualityIssueCount: 1,
        qualityIssueCodes: ['planner_output_invalid'],
      },
    });
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('rejectedPlannerOutput');
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('rejectedPlannerRawText');
  });

  it('logs rejected planner payloads only when debug logging is enabled', async () => {
    const logger = { log: vi.fn() };
    const rejectedOutput = { segments: [{ id: 'segment-1', emphasis: ['what'] }] };
    const rawText = JSON.stringify(rejectedOutput);
    const error = new SpeechPerformancePlannerInvalidOutputError(
      'Speech planner output failed validation.',
      {
        validationMessage: 'emphasis "what" is not present in authored text.',
        rejectedOutput,
        rawText,
      },
    );

    await resolveSpeechPerformancePlan({
      prepared: createPrepared(),
      logger,
      debugLogPlan: true,
      planner: {
        async plan() {
          throw error;
        },
      },
    });

    expect(logger.log).toHaveBeenCalledWith({
      level: 'warn',
      stage: 'speech-plan',
      message: 'Speech performance planner fell back to an identity plan',
      detail: {
        fallbackReason: 'planner_invalid',
        errorName: 'SpeechPerformancePlannerInvalidOutputError',
        validationMessage: 'emphasis "what" is not present in authored text.',
        qualityIssueCount: 1,
        qualityIssueCodes: ['planner_output_invalid'],
        rejectedPlannerOutput: rejectedOutput,
        rejectedPlannerRawText: rawText,
      },
    });
  });
});
