import type {
  GenerationModelOption,
  GenerationOptionsPayload,
  GenerationProvider,
  GenerationQuotaView,
} from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { GenerationBudgetUsage } from '../domain/generation-budget-repository.js';

export interface GenerationTarget {
  provider: GenerationProvider;
  model: string;
}

export type GenerationWorkload =
  | 'draft_generation'
  | 'lesson_memory'
  | 'homework_memory'
  | 'student_memory_snapshot'
  | 'profile_revision_drafting';

const GOOGLE_DASHBOARD_URL = 'https://ai.google.dev/gemini-api/docs/rate-limits';
const OPENAI_DASHBOARD_URL =
  'https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai';
const OPENROUTER_DASHBOARD_URL = 'https://openrouter.ai/docs/models';

export function resolveGenerationTarget(args: {
  config: BatchBackendConfig['generation'];
  workload: GenerationWorkload;
  providerOverride?: GenerationProvider;
  modelOverride?: string;
}): GenerationTarget {
  const configured = args.config.targets[args.workload];
  const provider = args.providerOverride ?? configured.provider;
  const model =
    args.modelOverride?.trim() ||
    (provider === configured.provider
      ? configured.model
      : args.config.models[provider === 'google_ai_studio' ? 'googleAiStudio' : provider].model);
  if (!model) throw new Error(`No explicit model configured for ${args.workload} (${provider})`);
  return { provider, model };
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

export function buildGenerationOptionsPayload(args: {
  config: BatchBackendConfig['generation'];
  quotaUsage?: GenerationBudgetUsage;
  now?: Date;
}): GenerationOptionsPayload {
  const target = resolveGenerationTarget({ config: args.config, workload: 'draft_generation' });
  // Roster order is presentation only: none of these options are automatic fallbacks.
  const providers: GenerationProvider[] = ['openai', 'google_ai_studio'];
  if (
    args.config.models.openrouter.model ||
    args.config.models.openrouter.allowed.length ||
    target.provider === 'openrouter'
  )
    providers.push('openrouter');
  const modelOptions: GenerationModelOption[] = [];
  const defaultModelByProvider: Partial<Record<GenerationProvider, string>> = {};
  for (const provider of providers) {
    const roster =
      args.config.models[provider === 'google_ai_studio' ? 'googleAiStudio' : provider];
    const model = provider === target.provider ? target.model : roster.model;
    if (model) defaultModelByProvider[provider] = model;
    for (const id of new Set(
      [model, ...roster.allowed].filter((id): id is string => Boolean(id)),
    )) {
      modelOptions.push({
        provider,
        id,
        defaultSelected: provider === target.provider && id === target.model,
        enabled: true,
      });
    }
  }
  return {
    providers,
    defaultProvider: target.provider,
    modelOptions,
    defaultModelByProvider,
    quota: buildQuotaSnapshot({
      config: args.config,
      provider: target.provider,
      model: target.model,
      usage: args.quotaUsage,
      now: args.now,
    }),
  };
}
