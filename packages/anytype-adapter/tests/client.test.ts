import { describe, expect, it, vi } from 'vitest';

import { ConfigurationError } from '@esl-pipeline/contracts';

import { AnytypeClient, createAnytypeClient } from '../src/client.js';

const buildResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const buildErrorResponse = () => ({
  ok: false,
  status: 401,
  statusText: 'Unauthorized',
  json: async () => ({ error: 'unauthorized' }),
  text: async () => 'unauthorized',
});

describe('anytype client', () => {
  it('throws when ANYTYPE_TOKEN is missing', () => {
    const current = process.env.ANYTYPE_TOKEN;
    delete process.env.ANYTYPE_TOKEN;
    expect(() => createAnytypeClient()).toThrow(ConfigurationError);
    if (current) process.env.ANYTYPE_TOKEN = current;
  });

  it('sends auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildResponse([{ id: 'space-1', name: 'Main' }]));
    const client = new AnytypeClient({
      auth: 'token-123',
      baseUrl: 'http://localhost:31009/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.listSpaces();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:31009/v1/spaces',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'Anytype-Version': '2025-11-08',
        }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildErrorResponse());
    const client = new AnytypeClient({
      auth: 'token-123',
      baseUrl: 'http://localhost:31009/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryBaseDelayMs: 0,
    });

    await expect(client.listSpaces()).rejects.toThrow(/Anytype API Error/);
  });

  it('retries transient fetch failures and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(buildResponse([{ id: 'space-1', name: 'Main' }]));
    const client = new AnytypeClient({
      auth: 'token-123',
      baseUrl: 'http://localhost:31009/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryBaseDelayMs: 0,
    });

    const spaces = await client.listSpaces();

    expect(spaces).toEqual([{ id: 'space-1', name: 'Main' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries retryable api status and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ error: 'service unavailable' }),
        text: async () => 'service unavailable',
      })
      .mockResolvedValueOnce(buildResponse([{ id: 'space-2', name: 'Backup' }]));
    const client = new AnytypeClient({
      auth: 'token-123',
      baseUrl: 'http://localhost:31009/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryBaseDelayMs: 0,
    });

    const spaces = await client.listSpaces();

    expect(spaces).toEqual([{ id: 'space-2', name: 'Backup' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a friendly Anytype unreachable error after transport retries', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = new AnytypeClient({
      auth: 'token-123',
      baseUrl: 'http://localhost:31009/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryBaseDelayMs: 0,
      maxRetries: 1,
    });

    await expect(client.listSpaces()).rejects.toThrow(/Anytype server unreachable/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
