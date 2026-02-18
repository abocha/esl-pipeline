import type {
  GenerateDraftRequest,
  GenerateDraftResponse,
  GenerationErrorCategory,
  GenerationProvider,
} from '@esl-pipeline/contracts';
import {
  classifyProviderRuntimeFailure,
  runProviderFallbackLadder,
  type ProviderRuntimeClassificationRules,
} from '@esl-pipeline/provider-runtime';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { GenerationBudgetUsage } from '../domain/generation-budget-repository.js';
import { logger } from '../infrastructure/logger.js';
import {
  GenerationBudgetExceededError,
  enforceGenerationBudgetBeforeAttempt,
  recordGenerationBudgetUsageAfterSuccess,
  resolveGenerationBudgetRepository,
  type GenerationBudgetGuardDependencies,
} from './generation-budget-guard.js';
import { getPromptPackage } from './get-prompt-package.js';
import {
  type ProviderExecutionRequest,
  type ProviderExecutionResult,
  ProviderExecutionError,
  executeGoogleGeneration,
  executeOpenAiGeneration,
  executeOpenRouterGeneration,
} from './generation-providers.js';
import { buildQuotaSnapshot, resolveGenerationCandidates } from './generation-policy.js';

type ProviderExecutor = (args: {
  config: BatchBackendConfig['generation'];
  request: ProviderExecutionRequest;
}) => Promise<ProviderExecutionResult>;

const DEFAULT_EXECUTORS: Record<GenerationProvider, ProviderExecutor> = {
  openai: executeOpenAiGeneration,
  google_ai_studio: executeGoogleGeneration,
  openrouter: executeOpenRouterGeneration,
};

const GENERATION_RUNTIME_CLASSIFICATION_RULES: ProviderRuntimeClassificationRules = {
  byProvider: {
    openai: {
      rateLimitCodes: ['rate_limit_exceeded'],
      timeoutStatusMin: 500,
      timeoutCodes: ['server_error'],
    },
    google_ai_studio: {
      timeoutStatusMin: 500,
    },
    openrouter: {
      timeoutStatuses: [500, 502, 503],
    },
  },
};

export class GenerateDraftProviderError extends Error {
  readonly category: GenerationErrorCategory;
  readonly provider: GenerationProvider;
  readonly model: string;
  readonly statusCode: number;
  readonly limitType?: string;
  readonly limit?: number;
  readonly used?: number;
  readonly window?: string;

  constructor(args: {
    category: GenerationErrorCategory;
    provider: GenerationProvider;
    model: string;
    message: string;
    limitType?: string;
    limit?: number;
    used?: number;
    window?: string;
  }) {
    super(args.message);
    this.name = 'GenerateDraftProviderError';
    this.category = args.category;
    this.provider = args.provider;
    this.model = args.model;
    this.statusCode = statusCodeForCategory(args.category);
    this.limitType = args.limitType;
    this.limit = args.limit;
    this.used = args.used;
    this.window = args.window;
  }
}

export interface GenerateDraftDependencies {
  config: BatchBackendConfig;
  promptPackages: {
    getById: typeof getPromptPackage;
  };
  executors: Partial<Record<GenerationProvider, ProviderExecutor>>;
  budget: GenerationBudgetGuardDependencies;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export async function generateDraft(
  request: GenerateDraftRequest,
  overrides?: Partial<GenerateDraftDependencies>,
): Promise<GenerateDraftResponse | null> {
  const config = overrides?.config ?? loadConfig();
  const promptPackages = overrides?.promptPackages ?? {
    getById: getPromptPackage,
  };
  const executors = {
    ...DEFAULT_EXECUTORS,
    ...overrides?.executors,
  };
  const budgetRepository = resolveGenerationBudgetRepository({
    config,
    overrides: overrides?.budget,
  });
  const now = overrides?.now ?? (() => new Date());
  const sleep = overrides?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const promptPackage = await promptPackages.getById(request.promptPackageId);
  if (!promptPackage) {
    return null;
  }

  const candidates = resolveGenerationCandidates({
    config: config.generation,
    providerOverride: request.provider,
    modelOverride: request.model,
  });

  if (candidates.length === 0) {
    throw new GenerateDraftProviderError({
      category: 'provider_contract_error',
      provider: request.provider ?? config.generation.defaultProvider,
      model: request.model ?? 'unspecified',
      message: 'No generation candidates are available for the current provider/model configuration.',
    });
  }

  const execution = await runProviderFallbackLadder<
    (typeof candidates)[number],
    {
      candidate: (typeof candidates)[number];
      result: ProviderExecutionResult;
      quotaUsage: GenerationBudgetUsage;
    },
    GenerateDraftProviderError
  >({
    candidates,
    runCandidate: async (candidate) => {
      await enforceGenerationBudgetBeforeAttempt({
        config,
        provider: candidate.provider,
        model: candidate.model,
        prompt: promptPackage.text,
        maxOutputTokens: request.maxOutputTokens,
        now: now(),
        repository: budgetRepository,
      });

      const executor = executors[candidate.provider];
      if (!executor) {
        throw new GenerateDraftProviderError({
          category: 'provider_contract_error',
          provider: candidate.provider,
          model: candidate.model,
          message: `No generation executor configured for provider: ${candidate.provider}`,
        });
      }

      const result = await executor({
        config: config.generation,
        request: {
          model: candidate.model,
          prompt: promptPackage.text,
          maxOutputTokens: request.maxOutputTokens,
          stream: false,
        },
      });

      await recordGenerationBudgetUsageAfterSuccess({
        config,
        provider: candidate.provider,
        model: candidate.model,
        usageTotalTokens: result.usage?.totalTokens,
        now: now(),
        repository: budgetRepository,
      });

      const quotaUsage = await budgetRepository.getUsage({
        provider: candidate.provider,
        model: candidate.model,
        now: now(),
      });

      return { candidate, result, quotaUsage };
    },
    mapError: (candidate, error) =>
      mapProviderError({
        provider: candidate.provider,
        model: candidate.model,
        error,
      }),
    isTimeoutError: (mappedError) => mappedError.category === 'provider_timeout',
    isFailFastError: (mappedError) =>
      mappedError.category === 'provider_contract_error' ||
      mappedError.category === 'budget_exceeded',
    getRetryMax: (candidate) =>
      retryMaxForProvider(config.generation, candidate.provider),
    getRetryBackoffMs: (candidate) =>
      retryBackoffForProvider(config.generation, candidate.provider),
    sleep,
    onAttempt: ({ candidate, retriesRemaining }) => {
      logger.info('Attempting draft generation candidate', {
        event: 'generation_candidate_attempt',
        provider: candidate.provider,
        model: candidate.model,
        fallbackRank: candidate.fallbackRank,
        retriesRemaining,
      });
    },
    onRetry: ({ candidate, retriesRemaining, backoffMs, mappedError }) => {
      logger.warn('Draft generation timed out; retrying candidate before fallback', {
        event: 'generation_candidate_retry',
        provider: candidate.provider,
        model: candidate.model,
        retriesRemaining,
        backoffMs,
        category: mappedError.category,
      });
    },
    onFallback: ({ candidate, mappedError }) => {
      logger.warn('Draft generation candidate failed; falling back to next candidate', {
        event: 'generation_candidate_fallback',
        provider: candidate.provider,
        model: candidate.model,
        category: mappedError.category,
        statusCode: mappedError.statusCode,
      });
    },
  });

  return {
    text: execution.result.text,
    provider: execution.candidate.provider,
    model: execution.candidate.model,
    quota: buildQuotaSnapshot({
      config: config.generation,
      provider: execution.candidate.provider,
      model: execution.candidate.model,
      usage: execution.quotaUsage,
      now: now(),
    }),
    ...(execution.result.usage ? { usage: execution.result.usage } : {}),
    ...(execution.result.providerRequestId
      ? { providerRequestId: execution.result.providerRequestId }
      : {}),
  };
}

function retryMaxForProvider(
  config: BatchBackendConfig['generation'],
  provider: GenerationProvider,
): number {
  if (provider === 'openai') return Math.max(0, config.providers.openai.retryMax);
  if (provider === 'google_ai_studio') return Math.max(0, config.providers.googleAiStudio.retryMax);
  return Math.max(0, config.providers.openrouter.retryMax);
}

function retryBackoffForProvider(
  config: BatchBackendConfig['generation'],
  provider: GenerationProvider,
): number {
  if (provider === 'openai') return Math.max(0, config.providers.openai.retryBackoffMs);
  if (provider === 'google_ai_studio') return Math.max(0, config.providers.googleAiStudio.retryBackoffMs);
  return Math.max(0, config.providers.openrouter.retryBackoffMs);
}

function statusCodeForCategory(category: GenerationErrorCategory): number {
  if (category === 'provider_rate_limit') return 429;
  if (category === 'provider_timeout') return 504;
  if (category === 'budget_exceeded') return 429;
  return 502;
}

function mapProviderError(args: {
  provider: GenerationProvider;
  model: string;
  error: unknown;
}): GenerateDraftProviderError {
  if (args.error instanceof GenerateDraftProviderError) {
    return args.error;
  }

  if (args.error instanceof GenerationBudgetExceededError) {
    return new GenerateDraftProviderError({
      category: 'budget_exceeded',
      provider: args.provider,
      model: args.model,
      message: args.error.message,
      limitType: args.error.limitType,
      limit: args.error.limit,
      used: args.error.used,
      window: args.error.window,
    });
  }

  const details = getErrorDetails(args.error);
  const category = classifyProviderRuntimeFailure({
    provider: args.provider,
    message: details.message,
    status: details.status,
    code: details.code,
    name: details.name,
    rules: GENERATION_RUNTIME_CLASSIFICATION_RULES,
  });

  return new GenerateDraftProviderError({
    category,
    provider: args.provider,
    model: args.model,
    message: details.message,
  });
}

function getErrorDetails(error: unknown): {
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
    const maybeStatus = error as Error & { status?: number; code?: unknown };
    const code =
      typeof maybeStatus.code === 'string' ? maybeStatus.code : undefined;
    return {
      status: maybeStatus.status,
      code,
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: String(error),
  };
}
