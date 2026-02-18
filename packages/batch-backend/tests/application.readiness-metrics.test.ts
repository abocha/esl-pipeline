import { afterEach, describe, expect, it, vi } from 'vitest';

import { getReadinessMetricsWithDefaults } from '../src/application/readiness-metrics.js';
import { logger } from '../src/infrastructure/logger.js';

describe('application/readiness-metrics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps snapshot shape and normalizes provider errors from failed-job messages', async () => {
    const readiness = vi.fn().mockResolvedValue({
      publishSucceeded: 9,
      publishFailed: 3,
      publishTotal: 12,
      latencySampleSize: 8,
      medianPublishLatencyMs: 15432.5,
      firstSessionTotalUsers: 5,
      firstSessionSucceededUsers: 4,
      voiceValidationFailures: 2,
      voiceStrictMismatches: 1,
      voiceProviderErrors: 2,
      voiceProviderErrorBreakdown: {
        provider_rate_limit: 1,
        provider_timeout: 1,
      },
      voiceFallbackSelections: null,
      voiceReuseSelections: null,
    });
    const listFailedErrorsForReadiness = vi.fn().mockResolvedValue([
      'Text-to-Dialogue synthesis failed [provider_rate_limit]: HTTP 429: too many requests',
      'Voice generation timed out while calling provider for this lesson',
      'frontmatter validation failed: missing title',
    ]);
    const warnSpy = vi.spyOn(logger, 'warn');

    const from = new Date('2024-03-01T00:00:00.000Z');
    const to = new Date('2024-03-08T00:00:00.000Z');
    const result = await getReadinessMetricsWithDefaults(
      { from, to, userId: '8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f' },
      {
        jobs: { readiness, listFailedErrorsForReadiness },
        now: () => new Date('2024-04-01T00:00:00.000Z'),
      },
    );

    expect(result.window).toEqual({
      from: '2024-03-01T00:00:00.000Z',
      to: '2024-03-08T00:00:00.000Z',
    });
    expect(result.publishSuccess).toEqual({
      succeeded: 9,
      failed: 3,
      total: 12,
      rate: 0.75,
    });
    expect(result.publishLatencyMs).toEqual({
      median: 15432.5,
      sampleSize: 8,
    });
    expect(result.firstSessionSuccessProxy).toEqual({
      successfulUsers: 4,
      totalUsers: 5,
      rate: 0.8,
    });
    expect(result.voiceAlignment).toEqual({
      validationFailures: 2,
      strictMismatches: 1,
      providerErrors: 2,
      providerErrorBreakdown: {
        provider_rate_limit: 1,
        provider_timeout: 1,
      },
      fallbackSelections: null,
      reuseSelections: null,
    });
    expect(result.sources.publishSuccessRate.source).toContain('jobs table');
    expect(result.sources.medianPublishLatencyMs.calculation).toContain('median');
    expect(result.sources.firstSessionSuccessProxy.window).toContain('request window');
    expect(result.sources.voiceProviderErrorRate.calculation).toContain(
      'provider-classified failed-job errors',
    );
    expect(warnSpy).not.toHaveBeenCalled();

    const readinessCall = readiness.mock.calls[0]?.[0];
    expect(readinessCall?.userId).toBe('8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f');
    expect(readinessCall?.from?.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(readinessCall?.to?.toISOString()).toBe('2024-03-08T00:00:00.000Z');

    const errorsCall = listFailedErrorsForReadiness.mock.calls[0]?.[0];
    expect(errorsCall?.userId).toBe('8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f');
    expect(errorsCall?.from?.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(errorsCall?.to?.toISOString()).toBe('2024-03-08T00:00:00.000Z');
  });

  it('uses a default 7-day window and null rates when sample sizes are empty', async () => {
    const readiness = vi.fn().mockResolvedValue({
      publishSucceeded: 0,
      publishFailed: 0,
      publishTotal: 0,
      latencySampleSize: 0,
      medianPublishLatencyMs: null,
      firstSessionTotalUsers: 0,
      firstSessionSucceededUsers: 0,
      voiceValidationFailures: 0,
      voiceStrictMismatches: 0,
      voiceProviderErrors: 0,
      voiceProviderErrorBreakdown: {},
      voiceFallbackSelections: null,
      voiceReuseSelections: null,
    });
    const listFailedErrorsForReadiness = vi.fn().mockResolvedValue([]);

    const now = new Date('2024-06-15T12:00:00.000Z');
    const result = await getReadinessMetricsWithDefaults(
      {},
      {
        jobs: { readiness, listFailedErrorsForReadiness },
        now: () => now,
      },
    );

    expect(result.window).toEqual({
      from: '2024-06-08T12:00:00.000Z',
      to: '2024-06-15T12:00:00.000Z',
    });
    expect(result.publishSuccess.rate).toBeNull();
    expect(result.firstSessionSuccessProxy.rate).toBeNull();
    expect(result.publishLatencyMs.median).toBeNull();
    expect(result.voiceAlignment?.providerErrors).toBe(0);
  });

  it('logs drift warning when normalized provider counts differ from legacy SQL counts', async () => {
    const readiness = vi.fn().mockResolvedValue({
      publishSucceeded: 1,
      publishFailed: 2,
      publishTotal: 3,
      latencySampleSize: 1,
      medianPublishLatencyMs: 1200,
      firstSessionTotalUsers: 1,
      firstSessionSucceededUsers: 1,
      voiceValidationFailures: 0,
      voiceStrictMismatches: 0,
      voiceProviderErrors: 0,
      voiceProviderErrorBreakdown: {},
      voiceFallbackSelections: null,
      voiceReuseSelections: null,
    });
    const listFailedErrorsForReadiness = vi
      .fn()
      .mockResolvedValue(['Provider timed out while generating dialogue']);
    const warnSpy = vi.spyOn(logger, 'warn');

    await getReadinessMetricsWithDefaults(
      {
        from: new Date('2024-05-01T00:00:00.000Z'),
        to: new Date('2024-05-08T00:00:00.000Z'),
        userId: '8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f',
      },
      {
        jobs: { readiness, listFailedErrorsForReadiness },
      },
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Readiness provider-error totals differ between legacy SQL and parser normalization',
      expect.objectContaining({
        event: 'readiness_provider_error_drift',
        legacyProviderErrors: 0,
        normalizedProviderErrors: 1,
        hasTotalDrift: true,
        userId: '8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f',
      }),
    );
  });

  it('logs drift warning when totals match but category breakdown differs', async () => {
    const readiness = vi.fn().mockResolvedValue({
      publishSucceeded: 1,
      publishFailed: 2,
      publishTotal: 3,
      latencySampleSize: 1,
      medianPublishLatencyMs: 1200,
      firstSessionTotalUsers: 1,
      firstSessionSucceededUsers: 1,
      voiceValidationFailures: 0,
      voiceStrictMismatches: 0,
      voiceProviderErrors: 2,
      voiceProviderErrorBreakdown: {
        provider_rate_limit: 2,
      },
      voiceFallbackSelections: null,
      voiceReuseSelections: null,
    });
    const listFailedErrorsForReadiness = vi.fn().mockResolvedValue([
      'Text-to-Dialogue synthesis failed [provider_rate_limit]: HTTP 429',
      'Provider timed out while generating dialogue',
    ]);
    const warnSpy = vi.spyOn(logger, 'warn');

    await getReadinessMetricsWithDefaults(
      {
        from: new Date('2024-05-01T00:00:00.000Z'),
        to: new Date('2024-05-08T00:00:00.000Z'),
        userId: '8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f',
      },
      {
        jobs: { readiness, listFailedErrorsForReadiness },
      },
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Readiness provider-error totals differ between legacy SQL and parser normalization',
      expect.objectContaining({
        event: 'readiness_provider_error_drift',
        legacyProviderErrors: 2,
        normalizedProviderErrors: 2,
        hasTotalDrift: false,
        hasBreakdownDrift: true,
        userId: '8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f',
      }),
    );
  });
});
