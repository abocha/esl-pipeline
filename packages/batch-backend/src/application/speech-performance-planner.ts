import type {
  PreparedStudyTextSynthesis,
  SpeechPerformancePlan,
  SpeechPerformancePlanner,
  SpeechPerformancePlannerBinding,
  SpeechPerformancePlannerFallbackReason,
  SpeechPerformancePlanV2,
  SpeechPerformancePromptPolicyId,
} from '@esl-pipeline/tts-core';
import {
  analyzeSpeechPlanCandidate,
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
  executeGoogleStructuredGenerationRaw,
  type ProviderStructuredRawExecutionResult,
  parseStructuredJsonText,
} from './generation-providers.js';
import { buildSpeechPlannerRequest } from './speech-performance-prompt.js';

type GoogleStructuredExecutor = typeof executeGoogleStructuredGenerationRaw;

interface SpeechPlannerOutput {
  segments: Array<Record<string, unknown>>;
}

export type SpeechPlannerProvider = 'google_ai_studio' | 'openai';

export interface SpeechPlannerAttemptResult {
  promptPolicyVersion: SpeechPerformancePromptPolicyId;
  promptHash: string;
  rawText?: string;
  rawParse?: ReturnType<typeof parseStructuredJsonText>;
  parsedCandidate?: unknown;
  candidateAnalysis?: import('@esl-pipeline/tts-core').SpeechPlanCandidateAnalysis;
  validation: { status: 'valid' } | { status: 'invalid'; reason: string };
  plan?: SpeechPerformancePlan;
  usage?: ProviderStructuredRawExecutionResult['usage'];
  returnedModel?: string;
  providerRequestId?: string;
  finishReason?: string;
  latencyMs: number;
  fallback?: { reason: SpeechPerformancePlannerFallbackReason };
}

export async function executeSpeechPlannerAttempt(args: {
  config: BatchBackendConfig;
  prepared: PreparedStudyTextSynthesis;
  promptPolicyVersion: SpeechPerformancePromptPolicyId;
  executor?: GoogleStructuredExecutor;
  budget?: GenerationBudgetGuardDependencies;
  now?: () => Date;
  repository?: ReturnType<typeof resolveGenerationBudgetRepository>;
}): Promise<SpeechPlannerAttemptResult> {
  const executor = args.executor ?? executeGoogleStructuredGenerationRaw;
  const now = args.now ?? (() => new Date());
  const repository =
    args.repository ??
    resolveGenerationBudgetRepository({ config: args.config, overrides: args.budget });
  const request = buildSpeechPlannerRequest(
    args.prepared,
    args.promptPolicyVersion,
    args.config.speechPlanner.model,
  );
  const startedAt = now();
  await enforceGenerationBudgetBeforeAttempt({
    config: args.config,
    provider: 'google_ai_studio',
    model: args.config.speechPlanner.model,
    prompt: request.prompt,
    maxOutputTokens: args.config.speechPlanner.maxOutputTokens,
    now: startedAt,
    repository,
    limits: {
      rpmBudget: args.config.speechPlanner.rpmBudget,
      dailyRequestBudget: args.config.speechPlanner.dailyRequestBudget,
    },
  });
  const result = await executor({
    config: args.config.generation,
    request: {
      model: args.config.speechPlanner.model,
      prompt: request.prompt,
      maxOutputTokens: args.config.speechPlanner.maxOutputTokens,
      responseSchema: request.responseSchema,
    },
  });
  await recordUsage(args.config, repository, now, result);
  const finishedAt = now();
  return evaluateSpeechPlannerRawOutput({
    prepared: args.prepared,
    rawText: result.rawText,
    promptPolicyVersion: request.promptPolicyVersion,
    promptHash: request.promptHash,
    plannerModel: args.config.speechPlanner.model,
    generatedAt: finishedAt.toISOString(),
    latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    usage: result.usage,
    returnedModel: result.model,
    providerRequestId: result.providerRequestId,
    finishReason: result.finishReason,
  });
}

export function evaluateSpeechPlannerRawOutput(args: {
  prepared: PreparedStudyTextSynthesis;
  rawText: string;
  promptPolicyVersion: SpeechPerformancePromptPolicyId;
  promptHash: string;
  plannerModel: string;
  generatedAt: string;
  latencyMs: number;
  usage?: ProviderStructuredRawExecutionResult['usage'];
  returnedModel?: string;
  providerRequestId?: string;
  finishReason?: string;
  plannerProvider?: SpeechPlannerProvider;
}): SpeechPlannerAttemptResult {
  const rawParse = parseStructuredJsonText(args.rawText);
  const metadata = {
    promptPolicyVersion: args.promptPolicyVersion,
    promptHash: args.promptHash,
    rawText: args.rawText,
    rawParse,
    usage: args.usage,
    latencyMs: args.latencyMs,
    returnedModel: args.returnedModel,
    providerRequestId: args.providerRequestId,
    finishReason: args.finishReason,
  };
  if (rawParse.status === 'malformed') {
    return {
      ...metadata,
      validation: { status: 'invalid', reason: 'malformed_structured_output' },
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
    };
  }
  const candidate = rawParse.output;
  const schemaVersion =
    args.promptPolicyVersion === 'speech-performance-v3-contextual-continuity' ? 2 : 1;
  const candidateAnalysis = analyzeSpeechPlanCandidate(args.prepared, candidate, { schemaVersion });
  if (candidateAnalysis.hardFailures.length > 0) {
    return {
      ...metadata,
      parsedCandidate: candidate,
      candidateAnalysis,
      validation: {
        status: 'invalid',
        reason: candidateAnalysis.hardFailures.map((failure) => failure.code).join(','),
      },
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
    };
  }
  try {
    const plan = validateSpeechPerformancePlan(
      args.prepared,
      mergePlannerOutput(args.prepared, candidate, {
        provider: args.plannerProvider ?? 'google_ai_studio',
        model: args.plannerModel,
        generatedAt: args.generatedAt,
        promptPolicyVersion: args.promptPolicyVersion,
        promptHash: args.promptHash,
      }),
    );
    return {
      ...metadata,
      parsedCandidate: candidate,
      candidateAnalysis,
      validation: { status: 'valid' },
      plan,
    };
  } catch (error) {
    return {
      ...metadata,
      parsedCandidate: candidate,
      candidateAnalysis,
      validation: {
        status: 'invalid',
        reason: error instanceof Error ? error.message : String(error),
      },
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
    };
  }
}

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
  const executor = overrides.executor ?? executeGoogleStructuredGenerationRaw;
  const now = overrides.now ?? (() => new Date());
  const repository = resolveGenerationBudgetRepository({ config, overrides: overrides.budget });

  return {
    planner: {
      async plan(prepared) {
        const attempt = await executeSpeechPlannerAttempt({
          config,
          prepared,
          promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
          executor,
          now,
          repository,
        });
        if (attempt.plan) return attempt.plan;
        throw new SpeechPerformancePlannerInvalidOutputError(
          'Speech planner output failed validation.',
          {
            validationMessage:
              attempt.validation.status === 'invalid'
                ? attempt.validation.reason
                : 'Speech planner output was not validated.',
            rejectedOutput: attempt.parsedCandidate,
            rawText: attempt.rawText,
          },
        );
      },
    },
  };
}

function mergePlannerOutput(
  prepared: Parameters<SpeechPerformancePlanner['plan']>[0],
  output: unknown,
  planner: NonNullable<SpeechPerformancePlan['planner']>,
): SpeechPerformancePlan {
  if (planner.promptPolicyVersion === 'speech-performance-v3-contextual-continuity') {
    return mergePlannerOutputV2(prepared, output, planner);
  }
  return mergePlannerOutputV1(prepared, output, planner);
}

function mergePlannerOutputV1(
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

function mergePlannerOutputV2(
  prepared: PreparedStudyTextSynthesis,
  output: unknown,
  planner: NonNullable<SpeechPerformancePlan['planner']>,
): SpeechPerformancePlanV2 {
  if (
    !prepared.performanceMode ||
    !prepared.performanceContextHash ||
    !prepared.performanceSpeakers
  ) {
    throw new Error('Speech planner v3 output requires prepared performance context.');
  }
  const parsed = output as {
    performanceContext?: {
      overallDirection?: unknown;
      speakerEnvelopes?: unknown;
    };
    segments?: Array<Record<string, unknown>>;
  };
  if (
    !parsed.performanceContext ||
    !Array.isArray(parsed.performanceContext.speakerEnvelopes) ||
    !Array.isArray(parsed.segments) ||
    parsed.segments.length !== prepared.segments.length
  ) {
    throw new Error('Speech planner v3 output has an invalid contextual plan shape.');
  }
  const cueById = new Map(parsed.segments.map((segment) => [String(segment.id ?? ''), segment]));
  const plan: SpeechPerformancePlanV2 = {
    schemaVersion: 2,
    mode: 'prompted',
    provider: prepared.selection.provider,
    model: prepared.selection.model,
    sourceHash: prepared.sourceHash,
    performanceContextHash: prepared.performanceContextHash,
    resolvedPerformanceMode: prepared.performanceMode,
    performanceContext: {
      overallDirection: parsed.performanceContext
        .overallDirection as SpeechPerformancePlanV2['performanceContext']['overallDirection'],
      speakerEnvelopes: parsed.performanceContext
        .speakerEnvelopes as SpeechPerformancePlanV2['performanceContext']['speakerEnvelopes'],
    },
    planner,
    segments: prepared.segments.map((source) => {
      const raw = cueById.get(source.id);
      if (!raw) throw new Error(`Speech planner output is missing segment "${source.id}".`);
      const pace = raw.pace === 'omit' ? undefined : raw.pace;
      const deliveryMode = raw.deliveryMode === 'DEFAULT' ? undefined : raw.deliveryMode;
      const emphasis = canonicalizeEmphasis(source.text, raw.emphasis);
      const rawControlEvidence = Array.isArray(raw.controlEvidence)
        ? (raw.controlEvidence as Array<Record<string, unknown>>)
        : [];
      const paceWithEmphasis = Boolean(pace && emphasis.length > 0);
      const keepEmphasis =
        !paceWithEmphasis ||
        rawControlEvidence.some(
          (entry) => entry.control === 'emphasis' && entry.learnerMeaningRequired === true,
        );
      const survivingEmphasis = keepEmphasis ? emphasis : [];
      const controlEvidence = rawControlEvidence.filter(
        (entry) => entry.control !== 'emphasis' || survivingEmphasis.length > 0,
      ) as unknown as NonNullable<SpeechPerformancePlanV2['segments'][number]['controlEvidence']>;
      const rawTurn = raw.turnAdjustment as Record<string, unknown> | undefined;
      const turnAdjustment =
        rawTurn &&
        Array.isArray(rawTurn.components) &&
        rawTurn.components.length > 0 &&
        Array.isArray(rawTurn.evidence) &&
        rawTurn.evidence.length > 0 &&
        typeof rawTurn.reason === 'string' &&
        rawTurn.reason.trim()
          ? (rawTurn as unknown as NonNullable<
              SpeechPerformancePlanV2['segments'][number]['turnAdjustment']
            >)
          : undefined;
      return {
        ...source,
        ...(turnAdjustment ? { turnAdjustment } : {}),
        ...(pace
          ? { pace: pace as NonNullable<SpeechPerformancePlanV2['segments'][number]['pace']> }
          : {}),
        ...(survivingEmphasis.length > 0 ? { emphasis: survivingEmphasis } : {}),
        ...(typeof raw.pauseBeforeMs === 'number' && raw.pauseBeforeMs > 0
          ? { pauseBeforeMs: raw.pauseBeforeMs }
          : {}),
        ...(typeof raw.pauseAfterMs === 'number' && raw.pauseAfterMs > 0
          ? { pauseAfterMs: raw.pauseAfterMs }
          : {}),
        ...(Array.isArray(raw.nonVerbalsBefore) && raw.nonVerbalsBefore.length > 0
          ? {
              nonVerbalsBefore: raw.nonVerbalsBefore as NonNullable<
                SpeechPerformancePlanV2['segments'][number]['nonVerbalsBefore']
              >,
            }
          : {}),
        ...(Array.isArray(raw.nonVerbalsAfter) && raw.nonVerbalsAfter.length > 0
          ? {
              nonVerbalsAfter: raw.nonVerbalsAfter as NonNullable<
                SpeechPerformancePlanV2['segments'][number]['nonVerbalsAfter']
              >,
            }
          : {}),
        ...(deliveryMode
          ? {
              deliveryMode: deliveryMode as NonNullable<
                SpeechPerformancePlanV2['segments'][number]['deliveryMode']
              >,
            }
          : {}),
        ...(controlEvidence.length > 0 ? { controlEvidence } : {}),
      };
    }),
  };
  return validateSpeechPerformancePlan(prepared, plan) as SpeechPerformancePlanV2;
}

function canonicalizeEmphasis(sourceText: string, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const sourceLower = sourceText.toLocaleLowerCase();
  return [
    ...new Set(
      value.flatMap((phrase) => {
        if (typeof phrase !== 'string' || !phrase) return [];
        const index = sourceLower.indexOf(phrase.toLocaleLowerCase());
        return index < 0 ? [] : [sourceText.slice(index, index + phrase.length)];
      }),
    ),
  ];
}

function sanitizeOptionalCueValues(
  sourceText: string,
  cue: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = Object.fromEntries(
    Object.entries(cue).filter(([, value]) => {
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined;
    }),
  );
  if (!Array.isArray(normalized.emphasis)) return normalized;
  const sourceLower = sourceText.toLocaleLowerCase();
  const emphasis = normalized.emphasis.filter(
    (phrase): phrase is string =>
      typeof phrase === 'string' &&
      phrase.length > 0 &&
      sourceLower.includes(phrase.toLocaleLowerCase()),
  );
  const canonical = emphasis.map((phrase) => {
    const index = sourceLower.indexOf(phrase.toLocaleLowerCase());
    return sourceText.slice(index, index + phrase.length);
  });
  return { ...normalized, emphasis: [...new Set(canonical)] };
}

async function recordUsage(
  config: BatchBackendConfig,
  repository: ReturnType<typeof resolveGenerationBudgetRepository>,
  now: () => Date,
  result: ProviderStructuredRawExecutionResult,
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
