import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  type GenerationBudgetLimits,
  type GenerationBudgetLimitType,
  type GenerationBudgetReservationResult,
  type GenerationBudgetUsage,
  getGenerationBudgetUsage,
  type ReserveGenerationBudgetInput,
  recordGenerationActualUsage,
  reserveGenerationBudget,
} from '../domain/generation-budget-repository.js';

const ESTIMATED_CHARS_PER_TOKEN = 4;

interface InMemoryCounters {
  requests: number;
  reservedTokens: number;
  actualTokens: number;
}

const inMemoryBudgetCounters = new Map<string, InMemoryCounters>();

export interface GenerationBudgetRepository {
  reserve: (input: ReserveGenerationBudgetInput) => Promise<GenerationBudgetReservationResult>;
  recordActual: (input: {
    provider: GenerationProvider;
    model: string;
    now: Date;
    actualTokens: number;
  }) => Promise<void>;
  getUsage: (input: {
    provider: GenerationProvider;
    model: string;
    now: Date;
  }) => Promise<GenerationBudgetUsage>;
}

export interface GenerationBudgetGuardDependencies {
  repository?: GenerationBudgetRepository;
}

export class GenerationBudgetExceededError extends Error {
  readonly category = 'budget_exceeded' as const;
  readonly provider: GenerationProvider;
  readonly model: string;
  readonly limitType: GenerationBudgetLimitType;
  readonly limit: number;
  readonly used: number;
  readonly window: 'minute' | 'day' | 'request';

  constructor(args: {
    provider: GenerationProvider;
    model: string;
    limitType: GenerationBudgetLimitType;
    limit: number;
    used: number;
    window: 'minute' | 'day' | 'request';
    message: string;
  }) {
    super(args.message);
    this.name = 'GenerationBudgetExceededError';
    this.provider = args.provider;
    this.model = args.model;
    this.limitType = args.limitType;
    this.limit = args.limit;
    this.used = args.used;
    this.window = args.window;
  }
}

function startOfUtcMinute(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      0,
      0,
    ),
  );
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function counterKey(args: {
  provider: GenerationProvider;
  model: string;
  bucket: 'minute' | 'day';
  bucketStart: Date;
}): string {
  return `${args.bucket}:${args.bucketStart.toISOString()}:${args.provider}:${args.model}`;
}

function getCounter(map: Map<string, InMemoryCounters>, key: string): InMemoryCounters {
  const current = map.get(key);
  if (current) return current;
  const created: InMemoryCounters = {
    requests: 0,
    reservedTokens: 0,
    actualTokens: 0,
  };
  map.set(key, created);
  return created;
}

const inMemoryGenerationBudgetRepository: GenerationBudgetRepository = {
  async reserve(input) {
    const minuteStart = startOfUtcMinute(input.now);
    const dayStart = startOfUtcDay(input.now);

    const minuteKey = counterKey({
      provider: input.provider,
      model: input.model,
      bucket: 'minute',
      bucketStart: minuteStart,
    });
    const dayKey = counterKey({
      provider: input.provider,
      model: input.model,
      bucket: 'day',
      bucketStart: dayStart,
    });

    const minute = getCounter(inMemoryBudgetCounters, minuteKey);
    const day = getCounter(inMemoryBudgetCounters, dayKey);

    const nextMinuteRequests = minute.requests + 1;
    const nextDayRequests = day.requests + 1;
    const nextReservedTokens = day.reservedTokens + input.estimatedTokens;

    if (
      input.limits.rpmBudget !== undefined &&
      input.limits.rpmBudget !== null &&
      input.limits.rpmBudget >= 0 &&
      nextMinuteRequests > input.limits.rpmBudget
    ) {
      return {
        allowed: false,
        reason: {
          limitType: 'rpm',
          window: 'minute',
          limit: input.limits.rpmBudget,
          used: minute.requests,
        },
        usage: {
          requestsPerMinuteUsed: minute.requests,
          requestsToday: day.requests,
          reservedTokensToday: day.reservedTokens,
          actualTokensToday: day.actualTokens,
        },
      };
    }

    if (
      input.limits.dailyRequestBudget !== undefined &&
      input.limits.dailyRequestBudget !== null &&
      input.limits.dailyRequestBudget >= 0 &&
      nextDayRequests > input.limits.dailyRequestBudget
    ) {
      return {
        allowed: false,
        reason: {
          limitType: 'daily_requests',
          window: 'day',
          limit: input.limits.dailyRequestBudget,
          used: day.requests,
        },
        usage: {
          requestsPerMinuteUsed: minute.requests,
          requestsToday: day.requests,
          reservedTokensToday: day.reservedTokens,
          actualTokensToday: day.actualTokens,
        },
      };
    }

    if (
      input.limits.dailyTokenBudget !== undefined &&
      input.limits.dailyTokenBudget !== null &&
      input.limits.dailyTokenBudget >= 0 &&
      nextReservedTokens > input.limits.dailyTokenBudget
    ) {
      return {
        allowed: false,
        reason: {
          limitType: 'daily_tokens',
          window: 'day',
          limit: input.limits.dailyTokenBudget,
          used: day.reservedTokens,
        },
        usage: {
          requestsPerMinuteUsed: minute.requests,
          requestsToday: day.requests,
          reservedTokensToday: day.reservedTokens,
          actualTokensToday: day.actualTokens,
        },
      };
    }

    minute.requests = nextMinuteRequests;
    day.requests = nextDayRequests;
    day.reservedTokens = nextReservedTokens;

    return {
      allowed: true,
      usage: {
        requestsPerMinuteUsed: minute.requests,
        requestsToday: day.requests,
        reservedTokensToday: day.reservedTokens,
        actualTokensToday: day.actualTokens,
      },
    };
  },
  async recordActual(input) {
    const dayStart = startOfUtcDay(input.now);
    const dayKey = counterKey({
      provider: input.provider,
      model: input.model,
      bucket: 'day',
      bucketStart: dayStart,
    });
    const day = getCounter(inMemoryBudgetCounters, dayKey);
    day.actualTokens += Math.max(0, Math.floor(input.actualTokens));
  },
  async getUsage(input) {
    const minuteStart = startOfUtcMinute(input.now);
    const dayStart = startOfUtcDay(input.now);
    const minute = getCounter(
      inMemoryBudgetCounters,
      counterKey({
        provider: input.provider,
        model: input.model,
        bucket: 'minute',
        bucketStart: minuteStart,
      }),
    );
    const day = getCounter(
      inMemoryBudgetCounters,
      counterKey({
        provider: input.provider,
        model: input.model,
        bucket: 'day',
        bucketStart: dayStart,
      }),
    );
    return {
      requestsPerMinuteUsed: minute.requests,
      requestsToday: day.requests,
      reservedTokensToday: day.reservedTokens,
      actualTokensToday: day.actualTokens,
    };
  },
};

function resolveProviderLimits(
  config: BatchBackendConfig['generation'],
  provider: GenerationProvider,
) {
  if (provider === 'openai') {
    return {
      rpmBudget: config.providers.openai.rpmBudget,
      dailyRequestBudget: config.providers.openai.dailyRequestBudget,
      dailyTokenBudget: config.providers.openai.dailyTokenBudget,
    };
  }
  if (provider === 'google_ai_studio') {
    return {
      rpmBudget: config.providers.googleAiStudio.rpmBudget,
      dailyRequestBudget: config.providers.googleAiStudio.dailyRequestBudget,
      dailyTokenBudget: undefined,
    };
  }
  return {
    rpmBudget: config.providers.openrouter.rpmBudget,
    dailyRequestBudget: config.providers.openrouter.dailyRequestBudget,
    dailyTokenBudget: config.providers.openrouter.dailyTokenBudget,
  };
}

function resolveAllowedModels(
  config: BatchBackendConfig['generation'],
  provider: GenerationProvider,
): Set<string> {
  if (provider === 'openai') {
    return new Set(config.models.openai.allowed.map((model) => model.trim()).filter(Boolean));
  }
  if (provider === 'google_ai_studio') {
    return new Set(
      config.models.googleAiStudio.allowed.map((model) => model.trim()).filter(Boolean),
    );
  }
  return new Set(config.models.openrouter.allowed.map((model) => model.trim()).filter(Boolean));
}

function estimateTokens(args: {
  prompt: string;
  requestedMaxOutputTokens?: number;
  hardCap: number;
}): number {
  const estimatedInputTokens = Math.ceil(
    Math.max(1, args.prompt.length) / ESTIMATED_CHARS_PER_TOKEN,
  );
  const outputBudget =
    typeof args.requestedMaxOutputTokens === 'number' && args.requestedMaxOutputTokens > 0
      ? Math.floor(args.requestedMaxOutputTokens)
      : Math.floor(args.hardCap);
  return Math.max(1, estimatedInputTokens + outputBudget);
}

export function resolveGenerationBudgetRepository(args: {
  config: BatchBackendConfig;
  overrides?: GenerationBudgetGuardDependencies;
}): GenerationBudgetRepository {
  if (args.overrides?.repository) {
    return args.overrides.repository;
  }

  if (!args.config.pg.enabled || args.config.nodeEnv === 'test') {
    return inMemoryGenerationBudgetRepository;
  }

  return {
    reserve: reserveGenerationBudget,
    recordActual: recordGenerationActualUsage,
    getUsage: getGenerationBudgetUsage,
  };
}

export async function enforceGenerationBudgetBeforeAttempt(args: {
  config: BatchBackendConfig;
  provider: GenerationProvider;
  model: string;
  prompt: string;
  maxOutputTokens?: number;
  now: Date;
  repository: GenerationBudgetRepository;
  limits?: GenerationBudgetLimits;
}): Promise<GenerationBudgetUsage> {
  const generationConfig = args.config.generation;

  if (generationConfig.budgetEmergencyOverride) {
    return args.repository.getUsage({
      provider: args.provider,
      model: args.model,
      now: args.now,
    });
  }

  if (
    typeof args.maxOutputTokens === 'number' &&
    args.maxOutputTokens > generationConfig.maxOutputTokensHard
  ) {
    throw new GenerationBudgetExceededError({
      provider: args.provider,
      model: args.model,
      limitType: 'max_output_tokens',
      limit: generationConfig.maxOutputTokensHard,
      used: args.maxOutputTokens,
      window: 'request',
      message: `maxOutputTokens (${args.maxOutputTokens}) exceeds hard cap (${generationConfig.maxOutputTokensHard}) for safe testing.`,
    });
  }

  if (generationConfig.strictNoPaid) {
    const allowedModels = resolveAllowedModels(generationConfig, args.provider);
    if (!allowedModels.has(args.model)) {
      throw new GenerationBudgetExceededError({
        provider: args.provider,
        model: args.model,
        limitType: 'model_not_allowed',
        limit: 0,
        used: 1,
        window: 'request',
        message:
          'Selected model is not allowed under strict no-paid safety mode. Choose an allowlisted model.',
      });
    }
  }

  if (generationConfig.safetyMode !== 'hard_stop') {
    return args.repository.getUsage({
      provider: args.provider,
      model: args.model,
      now: args.now,
    });
  }

  const limits = args.limits ?? resolveProviderLimits(generationConfig, args.provider);
  const reservation = await args.repository.reserve({
    provider: args.provider,
    model: args.model,
    now: args.now,
    estimatedTokens: estimateTokens({
      prompt: args.prompt,
      requestedMaxOutputTokens: args.maxOutputTokens,
      hardCap: generationConfig.maxOutputTokensHard,
    }),
    limits,
  });

  if (!reservation.allowed) {
    throw new GenerationBudgetExceededError({
      provider: args.provider,
      model: args.model,
      limitType: reservation.reason.limitType,
      limit: reservation.reason.limit,
      used: reservation.reason.used,
      window: reservation.reason.window,
      message: `Generation blocked by ${reservation.reason.limitType} safety limit (${reservation.reason.used}/${reservation.reason.limit}).`,
    });
  }

  return reservation.usage;
}

export async function recordGenerationBudgetUsageAfterSuccess(args: {
  config: BatchBackendConfig;
  provider: GenerationProvider;
  model: string;
  usageTotalTokens?: number;
  now: Date;
  repository: GenerationBudgetRepository;
}): Promise<void> {
  if (args.config.generation.budgetEmergencyOverride) {
    return;
  }
  if (args.config.generation.safetyMode !== 'hard_stop') {
    return;
  }

  await args.repository.recordActual({
    provider: args.provider,
    model: args.model,
    now: args.now,
    actualTokens: Math.max(0, Math.floor(args.usageTotalTokens ?? 0)),
  });
}
