import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStudentMemoryQueue, createStudentMemoryWorker } from '../src/infrastructure/student-memory-queue.js';

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
  const queueEventsOn = vi.fn();
  const workerOn = vi.fn();
  const Queue = vi.fn();
  const QueueEvents = vi.fn();
  const Worker = vi.fn();

  const storage = getMockStorage();
  storage.queueAdd = queueAdd;
  storage.queueEventsOn = queueEventsOn;
  storage.workerOn = workerOn;
  storage.Queue = Queue;
  storage.QueueEvents = QueueEvents;
  storage.Worker = Worker;

  return {
    Queue: vi.fn(function (this: unknown, name: string, opts: unknown) {
      Queue(name, opts);
      return { add: queueAdd };
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
