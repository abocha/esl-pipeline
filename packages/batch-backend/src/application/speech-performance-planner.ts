import type {
  SpeechPerformancePlan,
  SpeechPerformancePlanner,
  SpeechPerformancePlannerBinding,
} from '@esl-pipeline/tts-core';
import {
  createIdentitySpeechPerformancePlan,
  SpeechPerformancePlannerInvalidOutputError,
  validateSpeechPerformancePlan,
} from '@esl-pipeline/tts-core';

import type { BatchBackendConfig } from '../config/env.js';
import {
  enforceGenerationBudgetBeforeAttempt,
  type GenerationBudgetGuardDependencies,
  recordGenerationBudgetUsageAfterSuccess,
  resolveGenerationBudgetRepository,
} from './generation-budget-guard.js';
import {
  executeGoogleStructuredGeneration,
  type ProviderStructuredExecutionResult,
} from './generation-providers.js';

type GoogleStructuredExecutor = typeof executeGoogleStructuredGeneration;

interface SpeechPlannerOutput {
  segments: Array<Record<string, unknown>>;
}

const SPEECH_PLAN_RESPONSE_SCHEMA = {
  name: 'tts_speech_performance_plan',
  description: 'Provider-neutral expressive speech cues for immutable study-text segments.',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['segments'],
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: { type: 'string' },
            emotion: { type: 'string' },
            intonation: { type: 'string' },
            pace: { type: 'string', enum: ['slow', 'measured', 'natural', 'brisk'] },
            emphasis: { type: 'array', items: { type: 'string' } },
            pauseBeforeMs: { type: 'integer', minimum: 0, maximum: 3000 },
            pauseAfterMs: { type: 'integer', minimum: 0, maximum: 3000 },
            nonVerbalsBefore: {
              type: 'array',
              items: { type: 'string', enum: ['sigh', 'laugh', 'chuckle', 'breath'] },
            },
            nonVerbalsAfter: {
              type: 'array',
              items: { type: 'string', enum: ['sigh', 'laugh', 'chuckle', 'breath'] },
            },
            deliveryMode: {
              type: 'string',
              enum: ['STABLE', 'BALANCED', 'CREATIVE'],
            },
            freeFormDirection: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

export function createBackendSpeechPerformancePlanner(
  config: BatchBackendConfig,
  overrides: {
    executor?: GoogleStructuredExecutor;
    budget?: GenerationBudgetGuardDependencies;
    now?: () => Date;
  } = {},
): SpeechPerformancePlannerBinding {
  if (!config.speechPlanner?.enabled) return { unavailableReason: 'planner_disabled' };
  if (!config.generation.providers.googleAiStudio.apiKey) {
    return { unavailableReason: 'planner_missing_credentials' };
  }
  const executor = overrides.executor ?? executeGoogleStructuredGeneration;
  const now = overrides.now ?? (() => new Date());
  const repository = resolveGenerationBudgetRepository({ config, overrides: overrides.budget });

  return {
    planner: {
      async plan(prepared) {
        const prompt = buildSpeechPlannerPrompt(prepared);
        await enforceGenerationBudgetBeforeAttempt({
          config,
          provider: 'google_ai_studio',
          model: config.speechPlanner.model,
          prompt,
          maxOutputTokens: config.speechPlanner.maxOutputTokens,
          now: now(),
          repository,
          limits: {
            rpmBudget: config.speechPlanner.rpmBudget,
            dailyRequestBudget: config.speechPlanner.dailyRequestBudget,
          },
        });
        const result = await executor({
          config: config.generation,
          request: {
            model: config.speechPlanner.model,
            prompt,
            maxOutputTokens: config.speechPlanner.maxOutputTokens,
            responseSchema: SPEECH_PLAN_RESPONSE_SCHEMA,
          },
        });
        await recordUsage(config, repository, now, result);
        try {
          return validateSpeechPerformancePlan(
            prepared,
            mergePlannerOutput(prepared, result.output, {
              provider: 'google_ai_studio',
              model: config.speechPlanner.model,
              generatedAt: now().toISOString(),
            }),
          );
        } catch (error) {
          throw new SpeechPerformancePlannerInvalidOutputError(
            'Speech planner output failed validation.',
            {
              cause: error,
              validationMessage: error instanceof Error ? error.message : String(error),
              rejectedOutput: result.output,
              rawText: result.rawText,
            },
          );
        }
      },
    },
  };
}

function buildSpeechPlannerPrompt(
  prepared: Parameters<SpeechPerformancePlanner['plan']>[0],
): string {
  return [
    'Create restrained, natural speech-performance cues for this ESL study text.',
    'Do not rewrite words, add dialogue, or change segment order.',
    'Use non-verbal cues sparingly. Prefer clarity over theatrical delivery.',
    'Only set freeFormDirection for segments whose selected voice supportsFreeFormDirection.',
    JSON.stringify({
      segments: prepared.segments,
      voiceAssignments: prepared.voicePlan?.assignments ?? [],
    }),
  ].join('\n\n');
}

function mergePlannerOutput(
  prepared: Parameters<SpeechPerformancePlanner['plan']>[0],
  output: unknown,
  planner: NonNullable<SpeechPerformancePlan['planner']>,
): SpeechPerformancePlan {
  const parsed = output as Partial<SpeechPlannerOutput>;
  if (!Array.isArray(parsed?.segments) || parsed.segments.length !== prepared.segments.length) {
    throw new Error('Speech planner output must contain one cue object per source segment.');
  }
  const cueById = new Map(parsed.segments.map((segment) => [String(segment.id ?? ''), segment]));
  return {
    ...createIdentitySpeechPerformancePlan(prepared),
    mode: 'prompted',
    planner,
    segments: prepared.segments.map((segment) => {
      const cue = cueById.get(segment.id);
      if (!cue) throw new Error(`Speech planner output is missing segment "${segment.id}".`);
      const { id: _id, text: _text, speaker: _speaker, ...safeCue } = cue;
      return { ...segment, ...sanitizeOptionalCueValues(segment.text, safeCue) };
    }) as SpeechPerformancePlan['segments'],
  };
}

function sanitizeOptionalCueValues(
  sourceText: string,
  cue: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(cue.emphasis)) return cue;
  const sourceLower = sourceText.toLocaleLowerCase();
  const emphasis = cue.emphasis.filter(
    (phrase): phrase is string =>
      typeof phrase === 'string' &&
      phrase.length > 0 &&
      sourceLower.includes(phrase.toLocaleLowerCase()),
  );
  return { ...cue, emphasis };
}

async function recordUsage(
  config: BatchBackendConfig,
  repository: ReturnType<typeof resolveGenerationBudgetRepository>,
  now: () => Date,
  result: ProviderStructuredExecutionResult,
): Promise<void> {
  await recordGenerationBudgetUsageAfterSuccess({
    config,
    provider: 'google_ai_studio',
    model: config.speechPlanner.model,
    usageTotalTokens: result.usage?.totalTokens,
    now: now(),
    repository,
  });
}
