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
      dailyRequestBudget: 40,
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
