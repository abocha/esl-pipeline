import { describe, expect, it, vi } from 'vitest';

import type { GenerationBudgetRepository } from '../src/application/generation-budget-guard.js';
import { ProviderExecutionError } from '../src/application/generation-providers.js';
import { flattenGenerationRequestEnvelope } from '../src/application/generation-request-envelope.js';
import { buildLessonMemoryEnvelope } from '../src/application/lesson-memory-prompt.js';
import {
  createStudentMemoryGenerationPacer,
  StudentMemoryPacingDeferredError,
} from '../src/application/student-memory-generation-pacing.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';
import type { Metrics } from '../src/infrastructure/metrics.js';

const NOW = new Date('2026-06-21T10:11:32.000Z');
const USAGE = {
  requestsPerMinuteUsed: 1,
  requestsToday: 1,
  reservedTokensToday: 100,
  actualTokensToday: 0,
};

function createConfig(): BatchBackendConfig {
  const base = loadConfig();
  return {
    ...base,
    generation: {
      ...base.generation,

      safetyMode: 'hard_stop',
    },
  };
}

function createRepository(
  reserve: GenerationBudgetRepository['reserve'],
): GenerationBudgetRepository & {
  recordActual: ReturnType<typeof vi.fn>;
} {
  return {
    reserve,
    recordActual: vi.fn().mockResolvedValue(undefined),
    getUsage: vi.fn().mockResolvedValue(USAGE),
  };
}

function createMetrics() {
  const increment = vi.fn<Metrics['increment']>();
  const timing = vi.fn<Metrics['timing']>();
  return {
    increment,
    timing,
  } satisfies Metrics;
}

describe('application/student-memory-generation-pacing', () => {
  it('reserves and reports the effective envelope text plus the output allowance', async () => {
    const envelope = buildLessonMemoryEnvelope({
      transcriptId: 'fixture',
      transcriptText: 'Student: Synthetic travel story.',
    });
    const prompt = flattenGenerationRequestEnvelope(envelope);
    const repository = createRepository(vi.fn().mockResolvedValue({ allowed: true, usage: USAGE }));
    const metrics = createMetrics();
    const pacer = createStudentMemoryGenerationPacer(createConfig(), {
      repository,
      metrics,
      now: () => NOW,
    });
    await pacer.run({
      workload: 'lesson_memory',
      provider: 'openai',
      model: 'fixture',
      prompt,
      maxOutputTokens: 125,
      execute: async () => ({ usage: { totalTokens: 77 } }),
    });
    const estimatedTokens =
      Math.ceil((envelope.instructions.length + 2 + envelope.input.length) / 4) + 125;
    expect(repository.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', model: 'fixture', estimatedTokens }),
    );
    expect(metrics.increment).toHaveBeenCalledWith(
      'student_memory_generation_estimated_tokens',
      estimatedTokens,
      expect.objectContaining({ provider: 'openai', model: 'fixture' }),
    );
    expect(repository.recordActual).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', model: 'fixture', actualTokens: 77 }),
    );
  });
  it.each([
    ['rpm', 'budget_rpm_minute'],
    ['tpm', 'budget_tpm_minute'],
  ] as const)(
    'defers minute %s exhaustion without calling the executor',
    async (limitType, reason) => {
      const repository = createRepository(
        vi.fn().mockResolvedValue({
          allowed: false,
          reason: { limitType, window: 'minute', limit: 3, used: 3 },
          usage: USAGE,
        }),
      );
      const execute = vi.fn();
      const pacer = createStudentMemoryGenerationPacer(createConfig(), {
        repository,
        now: () => NOW,
      });

      await expect(
        pacer.run({
          workload: 'lesson_memory',
          provider: 'openai',
          model: 'gpt-5.4-mini',
          prompt: 'memory source',
          execute,
        }),
      ).rejects.toMatchObject({
        name: 'StudentMemoryPacingDeferredError',
        reason,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        notBefore: new Date('2026-06-21T10:12:00.000Z'),
      } satisfies Partial<StudentMemoryPacingDeferredError>);

      expect(execute).not.toHaveBeenCalled();
      expect(repository.recordActual).not.toHaveBeenCalled();
    },
  );

  it('leaves daily budget exhaustion as an ordinary failure', async () => {
    const repository = createRepository(
      vi.fn().mockResolvedValue({
        allowed: false,
        reason: { limitType: 'daily_tokens', window: 'day', limit: 100, used: 100 },
        usage: USAGE,
      }),
    );
    const pacer = createStudentMemoryGenerationPacer(createConfig(), {
      repository,
      now: () => NOW,
    });

    await expect(
      pacer.run({
        workload: 'lesson_memory',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        prompt: 'memory source',
        execute: vi.fn(),
      }),
    ).rejects.toMatchObject({
      name: 'GenerationBudgetExceededError',
      limitType: 'daily_tokens',
      window: 'day',
    });
  });

  it('uses the later provider Retry-After time for an HTTP 429', async () => {
    const repository = createRepository(vi.fn().mockResolvedValue({ allowed: true, usage: USAGE }));
    const pacer = createStudentMemoryGenerationPacer(createConfig(), {
      repository,
      now: () => NOW,
    });

    await expect(
      pacer.run({
        workload: 'homework_memory',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        prompt: 'memory source',
        execute: vi.fn().mockRejectedValue(
          new ProviderExecutionError({
            provider: 'openai',
            status: 429,
            retryAfterMs: 120_000,
            message: 'slow down',
          }),
        ),
      }),
    ).rejects.toMatchObject({
      name: 'StudentMemoryPacingDeferredError',
      reason: 'provider_rate_limit',
      provider: 'openai',
      model: 'gpt-5.4-mini',
      retryAfterMs: 120_000,
      notBefore: new Date('2026-06-21T10:13:32.000Z'),
    } satisfies Partial<StudentMemoryPacingDeferredError>);
  });

  it('uses the next UTC minute when an HTTP 429 omits Retry-After', async () => {
    const repository = createRepository(vi.fn().mockResolvedValue({ allowed: true, usage: USAGE }));
    const pacer = createStudentMemoryGenerationPacer(createConfig(), {
      repository,
      now: () => NOW,
    });

    await expect(
      pacer.run({
        workload: 'student_memory_snapshot',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        prompt: 'memory source',
        execute: vi.fn().mockRejectedValue(
          new ProviderExecutionError({
            provider: 'openai',
            status: 429,
            message: 'slow down',
          }),
        ),
      }),
    ).rejects.toMatchObject({
      notBefore: new Date('2026-06-21T10:12:00.000Z'),
    } satisfies Partial<StudentMemoryPacingDeferredError>);
  });

  it('records actual usage and privacy-safe metrics after success', async () => {
    const repository = createRepository(vi.fn().mockResolvedValue({ allowed: true, usage: USAGE }));
    const metrics = createMetrics();
    const execute = vi.fn().mockResolvedValue({ usage: { totalTokens: 456 } });
    const pacer = createStudentMemoryGenerationPacer(createConfig(), {
      repository,
      metrics,
      now: () => NOW,
    });

    await expect(
      pacer.run({
        workload: 'lesson_memory',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        prompt: 'memory source',
        execute,
      }),
    ).resolves.toEqual({ usage: { totalTokens: 456 } });

    expect(repository.recordActual).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-5.4-mini',
      now: NOW,
      actualTokens: 456,
    });
    expect(metrics.increment).toHaveBeenCalledWith(
      'student_memory_generation_completed_tokens',
      456,
      expect.objectContaining({
        workload: 'lesson_memory',
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
    );
  });

  it('preserves a completed result when actual-usage accounting is unavailable', async () => {
    const repository = createRepository(vi.fn().mockResolvedValue({ allowed: true, usage: USAGE }));
    const accountingFailure = new Error('generation budget database unavailable');
    repository.recordActual.mockRejectedValue(accountingFailure);
    const metrics = createMetrics();
    const result = { usage: { totalTokens: 456 }, persisted: true };
    const pacer = createStudentMemoryGenerationPacer(createConfig(), {
      repository,
      metrics,
      now: () => NOW,
    });

    await expect(
      pacer.run({
        workload: 'lesson_memory',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        prompt: 'memory source',
        execute: vi.fn().mockResolvedValue(result),
      }),
    ).resolves.toBe(result);

    expect(metrics.increment).toHaveBeenCalledWith(
      'student_memory_generation_actual_usage_record_failure_total',
      1,
      expect.objectContaining({
        workload: 'lesson_memory',
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
    );
  });
});
