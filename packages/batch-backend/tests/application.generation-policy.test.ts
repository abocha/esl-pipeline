import { describe, expect, it, vi } from 'vitest';

import {
  buildGenerationOptionsPayload,
  resolveGenerationCandidates,
} from '../src/application/generation-policy.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';

function buildConfig(
  overrides: Partial<BatchBackendConfig['generation']> = {},
): BatchBackendConfig['generation'] {
  return {
    defaultProvider: 'openai',
    fallbackProviders: ['google_ai_studio', 'openrouter'],
    quotaSourceMode: 'hybrid',
    safetyMode: 'hard_stop',
    strictNoPaid: true,
    maxOutputTokensHard: 3200,
    budgetEmergencyOverride: false,
    models: {
      openai: {
        primary: 'gpt-5.4-mini',
        fallback: 'gpt-5.4-nano',
        allowed: ['gpt-5.4-mini', 'gpt-5.4-nano'],
        studentMemoryPrimary: 'gpt-5.4-nano',
        studentMemoryFallback: 'gpt-5.4-mini',
        profileDraftPrimary: 'gpt-5.4',
        profileDraftFallback: 'gpt-5.4-mini',
        profileDraftTertiary: 'gpt-5.4-nano',
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
        requestTimeoutMs: 240_000,
        retryMax: 1,
        retryBackoffMs: 250,
        dailyTokenBudget: 120_000,
        dailyRequestBudget: 40,
        rpmBudget: 3,
      },
      googleAiStudio: {
        requestTimeoutMs: 240_000,
        retryMax: 1,
        retryBackoffMs: 250,
        dailyRequestBudget: 12,
        rpmBudget: 4,
      },
      openrouter: {
        requestTimeoutMs: 240_000,
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
  it('isolates the assignment default and exposes it in job options', () => {
    const config = loadConfig().generation;
    const assignment = resolveGenerationCandidates({ config, workload: 'draft_generation' });
    expect(assignment[0]).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol' });
    expect(config.models.openai.allowed).toContain('gpt-6.1-sol');
    const options = buildGenerationOptionsPayload({ config });
    expect(options.defaultModelByProvider?.openai).toBe('gpt-6.1-sol');
    expect(options.modelOptions.find((item) => item.id === 'gpt-6.1-sol')).toMatchObject({
      defaultSelected: true,
      tier: 'primary',
    });

    for (const workload of [
      'default',
      'student_memory_extraction',
      'profile_revision_drafting',
    ] as const) {
      const models = resolveGenerationCandidates({ config, workload })
        .filter((candidate) => candidate.provider === 'openai')
        .map((candidate) => candidate.model);
      expect(models[0]).toBe(workload === 'default' ? 'gpt-5.6-sol' : 'gpt-5.6-luna');
      expect(models).not.toContain('gpt-6.1-sol');
    }
  });

  it('preserves the assignment model in an explicit operator allowlist for unrelated workloads', () => {
    vi.stubEnv('GEN_ALLOWED_MODELS_OPENAI', 'gpt-5.6-sol,gpt-5.6-luna,gpt-6.1-sol');
    try {
      const config = loadConfig().generation;
      expect(config.models.openai.allowed).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-6.1-sol']);
      for (const workload of [
        'default',
        'student_memory_extraction',
        'profile_revision_drafting',
      ] as const) {
        expect(
          resolveGenerationCandidates({ config, workload }).some(
            (candidate) => candidate.provider === 'openai' && candidate.model === 'gpt-6.1-sol',
          ),
        ).toBe(true);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('preserves explicit assignment model and provider overrides', () => {
    const config = loadConfig().generation;
    expect(
      resolveGenerationCandidates({
        config,
        workload: 'draft_generation',
        providerOverride: 'google_ai_studio',
        modelOverride: 'custom-model',
      })[0],
    ).toMatchObject({ provider: 'google_ai_studio', model: 'custom-model' });
  });

  it('uses global fallback ranks that match execution candidate order', () => {
    const config = buildConfig();

    const options = buildGenerationOptionsPayload({ config });
    const candidates = resolveGenerationCandidates({ config });

    expect(options.modelOptions.map((option) => option.fallbackRank)).toEqual([
      ...options.modelOptions.keys(),
    ]);
    expect(
      options.modelOptions.map(({ provider, id, fallbackRank }) => ({
        provider,
        id,
        fallbackRank,
      })),
    ).toEqual(
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
          requestTimeoutMs: 240_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyTokenBudget: 120_000,
          dailyRequestBudget: 40,
          rpmBudget: 3,
        },
        googleAiStudio: {
          requestTimeoutMs: 240_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyRequestBudget: 0,
          rpmBudget: 4,
        },
        openrouter: {
          requestTimeoutMs: 240_000,
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
          primary: 'gpt-5.4-mini',
          fallback: 'gpt-5.4-nano',
          allowed: ['gpt-5.4-mini', 'gpt-5.4-nano'],
          studentMemoryPrimary: 'gpt-5.4-nano',
          studentMemoryFallback: 'gpt-5.4-mini',
          profileDraftPrimary: 'gpt-5.4',
          profileDraftFallback: 'gpt-5.4-mini',
          profileDraftTertiary: 'gpt-5.4-nano',
        },
        googleAiStudio: {
          primary: 'gemini-2.5-flash-lite',
          fallback: 'gemini-2.5-flash',
          tertiary: 'gemini-2.5-pro',
          allowed: [
            'gemini-2.5-flash-lite',
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-3.1-pro-preview',
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
      'gemini-3.1-pro-preview',
    ]);

    const options = buildGenerationOptionsPayload({ config });
    const extraModel = options.modelOptions.find(
      (option) => option.provider === 'google_ai_studio' && option.id === 'gemini-3.1-pro-preview',
    );
    expect(extraModel?.tier).toBe('custom');
    expect(extraModel?.defaultSelected).toBe(false);
  });

  it('keeps Gemini 3.5 Flash selectable without making it the Google default', () => {
    const config = buildConfig({
      models: {
        openai: {
          primary: 'gpt-5.4-mini',
          fallback: 'gpt-5.4-nano',
          allowed: ['gpt-5.4-mini', 'gpt-5.4-nano'],
          studentMemoryPrimary: 'gpt-5.4-nano',
          studentMemoryFallback: 'gpt-5.4-mini',
          profileDraftPrimary: 'gpt-5.4',
          profileDraftFallback: 'gpt-5.4-mini',
          profileDraftTertiary: 'gpt-5.4-nano',
        },
        googleAiStudio: {
          primary: 'gemini-3-flash-preview',
          fallback: 'gemini-2.5-flash-lite',
          tertiary: 'gemini-2.5-pro',
          allowed: [
            'gemini-3-flash-preview',
            'gemini-3.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.5-pro',
          ],
        },
        openrouter: {
          primary: 'anthropic/claude-sonnet-4',
          fallback: 'openai/gpt-5-mini',
          allowed: [],
        },
      },
    });

    const googleModels = resolveGenerationCandidates({ config })
      .filter((candidate) => candidate.provider === 'google_ai_studio')
      .map((candidate) => candidate.model);

    expect(googleModels).toEqual([
      'gemini-3-flash-preview',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
      'gemini-3.5-flash',
    ]);

    const options = buildGenerationOptionsPayload({ config });
    const defaultModelByProvider = options.defaultModelByProvider;
    expect(defaultModelByProvider).toBeDefined();
    expect(defaultModelByProvider?.google_ai_studio).toBe('gemini-3-flash-preview');
    const selectableModel = options.modelOptions.find(
      (option) => option.provider === 'google_ai_studio' && option.id === 'gemini-3.5-flash',
    );
    expect(selectableModel?.tier).toBe('custom');
    expect(selectableModel?.defaultSelected).toBe(false);
  });

  it('uses workload-specific openai ladders for memory extraction and profile drafting', () => {
    const config = buildConfig();

    expect(
      resolveGenerationCandidates({
        config,
        workload: 'student_memory_extraction',
        providerOverride: 'openai',
      })
        .filter((candidate) => candidate.provider === 'openai')
        .map((candidate) => candidate.model)
        .slice(0, 3),
    ).toEqual(['gpt-5.4-nano', 'gpt-5.4-mini']);

    expect(
      resolveGenerationCandidates({
        config,
        workload: 'profile_revision_drafting',
        providerOverride: 'openai',
      })
        .filter((candidate) => candidate.provider === 'openai')
        .map((candidate) => candidate.model)
        .slice(0, 3),
    ).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano']);
  });

  it('can constrain override candidates to one provider without provider fallback', () => {
    const config = buildConfig();

    const candidates = resolveGenerationCandidates({
      config,
      workload: 'profile_revision_drafting',
      providerOverride: 'openai',
      includeProviderFallbacks: false,
    });

    expect([...new Set(candidates.map((candidate) => candidate.provider))]).toEqual(['openai']);
    expect(candidates.map((candidate) => candidate.model).slice(0, 3)).toEqual([
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
    ]);
  });

  it('collapses profileDraftTertiary when it equals a prior rung, keeps it when distinct', () => {
    // Default config: profileDraftTertiary = 'gpt-5.4-nano' = general fallback.
    // uniqueNonEmpty deduplicates it, so only two distinct OpenAI rungs remain.
    const configCollapsed = buildConfig();
    const collapsedModels = resolveGenerationCandidates({
      config: configCollapsed,
      workload: 'profile_revision_drafting',
      providerOverride: 'openai',
    })
      .filter((c) => c.provider === 'openai')
      .map((c) => c.model);
    // gpt-5.4-nano appears only once (deduplicated)
    expect(collapsedModels.filter((m) => m === 'gpt-5.4-nano')).toHaveLength(1);
    expect(collapsedModels.slice(0, 3)).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano']);

    // Explicit distinct tertiary: preserves a true three-rung ladder.
    const configDistinct = buildConfig({
      models: {
        openai: {
          primary: 'gpt-5.4-mini',
          fallback: 'gpt-5.4-nano',
          allowed: ['gpt-5.4-mini', 'gpt-5.4-nano'],
          studentMemoryPrimary: 'gpt-5.4-nano',
          studentMemoryFallback: 'gpt-5.4-mini',
          profileDraftPrimary: 'gpt-5.4',
          profileDraftFallback: 'gpt-5.4-mini',
          profileDraftTertiary: 'gpt-5.4-turbo', // distinct model
        },
        googleAiStudio: configCollapsed.models.googleAiStudio,
        openrouter: configCollapsed.models.openrouter,
      },
    });
    const distinctModels = resolveGenerationCandidates({
      config: configDistinct,
      workload: 'profile_revision_drafting',
      providerOverride: 'openai',
    })
      .filter((c) => c.provider === 'openai')
      .map((c) => c.model);
    expect(distinctModels.slice(0, 3)).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-turbo']);
  });
});
