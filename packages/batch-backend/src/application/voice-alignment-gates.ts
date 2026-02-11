import type { ReadinessMetricsResponse } from '@esl-pipeline/contracts';

export interface VoiceAlignmentGateInput {
  readiness: ReadinessMetricsResponse;
  schemaValidRate?: number | null;
  baselineFallbackRate?: number | null;
  minSchemaValidRate?: number;
}

export type VoiceAlignmentGateName =
  | 'schema_valid_rate'
  | 'provider_contract_error_zero_regression'
  | 'fallback_rate_reduction';

export interface VoiceAlignmentGateResult {
  name: VoiceAlignmentGateName;
  status: 'passed' | 'failed' | 'skipped';
  actual: number | null;
  target: string;
}

export interface VoiceAlignmentGateSummary {
  ok: boolean;
  checks: VoiceAlignmentGateResult[];
}

const DEFAULT_MIN_SCHEMA_VALID_RATE = 0.99;

export function evaluateVoiceAlignmentGates(
  input: VoiceAlignmentGateInput,
): VoiceAlignmentGateSummary {
  const minSchemaValidRate = input.minSchemaValidRate ?? DEFAULT_MIN_SCHEMA_VALID_RATE;
  const checks: VoiceAlignmentGateResult[] = [
    checkSchemaValidRate(input.schemaValidRate, minSchemaValidRate),
    checkProviderContractErrorRegression(input.readiness),
    checkFallbackRateReduction(input.readiness, input.baselineFallbackRate ?? null),
  ];

  const ok = checks.every((check) => check.status !== 'failed');
  return { ok, checks };
}

function checkSchemaValidRate(
  schemaValidRate: number | null | undefined,
  minSchemaValidRate: number,
): VoiceAlignmentGateResult {
  if (schemaValidRate == null) {
    return {
      name: 'schema_valid_rate',
      status: 'skipped',
      actual: null,
      target: `>= ${minSchemaValidRate}`,
    };
  }
  return {
    name: 'schema_valid_rate',
    status: schemaValidRate >= minSchemaValidRate ? 'passed' : 'failed',
    actual: schemaValidRate,
    target: `>= ${minSchemaValidRate}`,
  };
}

function checkProviderContractErrorRegression(
  readiness: ReadinessMetricsResponse,
): VoiceAlignmentGateResult {
  const providerContractErrors =
    readiness.voiceAlignment?.providerErrorBreakdown?.provider_contract_error ?? 0;
  return {
    name: 'provider_contract_error_zero_regression',
    status: providerContractErrors === 0 ? 'passed' : 'failed',
    actual: providerContractErrors,
    target: '= 0',
  };
}

function checkFallbackRateReduction(
  readiness: ReadinessMetricsResponse,
  baselineFallbackRate: number | null,
): VoiceAlignmentGateResult {
  const fallbackSelections = readiness.voiceAlignment?.fallbackSelections;
  const reuseSelections = readiness.voiceAlignment?.reuseSelections;
  const currentFallbackRate = computeFallbackRate(fallbackSelections, reuseSelections);

  if (baselineFallbackRate == null || currentFallbackRate == null) {
    return {
      name: 'fallback_rate_reduction',
      status: 'skipped',
      actual: currentFallbackRate,
      target: baselineFallbackRate == null ? '< baseline (missing baseline)' : '< baseline',
    };
  }

  return {
    name: 'fallback_rate_reduction',
    status: currentFallbackRate < baselineFallbackRate ? 'passed' : 'failed',
    actual: currentFallbackRate,
    target: `< ${baselineFallbackRate}`,
  };
}

function computeFallbackRate(
  fallbackSelections: number | null | undefined,
  reuseSelections: number | null | undefined,
): number | null {
  if (fallbackSelections == null || reuseSelections == null) return null;
  const denominator = fallbackSelections + reuseSelections;
  if (denominator <= 0) return null;
  return Number((fallbackSelections / denominator).toFixed(4));
}
