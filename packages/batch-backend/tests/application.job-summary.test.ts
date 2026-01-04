import { describe, expect, it, vi } from 'vitest';

import { getJobSummaryWithDefaults } from '../src/application/job-summary.js';

describe('application/job-summary', () => {
  it('maps repository counts into response shape', async () => {
    const summary = vi.fn().mockResolvedValue({
      total: 10,
      queued: 1,
      running: 2,
      awaitingApproval: 3,
      succeeded: 3,
      failed: 1,
      ttsEnabled: 4,
      ttsSucceeded: 2,
    });

    const from = new Date('2024-01-01T00:00:00.000Z');
    const to = new Date('2024-01-07T00:00:00.000Z');
    const result = await getJobSummaryWithDefaults(
      { from, to, userId: 'user-1' },
      {
        jobs: { summary },
        now: () => new Date('2024-02-01T00:00:00.000Z'),
      },
    );

    expect(result).toEqual({
      total: 10,
      byState: {
        queued: 1,
        running: 2,
        awaiting_approval: 3,
        succeeded: 3,
        failed: 1,
      },
      pendingApprovals: 3,
      last7Days: {
        total: 10,
        succeeded: 3,
        failed: 1,
      },
      tts: {
        enabled: 4,
        succeeded: 2,
      },
    });

    const call = summary.mock.calls[0]?.[0];
    expect(call?.userId).toBe('user-1');
    expect(call?.from?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(call?.to?.toISOString()).toBe('2024-01-07T00:00:00.000Z');
  });
});
