import type {
  GenerationModelOption,
  GenerationOptionsPayload,
  GenerationProvider,
  GenerationQuotaView,
} from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { GenerationBudgetUsage } from '../domain/generation-budget-repository.js';

export interface GenerationCandidate {
  provider: GenerationProvider;
  model: string;
  fallbackRank: number;
}

const POLICY_PROVIDER_ORDER: readonly GenerationProvider[] = [
  'openai',
  'google_ai_studio',
  'openrouter',
];

const GOOGLE_DASHBOARD_URL = 'https://ai.google.dev/gemini-api/docs/rate-limits';
const OPENAI_DASHBOARD_URL =
  'https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai';
const OPENROUTER_DASHBOARD_URL = 'https://openrouter.ai/docs/models';

function uniqueNonEmpty(values: (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

export function resolveGenerationProviderOrder(
  config: BatchBackendConfig['generation'],
): GenerationProvider[] {
  const ordered = [
    config.defaultProvider,
    ...config.fallbackProviders,
    ...POLICY_PROVIDER_ORDER,
  ] as GenerationProvider[];
  return [...new Set(ordered)];
}

export function getModelLadderForProvider(
  config: BatchBackendConfig['generation'],
  provider: GenerationProvider,
): string[] {
  if (provider === 'openai') {
    return uniqueNonEmpty([
      config.models.openai.primary,
      config.models.openai.fallback,
      ...config.models.openai.allowed,
    ]);
  }
  if (provider === 'google_ai_studio') {
    return uniqueNonEmpty([
      config.models.googleAiStudio.primary,
      config.models.googleAiStudio.fallback,
      config.models.googleAiStudio.tertiary,
      ...config.models.googleAiStudio.allowed,
    ]);
  }
  return uniqueNonEmpty([
    config.models.openrouter.primary,
    config.models.openrouter.fallback,
    ...config.models.openrouter.allowed,
  ]);
}

export function resolveGenerationCandidates(args: {
  config: BatchBackendConfig['generation'];
  providerOverride?: GenerationProvider;
  modelOverride?: string;
}): GenerationCandidate[] {
  const providerOrder = resolveGenerationProviderOrder(args.config);
  const prioritizedProviders = args.providerOverride
    ? [
        args.providerOverride,
        ...providerOrder.filter((provider) => provider !== args.providerOverride),
      ]
    : providerOrder;

  const candidates: GenerationCandidate[] = [];
  let fallbackRank = 0;

  if (args.modelOverride && args.modelOverride.trim().length > 0) {
    const overrideProvider =
      args.providerOverride ?? prioritizedProviders[0] ?? args.config.defaultProvider;
    candidates.push({
      provider: overrideProvider,
      model: args.modelOverride.trim(),
      fallbackRank,
    });
    fallbackRank += 1;
  }

  for (const provider of prioritizedProviders) {
    for (const model of getModelLadderForProvider(args.config, provider)) {
      if (
        candidates.some((candidate) => candidate.provider === provider && candidate.model === model)
      ) {
        continue;
      }
      candidates.push({ provider, model, fallbackRank });
      fallbackRank += 1;
    }
  }

  return candidates;
}

function getGoogleQuotaBaseline(model: string): {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  requestsPerDay?: number;
} {
  if (model === 'gemini-3-flash-preview') {
    return {
      requestsPerMinute: 5,
      tokensPerMinute: 250_000,
      requestsPerDay: 20,
    };
  }
  if (model === 'gemini-2.5-flash-lite') {
    return {
      requestsPerMinute: 10,
      tokensPerMinute: 250_000,
      requestsPerDay: 20,
    };
  }
  if (model === 'gemini-2.5-pro') {
    return {
      requestsPerMinute: 15,
      requestsPerDay: 1_500,
    };
  }
  return {};
}

function getProviderDashboardUrl(provider: GenerationProvider): string {
  if (provider === 'openai') return OPENAI_DASHBOARD_URL;
  if (provider === 'google_ai_studio') return GOOGLE_DASHBOARD_URL;
  return OPENROUTER_DASHBOARD_URL;
}

export function buildQuotaSnapshot(args: {
  config: BatchBackendConfig['generation'];
  provider: GenerationProvider;
  model: string;
  usage?: GenerationBudgetUsage;
  now?: Date;
}): GenerationQuotaView {
  const nowIso = (args.now ?? new Date()).toISOString();
  const usage = args.usage;

  let requestsPerMinute: number | null | undefined;
  let tokensPerMinute: number | null | undefined;
  let requestsPerDay: number | null | undefined;
  let dailyTokenBudget: number | null | undefined;

  if (args.provider === 'openai') {
    requestsPerMinute = args.config.providers.openai.rpmBudget ?? null;
    requestsPerDay = args.config.providers.openai.dailyRequestBudget ?? null;
    dailyTokenBudget = args.config.providers.openai.dailyTokenBudget ?? null;
  } else if (args.provider === 'google_ai_studio') {
    const googleBaseline = getGoogleQuotaBaseline(args.model);
    requestsPerMinute =
      args.config.providers.googleAiStudio.rpmBudget ?? googleBaseline.requestsPerMinute ?? null;
    tokensPerMinute = googleBaseline.tokensPerMinute ?? null;
    requestsPerDay =
      args.config.providers.googleAiStudio.dailyRequestBudget ??
      googleBaseline.requestsPerDay ??
      null;
  } else {
    requestsPerMinute = args.config.providers.openrouter.rpmBudget ?? null;
    requestsPerDay = args.config.providers.openrouter.dailyRequestBudget ?? null;
    dailyTokenBudget = args.config.providers.openrouter.dailyTokenBudget ?? null;
  }

  const usedRequestsToday = usage?.requestsToday ?? null;
  const usedTokensToday = usage
    ? Math.max(usage.reservedTokensToday, usage.actualTokensToday)
    : null;
  const rpmUsed = usage?.requestsPerMinuteUsed ?? null;

  return {
    source: args.config.quotaSourceMode,
    lastUpdatedAt: nowIso,
    dashboardUrl: getProviderDashboardUrl(args.provider),
    requestsPerMinute,
    tokensPerMinute,
    requestsPerDay,
    dailyTokenBudget,
    usedRequestsToday,
    usedTokensToday,
    dailyRequestBudget: requestsPerDay,
    dailyRequestUsed: usedRequestsToday,
    dailyRequestRemaining:
      requestsPerDay === undefined || requestsPerDay === null || usedRequestsToday === null
        ? null
        : Math.max(0, requestsPerDay - usedRequestsToday),
    dailyTokenUsed: usedTokensToday,
    dailyTokenRemaining:
      dailyTokenBudget === undefined || dailyTokenBudget === null || usedTokensToday === null
        ? null
        : Math.max(0, dailyTokenBudget - usedTokensToday),
    rpmBudget: requestsPerMinute,
    rpmUsed,
    rpmRemaining:
      requestsPerMinute === undefined || requestsPerMinute === null || rpmUsed === null
        ? null
        : Math.max(0, requestsPerMinute - rpmUsed),
  };
}

function toTier(index: number): GenerationModelOption['tier'] {
  if (index === 0) return 'primary';
  if (index === 1) return 'fallback';
  if (index === 2) return 'tertiary';
  return 'custom';
}

export function buildGenerationOptionsPayload(args: {
  config: BatchBackendConfig['generation'];
  quotaUsage?: GenerationBudgetUsage;
  now?: Date;
}): GenerationOptionsPayload {
  const providers = resolveGenerationProviderOrder(args.config);
  const modelOptions: GenerationModelOption[] = [];
  const metadataByProviderModel = new Map<
    string,
    Pick<GenerationModelOption, 'tier' | 'defaultSelected'>
  >();

  for (const provider of providers) {
    const models = getModelLadderForProvider(args.config, provider);
    for (const [index, model] of models.entries()) {
      metadataByProviderModel.set(`${provider}:${model}`, {
        tier: toTier(index),
        defaultSelected: index === 0,
      });
    }
  }

  for (const candidate of resolveGenerationCandidates({ config: args.config })) {
    const metadata = metadataByProviderModel.get(`${candidate.provider}:${candidate.model}`);
    if (!metadata) {
      continue;
    }
    modelOptions.push({
      provider: candidate.provider,
      id: candidate.model,
      tier: metadata.tier,
      fallbackRank: candidate.fallbackRank,
      defaultSelected: metadata.defaultSelected,
      enabled: true,
    });
  }

  const defaultModelByProvider: Partial<Record<GenerationProvider, string>> = {};
  for (const provider of providers) {
    const first = getModelLadderForProvider(args.config, provider)[0];
    if (first) {
      defaultModelByProvider[provider] = first;
    }
  }

  const defaultModel = defaultModelByProvider[args.config.defaultProvider] ?? '';

  return {
    providers,
    defaultProvider: args.config.defaultProvider,
    modelOptions,
    defaultModelByProvider,
    quota: buildQuotaSnapshot({
      config: args.config,
      provider: args.config.defaultProvider,
      model: defaultModel,
      usage: args.quotaUsage,
      now: args.now,
    }),
  };
}
