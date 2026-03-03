import { describe, expect, it } from 'vitest';

import type { BatchBackendConfig } from '../src/config/env.js';
import {
  buildGenerationOptionsPayload,
  resolveGenerationCandidates,
} from '../src/application/generation-policy.js';

function buildConfig(overrides: Partial<BatchBackendConfig['generation']> = {}): BatchBackendConfig['generation'] {
  return {
    defaultProvider: 'openai',
    fallbackProviders: ['google_ai_studio', 'openrouter'],
    quotaSourceMode: 'hybrid',
    safetyMode: 'hard_stop',
    strictNoPaid: true,
    maxOutputTokensHard: 1200,
    budgetEmergencyOverride: false,
    models: {
      openai: {
        primary: 'gpt-5.2',
        fallback: 'gpt-5-mini',
        allowed: ['gpt-5.2', 'gpt-5-mini'],
      },
      googleAiStudio: {
        primary: 'gemini-3-flash-preview',
        fallback: 'gemini-2.5-flash-lite',
        tertiary: 'gemini-2.5-pro',
        allowed: ['gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
      },
      openrouter: {
        primary: 'anthropic/claude-sonnet-4',
        fallback: 'openai/gpt-5-mini',
        allowed: [],
      },
    },
    providers: {
      openai: {
        requestTimeoutMs: 30_000,
        retryMax: 1,
        retryBackoffMs: 250,
        dailyTokenBudget: 120_000,
        dailyRequestBudget: 40,
        rpmBudget: 3,
      },
      googleAiStudio: {
        requestTimeoutMs: 30_000,
        retryMax: 1,
        retryBackoffMs: 250,
        dailyRequestBudget: 12,
        rpmBudget: 4,
      },
      openrouter: {
        requestTimeoutMs: 30_000,
        retryMax: 1,
        retryBackoffMs: 250,
        dailyTokenBudget: 0,
        dailyRequestBudget: 0,
        rpmBudget: 0,
      },
    },
    ...overrides,
  };
}

describe('application/generation-policy', () => {
  it('uses global fallback ranks that match execution candidate order', () => {
    const config = buildConfig();

    const options = buildGenerationOptionsPayload({ config });
    const candidates = resolveGenerationCandidates({ config });

    expect(options.modelOptions.map((option) => option.fallbackRank)).toEqual(
      [...options.modelOptions.keys()],
    );
    expect(options.modelOptions.map(({ provider, id, fallbackRank }) => ({ provider, id, fallbackRank }))).toEqual(
      candidates.map(({ provider, model, fallbackRank }) => ({
        provider,
        id: model,
        fallbackRank,
      })),
    );
  });

  it('preserves explicit zero Google daily budget in quota payload', () => {
    const config = buildConfig({
      defaultProvider: 'google_ai_studio',
      fallbackProviders: ['openai', 'openrouter'],
      providers: {
        openai: {
          requestTimeoutMs: 30_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyTokenBudget: 120_000,
          dailyRequestBudget: 40,
          rpmBudget: 3,
        },
        googleAiStudio: {
          requestTimeoutMs: 30_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyRequestBudget: 0,
          rpmBudget: 4,
        },
        openrouter: {
          requestTimeoutMs: 30_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyTokenBudget: 0,
          dailyRequestBudget: 0,
          rpmBudget: 0,
        },
      },
    });

    const options = buildGenerationOptionsPayload({ config });
    expect(options.quota.requestsPerDay).toBe(0);
  });

  it('includes additional allowed models after primary/fallback ladder', () => {
    const config = buildConfig({
      models: {
        openai: {
          primary: 'gpt-5.2',
          fallback: 'gpt-5-mini',
          allowed: ['gpt-5.2', 'gpt-5-mini'],
        },
        googleAiStudio: {
          primary: 'gemini-2.5-flash-lite',
          fallback: 'gemini-2.5-flash',
          tertiary: 'gemini-2.5-pro',
          allowed: [
            'gemini-2.5-flash-lite',
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-3-pro-preview',
          ],
        },
        openrouter: {
          primary: 'anthropic/claude-sonnet-4',
          fallback: 'openai/gpt-5-mini',
          allowed: [],
        },
      },
    });

    const candidates = resolveGenerationCandidates({ config });
    const googleModels = candidates
      .filter((candidate) => candidate.provider === 'google_ai_studio')
      .map((candidate) => candidate.model);

    expect(googleModels).toEqual([
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-3-pro-preview',
    ]);

    const options = buildGenerationOptionsPayload({ config });
    const extraModel = options.modelOptions.find(
      (option) => option.provider === 'google_ai_studio' && option.id === 'gemini-3-pro-preview',
    );
    expect(extraModel?.tier).toBe('custom');
    expect(extraModel?.defaultSelected).toBe(false);
  });
});
