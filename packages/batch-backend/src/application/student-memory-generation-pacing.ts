import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { metrics as defaultMetrics, type Metrics } from '../infrastructure/metrics.js';
import type { GenerationBudgetRepository } from './generation-budget-guard.js';
import {
  enforceGenerationBudgetBeforeAttempt,
  estimateGenerationTokens,
  GenerationBudgetExceededError,
  recordGenerationBudgetUsageAfterSuccess,
  resolveGenerationBudgetRepository,
} from './generation-budget-guard.js';
import { ProviderExecutionError } from './generation-providers.js';

export type StudentMemoryGenerationWorkload =
  | 'lesson_memory'
  | 'homework_memory'
  | 'student_memory_snapshot'
  | 'profile_initial_enrichment';

export type StudentMemoryPacingReason =
  | 'budget_rpm_minute'
  | 'budget_tpm_minute'
  | 'provider_rate_limit';

export class StudentMemoryPacingDeferredError extends Error {
  readonly reason: StudentMemoryPacingReason;
  readonly provider: GenerationProvider;
  readonly model: string;
  readonly notBefore: Date;
  readonly estimatedTokens: number;
  readonly retryAfterMs?: number;

  constructor(args: {
    reason: StudentMemoryPacingReason;
    provider: GenerationProvider;
    model: string;
    notBefore: Date;
    estimatedTokens: number;
    retryAfterMs?: number;
  }) {
    super(
      `Student-memory generation deferred until ${args.notBefore.toISOString()} (${args.reason}).`,
    );
    this.name = 'StudentMemoryPacingDeferredError';
    this.reason = args.reason;
    this.provider = args.provider;
    this.model = args.model;
    this.notBefore = args.notBefore;
    this.estimatedTokens = args.estimatedTokens;
    this.retryAfterMs = args.retryAfterMs;
  }
}

export function isStudentMemoryPacingDeferredError(
  error: unknown,
): error is StudentMemoryPacingDeferredError {
  return error instanceof StudentMemoryPacingDeferredError;
}

export interface StudentMemoryGenerationPacer {
  run<T extends { usage?: { totalTokens?: number } }>(args: {
    workload: StudentMemoryGenerationWorkload;
    provider: GenerationProvider;
    model: string;
    prompt: string;
    maxOutputTokens?: number;
    recordUsage?: boolean;
    execute: () => Promise<T>;
  }): Promise<T>;
}

export interface StudentMemoryGenerationPacerDependencies {
  repository?: GenerationBudgetRepository;
  now?: () => Date;
  metrics?: Metrics;
}

function nextUtcMinute(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes() + 1,
      0,
      0,
    ),
  );
}

function deferredFromBudgetError(args: {
  error: unknown;
  provider: GenerationProvider;
  model: string;
  estimatedTokens: number;
  now: Date;
}): StudentMemoryPacingDeferredError | null {
  if (!(args.error instanceof GenerationBudgetExceededError) || args.error.window !== 'minute') {
    return null;
  }

  const reason =
    args.error.limitType === 'rpm'
      ? 'budget_rpm_minute'
      : args.error.limitType === 'tpm'
        ? 'budget_tpm_minute'
        : null;
  if (!reason) return null;

  return new StudentMemoryPacingDeferredError({
    reason,
    provider: args.provider,
    model: args.model,
    notBefore: nextUtcMinute(args.now),
    estimatedTokens: args.estimatedTokens,
  });
}

function deferredFromProviderError(args: {
  error: unknown;
  provider: GenerationProvider;
  model: string;
  estimatedTokens: number;
  now: Date;
}): StudentMemoryPacingDeferredError | null {
  if (!(args.error instanceof ProviderExecutionError) || args.error.status !== 429) {
    return null;
  }

  const retryAfterMs = args.error.retryAfterMs;
  const providerNotBefore = new Date(args.now.getTime() + (retryAfterMs ?? 0));
  const notBefore = new Date(
    Math.max(nextUtcMinute(args.now).getTime(), providerNotBefore.getTime()),
  );

  return new StudentMemoryPacingDeferredError({
    reason: 'provider_rate_limit',
    provider: args.provider,
    model: args.model,
    notBefore,
    estimatedTokens: args.estimatedTokens,
    ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
  });
}

function recordDeferralMetric(args: {
  metrics: Metrics;
  workload: StudentMemoryGenerationWorkload;
  error: StudentMemoryPacingDeferredError;
  now: Date;
}): void {
  const tags = {
    workload: args.workload,
    provider: args.error.provider,
    model: args.error.model,
    reason: args.error.reason,
  };
  args.metrics.increment('student_memory_generation_deferred_total', 1, tags);
  args.metrics.timing(
    'student_memory_generation_defer_duration_ms',
    Math.max(0, args.error.notBefore.getTime() - args.now.getTime()),
    tags,
  );
}

export function createStudentMemoryGenerationPacer(
  config: BatchBackendConfig,
  overrides: StudentMemoryGenerationPacerDependencies = {},
): StudentMemoryGenerationPacer {
  const repository = resolveGenerationBudgetRepository({
    config,
    overrides: { repository: overrides.repository },
  });
  const now = overrides.now ?? (() => new Date());
  const metrics = overrides.metrics ?? defaultMetrics;

  return {
    async run<T extends { usage?: { totalTokens?: number } }>(args: {
      workload: StudentMemoryGenerationWorkload;
      provider: GenerationProvider;
      model: string;
      prompt: string;
      maxOutputTokens?: number;
      recordUsage?: boolean;
      execute: () => Promise<T>;
    }): Promise<T> {
      const attemptedAt = now();
      const estimatedTokens = estimateGenerationTokens({
        prompt: args.prompt,
        requestedMaxOutputTokens: args.maxOutputTokens,
        hardCap: config.generation.maxOutputTokensHard,
      });
      const tags = {
        workload: args.workload,
        provider: args.provider,
        model: args.model,
      };
      metrics.increment('student_memory_generation_estimated_tokens', estimatedTokens, tags);

      try {
        await enforceGenerationBudgetBeforeAttempt({
          config,
          provider: args.provider,
          model: args.model,
          prompt: args.prompt,
          maxOutputTokens: args.maxOutputTokens,
          now: attemptedAt,
          repository,
        });
      } catch (error) {
        const deferred = deferredFromBudgetError({
          error,
          provider: args.provider,
          model: args.model,
          estimatedTokens,
          now: attemptedAt,
        });
        if (deferred) {
          recordDeferralMetric({
            metrics,
            workload: args.workload,
            error: deferred,
            now: attemptedAt,
          });
          throw deferred;
        }
        throw error;
      }

      let result: T;
      try {
        result = await args.execute();
      } catch (error) {
        const observedAt = now();
        const deferred = deferredFromProviderError({
          error,
          provider: args.provider,
          model: args.model,
          estimatedTokens,
          now: observedAt,
        });
        if (deferred) {
          recordDeferralMetric({
            metrics,
            workload: args.workload,
            error: deferred,
            now: observedAt,
          });
          throw deferred;
        }
        throw error;
      }

      const actualTokens = result.usage?.totalTokens;
      if (args.recordUsage !== false) {
        try {
          await recordGenerationBudgetUsageAfterSuccess({
            config,
            provider: args.provider,
            model: args.model,
            usageTotalTokens: actualTokens,
            now: now(),
            repository,
          });
        } catch {
          metrics.increment('student_memory_generation_actual_usage_record_failure_total', 1, tags);
        }
      }
      metrics.increment('student_memory_generation_completed_tokens', actualTokens ?? 0, tags);
      return result;
    },
  };
}
