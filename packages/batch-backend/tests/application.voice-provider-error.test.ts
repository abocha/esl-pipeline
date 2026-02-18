import { describe, expect, it } from 'vitest';

import {
  buildVoiceProviderErrorBreakdown,
  countVoiceProviderErrors,
  parseVoiceProviderError,
  parseVoiceProviderErrors,
} from '../src/application/voice-provider-error.js';

describe('application/voice-provider-error', () => {
  it('parses tagged provider errors with status and actionable hint', () => {
    const detail = parseVoiceProviderError(
      'Text-to-Dialogue synthesis failed [provider_rate_limit]: HTTP 429: too many requests',
    );

    expect(detail).toEqual({
      category: 'provider_rate_limit',
      message:
        'Text-to-Dialogue synthesis failed [provider_rate_limit]: HTTP 429: too many requests',
      providerStatus: 429,
      actionableHint: 'Retry later or reduce request concurrency/chunk size.',
    });
  });

  it('infers categories for untagged provider failures', () => {
    expect(
      parseVoiceProviderError('Voice generation timed out while calling provider for this lesson'),
    ).toEqual(
      expect.objectContaining({
        category: 'provider_timeout',
      }),
    );

    expect(parseVoiceProviderError('Invalid voice selected for this speaker profile')).toEqual(
      expect.objectContaining({
        category: 'invalid_voice_id',
      }),
    );
  });

  it('infers categories from provider HTTP status codes for untagged errors', () => {
    expect(parseVoiceProviderError('Provider call failed with HTTP 429')).toEqual(
      expect.objectContaining({
        category: 'provider_rate_limit',
        providerStatus: 429,
      }),
    );

    expect(parseVoiceProviderError('Provider call failed with HTTP 503')).toEqual(
      expect.objectContaining({
        category: 'provider_timeout',
        providerStatus: 503,
      }),
    );

    expect(parseVoiceProviderError('Provider call failed with HTTP 422')).toEqual(
      expect.objectContaining({
        category: 'provider_contract_error',
        providerStatus: 422,
      }),
    );
  });

  it('does not classify non-provider HTTP status failures as voice provider errors', () => {
    expect(parseVoiceProviderError('Notion API failed with HTTP 429: too many requests')).toBeNull();
    expect(parseVoiceProviderError('S3 upload failed with HTTP 503: service unavailable')).toBeNull();
    expect(parseVoiceProviderError('Auth middleware rejected request with HTTP 422')).toBeNull();
  });

  it('returns null for unknown or non-provider errors', () => {
    expect(parseVoiceProviderError('frontmatter validation failed: missing title')).toBeNull();
    expect(parseVoiceProviderError('')).toBeNull();
    expect(parseVoiceProviderError(null)).toBeNull();
  });

  it('builds normalized lists, totals, and breakdown counts', () => {
    const details = parseVoiceProviderErrors([
      'Text-to-Dialogue synthesis failed [provider_rate_limit]: HTTP 429',
      'Provider timed out while generating dialogue audio',
      'frontmatter validation failed: missing title',
      null,
      undefined,
    ]);

    expect(countVoiceProviderErrors(details)).toBe(2);
    expect(buildVoiceProviderErrorBreakdown(details)).toEqual({
      provider_rate_limit: 1,
      provider_timeout: 1,
    });
  });
});
