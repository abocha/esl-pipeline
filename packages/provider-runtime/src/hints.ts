import type { ProviderRuntimeCategory } from './classification.js';

export const providerRuntimeActionableHints: Record<ProviderRuntimeCategory, string> = {
  provider_rate_limit: 'Retry later or reduce request concurrency/chunk size.',
  provider_timeout: 'Retry with smaller payloads or increased provider timeout settings.',
  provider_contract_error: 'Check request payload shape and provider SDK compatibility.',
};
