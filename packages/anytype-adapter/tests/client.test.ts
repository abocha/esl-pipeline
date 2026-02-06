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
    });

    await expect(client.listSpaces()).rejects.toThrow(/Anytype API Error/);
  });
});
