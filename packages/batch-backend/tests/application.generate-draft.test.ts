import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAssignmentToPmd } from '@esl-pipeline/html-publisher';

import { GenerateDraftProviderError, generateDraft } from '../src/application/generate-draft.js';
import { ProviderExecutionError } from '../src/application/generation-providers.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';
import { assignmentFixture, promptPackageFixture } from './assignment-v1.test-harness.js';

function createConfig(
  overrides: Partial<BatchBackendConfig['generation']> = {},
): BatchBackendConfig {
  const base = loadConfig();
  return {
    ...base,
    generation: {
      ...base.generation,
      targets: {
        ...base.generation.targets,
        draft_generation: { provider: 'openai', model: 'gpt-6.1-sol' },
      },
      quotaSourceMode: 'hybrid',
      safetyMode: 'hard_stop',

      maxOutputTokensHard: 1200,

      models: {
        openai: {
          model: 'gpt-6.1-sol',

          allowed: ['gpt-6.1-sol', 'gpt-5-mini'],
        },
        googleAiStudio: {
          model: 'gemini-3-flash-preview',

          allowed: [
            'gemini-3-flash-preview',
            'gemini-2.5-flash-lite',
            'gemini-2.5-pro',
            'gemini-custom-001',
          ],
        },
        openrouter: {
          model: 'openrouter/test-primary',

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

  it('rechecks assignment ownership when an earlier prompt package is used for fresh generation', async () => {
    let canonical = false;
    const execute = vi.fn().mockResolvedValue({ rawText: JSON.stringify(assignmentFixture()) });
    const dependencies = {
      config: createConfig(),
      promptPackages: {
        getById: vi.fn().mockResolvedValue(promptPackageFixture()),
        isSourceCanonical: vi.fn().mockImplementation(async () => canonical),
      },
      executors: { openai: execute },
      now: () => new Date('2026-02-18T00:00:00.000Z'),
    };
    await expect(
      generateDraft({ promptPackageId: 'old-assignment-package' }, dependencies),
    ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL' });
    expect(execute).not.toHaveBeenCalled();

    canonical = true;
    await expect(
      generateDraft({ promptPackageId: 'old-assignment-package' }, dependencies),
    ).resolves.toMatchObject({ text: renderAssignmentToPmd(assignmentFixture()) });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns generated text from first provider candidate', async () => {
    const config = createConfig();
    const openAi = vi.fn().mockResolvedValue({
      rawText: JSON.stringify(assignmentFixture()),
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
          isSourceCanonical: async () => true,
          getById: vi.fn().mockResolvedValue(promptPackageFixture()),
        },
        executors: {
          openai: openAi,
          google_ai_studio: vi.fn(),
          openrouter: vi.fn(),
        },
        now: () => new Date('2026-02-18T00:00:00.000Z'),
      },
    );

    expect(result).toMatchObject({
      text: renderAssignmentToPmd(assignmentFixture()),
      provider: 'openai',
      model: 'gpt-6.1-sol',
      providerRequestId: 'resp-1',
      usage: { totalTokens: 36 },
      quota: {
        source: 'hybrid',
        lastUpdatedAt: '2026-02-18T00:00:00.000Z',
      },
    });
    expect(openAi).toHaveBeenCalledTimes(1);
  });

  it('fails explicitly without switching target on provider_timeout', async () => {
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

    await expect(
      generateDraft(
        {
          promptPackageId: 'prompt-2',
        },
        {
          config,
          promptPackages: {
            isSourceCanonical: async () => true,
            getById: vi.fn().mockResolvedValue(promptPackageFixture()),
          },
          executors: {
            openai: openAi,
            google_ai_studio: google,
            openrouter: vi.fn(),
          },
          now: () => new Date('2026-02-18T00:00:00.000Z'),
        },
      ),
    ).rejects.toMatchObject({
      category: 'provider_timeout',
      provider: 'openai',
      model: 'gpt-6.1-sol',
    });

    expect(openAi).toHaveBeenCalledTimes(1);
    expect(openAi.mock.calls[0]?.[0].request.model).toBe('gpt-6.1-sol');
    expect(google).not.toHaveBeenCalled();
  });

  it('fails explicitly without switching target on provider_rate_limit', async () => {
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

    await expect(
      generateDraft(
        {
          promptPackageId: 'prompt-3',
        },
        {
          config,
          promptPackages: {
            isSourceCanonical: async () => true,
            getById: vi.fn().mockResolvedValue(promptPackageFixture()),
          },
          executors: {
            openai: openAi,
            google_ai_studio: google,
            openrouter: vi.fn(),
          },
          now: () => new Date('2026-02-18T00:00:00.000Z'),
        },
      ),
    ).rejects.toMatchObject({
      category: 'provider_rate_limit',
      provider: 'openai',
      model: 'gpt-6.1-sol',
    });

    expect(openAi).toHaveBeenCalledTimes(1);
    expect(openAi.mock.calls[0]?.[0].request.model).toBe('gpt-6.1-sol');
    expect(google).not.toHaveBeenCalled();
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
            isSourceCanonical: async () => true,
            getById: vi.fn().mockResolvedValue(promptPackageFixture()),
          },
          executors: {
            openai: openAi,
            google_ai_studio: google,
            openrouter: vi.fn(),
          },
        },
      ),
    ).rejects.toMatchObject({
      name: 'GenerateDraftProviderError',
      category: 'provider_contract_error',
      statusCode: 502,
      provider: 'openai',
      model: 'gpt-6.1-sol',
    });
    expect(google).not.toHaveBeenCalled();
  });

  it('rejects unsupported assignment provider/model overrides before dispatch', async () => {
    const execute = vi.fn();
    for (const target of [
      { provider: 'google_ai_studio' as const, model: 'gemini-custom-001' },
      { provider: 'openai' as const, model: 'gpt-5-mini' },
    ]) {
      await expect(
        generateDraft(
          { promptPackageId: 'prompt-1', ...target },
          {
            config: createConfig(),
            promptPackages: {
              isSourceCanonical: async () => true,
              getById: vi.fn().mockResolvedValue(promptPackageFixture()),
            },
            executors: { openai: execute, google_ai_studio: execute },
          },
        ),
      ).rejects.toMatchObject({ category: 'provider_contract_error' });
    }
    expect(execute).not.toHaveBeenCalled();
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
          isSourceCanonical: async () => true,
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
            isSourceCanonical: async () => true,
            getById: vi.fn().mockResolvedValue(promptPackageFixture()),
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
            isSourceCanonical: async () => true,
            getById: vi.fn().mockResolvedValue(promptPackageFixture()),
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

  it('rejects old or mismatched prompt contracts with an actionable recreate error before dispatch', async () => {
    const execute = vi.fn();
    const old = promptPackageFixture();
    old.requestEnvelope.promptVersion = 'legacy';
    await expect(
      generateDraft(
        { promptPackageId: 'old' },
        {
          config: createConfig(),
          promptPackages: {
            isSourceCanonical: async () => true,
            getById: vi.fn().mockResolvedValue(old),
          },
          executors: { openai: execute },
        },
      ),
    ).rejects.toMatchObject({
      code: 'PROMPT_PACKAGE_OUTPUT_CONTRACT_UNSUPPORTED',
      message: expect.stringContaining('recreate'),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    'prefixed JSON',
    'invalid JSON',
    'invalid references',
    'wrong learner',
    'refusal',
    'incomplete',
  ])('rejects %s once, records usage and retains provider metadata', async (reason) => {
    const output = assignmentFixture();
    if (reason === 'invalid references') output.input.studyText.turns[0]!.speakerId = 'foreign';
    if (reason === 'wrong learner') output.metadata.student = 'Other learner';
    const executor = vi.fn().mockResolvedValue({
      rawText:
        reason === 'prefixed JSON'
          ? 'Here is JSON: ' + JSON.stringify(output)
          : reason === 'invalid JSON'
            ? '{broken'
            : JSON.stringify(output),
      ...(reason === 'refusal' || reason === 'incomplete' ? { contractError: reason } : {}),
      usage: { totalTokens: 36 },
      providerRequestId: 'resp-1',
      finishReason: reason === 'incomplete' ? 'incomplete:max_output_tokens' : 'completed',
    });
    const recordActual = vi.fn();
    const repository = {
      reserve: vi.fn().mockResolvedValue({ allowed: true, usage: {} }),
      recordActual,
      getUsage: vi.fn().mockResolvedValue({}),
    };
    await expect(
      generateDraft(
        { promptPackageId: 'prompt-1' },
        {
          config: createConfig(),
          promptPackages: {
            isSourceCanonical: async () => true,
            getById: vi.fn().mockResolvedValue(promptPackageFixture()),
          },
          executors: { openai: executor },
          budget: { repository },
        },
      ),
    ).rejects.toMatchObject({
      category: 'provider_contract_error',
      providerRequestId: 'resp-1',
      usage: { totalTokens: 36 },
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(recordActual).toHaveBeenCalledWith(expect.objectContaining({ actualTokens: 36 }));
  });
});
