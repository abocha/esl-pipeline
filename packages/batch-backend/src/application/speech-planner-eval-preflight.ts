import type { GenerationBudgetRepository } from './generation-budget-guard.js';
import {
  SPEECH_PLANNER_EVAL_MODELS,
  type SpeechPlannerEvalVariant,
} from './speech-planner-eval-fixtures.js';

export interface SpeechPlannerEvalRunPlan {
  plannerAttempts: number;
  compatibilityChecks: number;
  selectedSynthesisRequests: number;
  missingAttemptIds: string[];
}

export function buildSpeechPlannerEvalRunPlan(args: {
  variants: readonly SpeechPlannerEvalVariant[];
  completedAttemptIds?: ReadonlySet<string>;
  selectedSynthesisRequests?: number;
}): SpeechPlannerEvalRunPlan {
  const completed = args.completedAttemptIds ?? new Set<string>();
  const missing = args.variants.filter((variant) => !completed.has(variant.attemptId));
  return {
    plannerAttempts: missing.length,
    compatibilityChecks: missing.filter((variant) => variant.compatibilitySmoke).length,
    selectedSynthesisRequests: args.selectedSynthesisRequests ?? 0,
    missingAttemptIds: missing.map((variant) => variant.attemptId),
  };
}

export type SpeechPlannerEvalPreflightResult =
  | {
      allowed: true;
      usageVerified: boolean;
      allowlistReady: boolean;
      missingRequiredModels: string[];
      plannerAttempts: number;
      compatibilityChecks: number;
      remainingDailyCapacity?: number;
    }
  | {
      allowed: false;
      category:
        | 'missing_credentials'
        | 'model_not_allowed'
        | 'usage_unverified'
        | 'invalid_usage'
        | 'invalid_limits'
        | 'daily_capacity'
        | 'rpm_unavailable';
      remediation: string;
      allowlistReady: boolean;
      missingRequiredModels: string[];
      plannerAttempts: number;
      compatibilityChecks: number;
      remainingDailyCapacity?: number;
    };

export function preflightSpeechPlannerEval(args: {
  variants: readonly SpeechPlannerEvalVariant[];
  live: boolean;
  credentialsPresent: boolean;
  usedToday?: number;
  dailyLimit: number;
  rpm: number;
  allowedModels: readonly string[];
  completedAttemptIds?: ReadonlySet<string>;
}): SpeechPlannerEvalPreflightResult {
  const plan = buildSpeechPlannerEvalRunPlan({
    variants: args.variants,
    completedAttemptIds: args.completedAttemptIds,
  });
  const base = {
    plannerAttempts: plan.plannerAttempts,
    compatibilityChecks: plan.compatibilityChecks,
  };
  const missingModels = SPEECH_PLANNER_EVAL_MODELS.filter(
    (model) => !args.allowedModels.includes(model),
  );
  const allowlist = {
    allowlistReady: missingModels.length === 0,
    missingRequiredModels: missingModels,
  };
  if (
    !Number.isInteger(args.dailyLimit) ||
    args.dailyLimit < 0 ||
    !Number.isInteger(args.rpm) ||
    args.rpm < 0
  ) {
    return {
      allowed: false,
      category: 'invalid_limits',
      remediation: 'Configured daily and RPM limits must be finite nonnegative integers.',
      ...allowlist,
      ...base,
    };
  }
  if (args.usedToday !== undefined && (!Number.isInteger(args.usedToday) || args.usedToday < 0)) {
    return {
      allowed: false,
      category: 'invalid_usage',
      remediation: 'Current-day usage must be a finite nonnegative integer.',
      ...allowlist,
      ...base,
    };
  }
  if (args.live && missingModels.length > 0) {
    return {
      allowed: false,
      category: 'model_not_allowed',
      remediation: `Add the exact stable model IDs to GEN_ALLOWED_MODELS_GOOGLE: ${missingModels.join(', ')}.`,
      ...allowlist,
      ...base,
    };
  }
  if (!args.live) {
    return {
      allowed: true,
      usageVerified: args.usedToday !== undefined,
      ...allowlist,
      ...(args.usedToday === undefined
        ? {}
        : { remainingDailyCapacity: Math.max(0, args.dailyLimit - args.usedToday) }),
      ...base,
    };
  }
  if (!args.credentialsPresent) {
    return {
      allowed: false,
      category: 'missing_credentials',
      remediation: 'Configure GEMINI_API_KEY before a live evaluation.',
      ...allowlist,
      ...base,
    };
  }
  if (args.usedToday === undefined) {
    return {
      allowed: false,
      category: 'usage_unverified',
      remediation: 'Supply current provider usage with --used-today=<nonnegative integer>.',
      ...allowlist,
      ...base,
    };
  }
  const remainingDailyCapacity = Math.max(0, args.dailyLimit - args.usedToday);
  if (remainingDailyCapacity < plan.plannerAttempts) {
    return {
      allowed: false,
      category: 'daily_capacity',
      remediation: `Increase remaining daily request capacity by at least ${plan.plannerAttempts - remainingDailyCapacity} request${plan.plannerAttempts - remainingDailyCapacity === 1 ? '' : 's'}.`,
      ...allowlist,
      remainingDailyCapacity,
      ...base,
    };
  }
  if (args.rpm <= 0) {
    return {
      allowed: false,
      category: 'rpm_unavailable',
      remediation: 'Set an operator-approved positive ESL_TTS_SPEECH_PLANNER_RPM_BUDGET.',
      ...allowlist,
      remainingDailyCapacity,
      ...base,
    };
  }
  return {
    allowed: true,
    usageVerified: true,
    ...allowlist,
    remainingDailyCapacity,
    ...base,
  };
}

export function createSpeechPlannerEvalBudgetRepository(args: {
  usedToday: number;
}): GenerationBudgetRepository {
  if (!Number.isInteger(args.usedToday) || args.usedToday < 0) {
    throw new Error('Speech planner eval current-day usage must be a finite nonnegative integer.');
  }
  let requestsToday = args.usedToday;
  let reservedTokensToday = 0;
  let actualTokensToday = 0;
  const usage = () => ({
    requestsPerMinuteUsed: 0,
    requestsToday,
    reservedTokensToday,
    actualTokensToday,
  });
  return {
    async reserve(input) {
      const nextRequests = requestsToday + 1;
      if (
        input.limits.dailyRequestBudget !== undefined &&
        input.limits.dailyRequestBudget !== null &&
        nextRequests > input.limits.dailyRequestBudget
      ) {
        return {
          allowed: false,
          reason: {
            limitType: 'daily_requests',
            window: 'day',
            limit: input.limits.dailyRequestBudget,
            used: nextRequests,
          },
          usage: usage(),
        };
      }
      requestsToday = nextRequests;
      reservedTokensToday += Math.max(0, Math.floor(input.estimatedTokens));
      return { allowed: true, usage: usage() };
    },
    async recordActual(input) {
      actualTokensToday += Math.max(0, Math.floor(input.actualTokens));
    },
    async getUsage() {
      return usage();
    },
  };
}

export class SpeechPlannerEvalRateLimiter {
  private readonly starts: number[] = [];
  private readonly rpm: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(args: { rpm: number; now?: () => number; sleep?: (ms: number) => Promise<void> }) {
    if (!Number.isInteger(args.rpm) || args.rpm <= 0) {
      throw new Error('Speech planner eval RPM must be a positive integer.');
    }
    this.rpm = args.rpm;
    this.now = args.now ?? Date.now;
    this.sleep = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = this.now();
      while (this.starts.length > 0 && (this.starts[0] ?? 0) <= now - 60_000) {
        this.starts.shift();
      }
      if (this.starts.length < this.rpm) {
        this.starts.push(now);
        return;
      }
      await this.sleep(Math.max(1, (this.starts[0] ?? now) + 60_000 - now));
    }
  }
}
