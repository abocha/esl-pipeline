import { describe, expect, it, vi } from 'vitest';

import { ProviderExecutionError } from '../src/application/generation-providers.js';
import { createGenerationRequestEnvelope } from '../src/application/generation-request-envelope.js';
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
  it('preserves prompt-only initial enrichment with an existing reservation and durable result callback', async () => {
    const prompt = '  Confirmed synthetic lesson evidence\nTutor seed: preserve this fact.\n';
    const profile = {
      schemaVersion: 'foundational_profile_v1' as const,
      overallLevel: null,
      primaryGoals: [],
      communicationContexts: [],
      interestsAndUsefulThemes: [],
      stableStrengths: [],
      persistentChallenges: [],
      studyPreferences: [],
      durableConstraints: [],
      teacherNotes: null,
    };
    const execute = vi.fn().mockResolvedValue({
      output: profile,
      rawText: JSON.stringify(profile),
      usage: { totalTokens: 99 },
    });
    const onValidatedResponse = vi.fn().mockResolvedValue(undefined);
    const repository = {
      reserve: vi.fn(),
      recordActual: vi.fn(),
      getUsage: vi.fn().mockResolvedValue(USAGE),
    };
    const result = await generateProfileRevisionDraft({
      request: {
        prompt,
        operation: 'lesson_population',
        budgetReservationAlreadyMade: true,
        maxOutputTokens: 2800,
        onValidatedResponse,
      },
      overrides: { config: loadConfig(), executors: { openai: execute }, budget: { repository } },
    });
    expect(result.structuredProfile).toEqual(profile);
    expect(repository.reserve).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![0].request).toMatchObject({ prompt, maxOutputTokens: 2800 });
    expect(execute.mock.calls[0]![0].request).not.toHaveProperty('envelope');
    expect(onValidatedResponse).toHaveBeenCalledWith(profile);
    expect(onValidatedResponse.mock.invocationCallOrder[0]).toBeLessThan(
      repository.recordActual.mock.invocationCallOrder[0]!,
    );
  });
  it.each(['openai', 'google_ai_studio', 'openrouter'] as const)(
    'reserves the effective %s envelope and rejects before dispatch when denied',
    async (provider) => {
      const base = loadConfig();
      const config = {
        ...base,
        generation: { ...base.generation, safetyMode: 'hard_stop' as const },
      };
      const envelope = createGenerationRequestEnvelope({
        workload: 'profile_revision',
        instructions: 'Preserve durable approved truths.',
        sources: [{ id: 'profile', label: 'PROFILE', content: 'Synthetic source '.repeat(80) }],
      });
      const estimatedTokens =
        Math.ceil((envelope.instructions.length + 2 + envelope.input.length) / 4) + 125;
      const reserve = vi.fn().mockResolvedValue({
        allowed: false,
        reason: { limitType: 'daily_tokens', window: 'day', limit: 100, used: 100 },
        usage: USAGE,
      });
      const execute = vi.fn();
      const repository = {
        reserve,
        recordActual: vi.fn(),
        getUsage: vi.fn().mockResolvedValue(USAGE),
      };
      const request = {
        prompt: 'stale short copy',
        envelope,
        operation: 'profile_revision_refresh' as const,
        providerOverride: provider,
        modelOverride: 'fixture',
        maxOutputTokens: 125,
      };
      await expect(
        generateProfileRevisionDraft({
          request,
          overrides: { config, executors: { [provider]: execute }, budget: { repository } },
        }),
      ).rejects.toMatchObject({ limitType: 'daily_tokens', window: 'day' });
      expect(reserve).toHaveBeenCalledWith(
        expect.objectContaining({ provider, model: 'fixture', estimatedTokens }),
      );
      expect(execute).not.toHaveBeenCalled();
      expect(repository.recordActual).not.toHaveBeenCalled();
      reserve.mockResolvedValue({ allowed: true, usage: USAGE });
      const profile = { operation: 'no_change' as const, candidateIds: [] };
      execute.mockResolvedValue({
        output: profile,
        rawText: JSON.stringify(profile),
        usage: { totalTokens: 99 },
      });
      await generateProfileRevisionDraft({
        request: { ...request, validateOutput: () => profile },
        overrides: { config, executors: { [provider]: execute }, budget: { repository } },
      });
      expect(execute.mock.calls[0]![0].request.prompt).toBe(
        `${envelope.instructions}\n\n${envelope.input}`,
      );
      expect(repository.recordActual).toHaveBeenCalledWith(
        expect.objectContaining({ provider, model: 'fixture', actualTokens: 99 }),
      );
    },
  );
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
