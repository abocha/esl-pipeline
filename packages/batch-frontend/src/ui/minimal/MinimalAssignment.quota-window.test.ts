import { describe, expect, it } from 'vitest';

import { getGenerationQuotaWindowDecision } from './MinimalAssignment.quota-window';

describe('MinimalAssignment quota window helper', () => {
  it('returns no block when active quota does not apply to current provider/model selection', () => {
    const decision = getGenerationQuotaWindowDecision({
      quota: {
        lastUpdatedAt: '2026-02-18T00:00:30.000Z',
        rpmBudget: 5,
        rpmRemaining: 0,
      },
      quotaWindowTickMs: Date.parse('2026-02-18T00:00:40.000Z'),
      activeQuotaAppliesToCurrentSelection: false,
    });

    expect(decision.blockedReason).toBeNull();
    expect(decision.shouldTrackWindow).toBe(false);
  });

  it('treats zero-budget daily token quotas as hard-blocked', () => {
    const decision = getGenerationQuotaWindowDecision({
      quota: {
        lastUpdatedAt: '2026-02-18T00:00:30.000Z',
        dailyTokenBudget: 0,
        dailyTokenRemaining: 0,
      },
      quotaWindowTickMs: Date.parse('2026-02-18T00:00:40.000Z'),
      activeQuotaAppliesToCurrentSelection: true,
    });

    expect(decision.blockedReason).toBe('Daily token budget exhausted for selected model/provider.');
    expect(decision.shouldTrackWindow).toBe(false);
  });

  it('tracks daily request window blocks only within the same UTC day', () => {
    const sameDayDecision = getGenerationQuotaWindowDecision({
      quota: {
        lastUpdatedAt: '2026-02-18T00:00:30.000Z',
        dailyRequestBudget: 100,
        dailyRequestRemaining: 0,
      },
      quotaWindowTickMs: Date.parse('2026-02-18T22:00:00.000Z'),
      activeQuotaAppliesToCurrentSelection: true,
    });

    expect(sameDayDecision.blockedReason).toBe(
      'Daily request budget exhausted for selected model/provider.',
    );
    expect(sameDayDecision.shouldTrackWindow).toBe(true);

    const nextDayDecision = getGenerationQuotaWindowDecision({
      quota: {
        lastUpdatedAt: '2026-02-18T00:00:30.000Z',
        dailyRequestBudget: 100,
        dailyRequestRemaining: 0,
      },
      quotaWindowTickMs: Date.parse('2026-02-19T00:00:00.000Z'),
      activeQuotaAppliesToCurrentSelection: true,
    });

    expect(nextDayDecision.blockedReason).toBeNull();
    expect(nextDayDecision.shouldTrackWindow).toBe(false);
  });

  it('tracks rpm window block only within the same UTC minute', () => {
    const blocked = getGenerationQuotaWindowDecision({
      quota: {
        lastUpdatedAt: '2026-02-18T00:00:30.000Z',
        rpmBudget: 5,
        rpmRemaining: 0,
      },
      quotaWindowTickMs: Date.parse('2026-02-18T00:00:40.000Z'),
      activeQuotaAppliesToCurrentSelection: true,
    });

    expect(blocked.blockedReason).toBe(
      'Per-minute request budget exhausted. Wait for minute window reset.',
    );
    expect(blocked.shouldTrackWindow).toBe(true);

    const unblocked = getGenerationQuotaWindowDecision({
      quota: {
        lastUpdatedAt: '2026-02-18T00:00:30.000Z',
        rpmBudget: 5,
        rpmRemaining: 0,
      },
      quotaWindowTickMs: Date.parse('2026-02-18T00:01:05.000Z'),
      activeQuotaAppliesToCurrentSelection: true,
    });

    expect(unblocked.blockedReason).toBeNull();
    expect(unblocked.shouldTrackWindow).toBe(false);
  });
});
