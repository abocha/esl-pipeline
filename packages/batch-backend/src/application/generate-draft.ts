import type {
  GenerateDraftRequest,
  GenerateDraftResponse,
  GenerationErrorCategory,
  GenerationProvider,
} from '@esl-pipeline/contracts';
import { validateMarkdown } from '@esl-pipeline/md-validator';
import {
  classifyProviderRuntimeFailure,
  type ProviderRuntimeClassificationRules,
} from '@esl-pipeline/provider-runtime';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { GenerationBudgetUsage } from '../domain/generation-budget-repository.js';
import { isPromptPackageSourceCanonical } from '../domain/prompt-package-repository.js';
import { PromptPackageAssignmentError } from './create-prompt-package.js';
import {
  enforceGenerationBudgetBeforeAttempt,
  GenerationBudgetExceededError,
  type GenerationBudgetGuardDependencies,
  recordGenerationBudgetUsageAfterSuccess,
  resolveGenerationBudgetRepository,
} from './generation-budget-guard.js';
import { buildQuotaSnapshot, resolveGenerationTarget } from './generation-policy.js';
import {
  executeGoogleGeneration,
  executeOpenAiGeneration,
  executeOpenRouterGeneration,
  ProviderExecutionError,
  type ProviderExecutionRequest,
  type ProviderExecutionResult,
} from './generation-providers.js';
import {
  createGenerationRequestEnvelope,
  flattenGenerationRequestEnvelope,
  isGenerationRequestEnvelope,
} from './generation-request-envelope.js';
import { getPromptPackage } from './get-prompt-package.js';

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
    isSourceCanonical: typeof isPromptPackageSourceCanonical;
  };
  executors: Partial<Record<GenerationProvider, ProviderExecutor>>;
  budget: GenerationBudgetGuardDependencies;
  validator: typeof validateMarkdown;
  now: () => Date;
}

export async function generateDraft(
  request: GenerateDraftRequest,
  overrides?: Partial<GenerateDraftDependencies>,
): Promise<GenerateDraftResponse | null> {
  const config = overrides?.config ?? loadConfig();
  const promptPackages = overrides?.promptPackages ?? {
    getById: getPromptPackage,
    isSourceCanonical: isPromptPackageSourceCanonical,
  };
  const executors = {
    ...DEFAULT_EXECUTORS,
    ...overrides?.executors,
  };
  const budgetRepository = resolveGenerationBudgetRepository({
    config,
    overrides: overrides?.budget,
  });
  const validator = overrides?.validator ?? validateMarkdown;
  const now = overrides?.now ?? (() => new Date());

  const promptPackage = await promptPackages.getById(request.promptPackageId);
  if (!promptPackage) {
    return null;
  }
  if (!(await promptPackages.isSourceCanonical(request.promptPackageId))) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL',
      'Assignment source is no longer canonical',
    );
  }

  let target = {
    provider: request.provider ?? config.generation.targets.draft_generation.provider,
    model: request.model ?? 'unspecified',
  };
  let execution: {
    target: ReturnType<typeof resolveGenerationTarget>;
    result: ProviderExecutionResult;
    quotaUsage: GenerationBudgetUsage;
  };
  try {
    target = resolveGenerationTarget({
      config: config.generation,
      workload: 'draft_generation',
      providerOverride: request.provider,
      modelOverride: request.model,
    });
    await enforceGenerationBudgetBeforeAttempt({
      config,
      provider: target.provider,
      model: target.model,
      prompt: promptPackage.text,
      maxOutputTokens: request.maxOutputTokens,
      now: now(),
      repository: budgetRepository,
    });

    const executor = executors[target.provider];
    if (!executor) {
      throw new GenerateDraftProviderError({
        category: 'provider_contract_error',
        provider: target.provider,
        model: target.model,
        message: `No generation executor configured for provider: ${target.provider}`,
      });
    }

    const result = await executor({
      config: config.generation,
      request: {
        model: target.model,
        prompt: promptPackage.text,
        ...(isGenerationRequestEnvelope(promptPackage.requestEnvelope)
          ? { envelope: promptPackage.requestEnvelope }
          : {}),
        maxOutputTokens: request.maxOutputTokens,
        stream: false,
      },
    });

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

  const validated = await validateAssignmentDraftIfRequired({
    config,
    promptPackage,
    request,
    execution,
    executors,
    validator,
    budgetRepository,
    now,
  });

  return {
    text: validated.result.text,
    provider: execution.target.provider,
    model: execution.target.model,
    quota: buildQuotaSnapshot({
      config: config.generation,
      provider: execution.target.provider,
      model: execution.target.model,
      usage: validated.quotaUsage,
      now: now(),
    }),
    ...(validated.result.usage ? { usage: validated.result.usage } : {}),
    ...(validated.result.providerRequestId
      ? { providerRequestId: validated.result.providerRequestId }
      : {}),
  };
}

async function validateAssignmentDraftIfRequired(args: {
  config: BatchBackendConfig;
  promptPackage: Awaited<ReturnType<typeof getPromptPackage>> & {};
  request: GenerateDraftRequest;
  execution: {
    target: ReturnType<typeof resolveGenerationTarget>;
    result: ProviderExecutionResult;
    quotaUsage: GenerationBudgetUsage;
  };
  executors: Record<GenerationProvider, ProviderExecutor>;
  validator: typeof validateMarkdown;
  budgetRepository: ReturnType<typeof resolveGenerationBudgetRepository>;
  now: () => Date;
}): Promise<{ result: ProviderExecutionResult; quotaUsage: GenerationBudgetUsage }> {
  const envelope = args.promptPackage.requestEnvelope;
  if (!isGenerationRequestEnvelope(envelope) || envelope.workload !== 'assignment_draft') {
    return { result: args.execution.result, quotaUsage: args.execution.quotaUsage };
  }

  const validation = await args.validator({ markdown: args.execution.result.text, strict: true });
  if (validation.ok) {
    return { result: args.execution.result, quotaUsage: args.execution.quotaUsage };
  }

  const executor = args.executors[args.execution.target.provider];
  if (!executor) {
    throw new GenerateDraftProviderError({
      category: 'provider_contract_error',
      provider: args.execution.target.provider,
      model: args.execution.target.model,
      message: `No generation executor configured for provider: ${args.execution.target.provider}`,
    });
  }

  const repairEnvelope = createGenerationRequestEnvelope({
    workload: 'assignment_draft',
    promptVersion: `${envelope.promptVersion}:validator-repair-v1`,
    instructions: [
      'Repair the assignment markdown so it passes the supplied deterministic validator.',
      'Return only the complete repaired assignment markdown.',
      'Use only the failed draft and the validator diagnostics supplied as source data.',
      'Do not add facts, requirements, or instructions that are not present in the failed draft.',
    ].join('\n'),
    sources: [
      { id: 'failed-draft', label: 'FAILED_ASSIGNMENT_DRAFT', content: args.execution.result.text },
      {
        id: 'validator-diagnostics',
        label: 'VALIDATOR_DIAGNOSTICS',
        content: validation.errors.join('\n'),
      },
    ],
  });

  await enforceGenerationBudgetBeforeAttempt({
    config: args.config,
    provider: args.execution.target.provider,
    model: args.execution.target.model,
    prompt: flattenGenerationRequestEnvelope(repairEnvelope),
    maxOutputTokens: args.request.maxOutputTokens,
    now: args.now(),
    repository: args.budgetRepository,
  });

  let repaired: ProviderExecutionResult;
  try {
    repaired = await executor({
      config: args.config.generation,
      request: {
        model: args.execution.target.model,
        prompt: flattenGenerationRequestEnvelope(repairEnvelope),
        envelope: repairEnvelope,
        maxOutputTokens: args.request.maxOutputTokens,
        stream: false,
      },
    });
  } catch (error) {
    throw mapProviderError({
      provider: args.execution.target.provider,
      model: args.execution.target.model,
      error,
    });
  }

  await recordGenerationBudgetUsageAfterSuccess({
    config: args.config,
    provider: args.execution.target.provider,
    model: args.execution.target.model,
    usageTotalTokens: repaired.usage?.totalTokens,
    now: args.now(),
    repository: args.budgetRepository,
  });

  const repairValidation = await args.validator({ markdown: repaired.text, strict: true });
  if (!repairValidation.ok) {
    throw new GenerateDraftProviderError({
      category: 'provider_contract_error',
      provider: args.execution.target.provider,
      model: args.execution.target.model,
      message: `Assignment markdown failed validation after one repair: ${repairValidation.errors.join('; ')}`,
    });
  }

  const quotaUsage = await args.budgetRepository.getUsage({
    provider: args.execution.target.provider,
    model: args.execution.target.model,
    now: args.now(),
  });
  return { result: repaired, quotaUsage };
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
