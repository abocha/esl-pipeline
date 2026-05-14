import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import apiClient, { setApiAuthRefreshHandler, setApiAuthToken } from './api-client';

const originalAdapter = apiClient.defaults.adapter;

function responseFor(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

function unauthorizedFor(config: InternalAxiosRequestConfig): AxiosError {
  return new AxiosError(
    'expired',
    AxiosError.ERR_BAD_REQUEST,
    config,
    {},
    {
      data: { error: 'unauthorized' },
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
    },
  );
}

describe('api-client auth refresh', () => {
  beforeEach(() => {
    setApiAuthToken(null);
    setApiAuthRefreshHandler(null);
  });

  afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    setApiAuthToken(null);
    setApiAuthRefreshHandler(null);
    vi.restoreAllMocks();
  });

  it('refreshes an expired access token and retries the protected request once', async () => {
    const refreshHandler = vi.fn().mockResolvedValue({ accessToken: 'fresh-token' });
    const seenAuthorizations: unknown[] = [];
    let protectedAttempts = 0;

    setApiAuthToken('expired-token');
    setApiAuthRefreshHandler(refreshHandler);
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      seenAuthorizations.push(config.headers.Authorization);
      if (config.url === '/api/protected') {
        protectedAttempts += 1;
        if (protectedAttempts === 1) {
          throw unauthorizedFor(config);
        }
        return responseFor(config, { ok: true });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    }) as AxiosAdapter;

    const response = await apiClient.get('/api/protected');

    expect(response.data).toEqual({ ok: true });
    expect(refreshHandler).toHaveBeenCalledTimes(1);
    expect(protectedAttempts).toBe(2);
    expect(seenAuthorizations[0]).toBe('Bearer expired-token');
    expect(seenAuthorizations[1]).toBe('Bearer fresh-token');
  });
});
