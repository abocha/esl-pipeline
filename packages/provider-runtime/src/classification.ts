export type ProviderRuntimeCategory =
  | 'provider_rate_limit'
  | 'provider_timeout'
  | 'provider_contract_error';

export interface ProviderRuntimeProviderRules {
  rateLimitCodes?: readonly string[];
  timeoutStatuses?: readonly number[];
  timeoutStatusMin?: number;
  timeoutCodes?: readonly string[];
}

export interface ProviderRuntimeClassificationRules {
  rateLimitStatuses?: readonly number[];
  timeoutStatuses?: readonly number[];
  timeoutErrorNames?: readonly string[];
  timeoutCodes?: readonly string[];
  timeoutMessageSubstrings?: readonly string[];
  byProvider?: Readonly<Record<string, ProviderRuntimeProviderRules>>;
}

export interface ProviderRuntimeClassificationInput {
  provider: string;
  message: string;
  status?: number;
  code?: string;
  name?: string;
  rules?: ProviderRuntimeClassificationRules;
}

const DEFAULT_RATE_LIMIT_STATUSES = [429] as const;
const DEFAULT_TIMEOUT_STATUSES = [408, 504] as const;
const DEFAULT_TIMEOUT_ERROR_NAMES = ['AbortError'] as const;
const DEFAULT_TIMEOUT_CODES = ['etimedout', 'econnreset'] as const;
const DEFAULT_TIMEOUT_MESSAGE_SUBSTRINGS = [
  'timed out',
  'timeout',
  'econnreset',
  'etimedout',
  'fetch failed',
] as const;

export const DEFAULT_PROVIDER_RUNTIME_CLASSIFICATION_RULES: ProviderRuntimeClassificationRules = {
  rateLimitStatuses: DEFAULT_RATE_LIMIT_STATUSES,
  timeoutStatuses: DEFAULT_TIMEOUT_STATUSES,
  timeoutErrorNames: DEFAULT_TIMEOUT_ERROR_NAMES,
  timeoutCodes: DEFAULT_TIMEOUT_CODES,
  timeoutMessageSubstrings: DEFAULT_TIMEOUT_MESSAGE_SUBSTRINGS,
};

export function classifyProviderRuntimeFailure(
  input: ProviderRuntimeClassificationInput,
): ProviderRuntimeCategory {
  const rules = mergeRules(DEFAULT_PROVIDER_RUNTIME_CLASSIFICATION_RULES, input.rules);

  const provider = normalize(input.provider);
  const message = normalize(input.message);
  const code = normalize(input.code);
  const name = normalize(input.name);
  const status = input.status;
  const providerRules = provider ? rules.byProvider?.[provider] : undefined;

  if (status !== undefined && includesNumber(rules.rateLimitStatuses, status)) {
    return 'provider_rate_limit';
  }

  if (includesString(providerRules?.rateLimitCodes, code)) {
    return 'provider_rate_limit';
  }

  const hasGenericTimeoutSignal =
    includesString(rules.timeoutErrorNames, name) ||
    includesString(rules.timeoutCodes, code) ||
    includesSubstring(rules.timeoutMessageSubstrings, message);

  if (hasGenericTimeoutSignal) {
    return 'provider_timeout';
  }

  if (status === undefined) {
    return 'provider_contract_error';
  }

  if (includesNumber(rules.timeoutStatuses, status)) {
    return 'provider_timeout';
  }

  if (providerRules) {
    if (
      providerRules.timeoutStatusMin !== undefined &&
      status >= providerRules.timeoutStatusMin
    ) {
      return 'provider_timeout';
    }
    if (includesNumber(providerRules.timeoutStatuses, status)) {
      return 'provider_timeout';
    }
    if (includesString(providerRules.timeoutCodes, code)) {
      return 'provider_timeout';
    }
  }

  return 'provider_contract_error';
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function includesString(values: readonly string[] | undefined, value: string): boolean {
  if (!value || !values || values.length === 0) return false;
  return values.some((candidate) => normalize(candidate) === value);
}

function includesSubstring(values: readonly string[] | undefined, value: string): boolean {
  if (!value || !values || values.length === 0) return false;
  return values.some((candidate) => value.includes(normalize(candidate)));
}

function includesNumber(values: readonly number[] | undefined, value: number): boolean {
  return Boolean(values?.includes(value));
}

function mergeStringList(
  baseValues: readonly string[] | undefined,
  overrideValues: readonly string[] | undefined,
): string[] | undefined {
  if (!baseValues && !overrideValues) return undefined;
  return [...new Set([...(baseValues ?? []), ...(overrideValues ?? [])])];
}

function mergeNumberList(
  baseValues: readonly number[] | undefined,
  overrideValues: readonly number[] | undefined,
): number[] | undefined {
  if (!baseValues && !overrideValues) return undefined;
  return [...new Set([...(baseValues ?? []), ...(overrideValues ?? [])])];
}

function mergeRules(
  baseRules: ProviderRuntimeClassificationRules,
  overrideRules: ProviderRuntimeClassificationRules | undefined,
): ProviderRuntimeClassificationRules {
  if (!overrideRules) return baseRules;

  const mergedByProvider: Record<string, ProviderRuntimeProviderRules> = {};
  if (baseRules.byProvider) {
    Object.assign(mergedByProvider, baseRules.byProvider);
  }

  if (overrideRules.byProvider) {
    for (const [provider, providerRules] of Object.entries(overrideRules.byProvider)) {
      const key = normalize(provider);
      const baseProviderRules = mergedByProvider[key] ?? {};
      mergedByProvider[key] = {
        rateLimitCodes: mergeStringList(baseProviderRules.rateLimitCodes, providerRules.rateLimitCodes),
        timeoutStatuses: mergeNumberList(baseProviderRules.timeoutStatuses, providerRules.timeoutStatuses),
        timeoutStatusMin:
          providerRules.timeoutStatusMin === undefined
            ? baseProviderRules.timeoutStatusMin
            : providerRules.timeoutStatusMin,
        timeoutCodes: mergeStringList(baseProviderRules.timeoutCodes, providerRules.timeoutCodes),
      };
    }
  }

  return {
    rateLimitStatuses: mergeNumberList(baseRules.rateLimitStatuses, overrideRules.rateLimitStatuses),
    timeoutStatuses: mergeNumberList(baseRules.timeoutStatuses, overrideRules.timeoutStatuses),
    timeoutErrorNames: mergeStringList(baseRules.timeoutErrorNames, overrideRules.timeoutErrorNames),
    timeoutCodes: mergeStringList(baseRules.timeoutCodes, overrideRules.timeoutCodes),
    timeoutMessageSubstrings: mergeStringList(
      baseRules.timeoutMessageSubstrings,
      overrideRules.timeoutMessageSubstrings,
    ),
    ...(Object.keys(mergedByProvider).length > 0 ? { byProvider: mergedByProvider } : {}),
  };
}
