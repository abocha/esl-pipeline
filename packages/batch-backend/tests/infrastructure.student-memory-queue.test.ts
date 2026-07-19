import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createStudentMemoryQueue,
  createStudentMemoryWorker,
} from '../src/infrastructure/student-memory-queue.js';

function getMockStorage() {
  if (!(globalThis as Record<string, unknown>).__studentMemoryQueueTestStorage) {
    (globalThis as Record<string, unknown>).__studentMemoryQueueTestStorage = {};
  }
  return (globalThis as Record<string, unknown>).__studentMemoryQueueTestStorage as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
}

vi.mock('bullmq', () => {
  const queueAdd = vi.fn();
  const queueGetJob = vi.fn();
  const queueEventsOn = vi.fn();
  const workerOn = vi.fn();
  const Queue = vi.fn();
  const QueueEvents = vi.fn();
  const Worker = vi.fn();

  const storage = getMockStorage();
  storage.queueAdd = queueAdd;
  storage.queueGetJob = queueGetJob;
  storage.queueEventsOn = queueEventsOn;
  storage.workerOn = workerOn;
  storage.Queue = Queue;
  storage.QueueEvents = QueueEvents;
  storage.Worker = Worker;

  return {
    Queue: vi.fn(function (this: unknown, name: string, opts: unknown) {
      Queue(name, opts);
      return { add: queueAdd, getJob: queueGetJob };
    }) as unknown,
    QueueEvents: vi.fn(function (this: unknown, name: string, opts: unknown) {
      QueueEvents(name, opts);
      return { on: queueEventsOn };
    }) as unknown,
    Worker: vi.fn(function (this: unknown, name: string, processor: unknown, opts: unknown) {
      Worker(name, processor, opts);
      return { on: workerOn };
    }) as unknown,
  };
});

vi.mock('../src/config/env', () => ({
  loadConfig: vi.fn(() => ({
    studentMemory: {
      queueName: 'student-memory-test',
      maxConcurrency: 2,
    },
  })),
}));

vi.mock('../src/infrastructure/redis', () => ({
  createRedisClient: vi.fn().mockReturnValue({ mock: 'redis-connection' }),
}));

vi.mock('../src/infrastructure/logger', () => ({
  createJobLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
  }),
  logger: {
    error: vi.fn(),
  },
}));

describe('infrastructure/student-memory-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMockStorage().queueGetJob!.mockResolvedValue(null);
  });

  it('adds a missing stable job during reconciliation', async () => {
    const { reconcile } = createStudentMemoryQueue();
    const mocks = getMockStorage();
    const payload = {
      kind: 'lesson-memory-generate' as const,
      transcriptId: 'transcript-1',
      recordingId: 'recording-1',
      studentId: 'student-1',
      sourceStorageUri: 'local://confirmed/a.txt',
      sourceContentHash: 'a'.repeat(64),
      pendingEntryId: 'pending-1',
      provider: 'openai' as const,
      model: 'gpt-5.2',
    };

    await reconcile(payload, { jobId: 'lesson-memory:transcript-1' });

    expect(mocks.queueGetJob).toHaveBeenCalledWith('lesson-memory__transcript-1');
    expect(mocks.queueAdd).toHaveBeenCalledOnce();
  });

  it('retries a retained failed stable job without adding a duplicate', async () => {
    const retry = vi.fn();
    getMockStorage().queueGetJob!.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('failed'),
      retry,
    });
    const { reconcile } = createStudentMemoryQueue();

    await reconcile(
      {
        kind: 'lesson-memory-generate',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        studentId: 'student-1',
        sourceStorageUri: 'local://confirmed/a.txt',
        sourceContentHash: 'a'.repeat(64),
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      { jobId: 'lesson-memory:transcript-1' },
    );

    expect(retry).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(getMockStorage().queueAdd).not.toHaveBeenCalled();
  });

  it('converges when concurrent reconcilers both observe the same failed job', async () => {
    let stateReads = 0;
    let retryCalls = 0;
    const job = {
      getState: vi.fn(async () => {
        stateReads += 1;
        return stateReads <= 2 ? 'failed' : 'waiting';
      }),
      retry: vi.fn(async () => {
        retryCalls += 1;
        if (retryCalls === 2) throw new Error('Job is not in the failed state');
      }),
    };
    getMockStorage().queueGetJob!.mockResolvedValue(job);
    const { reconcile } = createStudentMemoryQueue();
    const payload = {
      kind: 'lesson-memory-generate' as const,
      transcriptId: 'transcript-1',
      recordingId: 'recording-1',
      studentId: 'student-1',
      sourceStorageUri: 'local://confirmed/a.txt',
      sourceContentHash: 'a'.repeat(64),
      pendingEntryId: 'pending-1',
      provider: 'openai' as const,
      model: 'gpt-5.2',
    };

    await expect(
      Promise.all([
        reconcile(payload, { jobId: 'lesson-memory:transcript-1' }),
        reconcile(payload, { jobId: 'lesson-memory:transcript-1' }),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    expect(job.retry).toHaveBeenCalledTimes(2);
    expect(getMockStorage().queueAdd).not.toHaveBeenCalled();
  });

  it('re-adds the stable job if it disappears during failed-job retry', async () => {
    getMockStorage().queueGetJob!.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('failed'),
      retry: vi.fn().mockRejectedValue(new Error('Missing key for job')),
    });
    getMockStorage().queueGetJob!.mockResolvedValueOnce(null);
    const { reconcile } = createStudentMemoryQueue();

    await reconcile(
      {
        kind: 'lesson-memory-generate',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        studentId: 'student-1',
        sourceStorageUri: 'local://confirmed/a.txt',
        sourceContentHash: 'a'.repeat(64),
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      { jobId: 'lesson-memory:transcript-1' },
    );

    expect(getMockStorage().queueAdd).toHaveBeenCalledOnce();
  });

  it.each([
    'waiting',
    'active',
    'completed',
  ])('leaves an existing %s stable job unchanged', async (state) => {
    getMockStorage().queueGetJob!.mockResolvedValue({
      getState: vi.fn().mockResolvedValue(state),
      retry: vi.fn(),
    });
    const { reconcile } = createStudentMemoryQueue();

    await reconcile(
      {
        kind: 'lesson-memory-generate',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        studentId: 'student-1',
        sourceStorageUri: 'local://confirmed/a.txt',
        sourceContentHash: 'a'.repeat(64),
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      { jobId: 'lesson-memory:transcript-1' },
    );

    expect(getMockStorage().queueAdd).not.toHaveBeenCalled();
  });

  it('sanitizes student-memory job ids so BullMQ accepts them', async () => {
    const { enqueue } = createStudentMemoryQueue();
    const mocks = getMockStorage();

    await enqueue(
      {
        kind: 'lesson-memory-generate',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        studentId: 'student-1',
        sourceStorageUri: 'local://confirmed/a.txt',
        sourceContentHash: 'a'.repeat(64),
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      { jobId: 'lesson-memory:transcript-1' },
    );

    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'lesson-memory-generate',
      expect.objectContaining({
        transcriptId: 'transcript-1',
      }),
      expect.objectContaining({
        jobId: 'lesson-memory__transcript-1',
        attempts: 5,
      }),
    );
  });

  it('creates a worker with student-memory concurrency settings', () => {
    const processor = vi.fn();
    const mocks = getMockStorage();

    createStudentMemoryWorker(processor);

    expect(mocks.Worker).toHaveBeenCalledWith(
      'student-memory-test',
      processor,
      expect.objectContaining({
        concurrency: 2,
      }),
    );
  });
});
