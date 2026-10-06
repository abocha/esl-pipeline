import { isDeepStrictEqual } from 'node:util';

import type {
  GenerateDraftRequest,
  GenerateDraftResponse,
  GenerationErrorCategory,
  GenerationProvider,
} from '@esl-pipeline/contracts';
import {
  ASSIGNMENT_RESPONSE_SCHEMA,
  ASSIGNMENT_TEMPLATE_CONTRACT,
  ASSIGNMENT_TEMPLATE_ID,
  validateFreshAssignmentV1,
} from '@esl-pipeline/contracts';
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
  executeOpenAiStructuredGenerationRaw,
  ProviderExecutionError,
  type ProviderStructuredExecutionRequest,
  type ProviderStructuredRawExecutionResult,
} from './generation-providers.js';
import { isGenerationRequestEnvelope } from './generation-request-envelope.js';
import { getPromptPackage } from './get-prompt-package.js';

type ProviderExecutor = (args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}) => Promise<ProviderStructuredRawExecutionResult>;

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
  readonly usage?: GenerateDraftResponse['usage'];
  readonly providerRequestId?: string;
  readonly finishReason?: string;

  constructor(args: {
    category: GenerationErrorCategory;
    provider: GenerationProvider;
    model: string;
    message: string;
    limitType?: string;
    limit?: number;
    used?: number;
    window?: string;
    usage?: GenerateDraftResponse['usage'];
    providerRequestId?: string;
    finishReason?: string;
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
    this.usage = args.usage;
    this.providerRequestId = args.providerRequestId;
    this.finishReason = args.finishReason;
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
    openai: executeOpenAiStructuredGenerationRaw,
    ...overrides?.executors,
  };
  const budgetRepository = resolveGenerationBudgetRepository({
    config,
    overrides: overrides?.budget,
  });
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

  const envelope = promptPackage.requestEnvelope;
  if (
    !isGenerationRequestEnvelope(envelope) ||
    envelope.workload !== 'assignment_draft' ||
    envelope.promptVersion !== 'assignment_v1' ||
    !envelope.assignmentContext ||
    promptPackage.templateSnapshot?.resolvedTemplateId !== ASSIGNMENT_TEMPLATE_ID ||
    envelope.instructions.split(/\r?\n/, 1)[0] !== ASSIGNMENT_TEMPLATE_CONTRACT ||
    !isDeepStrictEqual(envelope.responseSchema, ASSIGNMENT_RESPONSE_SCHEMA)
  ) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_OUTPUT_CONTRACT_UNSUPPORTED',
      'This prompt package does not pin the supported AssignmentV1 generation contract. Activate a compatible homework template revision and recreate the prompt package before generation.',
    );
  }

  let target = {
    provider: request.provider ?? config.generation.targets.draft_generation.provider,
    model: request.model ?? 'unspecified',
  };
  let execution: {
    target: ReturnType<typeof resolveGenerationTarget>;
    result: ProviderStructuredRawExecutionResult;
    quotaUsage: GenerationBudgetUsage;
  };
  try {
    target = resolveGenerationTarget({
      config: config.generation,
      workload: 'draft_generation',
      providerOverride: request.provider,
      modelOverride: request.model,
    });
    if (target.provider !== 'openai' || target.model !== 'gpt-6.1-sol') {
      throw new GenerateDraftProviderError({
        category: 'provider_contract_error',
        ...target,
        message:
          'AssignmentV1 requires the verified OpenAI gpt-6.1-sol target. Select that target before generation.',
      });
    }
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
        envelope,
        responseSchema: ASSIGNMENT_RESPONSE_SCHEMA,
        admission: 'assignment_v1',
        maxOutputTokens: request.maxOutputTokens,
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

  let text: string;
  let assignment;
  try {
    if (execution.result.contractError) throw new Error(execution.result.contractError);
    let output: unknown;
    try {
      output = JSON.parse(execution.result.rawText);
    } catch {
      throw new Error('AssignmentV1 response must contain direct JSON without wrappers or fences');
    }
    assignment = validateFreshAssignmentV1(output, envelope.assignmentContext);
    text = JSON.stringify(assignment, null, 2);
  } catch (error) {
    throw new GenerateDraftProviderError({
      category: 'provider_contract_error',
      ...execution.target,
      message: error instanceof Error ? error.message : 'AssignmentV1 output was invalid',
      usage: execution.result.usage,
      providerRequestId: execution.result.providerRequestId,
      finishReason: execution.result.finishReason,
    });
  }

  return {
    text,
    format: 'assignment_v1',
    assignment,
    validationContext: envelope.assignmentContext,
    provider: execution.target.provider,
    model: execution.target.model,
    quota: buildQuotaSnapshot({
      config: config.generation,
      provider: execution.target.provider,
      model: execution.target.model,
      usage: execution.quotaUsage,
      now: now(),
    }),
    ...(execution.result.usage ? { usage: execution.result.usage } : {}),
    ...(execution.result.providerRequestId
      ? { providerRequestId: execution.result.providerRequestId }
      : {}),
  };
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
