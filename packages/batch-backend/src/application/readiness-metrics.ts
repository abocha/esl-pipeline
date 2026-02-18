import type { ReadinessMetricsResponse } from '@esl-pipeline/contracts';

import {
  getReadinessMetrics,
  listFailedJobErrorsForReadiness,
} from '../domain/job-repository.js';
import { logger } from '../infrastructure/logger.js';
import { READINESS_METRIC_SOURCE_MAP } from '../infrastructure/metrics.js';
import {
  buildVoiceProviderErrorBreakdown,
  countVoiceProviderErrors,
  parseVoiceProviderErrors,
} from './voice-provider-error.js';

export interface ReadinessMetricsParams {
  from?: Date | null;
  to?: Date | null;
  userId?: string | null;
}

export interface ReadinessMetricsDependencies {
  jobs: {
    readiness: typeof getReadinessMetrics;
    listFailedErrorsForReadiness: typeof listFailedJobErrorsForReadiness;
  };
  now: () => Date;
}

const DEFAULT_RANGE_DAYS = 7;

export async function getReadinessMetricsWithDefaults(
  params: ReadinessMetricsParams = {},
  overrides?: Partial<ReadinessMetricsDependencies>,
): Promise<ReadinessMetricsResponse> {
  const jobs = {
    readiness: overrides?.jobs?.readiness ?? getReadinessMetrics,
    listFailedErrorsForReadiness:
      overrides?.jobs?.listFailedErrorsForReadiness ?? listFailedJobErrorsForReadiness,
  };
  const now = overrides?.now ?? (() => new Date());
  const resolved = resolveDateRange(params, now);

  const [snapshot, failedErrors] = await Promise.all([
    jobs.readiness({
      from: resolved.from,
      to: resolved.to,
      userId: params.userId ?? null,
    }),
    jobs.listFailedErrorsForReadiness({
      from: resolved.from,
      to: resolved.to,
      userId: params.userId ?? null,
    }),
  ]);

  const providerErrorDetails = parseVoiceProviderErrors(failedErrors);
  const normalizedProviderErrors = countVoiceProviderErrors(providerErrorDetails);
  const normalizedProviderErrorBreakdown = buildVoiceProviderErrorBreakdown(providerErrorDetails);

  const legacyProviderErrors = snapshot.voiceProviderErrors ?? 0;
  if (legacyProviderErrors !== normalizedProviderErrors) {
    logger.warn('Readiness provider-error totals differ between legacy SQL and parser normalization', {
      event: 'readiness_provider_error_drift',
      legacyProviderErrors,
      normalizedProviderErrors,
      from: resolved.from.toISOString(),
      to: resolved.to.toISOString(),
      userId: params.userId ?? null,
    });
  }

  return {
    window: {
      from: resolved.from.toISOString(),
      to: resolved.to.toISOString(),
    },
    publishSuccess: {
      succeeded: snapshot.publishSucceeded,
      failed: snapshot.publishFailed,
      total: snapshot.publishTotal,
      rate: computeRate(snapshot.publishSucceeded, snapshot.publishTotal),
    },
    publishLatencyMs: {
      median: snapshot.medianPublishLatencyMs,
      sampleSize: snapshot.latencySampleSize,
    },
    firstSessionSuccessProxy: {
      successfulUsers: snapshot.firstSessionSucceededUsers,
      totalUsers: snapshot.firstSessionTotalUsers,
      rate: computeRate(snapshot.firstSessionSucceededUsers, snapshot.firstSessionTotalUsers),
    },
    voiceAlignment: {
      validationFailures: snapshot.voiceValidationFailures ?? 0,
      strictMismatches: snapshot.voiceStrictMismatches ?? 0,
      providerErrors: normalizedProviderErrors,
      providerErrorBreakdown: normalizedProviderErrorBreakdown,
      fallbackSelections: snapshot.voiceFallbackSelections ?? null,
      reuseSelections: snapshot.voiceReuseSelections ?? null,
    },
    sources: READINESS_METRIC_SOURCE_MAP,
  };
}

function resolveDateRange(
  params: ReadinessMetricsParams,
  nowFactory: () => Date,
): { from: Date; to: Date } {
  const now = nowFactory();
  const to = params.to ?? now;
  const from = params.from ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}

function computeRate(successes: number, total: number): number | null {
  if (total <= 0) return null;
  return Number((successes / total).toFixed(4));
}
