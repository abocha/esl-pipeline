import {
  classifyProviderRuntimeFailure,
  type ProviderRuntimeCategory,
  type ProviderRuntimeClassificationRules,
  runProviderFallbackLadder,
} from '@esl-pipeline/provider-runtime';
import type {
  PreparedStudyTextSynthesis,
  SpeechPerformancePlan,
  SpeechPerformancePlanV2,
  SpeechPerformancePlanner,
  SpeechPerformancePlannerBinding,
  SpeechPerformancePlannerFallbackReason,
  SpeechPerformancePromptPolicyId,
} from '@esl-pipeline/tts-core';
import {
  analyzeSpeechPlanCandidate,
  assertSourceHasNoReservedDelimiter,
  CONTEXTUAL_SPEECH_ANNOTATION_VERSION,
  createIdentitySpeechPerformancePlan,
  SpeechPerformancePlannerBudgetExceededError,
  SpeechPerformancePlannerInvalidOutputError,
  validateSpeechPerformancePlan,
} from '@esl-pipeline/tts-core';

import type { BatchBackendConfig, SpeechPlannerProvider } from '../config/env.js';
import {
  enforceGenerationBudgetBeforeAttempt,
  GenerationBudgetExceededError,
  type GenerationBudgetGuardDependencies,
  getConfiguredGenerationAllowedModels,
  getConfiguredGenerationProviderLimits,
  getConfiguredSpeechPlannerLimits,
  recordGenerationBudgetUsageAfterSuccess,
  resolveGenerationBudgetRepository,
} from './generation-budget-guard.js';
import {
  executeGoogleStructuredGenerationRaw,
  executeOpenAiStructuredGenerationRaw,
  ProviderExecutionError,
  type ProviderStructuredExecutionRequest,
  type ProviderStructuredRawExecutionResult,
  parseStructuredJsonText,
} from './generation-providers.js';
import { buildSpeechPlannerRequest } from './speech-performance-prompt.js';

type SpeechPlannerExecutor = (args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}) => Promise<ProviderStructuredRawExecutionResult>;

const DEFAULT_EXECUTORS: Record<SpeechPlannerProvider, SpeechPlannerExecutor> = {
  google_ai_studio: executeGoogleStructuredGenerationRaw,
  openai: executeOpenAiStructuredGenerationRaw,
};

const SPEECH_PLANNER_RUNTIME_CLASSIFICATION_RULES: ProviderRuntimeClassificationRules = {
  byProvider: {
    openai: { timeoutStatusMin: 500, timeoutCodes: ['server_error'] },
    google_ai_studio: { timeoutStatusMin: 500 },
  },
};

interface SpeechPlannerOutput {
  segments: Array<Record<string, unknown>>;
}

interface SpeechAnnotationOutput {
  segments: Array<{ id: string; synthesisText: string }>;
}

export type { SpeechPlannerProvider } from '../config/env.js';

class SpeechPlannerProviderRuntimeError extends Error {
  readonly category: ProviderRuntimeCategory | 'budget_exceeded';
  readonly provider: SpeechPlannerProvider;
  readonly model: string;

  constructor(args: {
    category: ProviderRuntimeCategory | 'budget_exceeded';
    provider: SpeechPlannerProvider;
    model: string;
    message: string;
  }) {
    super(args.message);
    this.name = 'SpeechPlannerProviderRuntimeError';
    this.category = args.category;
    this.provider = args.provider;
    this.model = args.model;
  }
}

type SpeechPlannerMappedError =
  | SpeechPlannerProviderRuntimeError
  | SpeechPerformancePlannerBudgetExceededError;

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
  executors?: Partial<Record<SpeechPlannerProvider, SpeechPlannerExecutor>>;
  /** @deprecated Use provider-indexed executors. */
  executor?: SpeechPlannerExecutor;
  budget?: GenerationBudgetGuardDependencies;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  repository?: ReturnType<typeof resolveGenerationBudgetRepository>;
}): Promise<SpeechPlannerAttemptResult> {
  const provider = args.config.speechPlanner.provider;
  const executors = { ...DEFAULT_EXECUTORS, ...args.executors };
  if (args.executor) executors[provider] = args.executor;
  const executor = executors[provider];
  const now = args.now ?? (() => new Date());
  const sleep = args.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const repository =
    args.repository ??
    resolveGenerationBudgetRepository({ config: args.config, overrides: args.budget });
  const request = buildSpeechPlannerRequest(
    args.prepared,
    args.promptPolicyVersion,
    args.config.speechPlanner.model,
  );
  if (args.promptPolicyVersion === 'contextual-bracket-annotation-v1') {
    try {
      for (const segment of args.prepared.segments) {
        assertSourceHasNoReservedDelimiter(segment.text);
      }
    } catch (error) {
      return {
        promptPolicyVersion: request.promptPolicyVersion,
        promptHash: request.promptHash,
        validation: {
          status: 'invalid',
          reason: error instanceof Error ? error.message : String(error),
        },
        latencyMs: 0,
        fallback: { reason: 'planner_invalid' },
      };
    }
  }
  const startedAt = now();
  const candidate = { provider, model: args.config.speechPlanner.model } as const;
  const result = await runProviderFallbackLadder<
    typeof candidate,
    ProviderStructuredRawExecutionResult,
    SpeechPlannerMappedError
  >({
    candidates: [candidate],
    runCandidate: async (selected) => {
      await enforceGenerationBudgetBeforeAttempt({
        config: args.config,
        provider: selected.provider,
        model: selected.model,
        prompt: request.prompt,
        maxOutputTokens: args.config.speechPlanner.maxOutputTokens,
        now: now(),
        repository,
        limits: {
          ...getConfiguredGenerationProviderLimits(args.config.generation, selected.provider),
          ...getConfiguredSpeechPlannerLimits(args.config),
        },
      });
      const executed = await executor({
        config: args.config.generation,
        request: {
          model: selected.model,
          prompt: request.prompt,
          maxOutputTokens: args.config.speechPlanner.maxOutputTokens,
          responseSchema: request.responseSchema,
          ...(selected.provider === 'openai' ? { store: false } : {}),
        },
      });
      await recordUsage(args.config, repository, now, selected.provider, executed);
      return executed;
    },
    mapError: (selected, error) => mapSpeechPlannerProviderError(selected, error),
    isTimeoutError: (error) => error.category === 'provider_timeout',
    isFailFastError: (error) =>
      error.category === 'provider_contract_error' || error.category === 'budget_exceeded',
    getRetryMax: (selected) => retryMaxForProvider(args.config.generation, selected.provider),
    getRetryBackoffMs: (selected) =>
      retryBackoffForProvider(args.config.generation, selected.provider),
    sleep,
  });
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
    plannerProvider: provider,
  });
}

export function returnedModelMatchesRequestedModel(
  requestedModel: string,
  returnedModel: string | undefined,
): boolean {
  return (
    returnedModel === undefined ||
    returnedModel === requestedModel ||
    returnedModel.startsWith(`${requestedModel}-`)
  );
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
  const baseMetadata = {
    promptPolicyVersion: args.promptPolicyVersion,
    promptHash: args.promptHash,
    rawText: args.rawText,
    usage: args.usage,
    latencyMs: args.latencyMs,
    returnedModel: args.returnedModel,
    providerRequestId: args.providerRequestId,
    finishReason: args.finishReason,
  };
  if (!returnedModelMatchesRequestedModel(args.plannerModel, args.returnedModel)) {
    return {
      ...baseMetadata,
      validation: { status: 'invalid', reason: 'returned_model_mismatch' },
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
    };
  }
  const rawParse = parseStructuredJsonText(args.rawText);
  const metadata = { ...baseMetadata, rawParse };
  if (rawParse.status === 'malformed') {
    return {
      ...metadata,
      validation: { status: 'invalid', reason: 'malformed_structured_output' },
      plan: undefined,
      fallback: { reason: 'planner_invalid' },
    };
  }
  const candidate = rawParse.output;
  const candidateAnalysis =
    args.promptPolicyVersion === 'contextual-bracket-annotation-v1'
      ? { hardFailures: [], warnings: [] }
      : analyzeSpeechPlanCandidate(args.prepared, candidate);
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
        ...(args.returnedModel ? { returnedModel: args.returnedModel } : {}),
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
    executors?: Partial<Record<SpeechPlannerProvider, SpeechPlannerExecutor>>;
    /** @deprecated Use provider-indexed executors. */
    executor?: SpeechPlannerExecutor;
    budget?: GenerationBudgetGuardDependencies;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): SpeechPerformancePlannerBinding {
  if (!config.speechPlanner?.enabled) return { unavailableReason: 'planner_disabled' };
  const provider = config.speechPlanner.provider;
  if (
    !getConfiguredGenerationAllowedModels(config.generation, provider).includes(
      config.speechPlanner.model,
    )
  ) {
    return { unavailableReason: 'planner_unavailable' };
  }
  if (!credentialForProvider(config.generation, provider)) {
    return { unavailableReason: 'planner_missing_credentials' };
  }
  const now = overrides.now ?? (() => new Date());
  const repository = resolveGenerationBudgetRepository({ config, overrides: overrides.budget });

  return {
    planner: {
      async plan(prepared) {
        const attempt = await executeSpeechPlannerAttempt({
          config,
          prepared,
          promptPolicyVersion: 'contextual-bracket-annotation-v1',
          executors: overrides.executors,
          executor: overrides.executor,
          now,
          sleep: overrides.sleep,
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
  if (planner.promptPolicyVersion === 'contextual-bracket-annotation-v1') {
    return mergePlannerOutputV2(prepared, output, planner);
  }
  return mergePlannerOutputV1(prepared, output, planner);
}

function mergePlannerOutputV2(
  prepared: Parameters<SpeechPerformancePlanner['plan']>[0],
  output: unknown,
  planner: NonNullable<SpeechPerformancePlan['planner']>,
): SpeechPerformancePlanV2 {
  const parsed = output as Partial<SpeechAnnotationOutput>;
  if (!Array.isArray(parsed?.segments) || parsed.segments.length !== prepared.segments.length) {
    throw new Error('Speech annotation output must contain every source segment exactly once.');
  }
  const segments = prepared.segments.map((source, index) => {
    const candidate = parsed.segments![index];
    if (!candidate || candidate.id !== source.id) {
      throw new Error(
        `Speech annotation segment at index ${index} does not match source segment "${source.id}".`,
      );
    }
    if (typeof candidate.synthesisText !== 'string') {
      throw new Error(`Speech annotation segment "${source.id}" has no synthesisText.`);
    }
    return { ...source, synthesisText: candidate.synthesisText };
  });
  return {
    schemaVersion: 2,
    mode: 'prompted',
    provider: prepared.selection.provider,
    model: prepared.selection.model,
    sourceHash: prepared.sourceHash,
    enhancerVersion: CONTEXTUAL_SPEECH_ANNOTATION_VERSION,
    planner,
    segments,
  };
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
  provider: SpeechPlannerProvider,
  result: ProviderStructuredRawExecutionResult,
): Promise<void> {
  await recordGenerationBudgetUsageAfterSuccess({
    config,
    provider,
    model: config.speechPlanner.model,
    usageTotalTokens: result.usage?.totalTokens,
    now: now(),
    repository,
  });
}

function credentialForProvider(
  config: BatchBackendConfig['generation'],
  provider: SpeechPlannerProvider,
): string | undefined {
  return provider === 'openai'
    ? config.providers.openai.apiKey
    : config.providers.googleAiStudio.apiKey;
}

function retryMaxForProvider(
  config: BatchBackendConfig['generation'],
  provider: SpeechPlannerProvider,
): number {
  return Math.max(
    0,
    provider === 'openai'
      ? config.providers.openai.retryMax
      : config.providers.googleAiStudio.retryMax,
  );
}

function retryBackoffForProvider(
  config: BatchBackendConfig['generation'],
  provider: SpeechPlannerProvider,
): number {
  return Math.max(
    0,
    provider === 'openai'
      ? config.providers.openai.retryBackoffMs
      : config.providers.googleAiStudio.retryBackoffMs,
  );
}

function mapSpeechPlannerProviderError(
  candidate: { provider: SpeechPlannerProvider; model: string },
  error: unknown,
): SpeechPlannerMappedError {
  if (error instanceof SpeechPlannerProviderRuntimeError) return error;
  if (error instanceof SpeechPerformancePlannerBudgetExceededError) return error;
  if (error instanceof GenerationBudgetExceededError) {
    return new SpeechPerformancePlannerBudgetExceededError(error.message, { cause: error });
  }
  const details = getProviderErrorDetails(error);
  const contractCodes = new Set([
    'malformed_payload',
    'malformed_structured_output',
    'missing_api_key',
  ]);
  return new SpeechPlannerProviderRuntimeError({
    category: contractCodes.has(details.code ?? '')
      ? 'provider_contract_error'
      : classifyProviderRuntimeFailure({
          provider: candidate.provider,
          ...details,
          rules: SPEECH_PLANNER_RUNTIME_CLASSIFICATION_RULES,
        }),
    provider: candidate.provider,
    model: candidate.model,
    message: details.message,
  });
}

function getProviderErrorDetails(error: unknown): {
  status?: number;
  code?: string;
  message: string;
  name?: string;
} {
  if (error instanceof ProviderExecutionError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      name: error.name,
    };
  }
  if (error instanceof Error) {
    const cast = error as Error & { status?: number; code?: unknown };
    return {
      status: cast.status,
      code: typeof cast.code === 'string' ? cast.code : undefined,
      message: error.message,
      name: error.name,
    };
  }
  return { message: String(error) };
}
