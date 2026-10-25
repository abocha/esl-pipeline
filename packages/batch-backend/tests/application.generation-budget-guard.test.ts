import { describe, expect, it, vi } from 'vitest';

import {
  enforceGenerationBudgetBeforeAttempt,
  estimateGenerationTokens,
  getConfiguredGenerationAllowedModels,
  getConfiguredGenerationProviderLimits,
  getConfiguredSpeechPlannerLimits,
} from '../src/application/generation-budget-guard.js';
import { loadConfig } from '../src/config/env.js';

describe('generation budget guard', () => {
  it('removes retired provider budget admission and retains OpenAI limits', () => {
    const config = loadConfig();
    expect(getConfiguredGenerationAllowedModels(config.generation, 'google_ai_studio')).toEqual([]);
    expect(() =>
      getConfiguredGenerationProviderLimits(config.generation, 'google_ai_studio'),
    ).toThrow('is retired');
    expect(getConfiguredGenerationProviderLimits(config.generation, 'openai')).toMatchObject({
      rpmBudget: 3,
      tpmBudget: 160_000,
      dailyRequestBudget: undefined,
    });
    expect(getConfiguredSpeechPlannerLimits(config)).toEqual({
      rpmBudget: 4,
      dailyRequestBudget: 120,
    });
  });

  it.each(['off', 'warn', 'hard_stop'] as const)(
    'rejects frozen retired targets before any budget work in %s mode',
    async (safetyMode) => {
      const config = loadConfig();
      config.generation.safetyMode = safetyMode;
      const reserve = vi.fn();
      const getUsage = vi.fn();
      for (const provider of ['google_ai_studio', 'openrouter'] as const) {
        await expect(
          enforceGenerationBudgetBeforeAttempt({
            config,
            provider,
            model: 'frozen-model',
            prompt: 'source',
            now: new Date(),
            repository: { reserve, getUsage, recordActual: vi.fn() },
          }),
        ).rejects.toMatchObject({ code: 'unsupported_provider', status: 400, provider });
      }
      expect(reserve).not.toHaveBeenCalled();
      expect(getUsage).not.toHaveBeenCalled();
    },
  );

  it('uses one exported token estimate for reservations and pacing', () => {
    expect(
      estimateGenerationTokens({
        prompt: 'abcdefgh',
        requestedMaxOutputTokens: 50,
        hardCap: 100,
      }),
    ).toBe(52);
  });

  it('passes the configured OpenAI TPM budget into the reservation request', async () => {
    const base = loadConfig();
    const reserve = vi.fn().mockResolvedValue({
      allowed: true,
      usage: {
        requestsPerMinuteUsed: 1,
        requestsToday: 1,
        reservedTokensToday: 10,
        actualTokensToday: 0,
      },
    });

    await enforceGenerationBudgetBeforeAttempt({
      config: {
        ...base,
        generation: {
          ...base.generation,
          providers: {
            ...base.generation.providers,
            openai: { ...base.generation.providers.openai, tpmBudget: 160_000 },
          },
        },
      },
      provider: 'openai',
      model: 'gpt-5.6-luna',
      prompt: 'memory source',
      now: new Date('2026-06-19T00:00:00.000Z'),
      repository: {
        reserve,
        recordActual: vi.fn(),
        getUsage: vi.fn(),
      },
    });

    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({ limits: expect.objectContaining({ tpmBudget: 160_000 }) }),
    );
  });
  it('keeps the output cap when capacity enforcement is off', async () => {
    const config = loadConfig();
    config.generation.safetyMode = 'off';
    config.generation.maxOutputTokensHard = 100;
    const reserve = vi.fn();
    const getUsage = vi.fn();
    await expect(
      enforceGenerationBudgetBeforeAttempt({
        config,
        provider: 'openai',
        model: 'operator-custom',
        prompt: 'source',
        maxOutputTokens: 101,
        now: new Date(),
        repository: { reserve, getUsage, recordActual: vi.fn() },
      }),
    ).rejects.toMatchObject({ category: 'budget_exceeded', limitType: 'max_output_tokens' });
    expect(reserve).not.toHaveBeenCalled();
    expect(getUsage).not.toHaveBeenCalled();
  });
});

describe('OpenAI group admission', () => {
  it.each(['off', 'warn', 'hard_stop'] as const)(
    'fails closed for an unmapped model in %s',
    async (safetyMode) => {
      const config = loadConfig();
      config.generation.safetyMode = safetyMode;
      const reserve = vi.fn(),
        getUsage = vi.fn();
      await expect(
        enforceGenerationBudgetBeforeAttempt({
          config,
          provider: 'openai',
          model: 'unclassified',
          prompt: 'input',
          now: new Date(),
          repository: { reserve, getUsage, recordActual: vi.fn() },
        }),
      ).rejects.toMatchObject({ limitType: 'model_not_allowed' });
      expect(reserve).not.toHaveBeenCalled();
      expect(getUsage).not.toHaveBeenCalled();
    },
  );
  it('shares reservations within a group, keeps groups independent and resets at UTC midnight', async () => {
    const config = loadConfig();
    config.generation.providers.openai.dailyTokenBudgets = { efficient: 101, larger: 101 };
    const { resolveGenerationBudgetRepository } = await import(
      '../src/application/generation-budget-guard.js'
    );
    const repository = resolveGenerationBudgetRepository({ config });
    const now = new Date('2040-01-01T23:59:00Z');
    const attempt = (model: string, date = now) =>
      enforceGenerationBudgetBeforeAttempt({
        config,
        provider: 'openai',
        model,
        prompt: 'test',
        maxOutputTokens: 99,
        now: date,
        repository,
      });
    await attempt('gpt-5.6-luna');
    await expect(attempt('gpt-5.6-terra')).rejects.toMatchObject({
      limitType: 'daily_tokens',
      used: 100,
      limit: 101,
    });
    await attempt('gpt-6.1-sol');
    await expect(attempt('gpt-6-sol')).rejects.toMatchObject({ limitType: 'daily_tokens' });
    await repository.recordActual({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      now,
      actualTokens: 30,
    });
    expect(
      await repository.getUsage({ provider: 'openai', model: 'gpt-5.6-terra', now }),
    ).toMatchObject({
      requestsToday: 0,
      reservedTokensToday: 0,
      groupReservedTokensToday: 100,
      groupActualTokensToday: 30,
    });
    await attempt('gpt-5.6-terra', new Date('2040-01-02T00:00:00Z'));
  });
  it('cannot bypass group policy with caller-specific rate limits', async () => {
    const config = loadConfig(),
      reserve = vi.fn().mockResolvedValue({ allowed: true, usage: {} });
    await enforceGenerationBudgetBeforeAttempt({
      config,
      provider: 'openai',
      model: 'gpt-6.1-sol',
      prompt: 'test',
      now: new Date(),
      limits: { rpmBudget: 12, dailyTokenBudget: 99999999 },
      repository: { reserve, getUsage: vi.fn(), recordActual: vi.fn() },
    });
    expect(reserve.mock.calls[0]![0].limits).toMatchObject({
      rpmBudget: 12,
      dailyTokenBudget: 225000,
    });
  });
});
