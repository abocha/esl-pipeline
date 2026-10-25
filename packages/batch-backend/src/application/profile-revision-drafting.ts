import type { GenerationErrorCategory, GenerationProvider } from '@esl-pipeline/contracts';
import {
  classifyProviderRuntimeFailure,
  type ProviderRuntimeClassificationRules,
} from '@esl-pipeline/provider-runtime';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { GenerationBudgetUsage } from '../domain/generation-budget-repository.js';
import {
  FOUNDATIONAL_PROFILE_JSON_SCHEMA,
  FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_DESCRIPTION,
  FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_NAME,
  type FoundationalProfile,
  validateFoundationalProfileOutput,
} from './foundational-profile.js';
import {
  enforceGenerationBudgetBeforeAttempt,
  GenerationBudgetExceededError,
  type GenerationBudgetGuardDependencies,
  recordGenerationBudgetUsageAfterSuccess,
  resolveGenerationBudgetRepository,
} from './generation-budget-guard.js';
import { resolveGenerationTarget } from './generation-policy.js';
import {
  executeOpenAiStructuredGeneration,
  ProviderExecutionError,
  type ProviderStructuredExecutionRequest,
  type ProviderStructuredExecutionResult,
} from './generation-providers.js';
import {
  type GenerationRequestEnvelopeV1,
  resolveGenerationRequestText,
} from './generation-request-envelope.js';
import type { ProfileCandidatePatch } from './profile-candidate-patch.js';

type ProviderExecutor = (args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}) => Promise<ProviderStructuredExecutionResult>;

const DEFAULT_EXECUTORS: Partial<Record<GenerationProvider, ProviderExecutor>> = {
  openai: executeOpenAiStructuredGeneration,
};

const GENERATION_RUNTIME_CLASSIFICATION_RULES: ProviderRuntimeClassificationRules = {
  byProvider: {
    openai: {
      rateLimitCodes: ['rate_limit_exceeded'],
      timeoutStatusMin: 500,
      timeoutCodes: ['server_error'],
    },
  },
};

export type ProfileDraftingOperation =
  | 'candidate_promotion'
  | 'legacy_normalization'
  | 'lesson_population'
  | 'profile_revision_refresh';

export class ProfileRevisionDraftingError extends Error {
  readonly category: GenerationErrorCategory;
  readonly provider: GenerationProvider;
  readonly model: string;
  readonly statusCode: number;
  readonly limitType?: string;
  readonly limit?: number;
  readonly used?: number;
  readonly window?: string;
  readonly rejectedBeforeExecution: boolean;
  readonly providerStatus?: number;
  readonly retryAfterMs?: number;

  constructor(args: {
    category: GenerationErrorCategory;
    provider: GenerationProvider;
    model: string;
    message: string;
    limitType?: string;
    limit?: number;
    used?: number;
    window?: string;
    rejectedBeforeExecution?: boolean;
    providerStatus?: number;
    retryAfterMs?: number;
  }) {
    super(args.message);
    this.name = 'ProfileRevisionDraftingError';
    this.category = args.category;
    this.provider = args.provider;
    this.model = args.model;
    this.statusCode = statusCodeForCategory(args.category);
    this.limitType = args.limitType;
    this.limit = args.limit;
    this.used = args.used;
    this.window = args.window;
    this.rejectedBeforeExecution = args.rejectedBeforeExecution ?? false;
    this.providerStatus = args.providerStatus;
    this.retryAfterMs = args.retryAfterMs;
  }
}

export interface GenerateProfileRevisionDraftDependencies {
  config: BatchBackendConfig;
  executors: Partial<Record<GenerationProvider, ProviderExecutor>>;
  budget: GenerationBudgetGuardDependencies;
  now: () => Date;
}

export interface GenerateProfileRevisionDraftRequest {
  prompt: string;
  envelope?: GenerationRequestEnvelopeV1;
  operation: ProfileDraftingOperation;
  maxOutputTokens?: number;
  providerOverride?: GenerationProvider;
  modelOverride?: string;
  budgetReservationAlreadyMade?: boolean;
  responseSchema?: ProviderStructuredExecutionRequest['responseSchema'];
  validateOutput?: (output: unknown) => FoundationalProfile | ProfileCandidatePatch;
  onValidatedResponse?: (profile: FoundationalProfile | ProfileCandidatePatch) => Promise<void>;
}

export interface GenerateProfileRevisionDraftResult {
  structuredProfile: FoundationalProfile | ProfileCandidatePatch;
  rawOutput: unknown;
  rawText: string;
  provider: GenerationProvider;
  model: string;
  providerRequestId?: string;
  usage?: ProviderStructuredExecutionResult['usage'];
  finishReason?: string;
}

export async function generateProfileRevisionDraft(args: {
  request: GenerateProfileRevisionDraftRequest;
  overrides?: Partial<GenerateProfileRevisionDraftDependencies>;
}): Promise<GenerateProfileRevisionDraftResult> {
  const config = args.overrides?.config ?? loadConfig();
  const executors = {
    ...DEFAULT_EXECUTORS,
    ...args.overrides?.executors,
  };
  const budgetRepository = resolveGenerationBudgetRepository({
    config,
    overrides: args.overrides?.budget,
  });
  const now = args.overrides?.now ?? (() => new Date());

  let target = {
    provider:
      args.request.providerOverride ?? config.generation.targets.profile_revision_drafting.provider,
    model: args.request.modelOverride ?? 'unspecified',
  };
  let execution: {
    target: ReturnType<typeof resolveGenerationTarget>;
    result: ProviderStructuredExecutionResult;
    quotaUsage: GenerationBudgetUsage;
  };
  try {
    target = resolveGenerationTarget({
      config: config.generation,
      workload: 'profile_revision_drafting',
      providerOverride: args.request.providerOverride,
      modelOverride: args.request.modelOverride,
    });
    if (!args.request.budgetReservationAlreadyMade) {
      await enforceGenerationBudgetBeforeAttempt({
        config,
        provider: target.provider,
        model: target.model,
        prompt: resolveGenerationRequestText(args.request),
        maxOutputTokens: args.request.maxOutputTokens,
        now: now(),
        repository: budgetRepository,
      });
    }

    const executor = executors[target.provider];
    if (!executor) {
      throw new ProfileRevisionDraftingError({
        category: 'provider_contract_error',
        provider: target.provider,
        model: target.model,
        message: `No generation executor configured for provider: ${target.provider}`,
        rejectedBeforeExecution: true,
      });
    }

    const result = await executor({
      config: config.generation,
      request: {
        model: target.model,
        prompt: resolveGenerationRequestText(args.request),
        ...(args.request.envelope ? { envelope: args.request.envelope } : {}),
        maxOutputTokens: args.request.maxOutputTokens,
        responseSchema: args.request.responseSchema ?? {
          name: FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_NAME,
          description: FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_DESCRIPTION,
          schema: FOUNDATIONAL_PROFILE_JSON_SCHEMA,
          strict: true,
        },
      },
    });

    if (args.request.onValidatedResponse) {
      const validated = args.request.validateOutput
        ? args.request.validateOutput(result.output)
        : validateFoundationalProfileOutput(result.output);
      await args.request.onValidatedResponse(validated);
    }

    await recordGenerationBudgetUsageAfterSuccess({
      config,
      provider: target.provider,
      model: target.model,
      usageTotalTokens: result.usage?.totalTokens,
      now: now(),
      repository: budgetRepository,
    });

    const quotaUsage = await budgetRepository.getUsage({
      provider: target.provider,
      model: target.model,
      now: now(),
    });

    execution = { target, result, quotaUsage };
  } catch (error) {
    throw mapProviderError({ provider: target.provider, model: target.model, error });
  }

  return {
    structuredProfile: args.request.validateOutput
      ? args.request.validateOutput(execution.result.output)
      : validateFoundationalProfileOutput(execution.result.output),
    rawOutput: execution.result.output,
    rawText: execution.result.rawText,
    provider: execution.target.provider,
    model: execution.target.model,
    ...(execution.result.usage ? { usage: execution.result.usage } : {}),
    ...(execution.result.finishReason ? { finishReason: execution.result.finishReason } : {}),
    ...(execution.result.providerRequestId
      ? { providerRequestId: execution.result.providerRequestId }
      : {}),
  };
}

export function isCompleteTextGenerationFinishReason(finishReason?: string | null): boolean {
  if (typeof finishReason !== 'string') {
    return true;
  }

  const normalized = finishReason.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    normalized === 'stop' ||
    normalized === 'completed' ||
    normalized === 'complete' ||
    normalized === 'end_turn'
  );
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
}): ProfileRevisionDraftingError {
  if (args.error instanceof ProfileRevisionDraftingError) {
    return args.error;
  }

  if (args.error instanceof GenerationBudgetExceededError) {
    return new ProfileRevisionDraftingError({
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

  return new ProfileRevisionDraftingError({
    category,
    provider: args.provider,
    model: args.model,
    message: details.message,
    providerStatus: details.status,
    retryAfterMs:
      args.error instanceof ProviderExecutionError ? args.error.retryAfterMs : undefined,
    rejectedBeforeExecution:
      args.error instanceof ProviderExecutionError &&
      typeof details.status === 'number' &&
      [400, 401, 403, 404, 422, 429].includes(details.status),
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
    const code = typeof maybeStatus.code === 'string' ? maybeStatus.code : undefined;
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
