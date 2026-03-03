import type { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  __esModule: true,
  default: {
    post: vi.fn(),
  },
  buildApiProxyPath: vi.fn((path: string) => `/api${path}`),
  getApiAuthToken: vi.fn(() => null),
  handleApiError: vi.fn((error: { response?: { status?: number } }) => {
    const status = error.response?.status ?? 0;
    return `HTTP ${status}`;
  }),
  isAuthError: vi.fn(
    (error: { response?: { status?: number } }) =>
      error.response?.status === 401 || error.response?.status === 403,
  ),
}));

import apiClient, {
  buildApiProxyPath,
  handleApiError,
  isAuthError,
} from './api-client';
import { GenerationDraftApiError, generateDraft } from './api';

function makeAxiosError(args: {
  status?: number;
  data?: unknown;
  message?: string;
  request?: unknown;
}): AxiosError {
  return {
    name: 'AxiosError',
    message: args.message ?? 'request failed',
    isAxiosError: true,
    config: {} as AxiosError['config'],
    response:
      args.status === undefined
        ? undefined
        : ({
            status: args.status,
            statusText: String(args.status),
            headers: {},
            config: {},
            data: args.data,
          } as AxiosError['response']),
    request: args.request,
    toJSON: () => ({}),
  } as AxiosError;
}

describe('utils/api generateDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to /generation/drafts and returns typed response payload', async () => {
    const response = {
      text: '# Generated draft',
      provider: 'openai',
      model: 'gpt-5.2',
      quota: {
        source: 'hybrid',
        lastUpdatedAt: '2026-02-18T00:00:00.000Z',
      },
    };
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: response } as never);

    const result = await generateDraft({ promptPackageId: 'pkg-1' });

    expect(buildApiProxyPath).toHaveBeenCalledWith('/generation/drafts');
    expect(apiClient.post).toHaveBeenCalledWith('/api/generation/drafts', {
      promptPackageId: 'pkg-1',
    }, {
      timeout: 240000,
    });
    expect(result).toEqual(response);
  });

  it('maps auth errors to a login-required message', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      makeAxiosError({
        status: 401,
        data: { error: 'unauthorized', message: 'Unauthorized' },
      }),
    );

    await expect(generateDraft({ promptPackageId: 'pkg-1' })).rejects.toThrow(
      'Authentication required. Please login to generate drafts.',
    );
    expect(isAuthError).toHaveBeenCalledTimes(1);
  });

  it('throws a typed rate-limit error with normalized fields', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      makeAxiosError({
        status: 429,
        data: {
          error: 'internal_error',
          code: 'provider_rate_limit',
          message: 'Rate limit reached',
          provider: 'openai',
          model: 'gpt-5.2',
          requestId: 'req-1',
          timestamp: '2026-02-18T12:00:00.000Z',
        },
      }),
    );

    await expect(generateDraft({ promptPackageId: 'pkg-1' })).rejects.toMatchObject({
      name: 'GenerationDraftApiError',
      message: 'Rate limit reached',
      status: 429,
      code: 'provider_rate_limit',
      provider: 'openai',
      model: 'gpt-5.2',
      requestId: 'req-1',
      timestamp: '2026-02-18T12:00:00.000Z',
    });
  });

  it('throws a typed timeout error', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      makeAxiosError({
        status: 504,
        data: {
          error: 'internal_error',
          code: 'provider_timeout',
          message: 'Provider timed out',
          provider: 'google_ai_studio',
          model: 'gemini-3-flash-preview',
        },
      }),
    );

    await expect(generateDraft({ promptPackageId: 'pkg-1' })).rejects.toMatchObject({
      name: 'GenerationDraftApiError',
      message: 'Provider timed out',
      status: 504,
      code: 'provider_timeout',
      provider: 'google_ai_studio',
      model: 'gemini-3-flash-preview',
    });
  });

  it('throws a typed provider contract error', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      makeAxiosError({
        status: 502,
        data: {
          error: 'internal_error',
          code: 'provider_contract_error',
          message: 'Provider contract mismatch',
          provider: 'openrouter',
          model: 'anthropic/claude-sonnet-4',
        },
      }),
    );

    await expect(generateDraft({ promptPackageId: 'pkg-1' })).rejects.toMatchObject({
      name: 'GenerationDraftApiError',
      message: 'Provider contract mismatch',
      status: 502,
      code: 'provider_contract_error',
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
    });
  });

  it('throws a typed budget-exceeded error with limit details', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      makeAxiosError({
        status: 429,
        data: {
          error: 'internal_error',
          code: 'budget_exceeded',
          message: 'Generation blocked by daily_tokens safety limit (120000/120000).',
          provider: 'openai',
          model: 'gpt-5.2',
          limitType: 'daily_tokens',
          limit: 120000,
          used: 120000,
          window: 'day',
        },
      }),
    );

    await expect(generateDraft({ promptPackageId: 'pkg-1' })).rejects.toMatchObject({
      name: 'GenerationDraftApiError',
      status: 429,
      code: 'budget_exceeded',
      provider: 'openai',
      model: 'gpt-5.2',
      limitType: 'daily_tokens',
      limit: 120000,
      used: 120000,
      window: 'day',
    });
  });

  it('uses handleApiError as a fallback message for 404 envelopes without message', async () => {
    vi.mocked(handleApiError).mockReturnValueOnce('Prompt package not found');
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      makeAxiosError({
        status: 404,
        data: { error: 'not_found' },
      }),
    );

    await expect(generateDraft({ promptPackageId: 'pkg-missing' })).rejects.toMatchObject({
      name: 'GenerationDraftApiError',
      message: 'Prompt package not found',
      status: 404,
    });
  });

  it('falls back to generic API error handling for unknown/non-normalized failures', async () => {
    vi.mocked(handleApiError).mockReturnValueOnce('Upstream unavailable');
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      makeAxiosError({
        status: 503,
        data: { error: 'service_unavailable', message: 'Service unavailable' },
      }),
    );

    const thrown = await generateDraft({ promptPackageId: 'pkg-1' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(GenerationDraftApiError);
    expect((thrown as Error).message).toBe('Upstream unavailable');
  });
});
