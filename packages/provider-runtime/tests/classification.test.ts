import { describe, expect, it } from 'vitest';

import {
  classifyProviderRuntimeFailure,
  type ProviderRuntimeClassificationRules,
} from '../src/classification.js';

const GENERATION_RULES: ProviderRuntimeClassificationRules = {
  byProvider: {
    openai: {
      rateLimitCodes: ['rate_limit_exceeded'],
      timeoutStatusMin: 500,
      timeoutCodes: ['server_error'],
    },
    google_ai_studio: {
      timeoutStatusMin: 500,
    },
    openrouter: {
      timeoutStatuses: [500, 502, 503],
    },
  },
};

describe('classifyProviderRuntimeFailure', () => {
  it('classifies HTTP 429 as provider_rate_limit', () => {
    expect(
      classifyProviderRuntimeFailure({
        provider: 'openai',
        status: 429,
        message: 'rate limit exceeded',
      }),
    ).toBe('provider_rate_limit');
  });

  it('classifies provider-specific rate limit code', () => {
    expect(
      classifyProviderRuntimeFailure({
        provider: 'openai',
        code: 'rate_limit_exceeded',
        message: 'too many requests',
        rules: GENERATION_RULES,
      }),
    ).toBe('provider_rate_limit');
  });

  it('classifies generic timeout signals from message and codes', () => {
    expect(
      classifyProviderRuntimeFailure({
        provider: 'google_ai_studio',
        code: 'ETIMEDOUT',
        message: 'socket ETIMEDOUT',
      }),
    ).toBe('provider_timeout');

    expect(
      classifyProviderRuntimeFailure({
        provider: 'openrouter',
        message: 'fetch failed',
      }),
    ).toBe('provider_timeout');
  });

  it('classifies provider-specific timeout status behavior for generation rules', () => {
    expect(
      classifyProviderRuntimeFailure({
        provider: 'google_ai_studio',
        status: 500,
        message: 'upstream unavailable',
        rules: GENERATION_RULES,
      }),
    ).toBe('provider_timeout');

    expect(
      classifyProviderRuntimeFailure({
        provider: 'openrouter',
        status: 502,
        message: 'bad gateway',
        rules: GENERATION_RULES,
      }),
    ).toBe('provider_timeout');
  });

  it('requires status before provider-specific timeout code rules apply', () => {
    expect(
      classifyProviderRuntimeFailure({
        provider: 'openai',
        code: 'server_error',
        message: 'server_error',
        rules: GENERATION_RULES,
      }),
    ).toBe('provider_contract_error');

    expect(
      classifyProviderRuntimeFailure({
        provider: 'openai',
        status: 400,
        code: 'server_error',
        message: 'server_error',
        rules: GENERATION_RULES,
      }),
    ).toBe('provider_timeout');
  });

  it('falls back to provider_contract_error when no rule matches', () => {
    expect(
      classifyProviderRuntimeFailure({
        provider: 'openai',
        status: 400,
        code: 'invalid_prompt',
        message: 'bad request payload',
        rules: GENERATION_RULES,
      }),
    ).toBe('provider_contract_error');
  });
});
