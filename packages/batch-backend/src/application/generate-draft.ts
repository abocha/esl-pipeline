import type {
  GenerateDraftRequest,
  GenerateDraftResponse,
  GenerationErrorCategory,
  GenerationProvider,
} from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { logger } from '../infrastructure/logger.js';
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

export class GenerateDraftProviderError extends Error {
  readonly category: GenerationErrorCategory;
  readonly provider: GenerationProvider;
  readonly model: string;
  readonly statusCode: number;

  constructor(args: {
    category: GenerationErrorCategory;
    provider: GenerationProvider;
    model: string;
    message: string;
  }) {
    super(args.message);
    this.name = 'GenerateDraftProviderError';
    this.category = args.category;
    this.provider = args.provider;
    this.model = args.model;
    this.statusCode = statusCodeForCategory(args.category);
  }
}

export interface GenerateDraftDependencies {
  config: BatchBackendConfig;
  promptPackages: {
    getById: typeof getPromptPackage;
  };
  executors: Partial<Record<GenerationProvider, ProviderExecutor>>;
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
    ...(overrides?.executors ?? {}),
  };
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

  let lastFallbackError: GenerateDraftProviderError | null = null;

  for (const candidate of candidates) {
    const executor = executors[candidate.provider];
    if (!executor) {
      throw new GenerateDraftProviderError({
        category: 'provider_contract_error',
        provider: candidate.provider,
        model: candidate.model,
        message: `No generation executor configured for provider: ${candidate.provider}`,
      });
    }

    let retriesRemaining = retryMaxForProvider(config.generation, candidate.provider);

    while (true) {
      try {
        logger.info('Attempting draft generation candidate', {
          event: 'generation_candidate_attempt',
          provider: candidate.provider,
          model: candidate.model,
          fallbackRank: candidate.fallbackRank,
          retriesRemaining,
        });

        const result = await executor({
          config: config.generation,
          request: {
            model: candidate.model,
            prompt: promptPackage.text,
            maxOutputTokens: request.maxOutputTokens,
            stream: false,
          },
        });

        return {
          text: result.text,
          provider: candidate.provider,
          model: candidate.model,
          quota: buildQuotaSnapshot({
            config: config.generation,
            provider: candidate.provider,
            model: candidate.model,
            now: now(),
          }),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
        };
      } catch (error) {
        const mapped = mapProviderError({
          provider: candidate.provider,
          model: candidate.model,
          error,
        });

        if (mapped.category === 'provider_timeout' && retriesRemaining > 0) {
          retriesRemaining -= 1;
          const backoffMs = retryBackoffForProvider(config.generation, candidate.provider);
          logger.warn('Draft generation timed out; retrying candidate before fallback', {
            event: 'generation_candidate_retry',
            provider: candidate.provider,
            model: candidate.model,
            retriesRemaining,
            backoffMs,
            category: mapped.category,
          });
          if (backoffMs > 0) {
            await sleep(backoffMs);
          }
          continue;
        }

        if (mapped.category === 'provider_contract_error') {
          throw mapped;
        }

        lastFallbackError = mapped;
        logger.warn('Draft generation candidate failed; falling back to next candidate', {
          event: 'generation_candidate_fallback',
          provider: candidate.provider,
          model: candidate.model,
          category: mapped.category,
          statusCode: mapped.statusCode,
        });
        break;
      }
    }
  }

  if (lastFallbackError) {
    throw lastFallbackError;
  }

  throw new GenerateDraftProviderError({
    category: 'provider_contract_error',
    provider: request.provider ?? config.generation.defaultProvider,
    model: request.model ?? 'unspecified',
    message: 'All generation candidates failed before a fallback decision could be applied.',
  });
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
  return 502;
}

function mapProviderError(args: {
  provider: GenerationProvider;
  model: string;
  error: unknown;
}): GenerateDraftProviderError {
  const details = getErrorDetails(args.error);

  if (isRateLimitError(args.provider, details.status, details.code)) {
    return new GenerateDraftProviderError({
      category: 'provider_rate_limit',
      provider: args.provider,
      model: args.model,
      message: details.message,
    });
  }

  if (isTimeoutError(args.provider, details)) {
    return new GenerateDraftProviderError({
      category: 'provider_timeout',
      provider: args.provider,
      model: args.model,
      message: details.message,
    });
  }

  return new GenerateDraftProviderError({
    category: 'provider_contract_error',
    provider: args.provider,
    model: args.model,
    message: details.message,
  });
}

function isRateLimitError(
  provider: GenerationProvider,
  status: number | undefined,
  code: string | undefined,
): boolean {
  if (status === 429) return true;
  if (provider === 'openai' && code === 'rate_limit_exceeded') return true;
  return false;
}

function isTimeoutError(
  provider: GenerationProvider,
  details: {
    status?: number;
    code?: string;
    message: string;
    name?: string;
  },
): boolean {
  const message = details.message.toLowerCase();
  const code = details.code?.toLowerCase();

  if (
    details.name === 'AbortError' ||
    code === 'etimedout' ||
    code === 'econnreset' ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('fetch failed')
  ) {
    return true;
  }

  const status = details.status;
  if (status === undefined) return false;

  if (status === 408 || status === 504) {
    return true;
  }

  if (provider === 'openai') {
    if (status >= 500) return true;
    if (code === 'server_error') return true;
    return false;
  }

  if (provider === 'google_ai_studio') {
    return status >= 500;
  }

  return status === 500 || status === 502 || status === 503;
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
    const maybeStatus = error as Error & { status?: number; code?: string };
    return {
      status: maybeStatus.status,
      code: maybeStatus.code,
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: String(error),
  };
}
