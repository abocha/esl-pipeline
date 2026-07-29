import type {
  PreparedStudyTextSynthesis,
  SpeechPerformancePlan,
  SpeechPerformancePlanner,
  SpeechPerformancePlannerBinding,
  SpeechPerformancePlannerFallbackReason,
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
      fallback: undefined,
    };
  }
  const candidate = rawParse.output;
  const candidateAnalysis = analyzeSpeechPlanCandidate(args.prepared, candidate);
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
      fallback: undefined,
    };
  }
  try {
    const plan = validateSpeechPerformancePlan(
      args.prepared,
      mergePlannerOutput(args.prepared, candidate, {
        provider: 'google_ai_studio',
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
      fallback: undefined,
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
