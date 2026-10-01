import { describe, expect, it } from 'vitest';

import {
  buildGenerationOptionsPayload,
  buildQuotaSnapshot,
  type GenerationWorkload,
  resolveGenerationTarget,
} from '../src/application/generation-policy.js';
import { loadConfig } from '../src/config/env.js';

describe('explicit workload generation routing', () => {
  it.each([
    'draft_generation',
    'lesson_memory',
    'homework_memory',
    'student_memory_snapshot',
    'profile_revision_drafting',
  ] satisfies GenerationWorkload[])('resolves exactly the configured %s target', (workload) => {
    const config = loadConfig().generation;
    config.targets[workload] = { provider: 'google_ai_studio', model: 'gemini-3-flash-preview' };
    expect(resolveGenerationTarget({ config, workload })).toEqual({
      provider: 'google_ai_studio',
      model: 'gemini-3-flash-preview',
    });
  });
  it('keeps assignment selection independent from memory and profile targets', () => {
    const config = loadConfig().generation;
    expect(resolveGenerationTarget({ config, workload: 'draft_generation' }).model).toBe(
      'gpt-6.1-sol',
    );
    for (const workload of [
      'lesson_memory',
      'homework_memory',
      'student_memory_snapshot',
      'profile_revision_drafting',
    ] as const)
      expect(resolveGenerationTarget({ config, workload }).model).toBe('gpt-5.6-luna');
    config.targets.draft_generation.model = 'assignment-custom';
    expect(resolveGenerationTarget({ config, workload: 'lesson_memory' }).model).toBe(
      'gpt-5.6-luna',
    );
  });
  it('supports model-only, provider-only, and exact operator overrides without a graph', () => {
    const config = loadConfig().generation;
    expect(
      resolveGenerationTarget({ config, workload: 'draft_generation', modelOverride: ' custom ' }),
    ).toEqual({ provider: 'openai', model: 'custom' });
    expect(
      resolveGenerationTarget({
        config,
        workload: 'draft_generation',
        providerOverride: 'google_ai_studio',
      }),
    ).toEqual({ provider: 'google_ai_studio', model: 'gemini-3-flash-preview' });
    expect(
      resolveGenerationTarget({
        config,
        workload: 'draft_generation',
        providerOverride: 'openrouter',
        modelOverride: 'operator/model',
      }),
    ).toEqual({ provider: 'openrouter', model: 'operator/model' });
    expect(() =>
      resolveGenerationTarget({
        config,
        workload: 'draft_generation',
        providerOverride: 'openrouter',
      }),
    ).toThrow('No explicit model');
  });
  it('presents explicit choices without rank/tier or incidental OpenRouter routing', () => {
    const config = loadConfig().generation;
    const options = buildGenerationOptionsPayload({ config });
    expect(options.defaultProvider).toBe('openai');
    expect(options.providers).toEqual(['openai', 'google_ai_studio']);
    expect(options.defaultModelByProvider?.openai).toBe('gpt-6.1-sol');
    expect(options.modelOptions.filter((o) => o.defaultSelected)).toEqual([
      { provider: 'openai', id: 'gpt-6.1-sol', defaultSelected: true, enabled: true },
    ]);
    for (const option of options.modelOptions) {
      expect(option).not.toHaveProperty('fallbackRank');
      expect(option).not.toHaveProperty('tier');
    }
  });
  it('retains Google quota and usage metadata independently of routing', () => {
    const config = loadConfig().generation;
    config.providers.googleAiStudio.rpmBudget = undefined;
    config.providers.googleAiStudio.dailyRequestBudget = undefined;
    expect(
      buildQuotaSnapshot({
        config,
        provider: 'google_ai_studio',
        model: 'gemini-3-flash-preview',
        usage: {
          requestsPerMinuteUsed: 2,
          requestsToday: 3,
          reservedTokensToday: 100,
          actualTokensToday: 80,
        },
      }),
    ).toMatchObject({
      requestsPerMinute: 5,
      requestsPerDay: 20,
      usedRequestsToday: 3,
      usedTokensToday: 100,
      rpmRemaining: 3,
      dailyRequestRemaining: 17,
    });
  });
});
