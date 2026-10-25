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
import { getOpenAiModelGroup, OPENAI_MODEL_GROUPS } from '../domain/openai-model-groups.js';
import { assertSupportedGenerationTarget } from './generation-policy.js';

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

function readInMemoryGroupUsage(input: { provider: GenerationProvider; model: string; now: Date }) {
  const group = getOpenAiModelGroup(input.model);
  let reserved = 0,
    actual = 0;
  for (const model of OPENAI_MODEL_GROUPS[group]) {
    const counter = inMemoryBudgetCounters.get(
      counterKey({
        provider: input.provider,
        model,
        bucket: 'day',
        bucketStart: startOfUtcDay(input.now),
      }),
    );
    reserved += counter?.reservedTokens ?? 0;
    actual += counter?.actualTokens ?? 0;
  }
  return {
    dailyTokenGroup: group,
    groupReservedTokensToday: reserved,
    groupActualTokensToday: actual,
  };
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

    const groupUsage = readInMemoryGroupUsage(input);
    const nextMinuteRequests = minute.requests + 1;
    const nextMinuteReservedTokens = minute.reservedTokens + input.estimatedTokens;
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
          ...readInMemoryGroupUsage(input),
        },
      };
    }

    if (
      input.limits.tpmBudget !== undefined &&
      input.limits.tpmBudget !== null &&
      input.limits.tpmBudget >= 0 &&
      nextMinuteReservedTokens > input.limits.tpmBudget
    ) {
      return {
        allowed: false,
        reason: {
          limitType: 'tpm',
          window: 'minute',
          limit: input.limits.tpmBudget,
          used: minute.reservedTokens,
        },
        usage: {
          requestsPerMinuteUsed: minute.requests,
          requestsToday: day.requests,
          reservedTokensToday: day.reservedTokens,
          actualTokensToday: day.actualTokens,
          ...readInMemoryGroupUsage(input),
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
          ...readInMemoryGroupUsage(input),
        },
      };
    }

    if (
      input.limits.dailyTokenBudget !== undefined &&
      input.limits.dailyTokenBudget !== null &&
      input.limits.dailyTokenBudget >= 0 &&
      groupUsage.groupReservedTokensToday + input.estimatedTokens > input.limits.dailyTokenBudget
    ) {
      return {
        allowed: false,
        reason: {
          limitType: 'daily_tokens',
          window: 'day',
          limit: input.limits.dailyTokenBudget,
          used: groupUsage.groupReservedTokensToday,
        },
        usage: {
          requestsPerMinuteUsed: minute.requests,
          requestsToday: day.requests,
          reservedTokensToday: day.reservedTokens,
          actualTokensToday: day.actualTokens,
          ...readInMemoryGroupUsage(input),
        },
      };
    }

    minute.requests = nextMinuteRequests;
    minute.reservedTokens = nextMinuteReservedTokens;
    day.requests = nextDayRequests;
    day.reservedTokens = nextReservedTokens;

    return {
      allowed: true,
      usage: {
        requestsPerMinuteUsed: minute.requests,
        requestsToday: day.requests,
        reservedTokensToday: day.reservedTokens,
        actualTokensToday: day.actualTokens,
        ...readInMemoryGroupUsage(input),
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
      ...readInMemoryGroupUsage(input),
    };
  },
};

function resolveProviderLimits(
  config: BatchBackendConfig['generation'],
  provider: GenerationProvider,
) {
  assertSupportedGenerationTarget({ provider, model: '' });
  return {
    rpmBudget: config.providers.openai.rpmBudget,
    tpmBudget: config.providers.openai.tpmBudget,
    dailyRequestBudget: config.providers.openai.dailyRequestBudget,
  };
}

function resolveAllowedModels(
  config: BatchBackendConfig['generation'],
  provider: GenerationProvider,
): Set<string> {
  if (provider !== 'openai') return new Set();
  return new Set(config.models.openai.allowed.map((model) => model.trim()).filter(Boolean));
}

export function getConfiguredGenerationAllowedModels(
  config: BatchBackendConfig['generation'],
  provider: GenerationProvider,
): readonly string[] {
  return [...resolveAllowedModels(config, provider)];
}

export function getConfiguredGenerationProviderLimits(
  config: BatchBackendConfig['generation'],
  provider: GenerationProvider,
): Readonly<GenerationBudgetLimits> {
  return resolveProviderLimits(config, provider);
}

export function getConfiguredSpeechPlannerLimits(
  config: BatchBackendConfig,
): Readonly<Pick<GenerationBudgetLimits, 'rpmBudget' | 'dailyRequestBudget'>> {
  return {
    rpmBudget: config.speechPlanner.rpmBudget,
    dailyRequestBudget: config.speechPlanner.dailyRequestBudget,
  };
}

export function estimateGenerationTokens(args: {
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
  assertSupportedGenerationTarget(args);
  const generationConfig = args.config.generation;

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

  let group;
  try {
    group = getOpenAiModelGroup(args.model);
  } catch {
    throw new GenerationBudgetExceededError({
      provider: args.provider,
      model: args.model,
      limitType: 'model_not_allowed',
      limit: 0,
      used: 0,
      window: 'request',
      message: 'OpenAI model has no reviewed daily-budget group. Select a classified model.',
    });
  }
  if (generationConfig.safetyMode !== 'hard_stop') {
    return args.repository.getUsage({
      provider: args.provider,
      model: args.model,
      now: args.now,
    });
  }

  const limits = {
    ...(args.limits ?? resolveProviderLimits(generationConfig, args.provider)),
    dailyTokenBudget: generationConfig.providers.openai.dailyTokenBudgets[group],
  };
  const reservation = await args.repository.reserve({
    provider: args.provider,
    model: args.model,
    now: args.now,
    estimatedTokens: estimateGenerationTokens({
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
      message:
        reservation.reason.limitType === 'model_not_allowed'
          ? 'Existing OpenAI daily reservations include unclassified models. Wait for 00:00 UTC or ask the operator to review model-group membership.'
          : `Generation blocked by ${reservation.reason.limitType} safety limit (${reservation.reason.used}/${reservation.reason.limit}).${reservation.reason.limitType === 'daily_tokens' ? ` The ${group} group counts reserved tokens across its models; actual usage is tracked separately. Wait for 00:00 UTC or ask the operator to review the daily budget.` : ''}`,
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
