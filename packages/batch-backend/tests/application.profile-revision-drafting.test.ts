import { describe, expect, it, vi } from 'vitest';

import { ProviderExecutionError } from '../src/application/generation-providers.js';
import {
  generateProfileRevisionDraft,
  ProfileRevisionDraftingError,
} from '../src/application/profile-revision-drafting.js';
import { loadConfig } from '../src/config/env.js';

const USAGE = {
  requestsPerMinuteUsed: 1,
  requestsToday: 1,
  reservedTokensToday: 100,
  actualTokensToday: 0,
};

describe('application/profile-revision-drafting single target', () => {
  it.each([
    { status: 429, category: 'provider_rate_limit', retryAfterMs: 120_000 },
    { status: 504, category: 'provider_timeout', retryAfterMs: undefined },
  ] as const)(
    'preserves $status rejection metadata without a second model request',
    async (caseInfo) => {
      const base = loadConfig();
      const config = {
        ...base,
        generation: {
          ...base.generation,

          safetyMode: 'hard_stop' as const,
        },
      };
      const reserve = vi.fn().mockResolvedValue({ allowed: true, usage: USAGE });
      const execute = vi.fn().mockRejectedValue(
        new ProviderExecutionError({
          provider: 'openai',
          message: 'provider rejected',
          status: caseInfo.status,
          ...(caseInfo.retryAfterMs ? { retryAfterMs: caseInfo.retryAfterMs } : {}),
        }),
      );

      await expect(
        generateProfileRevisionDraft({
          request: {
            prompt: 'Canonical lesson evidence',
            operation: 'lesson_population',

            budgetReservationAlreadyMade: true,
          },
          overrides: {
            config,
            executors: { openai: execute, google_ai_studio: vi.fn(), openrouter: vi.fn() },
            budget: {
              repository: {
                reserve,
                recordActual: vi.fn(),
                getUsage: vi.fn().mockResolvedValue(USAGE),
              },
            },
          },
        }),
      ).rejects.toMatchObject({
        name: ProfileRevisionDraftingError.name,
        category: caseInfo.category,
        providerStatus: caseInfo.status,
        retryAfterMs: caseInfo.retryAfterMs,
        rejectedBeforeExecution: caseInfo.status === 429,
      });
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0]?.[0].request.model).toBe('gpt-5.6-luna');
      expect(reserve).not.toHaveBeenCalled();
    },
  );
});
