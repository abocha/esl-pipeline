import { describe, expect, it, vi } from 'vitest';

import { getReadinessMetricsWithDefaults } from '../src/application/readiness-metrics.js';

describe('application/readiness-metrics', () => {
  it('maps repository snapshot into readiness response shape', async () => {
    const readiness = vi.fn().mockResolvedValue({
      publishSucceeded: 9,
      publishFailed: 3,
      publishTotal: 12,
      latencySampleSize: 8,
      medianPublishLatencyMs: 15432.5,
      firstSessionTotalUsers: 5,
      firstSessionSucceededUsers: 4,
    });

    const from = new Date('2024-03-01T00:00:00.000Z');
    const to = new Date('2024-03-08T00:00:00.000Z');
    const result = await getReadinessMetricsWithDefaults(
      { from, to, userId: '8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f' },
      {
        jobs: { readiness },
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
    expect(result.sources.publishSuccessRate.source).toContain('jobs table');
    expect(result.sources.medianPublishLatencyMs.calculation).toContain('median');
    expect(result.sources.firstSessionSuccessProxy.window).toContain('request window');

    const call = readiness.mock.calls[0]?.[0];
    expect(call?.userId).toBe('8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f');
    expect(call?.from?.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(call?.to?.toISOString()).toBe('2024-03-08T00:00:00.000Z');
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
    });

    const now = new Date('2024-06-15T12:00:00.000Z');
    const result = await getReadinessMetricsWithDefaults(
      {},
      {
        jobs: { readiness },
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
  });
});

