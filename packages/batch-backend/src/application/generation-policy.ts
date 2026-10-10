import type {
  GenerationModelOption,
  GenerationOptionsPayload,
  GenerationProvider,
  GenerationQuotaView,
} from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { GenerationBudgetUsage } from '../domain/generation-budget-repository.js';
import { ProviderExecutionError } from './generation-providers.js';

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

const OPENAI_DASHBOARD_URL = 'https://platform.openai.com/settings/organization/limits';

export function resolveGenerationTarget(args: {
  config: BatchBackendConfig['generation'];
  workload: GenerationWorkload;
  providerOverride?: GenerationProvider;
  modelOverride?: string;
}): GenerationTarget {
  const configured = args.config.targets[args.workload];
  const provider = args.providerOverride ?? configured.provider;
  const model = args.modelOverride?.trim() || configured.model;
  assertSupportedGenerationTarget({ provider, model });
  if (!model) throw new Error(`No explicit model configured for ${args.workload} (${provider})`);
  return { provider, model };
}

/** Retired targets are rejected, including frozen jobs; never rewrite their provenance. */
export function assertSupportedGenerationTarget(target: GenerationTarget): void {
  if (target.provider !== 'openai') {
    throw new ProviderExecutionError({
      provider: target.provider,
      message: `LLM provider ${target.provider} is retired. Create new work with an explicit OpenAI target; frozen jobs are not retargeted.`,
      code: 'unsupported_provider',
      status: 400,
    });
  }
  if (/^(gemini|gemma)(-|$)/i.test(target.model)) {
    throw new ProviderExecutionError({
      provider: target.provider,
      message: `Model ${target.model} is not an OpenAI LLM target.`,
      code: 'unsupported_model',
      status: 400,
    });
  }
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

  assertSupportedGenerationTarget(args);
  const requestsPerMinute = args.config.providers.openai.rpmBudget ?? null;
  const tokensPerMinute = args.config.providers.openai.tpmBudget ?? null;
  const requestsPerDay = args.config.providers.openai.dailyRequestBudget ?? null;
  const dailyTokenBudget = args.config.providers.openai.dailyTokenBudget ?? null;

  const usedRequestsToday = usage?.requestsToday ?? null;
  const usedTokensToday = usage
    ? Math.max(usage.reservedTokensToday, usage.actualTokensToday)
    : null;
  const rpmUsed = usage?.requestsPerMinuteUsed ?? null;

  return {
    source: args.config.quotaSourceMode,
    lastUpdatedAt: nowIso,
    dashboardUrl: OPENAI_DASHBOARD_URL,
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
  const providers: GenerationProvider[] = ['openai'];
  const modelOptions: GenerationModelOption[] = [];
  const defaultModelByProvider: Partial<Record<GenerationProvider, string>> = {};
  for (const provider of providers) {
    const roster = args.config.models.openai;
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
