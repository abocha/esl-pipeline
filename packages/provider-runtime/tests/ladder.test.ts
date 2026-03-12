import { describe, expect, it, vi } from 'vitest';

import { runProviderFallbackLadder } from '../src/ladder.js';

interface Candidate {
  id: string;
}

interface MappedError {
  category: 'provider_rate_limit' | 'provider_timeout' | 'provider_contract_error';
  message: string;
}

describe('runProviderFallbackLadder', () => {
  it('retries timeout errors for the same candidate before succeeding', async () => {
    const sleep = vi.fn(async () => {});
    const runCandidate = vi
      .fn<(_candidate: Candidate) => Promise<string>>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('ok');

    const result = await runProviderFallbackLadder<Candidate, string, MappedError>({
      candidates: [{ id: 'openai' }],
      runCandidate,
      mapError: () => ({ category: 'provider_timeout', message: 'timeout' }),
      isTimeoutError: (error) => error.category === 'provider_timeout',
      isFailFastError: (error) => error.category === 'provider_contract_error',
      getRetryMax: () => 1,
      getRetryBackoffMs: () => 10,
      sleep,
    });

    expect(result).toBe('ok');
    expect(runCandidate).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('falls back to next candidate for recoverable non-timeout errors', async () => {
    const runCandidate = vi
      .fn<(_candidate: Candidate) => Promise<string>>()
      .mockRejectedValueOnce(new Error('rate limit'))
      .mockResolvedValueOnce('fallback-ok');

    const result = await runProviderFallbackLadder<Candidate, string, MappedError>({
      candidates: [{ id: 'openai' }, { id: 'google' }],
      runCandidate,
      mapError: () => ({ category: 'provider_rate_limit', message: 'rate limit' }),
      isTimeoutError: (error) => error.category === 'provider_timeout',
      isFailFastError: (error) => error.category === 'provider_contract_error',
      getRetryMax: () => 0,
      getRetryBackoffMs: () => 0,
      sleep: async () => {},
    });

    expect(result).toBe('fallback-ok');
    expect(runCandidate).toHaveBeenCalledTimes(2);
  });

  it('fails fast on contract errors', async () => {
    const runCandidate = vi
      .fn<(_candidate: Candidate) => Promise<string>>()
      .mockRejectedValue(new Error('contract'));

    await expect(
      runProviderFallbackLadder<Candidate, string, MappedError>({
        candidates: [{ id: 'openai' }, { id: 'google' }],
        runCandidate,
        mapError: () => ({ category: 'provider_contract_error', message: 'contract' }),
        isTimeoutError: (error) => error.category === 'provider_timeout',
        isFailFastError: (error) => error.category === 'provider_contract_error',
        getRetryMax: () => 1,
        getRetryBackoffMs: () => 0,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ category: 'provider_contract_error' });

    expect(runCandidate).toHaveBeenCalledTimes(1);
  });

  it('throws the last fallback error when all candidates fail recoverably', async () => {
    const runCandidate = vi
      .fn<(_candidate: Candidate) => Promise<string>>()
      .mockRejectedValue(new Error('timeout'));

    await expect(
      runProviderFallbackLadder<Candidate, string, MappedError>({
        candidates: [{ id: 'openai' }, { id: 'google' }],
        runCandidate,
        mapError: (candidate) => ({
          category: candidate.id === 'openai' ? 'provider_timeout' : 'provider_rate_limit',
          message: candidate.id,
        }),
        isTimeoutError: (error) => error.category === 'provider_timeout',
        isFailFastError: (error) => error.category === 'provider_contract_error',
        getRetryMax: () => 0,
        getRetryBackoffMs: () => 0,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ category: 'provider_rate_limit', message: 'google' });
  });
});
