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
  it('exposes Gemini eval allowlist and configured Google limits without resolving a repository', () => {
    const config = loadConfig();

    expect(getConfiguredGenerationAllowedModels(config.generation, 'google_ai_studio')).toContain(
      'gemini-3.5-flash-lite',
    );
    expect(getConfiguredGenerationProviderLimits(config.generation, 'google_ai_studio')).toEqual({
      rpmBudget: 4,
      dailyRequestBudget: 12,
      dailyTokenBudget: undefined,
    });
    expect(getConfiguredSpeechPlannerLimits(config)).toEqual({
      rpmBudget: 4,
      dailyRequestBudget: 120,
    });
  });

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
