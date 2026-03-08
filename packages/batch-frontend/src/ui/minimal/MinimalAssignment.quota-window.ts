export interface GenerationQuotaLike {
  lastUpdatedAt: string;
  dailyTokenBudget?: number | null;
  dailyTokenRemaining?: number | null;
  dailyRequestBudget?: number | null;
  dailyRequestRemaining?: number | null;
  rpmBudget?: number | null;
  rpmRemaining?: number | null;
}

export interface GenerationQuotaWindowDecision {
  blockedReason: string | null;
  shouldTrackWindow: boolean;
  dayWindowCurrent: boolean;
  minuteWindowCurrent: boolean;
  dailyTokenWindowBlocked: boolean;
  dailyRequestWindowBlocked: boolean;
  rpmWindowBlocked: boolean;
}

function isDefinedNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}

export function isSameUtcDay(leftMs: number, rightMs: number): boolean {
  const left = new Date(leftMs);
  const right = new Date(rightMs);
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

export function isSameUtcMinute(leftMs: number, rightMs: number): boolean {
  const left = new Date(leftMs);
  const right = new Date(rightMs);
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate() &&
    left.getUTCHours() === right.getUTCHours() &&
    left.getUTCMinutes() === right.getUTCMinutes()
  );
}

export function getGenerationQuotaWindowDecision(params: {
  quota: GenerationQuotaLike | null;
  quotaWindowTickMs: number;
  activeQuotaAppliesToCurrentSelection: boolean;
}): GenerationQuotaWindowDecision {
  const { quota, quotaWindowTickMs, activeQuotaAppliesToCurrentSelection } = params;

  if (!quota || !activeQuotaAppliesToCurrentSelection) {
    return {
      blockedReason: null,
      shouldTrackWindow: false,
      dayWindowCurrent: false,
      minuteWindowCurrent: false,
      dailyTokenWindowBlocked: false,
      dailyRequestWindowBlocked: false,
      rpmWindowBlocked: false,
    };
  }

  const lastUpdatedMs = Date.parse(quota.lastUpdatedAt);
  const windowKnown = Number.isFinite(lastUpdatedMs);
  const dayWindowCurrent = windowKnown && isSameUtcDay(lastUpdatedMs, quotaWindowTickMs);
  const minuteWindowCurrent = windowKnown && isSameUtcMinute(lastUpdatedMs, quotaWindowTickMs);

  const dailyTokenHardBlocked =
    quota.dailyTokenBudget === 0 &&
    isDefinedNumber(quota.dailyTokenRemaining) &&
    quota.dailyTokenRemaining <= 0;
  const dailyRequestHardBlocked =
    quota.dailyRequestBudget === 0 &&
    isDefinedNumber(quota.dailyRequestRemaining) &&
    quota.dailyRequestRemaining <= 0;
  const rpmHardBlocked =
    quota.rpmBudget === 0 && isDefinedNumber(quota.rpmRemaining) && quota.rpmRemaining <= 0;

  const dailyTokenWindowBlocked =
    !dailyTokenHardBlocked &&
    isDefinedNumber(quota.dailyTokenRemaining) &&
    quota.dailyTokenRemaining <= 0 &&
    dayWindowCurrent;
  const dailyRequestWindowBlocked =
    !dailyRequestHardBlocked &&
    isDefinedNumber(quota.dailyRequestRemaining) &&
    quota.dailyRequestRemaining <= 0 &&
    dayWindowCurrent;
  const rpmWindowBlocked =
    !rpmHardBlocked &&
    isDefinedNumber(quota.rpmRemaining) &&
    quota.rpmRemaining <= 0 &&
    minuteWindowCurrent;

  const blockedReason =
    dailyTokenHardBlocked || dailyTokenWindowBlocked
      ? 'Daily token budget exhausted for selected model/provider.'
      : dailyRequestHardBlocked || dailyRequestWindowBlocked
        ? 'Daily request budget exhausted for selected model/provider.'
        : rpmHardBlocked || rpmWindowBlocked
          ? 'Per-minute request budget exhausted. Wait for minute window reset.'
          : null;

  return {
    blockedReason,
    shouldTrackWindow: dailyTokenWindowBlocked || dailyRequestWindowBlocked || rpmWindowBlocked,
    dayWindowCurrent,
    minuteWindowCurrent,
    dailyTokenWindowBlocked,
    dailyRequestWindowBlocked,
    rpmWindowBlocked,
  };
}
