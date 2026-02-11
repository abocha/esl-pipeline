import { describe, expect, it } from 'vitest';

import { evaluateVoiceAlignmentGates } from '../src/application/voice-alignment-gates.js';

describe('application/voice-alignment-gates', () => {
  it('passes all gates when metrics satisfy thresholds', () => {
    const result = evaluateVoiceAlignmentGates({
      schemaValidRate: 0.992,
      baselineFallbackRate: 0.4,
      readiness: {
        window: {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-01-08T00:00:00.000Z',
        },
        publishSuccess: {
          succeeded: 10,
          failed: 1,
          total: 11,
          rate: 0.9091,
        },
        publishLatencyMs: {
          median: 1234,
          sampleSize: 9,
        },
        firstSessionSuccessProxy: {
          successfulUsers: 5,
          totalUsers: 6,
          rate: 0.8333,
        },
        voiceAlignment: {
          validationFailures: 1,
          strictMismatches: 0,
          providerErrors: 0,
          providerErrorBreakdown: {
            provider_contract_error: 0,
          },
          fallbackSelections: 2,
          reuseSelections: 8,
        },
        sources: {
          publishSuccessRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          medianPublishLatencyMs: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          firstSessionSuccessProxy: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          voiceValidationFailureRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          voiceStrictMismatchRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          voiceFallbackRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          voiceProviderErrorRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks.every((check) => check.status !== 'failed')).toBe(true);
  });

  it('fails provider contract error regression check when contract errors are present', () => {
    const result = evaluateVoiceAlignmentGates({
      readiness: {
        window: {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-01-08T00:00:00.000Z',
        },
        publishSuccess: {
          succeeded: 0,
          failed: 0,
          total: 0,
          rate: null,
        },
        publishLatencyMs: {
          median: null,
          sampleSize: 0,
        },
        firstSessionSuccessProxy: {
          successfulUsers: 0,
          totalUsers: 0,
          rate: null,
        },
        voiceAlignment: {
          validationFailures: 0,
          strictMismatches: 0,
          providerErrors: 1,
          providerErrorBreakdown: {
            provider_contract_error: 1,
          },
          fallbackSelections: null,
          reuseSelections: null,
        },
        sources: {
          publishSuccessRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          medianPublishLatencyMs: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          firstSessionSuccessProxy: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          voiceValidationFailureRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          voiceStrictMismatchRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          voiceFallbackRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
          voiceProviderErrorRate: {
            source: 'jobs',
            window: '7d',
            calculation: 'x',
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(
      result.checks.find((check) => check.name === 'provider_contract_error_zero_regression')
        ?.status,
    ).toBe('failed');
  });
});
