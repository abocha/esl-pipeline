import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GenerateDraftProviderError, generateDraft } from '../src/application/generate-draft.js';
import { ProviderExecutionError } from '../src/application/generation-providers.js';
import { createGenerationRequestEnvelope } from '../src/application/generation-request-envelope.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';

function createConfig(
  overrides: Partial<BatchBackendConfig['generation']> = {},
): BatchBackendConfig {
  const base = loadConfig();
  return {
    ...base,
    generation: {
      ...base.generation,
      defaultProvider: 'openai',
      fallbackProviders: ['google_ai_studio', 'openrouter'],
      quotaSourceMode: 'hybrid',
      safetyMode: 'hard_stop',
      strictNoPaid: false,
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
          allowed: [
            'gemini-3-flash-preview',
            'gemini-2.5-flash-lite',
            'gemini-2.5-pro',
            'gemini-custom-001',
          ],
        },
        openrouter: {
          primary: 'openrouter/test-primary',
          fallback: 'openrouter/test-fallback',
          allowed: ['openrouter/test-primary', 'openrouter/test-fallback'],
        },
      },
      providers: {
        openai: {
          ...base.generation.providers.openai,
          apiKey: 'openai-key',
          requestTimeoutMs: 5_000,
          retryMax: 1,
          retryBackoffMs: 0,
          dailyTokenBudget: 1_000_000,
          dailyRequestBudget: 1_000,
          rpmBudget: 1_000,
        },
        googleAiStudio: {
          ...base.generation.providers.googleAiStudio,
          apiKey: 'google-key',
          requestTimeoutMs: 5_000,
          retryMax: 1,
          retryBackoffMs: 0,
          dailyRequestBudget: 1_000,
          rpmBudget: 1_000,
        },
        openrouter: {
          ...base.generation.providers.openrouter,
          apiKey: 'openrouter-key',
          requestTimeoutMs: 5_000,
          retryMax: 1,
          retryBackoffMs: 0,
          dailyTokenBudget: 1_000_000,
          dailyRequestBudget: 1_000,
          rpmBudget: 1_000,
        },
      },
      ...overrides,
    },
  };
}

describe('application/generate-draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns generated text from first provider candidate', async () => {
    const config = createConfig();
    const openAi = vi.fn().mockResolvedValue({
      text: '# Generated draft',
      providerRequestId: 'resp-1',
      usage: { inputTokens: 12, outputTokens: 24, totalTokens: 36 },
    });

    const result = await generateDraft(
      {
        promptPackageId: 'prompt-1',
      },
      {
        config,
        promptPackages: {
          getById: vi.fn().mockResolvedValue({ id: 'prompt-1', text: 'PROMPT' }),
        },
        executors: {
          openai: openAi,
          google_ai_studio: vi.fn(),
          openrouter: vi.fn(),
        },
        now: () => new Date('2026-02-18T00:00:00.000Z'),
        sleep: async () => {},
      },
    );

    expect(result).toMatchObject({
      text: '# Generated draft',
      provider: 'openai',
      model: 'gpt-5.2',
      providerRequestId: 'resp-1',
      usage: { totalTokens: 36 },
      quota: {
        source: 'hybrid',
        lastUpdatedAt: '2026-02-18T00:00:00.000Z',
      },
    });
    expect(openAi).toHaveBeenCalledTimes(1);
  });

  it('retries timeout then falls back to next candidate', async () => {
    const config = createConfig();
    const openAi = vi.fn().mockRejectedValue(
      new ProviderExecutionError({
        provider: 'openai',
        message: 'gateway timeout',
        status: 504,
        code: 'server_error',
      }),
    );
    const google = vi.fn().mockResolvedValue({ text: '# Google draft', providerRequestId: 'g-1' });

    const result = await generateDraft(
      {
        promptPackageId: 'prompt-2',
      },
      {
        config,
        promptPackages: {
          getById: vi.fn().mockResolvedValue({ id: 'prompt-2', text: 'PROMPT' }),
        },
        executors: {
          openai: openAi,
          google_ai_studio: google,
          openrouter: vi.fn(),
        },
        now: () => new Date('2026-02-18T00:00:00.000Z'),
        sleep: async () => {},
      },
    );

    if (!result) {
      throw new Error('Expected generated draft response');
    }
    expect(openAi).toHaveBeenCalledTimes(4);
    expect(google).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('google_ai_studio');
    expect(result.model).toBe('gemini-3-flash-preview');
  });

  it('falls back immediately on rate limit', async () => {
    const config = createConfig();
    const openAi = vi.fn().mockRejectedValue(
      new ProviderExecutionError({
        provider: 'openai',
        message: 'rate limited',
        status: 429,
        code: 'rate_limit_exceeded',
      }),
    );
    const google = vi.fn().mockResolvedValue({ text: '# Google draft' });

    const result = await generateDraft(
      {
        promptPackageId: 'prompt-3',
      },
      {
        config,
        promptPackages: {
          getById: vi.fn().mockResolvedValue({ id: 'prompt-3', text: 'PROMPT' }),
        },
        executors: {
          openai: openAi,
          google_ai_studio: google,
          openrouter: vi.fn(),
        },
        now: () => new Date('2026-02-18T00:00:00.000Z'),
        sleep: async () => {},
      },
    );

    if (!result) {
      throw new Error('Expected generated draft response');
    }
    expect(openAi).toHaveBeenCalledTimes(2);
    expect(google).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('google_ai_studio');
  });

  it('fails fast on provider contract error', async () => {
    const config = createConfig();
    const openAi = vi.fn().mockRejectedValue(
      new ProviderExecutionError({
        provider: 'openai',
        message: 'invalid prompt payload',
        status: 400,
        code: 'invalid_prompt',
      }),
    );
    const google = vi.fn();

    await expect(
      generateDraft(
        {
          promptPackageId: 'prompt-4',
        },
        {
          config,
          promptPackages: {
            getById: vi.fn().mockResolvedValue({ id: 'prompt-4', text: 'PROMPT' }),
          },
          executors: {
            openai: openAi,
            google_ai_studio: google,
            openrouter: vi.fn(),
          },
          sleep: async () => {},
        },
      ),
    ).rejects.toMatchObject({
      name: 'GenerateDraftProviderError',
      category: 'provider_contract_error',
      statusCode: 502,
      provider: 'openai',
      model: 'gpt-5.2',
    });
    expect(google).not.toHaveBeenCalled();
  });

  it('prioritizes explicit provider/model override candidate', async () => {
    const config = createConfig();
    const google = vi.fn().mockResolvedValue({ text: '# Override model draft' });

    const result = await generateDraft(
      {
        promptPackageId: 'prompt-5',
        provider: 'google_ai_studio',
        model: 'gemini-custom-001',
      },
      {
        config,
        promptPackages: {
          getById: vi.fn().mockResolvedValue({ id: 'prompt-5', text: 'PROMPT' }),
        },
        executors: {
          openai: vi.fn(),
          google_ai_studio: google,
          openrouter: vi.fn(),
        },
        sleep: async () => {},
      },
    );

    if (!result) {
      throw new Error('Expected generated draft response');
    }
    const invocation = google.mock.calls[0]?.[0];
    expect(invocation?.request.model).toBe('gemini-custom-001');
    expect(result.provider).toBe('google_ai_studio');
    expect(result.model).toBe('gemini-custom-001');
  });

  it('returns null when prompt package is missing', async () => {
    const config = createConfig();
    const result = await generateDraft(
      {
        promptPackageId: 'missing',
      },
      {
        config,
        promptPackages: {
          getById: vi.fn().mockResolvedValue(null),
        },
      },
    );

    expect(result).toBeNull();
  });

  it('fails fast when maxOutputTokens exceeds hard safety cap', async () => {
    const config = createConfig({
      maxOutputTokensHard: 100,
    });
    const openAi = vi.fn();

    await expect(
      generateDraft(
        {
          promptPackageId: 'prompt-7',
          maxOutputTokens: 101,
        },
        {
          config,
          promptPackages: {
            getById: vi.fn().mockResolvedValue({ id: 'prompt-7', text: 'PROMPT' }),
          },
          executors: {
            openai: openAi,
          },
        },
      ),
    ).rejects.toMatchObject({
      name: 'GenerateDraftProviderError',
      category: 'budget_exceeded',
      statusCode: 429,
      limitType: 'max_output_tokens',
      limit: 100,
    });
    expect(openAi).not.toHaveBeenCalled();
  });

  it('fails fast when strict no-paid policy blocks model', async () => {
    const config = createConfig({
      strictNoPaid: true,
      models: {
        openai: {
          primary: 'gpt-5.2',
          fallback: 'gpt-5-mini',
          allowed: ['gpt-5.2'],
        },
        googleAiStudio: {
          primary: 'gemini-3-flash-preview',
          fallback: 'gemini-2.5-flash-lite',
          tertiary: 'gemini-2.5-pro',
          allowed: ['gemini-3-flash-preview'],
        },
        openrouter: {
          primary: 'openrouter/test-primary',
          fallback: 'openrouter/test-fallback',
          allowed: [],
        },
      },
    });
    const openAi = vi.fn();

    await expect(
      generateDraft(
        {
          promptPackageId: 'prompt-8',
          provider: 'openai',
          model: 'gpt-5-mini',
        },
        {
          config,
          promptPackages: {
            getById: vi.fn().mockResolvedValue({ id: 'prompt-8', text: 'PROMPT' }),
          },
          executors: {
            openai: openAi,
          },
        },
      ),
    ).rejects.toMatchObject({
      name: 'GenerateDraftProviderError',
      category: 'budget_exceeded',
      statusCode: 429,
      limitType: 'model_not_allowed',
    });
    expect(openAi).not.toHaveBeenCalled();
  });

  it('bypasses strict no-paid checks when emergency override is enabled', async () => {
    const config = createConfig({
      budgetEmergencyOverride: true,
      strictNoPaid: true,
      models: {
        openai: {
          primary: 'gpt-5.2',
          fallback: 'gpt-5-mini',
          allowed: ['gpt-5.2'],
        },
        googleAiStudio: {
          primary: 'gemini-3-flash-preview',
          fallback: 'gemini-2.5-flash-lite',
          tertiary: 'gemini-2.5-pro',
          allowed: ['gemini-3-flash-preview'],
        },
        openrouter: {
          primary: 'openrouter/test-primary',
          fallback: 'openrouter/test-fallback',
          allowed: [],
        },
      },
    });
    const openAi = vi.fn().mockResolvedValue({
      text: '# Override path draft',
      usage: { totalTokens: 42 },
    });

    const result = await generateDraft(
      {
        promptPackageId: 'prompt-override',
        provider: 'openai',
        model: 'gpt-5-mini',
      },
      {
        config,
        promptPackages: {
          getById: vi.fn().mockResolvedValue({ id: 'prompt-override', text: 'PROMPT' }),
        },
        executors: {
          openai: openAi,
        },
      },
    );

    expect(openAi).toHaveBeenCalledTimes(1);
    expect(result?.provider).toBe('openai');
    expect(result?.model).toBe('gpt-5-mini');
  });

  it('classifies missing provider credentials as contract error', async () => {
    const baseProviders = createConfig().generation.providers;
    const config = createConfig({
      providers: {
        ...baseProviders,
        openai: {
          ...baseProviders.openai,
          apiKey: '',
        },
      },
    });

    await expect(
      generateDraft(
        {
          promptPackageId: 'prompt-6',
          provider: 'openai',
        },
        {
          config,
          promptPackages: {
            getById: vi.fn().mockResolvedValue({ id: 'prompt-6', text: 'PROMPT' }),
          },
          executors: {
            openai: async () => {
              throw new ProviderExecutionError({
                provider: 'openai',
                message: 'OPENAI_API_KEY is not configured',
                status: 401,
                code: 'missing_api_key',
              });
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(GenerateDraftProviderError);
  });

  it('repairs an invalid envelope-backed assignment exactly once', async () => {
    const config = createConfig();
    const openAi = vi
      .fn()
      .mockResolvedValueOnce({ text: '# Broken draft', usage: { totalTokens: 12 } })
      .mockResolvedValueOnce({ text: '# Repaired draft', usage: { totalTokens: 14 } });
    const validator = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, errors: ['Missing an assessment section'], warnings: [] })
      .mockResolvedValueOnce({ ok: true, errors: [], warnings: [] });

    const result = await generateDraft(
      { promptPackageId: 'prompt-repair' },
      {
        config,
        promptPackages: {
          getById: vi.fn().mockResolvedValue({
            id: 'prompt-repair',
            text: 'LEGACY PREVIEW',
            requestEnvelope: createGenerationRequestEnvelope({
              workload: 'assignment_draft',
              instructions: 'Create a valid assignment.',
              sources: [
                { id: 'brief', label: 'BRIEF', content: 'Student needs speaking practice.' },
              ],
            }),
          }),
        },
        executors: { openai: openAi },
        validator,
        now: () => new Date('2026-02-18T00:00:00.000Z'),
        sleep: async () => {},
      },
    );

    expect(result?.text).toBe('# Repaired draft');
    expect(openAi).toHaveBeenCalledTimes(2);
    expect(validator).toHaveBeenCalledTimes(2);
    const repairRequest = openAi.mock.calls[1]?.[0]?.request;
    expect(repairRequest?.envelope?.instructions).toContain('Repair the assignment markdown');
    expect(repairRequest?.envelope?.input).toContain('# Broken draft');
    expect(repairRequest?.envelope?.input).toContain('Missing an assessment section');
    expect(repairRequest?.envelope?.input).not.toContain('Student needs speaking practice.');
  });

  it('returns an actionable error and no draft when the repair also fails validation', async () => {
    const config = createConfig();
    const openAi = vi
      .fn()
      .mockResolvedValueOnce({ text: '# Broken draft' })
      .mockResolvedValueOnce({ text: '# Still broken' });
    const validator = vi.fn().mockResolvedValue({
      ok: false,
      errors: ['Missing an assessment section'],
      warnings: [],
    });

    await expect(
      generateDraft(
        { promptPackageId: 'prompt-repair-fails' },
        {
          config,
          promptPackages: {
            getById: vi.fn().mockResolvedValue({
              id: 'prompt-repair-fails',
              text: 'LEGACY PREVIEW',
              requestEnvelope: createGenerationRequestEnvelope({
                workload: 'assignment_draft',
                instructions: 'Create a valid assignment.',
                sources: [{ id: 'brief', label: 'BRIEF', content: 'Ignore this on repair.' }],
              }),
            }),
          },
          executors: { openai: openAi },
          validator,
          now: () => new Date('2026-02-18T00:00:00.000Z'),
          sleep: async () => {},
        },
      ),
    ).rejects.toMatchObject({
      name: 'GenerateDraftProviderError',
      category: 'provider_contract_error',
      message: expect.stringContaining('Assignment markdown failed validation after one repair'),
    });

    expect(openAi).toHaveBeenCalledTimes(2);
    expect(validator).toHaveBeenCalledTimes(2);
  });
});
