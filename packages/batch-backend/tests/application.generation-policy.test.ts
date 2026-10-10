import { describe, expect, it } from 'vitest';

import {
  buildGenerationOptionsPayload,
  buildQuotaSnapshot,
  type GenerationWorkload,
  resolveGenerationTarget,
} from '../src/application/generation-policy.js';
import { loadConfig } from '../src/config/env.js';

describe('explicit OpenAI workload generation routing', () => {
  it.each([
    'draft_generation',
    'lesson_memory',
    'homework_memory',
    'student_memory_snapshot',
    'profile_revision_drafting',
  ] satisfies GenerationWorkload[])(
    'resolves the configured %s target without fallback',
    (workload) => {
      const config = loadConfig().generation;
      config.targets[workload] = { provider: 'openai', model: 'gpt-6.1-sol' };
      expect(resolveGenerationTarget({ config, workload })).toEqual({
        provider: 'openai',
        model: 'gpt-6.1-sol',
      });
    },
  );
  it('keeps Sol assignment and Luna memory targets independent', () => {
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
    expect(
      resolveGenerationTarget({
        config,
        workload: 'lesson_memory',
        modelOverride: ' gpt-6.1-sol ',
      }),
    ).toEqual({ provider: 'openai', model: 'gpt-6.1-sol' });
    expect(config.targets.lesson_memory.model).toBe('gpt-5.6-luna');
  });
  it.each(['google_ai_studio', 'openrouter'] as const)(
    'rejects retired %s overrides and frozen targets without retargeting',
    (provider) => {
      const config = loadConfig().generation;
      expect(() =>
        resolveGenerationTarget({
          config,
          workload: 'lesson_memory',
          providerOverride: provider,
          modelOverride: 'historical-model',
        }),
      ).toThrow('is retired');
      config.targets.lesson_memory = { provider, model: 'historical-model' };
      expect(() => resolveGenerationTarget({ config, workload: 'lesson_memory' })).toThrow(
        'is retired',
      );
      expect(config.targets.lesson_memory).toEqual({ provider, model: 'historical-model' });
    },
  );
  it('presents only OpenAI choices with configured TPM and usage', () => {
    const config = loadConfig().generation;
    const options = buildGenerationOptionsPayload({ config });
    expect(options.providers).toEqual(['openai']);
    expect(options.defaultModelByProvider).toEqual({ openai: 'gpt-6.1-sol' });
    expect(options.modelOptions.filter((o) => o.defaultSelected)).toEqual([
      { provider: 'openai', id: 'gpt-6.1-sol', defaultSelected: true, enabled: true },
    ]);
    expect(
      buildQuotaSnapshot({
        config,
        provider: 'openai',
        model: 'gpt-5.6-luna',
        usage: {
          requestsPerMinuteUsed: 2,
          requestsToday: 3,
          reservedTokensToday: 100,
          actualTokensToday: 80,
        },
      }),
    ).toMatchObject({
      tokensPerMinute: 160_000,
      usedRequestsToday: 3,
      usedTokensToday: 100,
      rpmRemaining: 1,
      dailyRequestRemaining: 37,
    });
  });
});
