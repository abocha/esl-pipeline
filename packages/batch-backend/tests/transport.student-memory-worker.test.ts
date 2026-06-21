import { DelayedError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentMemoryPacingDeferredError } from '../src/application/student-memory-generation-pacing.js';
import { processStudentMemoryBullJob } from '../src/transport/student-memory-worker.js';

interface WorkerTestStorage {
  processStudentMemoryJob: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
}

function getStorage(): WorkerTestStorage {
  const global = globalThis as Record<string, unknown>;
  const existing = global.__studentMemoryWorkerTestStorage as WorkerTestStorage | undefined;
  if (existing) return existing;
  const created: WorkerTestStorage = {
    processStudentMemoryJob: vi.fn(),
    info: vi.fn(),
  };
  global.__studentMemoryWorkerTestStorage = created;
  return created;
}

vi.mock('../src/application/process-student-memory-job', () => {
  const storage = getStorage();
  return { processStudentMemoryJob: storage.processStudentMemoryJob };
});

vi.mock('../src/infrastructure/logger', () => {
  const storage = getStorage();
  return {
    logger: {
      info: storage.info,
      error: vi.fn(),
    },
  };
});

describe('transport/student-memory-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves a pacing-deferred active job to delayed without surfacing its application error', async () => {
    const storage = getStorage();
    const deferred = new StudentMemoryPacingDeferredError({
      reason: 'provider_rate_limit',
      provider: 'openai',
      model: 'gpt-5.4-mini',
      notBefore: new Date('2026-06-21T10:13:32.000Z'),
      estimatedTokens: 456,
      retryAfterMs: 120_000,
    });
    storage.processStudentMemoryJob.mockRejectedValue(deferred);
    const moveToDelayed = vi.fn().mockResolvedValue(undefined);
    const bullJob = {
      id: 'job-1',
      data: {
        kind: 'lesson-memory-generate',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        studentId: 'student-1',
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.4-mini',
      },
      attemptsMade: 4,
      opts: { attempts: 5 },
      token: 'worker-token',
      moveToDelayed,
    };

    await expect(
      processStudentMemoryBullJob({
        bullJob: bullJob as never,
        config: {} as never,
        now: () => new Date('2026-06-21T10:11:32.000Z'),
      }),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(moveToDelayed).toHaveBeenCalledWith(deferred.notBefore.getTime(), 'worker-token');
    expect(storage.info).toHaveBeenCalledWith(
      'Student-memory job deferred for pacing',
      expect.objectContaining({
        event: 'student_memory_pacing_deferred',
        jobId: 'job-1',
        kind: 'lesson-memory-generate',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        reason: 'provider_rate_limit',
        notBefore: '2026-06-21T10:13:32.000Z',
        deferDurationMs: 120_000,
        estimatedTokens: 456,
        retryAfterMs: 120_000,
      }),
    );
  });

  it('rethrows ordinary worker errors without moving the job to delayed', async () => {
    const storage = getStorage();
    const failure = new Error('schema validation failed');
    storage.processStudentMemoryJob.mockRejectedValue(failure);
    const moveToDelayed = vi.fn();

    await expect(
      processStudentMemoryBullJob({
        bullJob: {
          id: 'job-2',
          data: {
            kind: 'homework-memory-generate',
            jobId: 'source-job-1',
            studentId: 'student-1',
            pendingEntryId: 'pending-1',
            provider: 'openai',
            model: 'gpt-5.4-mini',
          },
          attemptsMade: 0,
          opts: { attempts: 5 },
          token: 'worker-token',
          moveToDelayed,
        } as never,
        config: {} as never,
      }),
    ).rejects.toBe(failure);

    expect(moveToDelayed).not.toHaveBeenCalled();
  });
});
