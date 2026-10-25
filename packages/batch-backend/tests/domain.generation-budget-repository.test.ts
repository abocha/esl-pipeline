import './support/bootstrap-pg-test-env.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getGenerationBudgetUsage,
  recordGenerationActualUsage,
  reserveGenerationBudget,
} from '../src/domain/generation-budget-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();
const now = new Date('2045-01-01T23:59:00Z');
const reserve = (model: string, tokens: number, cap: number, date = now) =>
  reserveGenerationBudget({
    provider: 'openai',
    model,
    now: date,
    estimatedTokens: tokens,
    limits: { dailyTokenBudget: cap },
  });
describe('shared OpenAI daily admission (PostgreSQL)', () => {
  beforeEach(async () => {
    await withPgClient((c) =>
      c.query(
        "DELETE FROM generation_budget_counters WHERE bucket_start >= '2045-01-01' AND bucket_start < '2045-01-03'",
      ),
    );
  });
  afterAll(closePgPool);
  it.each([
    ['gpt-5.6-luna', 'gpt-5.6-terra', 2250000],
    ['gpt-6.1-sol', 'gpt-6-sol', 225000],
  ] as const)('serializes simultaneous %s / %s requests', async (a, b, cap) => {
    const results = await Promise.all([reserve(a, cap - 1, cap), reserve(b, cap - 1, cap)]);
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
    expect(results.find((r) => !r.allowed)).toMatchObject({
      allowed: false,
      reason: { limitType: 'daily_tokens', used: cap - 1, limit: cap },
    });
    const usage = await getGenerationBudgetUsage({ provider: 'openai', model: a, now });
    expect(usage.groupReservedTokensToday).toBe(cap - 1);
    expect(await reserve(b, 1, cap)).toMatchObject({ allowed: true });
    expect(await reserve(a, 1, cap)).toMatchObject({ allowed: false });
  });
  it('includes pre-upgrade rows and retains model attribution and actual usage', async () => {
    await withPgClient((c) =>
      c.query(`INSERT INTO generation_budget_counters
      (bucket_type,bucket_start,provider,model,request_count,reserved_tokens,actual_tokens)
      VALUES ('day','2045-01-01','openai','gpt-5.6-luna',6,113653,51912)`),
    );
    expect(await reserve('gpt-5.6-terra', 6348, 120000)).toMatchObject({
      allowed: false,
      reason: { used: 113653 },
    });
    expect(await reserve('gpt-5.6-terra', 12001, 2250000)).toMatchObject({ allowed: true });
    await recordGenerationActualUsage({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      now,
      actualTokens: 100,
    });
    expect(
      await getGenerationBudgetUsage({ provider: 'openai', model: 'gpt-5.6-terra', now }),
    ).toMatchObject({
      requestsToday: 1,
      reservedTokensToday: 12001,
      actualTokensToday: 100,
      groupReservedTokensToday: 125654,
      groupActualTokensToday: 52012,
    });
    expect(
      await getGenerationBudgetUsage({ provider: 'openai', model: 'gpt-5.6-luna', now }),
    ).toMatchObject({ requestsToday: 6, reservedTokensToday: 113653, actualTokensToday: 51912 });
  });
  it('blocks both groups on retained unmapped reservations without deleting or relabelling them', async () => {
    await withPgClient((c) =>
      c.query(`INSERT INTO generation_budget_counters
      (bucket_type,bucket_start,provider,model,request_count,reserved_tokens,actual_tokens)
      VALUES ('day','2045-01-01','openai','unclassified-legacy',1,123,50)`),
    );
    for (const model of ['gpt-5.6-luna', 'gpt-6.1-sol']) {
      expect(await reserve(model, 1, 2250000)).toMatchObject({
        allowed: false,
        reason: { limitType: 'model_not_allowed', used: 123, window: 'day' },
      });
    }
    expect(
      await getGenerationBudgetUsage({ provider: 'openai', model: 'gpt-5.6-luna', now }),
    ).toMatchObject({
      groupReservedTokensToday: 0,
      unclassifiedReservedTokensToday: 123,
      requestsToday: 0,
    });
    expect(
      await reserve('gpt-5.6-luna', 1, 2250000, new Date('2045-01-02T00:00:00Z')),
    ).toMatchObject({ allowed: true });
    expect(
      (
        await withPgClient((c) =>
          c.query(
            "SELECT reserved_tokens FROM generation_budget_counters WHERE model='unclassified-legacy' AND bucket_start='2045-01-01'",
          ),
        )
      ).rows[0].reserved_tokens,
    ).toBe('123');
  });

  it('keeps groups independent, resets at UTC midnight and fails unknown models without writing', async () => {
    await reserve('gpt-5.6-luna', 2250000, 2250000);
    expect(await reserve('gpt-6.1-sol', 225000, 225000)).toMatchObject({ allowed: true });
    expect(await reserve('gpt-5.6-terra', 1, 2250000)).toMatchObject({ allowed: false });
    expect(
      await reserve('gpt-5.6-terra', 1, 2250000, new Date('2045-01-02T00:00:00Z')),
    ).toMatchObject({ allowed: true });
    await expect(reserve('unknown', 1, 2250000)).rejects.toThrow('no reviewed');
    expect(
      (
        await withPgClient((c) =>
          c.query("SELECT count(*)::int n FROM generation_budget_counters WHERE model='unknown'"),
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('retains minute and explicit daily request limits without consuming denied reservations', async () => {
    const input = {
      provider: 'openai' as const,
      model: 'gpt-5.6-luna',
      now,
      estimatedTokens: 100,
      limits: { rpmBudget: 1, tpmBudget: 150, dailyRequestBudget: 2, dailyTokenBudget: 2250000 },
    };
    expect(await reserveGenerationBudget(input)).toMatchObject({ allowed: true });
    expect(await reserveGenerationBudget(input)).toMatchObject({
      allowed: false,
      reason: { limitType: 'rpm' },
    });
    expect(
      await reserveGenerationBudget({ ...input, limits: { ...input.limits, rpmBudget: 3 } }),
    ).toMatchObject({ allowed: false, reason: { limitType: 'tpm' } });
    expect(
      await reserveGenerationBudget({ ...input, now: new Date('2045-01-01T23:58:00Z') }),
    ).toMatchObject({ allowed: true });
    expect(
      await reserveGenerationBudget({ ...input, now: new Date('2045-01-01T23:57:00Z') }),
    ).toMatchObject({ allowed: false, reason: { limitType: 'daily_requests' } });
    expect(await getGenerationBudgetUsage(input)).toMatchObject({
      requestsToday: 2,
      groupReservedTokensToday: 200,
    });
  });
});
