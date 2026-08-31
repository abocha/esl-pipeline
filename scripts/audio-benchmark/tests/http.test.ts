import { describe, expect, test, vi } from 'vitest';

import { BenchmarkHttpError, executeHttpRequest } from '../http';

describe('benchmark HTTP safety', () => {
  test('does not invoke transport when the provider credential is absent', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      executeHttpRequest(
        { method: 'GET', url: 'https://example.test', credentialEnv: 'MISTRAL_API_KEY' },
        {},
        fetchImpl,
      ),
    ).rejects.toMatchObject({
      name: 'BenchmarkHttpError',
      outcome: 'failed',
      category: 'missing_credential',
    } satisfies Partial<BenchmarkHttpError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('classifies a transport exception as uncertain instead of retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('connection reset'));
    await expect(
      executeHttpRequest(
        { method: 'GET', url: 'https://example.test', credentialEnv: 'MISTRAL_API_KEY' },
        { MISTRAL_API_KEY: 'test-secret' },
        fetchImpl,
      ),
    ).rejects.toMatchObject({
      outcome: 'uncertain',
      category: 'transport_uncertain',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('classifies a paid POST 5xx as uncertain', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"error":"temporary"}', { status: 503 }));
    await expect(
      executeHttpRequest(
        {
          method: 'POST',
          url: 'https://example.test',
          credentialEnv: 'MISTRAL_API_KEY',
          requestRisk: 'paid',
        },
        { MISTRAL_API_KEY: 'test-secret' },
        fetchImpl,
      ),
    ).resolves.toMatchObject({ status: 503 });
  });
});
