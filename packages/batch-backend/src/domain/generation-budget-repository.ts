import type { GenerationProvider } from '@esl-pipeline/contracts';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';

export type GenerationBudgetLimitType =
  | 'rpm'
  | 'daily_requests'
  | 'daily_tokens'
  | 'max_output_tokens'
  | 'model_not_allowed';

export type GenerationBudgetWindow = 'minute' | 'day' | 'request';

export interface GenerationBudgetUsage {
  requestsPerMinuteUsed: number;
  requestsToday: number;
  reservedTokensToday: number;
  actualTokensToday: number;
}

export interface GenerationBudgetLimits {
  rpmBudget?: number | null;
  dailyRequestBudget?: number | null;
  dailyTokenBudget?: number | null;
}

export interface GenerationBudgetBlockedReason {
  limitType: GenerationBudgetLimitType;
  window: GenerationBudgetWindow;
  limit: number;
  used: number;
}

export type GenerationBudgetReservationResult =
  | {
      allowed: true;
      usage: GenerationBudgetUsage;
    }
  | {
      allowed: false;
      reason: GenerationBudgetBlockedReason;
      usage: GenerationBudgetUsage;
    };

export interface ReserveGenerationBudgetInput {
  provider: GenerationProvider;
  model: string;
  now: Date;
  estimatedTokens: number;
  limits: GenerationBudgetLimits;
}

export interface RecordGenerationActualUsageInput {
  provider: GenerationProvider;
  model: string;
  now: Date;
  actualTokens: number;
}

export interface GetGenerationBudgetUsageInput {
  provider: GenerationProvider;
  model: string;
  now: Date;
}

interface CounterRow {
  request_count: number | string;
  reserved_tokens: number | string;
  actual_tokens: number | string;
}

type BucketType = 'minute' | 'day';

function startOfUtcMinute(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      0,
      0,
    ),
  );
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function asNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function ensureCounterRow(args: {
  client: PoolClient;
  bucketType: BucketType;
  bucketStart: Date;
  provider: GenerationProvider;
  model: string;
}): Promise<void> {
  await args.client.query(
    `
      INSERT INTO generation_budget_counters (
        bucket_type,
        bucket_start,
        provider,
        model,
        request_count,
        reserved_tokens,
        actual_tokens
      )
      VALUES ($1, $2, $3, $4, 0, 0, 0)
      ON CONFLICT (bucket_type, bucket_start, provider, model) DO NOTHING
    `,
    [args.bucketType, args.bucketStart, args.provider, args.model],
  );
}

async function readCounterRowForUpdate(args: {
  client: PoolClient;
  bucketType: BucketType;
  bucketStart: Date;
  provider: GenerationProvider;
  model: string;
}): Promise<CounterRow> {
  const result = await args.client.query<CounterRow>(
    `
      SELECT request_count, reserved_tokens, actual_tokens
      FROM generation_budget_counters
      WHERE bucket_type = $1
        AND bucket_start = $2
        AND provider = $3
        AND model = $4
      FOR UPDATE
    `,
    [args.bucketType, args.bucketStart, args.provider, args.model],
  );

  return (
    result.rows[0] ?? {
      request_count: 0,
      reserved_tokens: 0,
      actual_tokens: 0,
    }
  );
}

async function readCounterRow(args: {
  client: PoolClient;
  bucketType: BucketType;
  bucketStart: Date;
  provider: GenerationProvider;
  model: string;
}): Promise<CounterRow> {
  const result = await args.client.query<CounterRow>(
    `
      SELECT request_count, reserved_tokens, actual_tokens
      FROM generation_budget_counters
      WHERE bucket_type = $1
        AND bucket_start = $2
        AND provider = $3
        AND model = $4
    `,
    [args.bucketType, args.bucketStart, args.provider, args.model],
  );

  return (
    result.rows[0] ?? {
      request_count: 0,
      reserved_tokens: 0,
      actual_tokens: 0,
    }
  );
}

function sanitizeNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

export async function reserveGenerationBudget(
  input: ReserveGenerationBudgetInput,
): Promise<GenerationBudgetReservationResult> {
  const estimatedTokens = sanitizeNonNegativeInt(input.estimatedTokens);
  const minuteStart = startOfUtcMinute(input.now);
  const dayStart = startOfUtcDay(input.now);

  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await ensureCounterRow({
        client,
        bucketType: 'minute',
        bucketStart: minuteStart,
        provider: input.provider,
        model: input.model,
      });
      await ensureCounterRow({
        client,
        bucketType: 'day',
        bucketStart: dayStart,
        provider: input.provider,
        model: input.model,
      });

      const minuteRow = await readCounterRowForUpdate({
        client,
        bucketType: 'minute',
        bucketStart: minuteStart,
        provider: input.provider,
        model: input.model,
      });
      const dayRow = await readCounterRowForUpdate({
        client,
        bucketType: 'day',
        bucketStart: dayStart,
        provider: input.provider,
        model: input.model,
      });

      const minuteRequests = asNumber(minuteRow.request_count);
      const dayRequests = asNumber(dayRow.request_count);
      const dayReservedTokens = asNumber(dayRow.reserved_tokens);
      const dayActualTokens = asNumber(dayRow.actual_tokens);

      const nextMinuteRequests = minuteRequests + 1;
      const nextDayRequests = dayRequests + 1;
      const nextDayReservedTokens = dayReservedTokens + estimatedTokens;

      if (
        input.limits.rpmBudget !== undefined &&
        input.limits.rpmBudget !== null &&
        input.limits.rpmBudget >= 0 &&
        nextMinuteRequests > input.limits.rpmBudget
      ) {
        await client.query('ROLLBACK');
        return {
          allowed: false,
          reason: {
            limitType: 'rpm',
            window: 'minute',
            limit: input.limits.rpmBudget,
            used: minuteRequests,
          },
          usage: {
            requestsPerMinuteUsed: minuteRequests,
            requestsToday: dayRequests,
            reservedTokensToday: dayReservedTokens,
            actualTokensToday: dayActualTokens,
          },
        };
      }

      if (
        input.limits.dailyRequestBudget !== undefined &&
        input.limits.dailyRequestBudget !== null &&
        input.limits.dailyRequestBudget >= 0 &&
        nextDayRequests > input.limits.dailyRequestBudget
      ) {
        await client.query('ROLLBACK');
        return {
          allowed: false,
          reason: {
            limitType: 'daily_requests',
            window: 'day',
            limit: input.limits.dailyRequestBudget,
            used: dayRequests,
          },
          usage: {
            requestsPerMinuteUsed: minuteRequests,
            requestsToday: dayRequests,
            reservedTokensToday: dayReservedTokens,
            actualTokensToday: dayActualTokens,
          },
        };
      }

      if (
        input.limits.dailyTokenBudget !== undefined &&
        input.limits.dailyTokenBudget !== null &&
        input.limits.dailyTokenBudget >= 0 &&
        nextDayReservedTokens > input.limits.dailyTokenBudget
      ) {
        await client.query('ROLLBACK');
        return {
          allowed: false,
          reason: {
            limitType: 'daily_tokens',
            window: 'day',
            limit: input.limits.dailyTokenBudget,
            used: dayReservedTokens,
          },
          usage: {
            requestsPerMinuteUsed: minuteRequests,
            requestsToday: dayRequests,
            reservedTokensToday: dayReservedTokens,
            actualTokensToday: dayActualTokens,
          },
        };
      }

      await client.query(
        `
          UPDATE generation_budget_counters
          SET request_count = request_count + 1
          WHERE bucket_type = 'minute'
            AND bucket_start = $1
            AND provider = $2
            AND model = $3
        `,
        [minuteStart, input.provider, input.model],
      );

      await client.query(
        `
          UPDATE generation_budget_counters
          SET
            request_count = request_count + 1,
            reserved_tokens = reserved_tokens + $4
          WHERE bucket_type = 'day'
            AND bucket_start = $1
            AND provider = $2
            AND model = $3
        `,
        [dayStart, input.provider, input.model, estimatedTokens],
      );

      await client.query('COMMIT');

      return {
        allowed: true,
        usage: {
          requestsPerMinuteUsed: nextMinuteRequests,
          requestsToday: nextDayRequests,
          reservedTokensToday: nextDayReservedTokens,
          actualTokensToday: dayActualTokens,
        },
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // no-op
      }
      throw error;
    }
  });
}

export async function recordGenerationActualUsage(
  input: RecordGenerationActualUsageInput,
): Promise<void> {
  const actualTokens = sanitizeNonNegativeInt(input.actualTokens);
  if (actualTokens <= 0) {
    return;
  }

  const dayStart = startOfUtcDay(input.now);

  await withPgClient(async (client) => {
    await ensureCounterRow({
      client,
      bucketType: 'day',
      bucketStart: dayStart,
      provider: input.provider,
      model: input.model,
    });

    await client.query(
      `
        UPDATE generation_budget_counters
        SET actual_tokens = actual_tokens + $4
        WHERE bucket_type = 'day'
          AND bucket_start = $1
          AND provider = $2
          AND model = $3
      `,
      [dayStart, input.provider, input.model, actualTokens],
    );
  });
}

export async function getGenerationBudgetUsage(
  input: GetGenerationBudgetUsageInput,
): Promise<GenerationBudgetUsage> {
  const minuteStart = startOfUtcMinute(input.now);
  const dayStart = startOfUtcDay(input.now);

  return withPgClient(async (client) => {
    const minuteRow = await readCounterRow({
      client,
      bucketType: 'minute',
      bucketStart: minuteStart,
      provider: input.provider,
      model: input.model,
    });
    const dayRow = await readCounterRow({
      client,
      bucketType: 'day',
      bucketStart: dayStart,
      provider: input.provider,
      model: input.model,
    });

    return {
      requestsPerMinuteUsed: asNumber(minuteRow.request_count),
      requestsToday: asNumber(dayRow.request_count),
      reservedTokensToday: asNumber(dayRow.reserved_tokens),
      actualTokensToday: asNumber(dayRow.actual_tokens),
    };
  });
}
