import { describe, expect, it, vi } from 'vitest';

import { enforceGenerationBudgetBeforeAttempt } from '../src/application/generation-budget-guard.js';
import { loadConfig } from '../src/config/env.js';

describe('generation budget guard', () => {
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
      model: 'gpt-5.4-mini',
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
});
