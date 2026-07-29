import { describe, expect, it, vi } from 'vitest';

import {
  buildSpeechPlannerEvalMatrix,
  loadSpeechPlannerEvalFixtures,
} from '../src/application/speech-planner-eval-fixtures.js';
import {
  createSpeechPlannerEvalBudgetRepository,
  preflightSpeechPlannerEval,
  SpeechPlannerEvalRateLimiter,
} from '../src/application/speech-planner-eval-preflight.js';

const allowedModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

describe('speech planner eval preflight', () => {
  it('fails closed on allowlist, explicit usage, daily capacity, and zero RPM', () => {
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: loadSpeechPlannerEvalFixtures(),
      repetitions: 3,
    });

    expect(
      preflightSpeechPlannerEval({
        variants,
        live: true,
        credentialsPresent: true,
        dailyLimit: 120,
        rpm: 4,
        allowedModels: ['gemini-3.1-flash-lite'],
      }),
    ).toMatchObject({ allowed: false, category: 'model_not_allowed' });
    expect(
      preflightSpeechPlannerEval({
        variants,
        live: true,
        credentialsPresent: true,
        dailyLimit: 120,
        rpm: 4,
        allowedModels,
      }),
    ).toMatchObject({ allowed: false, category: 'usage_unverified' });
    expect(
      preflightSpeechPlannerEval({
        variants,
        live: true,
        credentialsPresent: true,
        usedToday: 1,
        dailyLimit: 120,
        rpm: 4,
        allowedModels,
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        remediation: 'Increase remaining daily request capacity by at least 1 request.',
      }),
    );
    expect(
      preflightSpeechPlannerEval({
        variants,
        live: true,
        credentialsPresent: true,
        usedToday: 0,
        dailyLimit: 120,
        rpm: 0,
        allowedModels,
      }),
    ).toMatchObject({ allowed: false, category: 'rpm_unavailable' });
  });

  it.each([Number.NaN, -1, 1.5])('rejects invalid current-day usage %s', (usedToday) => {
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: loadSpeechPlannerEvalFixtures(),
      repetitions: 3,
    });
    expect(
      preflightSpeechPlannerEval({
        variants,
        live: true,
        credentialsPresent: true,
        usedToday,
        dailyLimit: 120,
        rpm: 4,
        allowedModels,
      }),
    ).toMatchObject({ allowed: false, category: 'invalid_usage' });
    expect(() => createSpeechPlannerEvalBudgetRepository({ usedToday })).toThrow(
      'nonnegative integer',
    );
  });

  it.each([
    { dailyLimit: Number.NaN, rpm: 4 },
    { dailyLimit: -1, rpm: 4 },
    { dailyLimit: 120.5, rpm: 4 },
    { dailyLimit: 120, rpm: Number.NaN },
    { dailyLimit: 120, rpm: 1.5 },
  ])('rejects invalid configured limits %#', ({ dailyLimit, rpm }) => {
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: loadSpeechPlannerEvalFixtures(),
      repetitions: 3,
    });
    expect(
      preflightSpeechPlannerEval({
        variants,
        live: true,
        credentialsPresent: true,
        usedToday: 0,
        dailyLimit,
        rpm,
        allowedModels,
      }),
    ).toMatchObject({ allowed: false, category: 'invalid_limits' });
  });

  it('requires both stable models even for a filtered or resumed live matrix', () => {
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: loadSpeechPlannerEvalFixtures().slice(0, 1),
      repetitions: 1,
      models: ['gemini-3.1-flash-lite'],
    });
    expect(
      preflightSpeechPlannerEval({
        variants,
        live: true,
        credentialsPresent: true,
        usedToday: 0,
        dailyLimit: 120,
        rpm: 4,
        allowedModels: ['gemini-3.1-flash-lite'],
      }),
    ).toMatchObject({
      allowed: false,
      category: 'model_not_allowed',
      remediation: expect.stringContaining('gemini-3.5-flash-lite'),
    });
  });

  it('reports remaining capacity in dry-run when usage is supplied', () => {
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: loadSpeechPlannerEvalFixtures().slice(0, 1),
      repetitions: 1,
    });
    expect(
      preflightSpeechPlannerEval({
        variants,
        live: false,
        credentialsPresent: false,
        usedToday: 7,
        dailyLimit: 120,
        rpm: 4,
        allowedModels,
      }),
    ).toMatchObject({ allowed: true, usageVerified: true, remainingDailyCapacity: 113 });
  });

  it('reports a missing required allowlist model without blocking dry-run inspection', () => {
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: loadSpeechPlannerEvalFixtures(),
      repetitions: 3,
    });

    expect(
      preflightSpeechPlannerEval({
        variants,
        live: false,
        credentialsPresent: false,
        dailyLimit: 120,
        rpm: 4,
        allowedModels: ['gemini-3.1-flash-lite'],
      }),
    ).toMatchObject({
      allowed: true,
      usageVerified: false,
      allowlistReady: false,
      missingRequiredModels: ['gemini-3.5-flash-lite'],
      plannerAttempts: 120,
    });
  });

  it('accepts the fixed run with renewable RPM and counts the smoke inside 120 attempts', () => {
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: loadSpeechPlannerEvalFixtures(),
      repetitions: 3,
    });
    expect(
      preflightSpeechPlannerEval({
        variants,
        live: true,
        credentialsPresent: true,
        usedToday: 0,
        dailyLimit: 120,
        rpm: 4,
        allowedModels,
      }),
    ).toMatchObject({
      allowed: true,
      plannerAttempts: 120,
      compatibilityChecks: 1,
      remainingDailyCapacity: 120,
    });
  });

  it('uses an eval-owned repository initialized from explicit current-day usage', async () => {
    const repository = createSpeechPlannerEvalBudgetRepository({ usedToday: 7 });
    const now = new Date('2026-07-29T00:00:00.000Z');
    const result = await repository.reserve({
      provider: 'google_ai_studio',
      model: 'gemini-3.5-flash-lite',
      now,
      estimatedTokens: 100,
      limits: { dailyRequestBudget: 8, rpmBudget: 4 },
    });

    expect(result).toMatchObject({ allowed: true, usage: { requestsToday: 8 } });
    await expect(
      repository.reserve({
        provider: 'google_ai_studio',
        model: 'gemini-3.1-flash-lite',
        now,
        estimatedTokens: 100,
        limits: { dailyRequestBudget: 8, rpmBudget: 4 },
      }),
    ).resolves.toMatchObject({ allowed: false, reason: { limitType: 'daily_requests' } });
  });

  it('throttles starts across renewable sixty-second windows', async () => {
    let nowMs = 0;
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });
    const limiter = new SpeechPlannerEvalRateLimiter({
      rpm: 2,
      now: () => nowMs,
      sleep,
    });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(sleep).toHaveBeenNthCalledWith(1, 60_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 60_000);
  });
});
