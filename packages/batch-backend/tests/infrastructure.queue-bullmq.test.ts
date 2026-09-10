import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import SUT after mocks so it binds to the mocked modules.
import {
  createJobQueue,
  createJobWorker,
  recoverAssignmentShareQueue,
} from '../src/infrastructure/queue-bullmq.js';

// Helper to get or create global mock storage
function getMockStorage() {
  if (!(globalThis as any).__testMockStorage) {
    (globalThis as any).__testMockStorage = {};
  }
  return (globalThis as any).__testMockStorage;
}

vi.mock('bullmq', () => {
  const queueAdd = vi.fn();
  const queueGetJob = vi.fn();
  const queueOn = vi.fn();
  const queueEventsOn = vi.fn();
  const queueEventsClose = vi.fn();
  const workerOn = vi.fn();
  const workerClose = vi.fn();
  const Queue = vi.fn();
  const QueueEvents = vi.fn();
  const Worker = vi.fn();

  const storage = getMockStorage();
  storage.queueAdd = queueAdd;
  storage.queueGetJob = queueGetJob;
  storage.queueOn = queueOn;
  storage.queueEventsOn = queueEventsOn;
  storage.queueEventsClose = queueEventsClose;
  storage.workerOn = workerOn;
  storage.workerClose = workerClose;
  storage.Queue = Queue;
  storage.QueueEvents = QueueEvents;
  storage.Worker = Worker;

  return {
    Queue: vi.fn(function (this: any, name: string, opts: any) {
      const instance = {
        name,
        opts,
        add: queueAdd,
        getJob: queueGetJob,
        on: queueOn,
      };
      Queue(name, opts);
      return instance;
    }) as any,
    QueueEvents: vi.fn(function (this: any, name: string, opts: any) {
      const instance = {
        name,
        opts,
        on: queueEventsOn,
        close: queueEventsClose,
      };
      QueueEvents(name, opts);
      return instance;
    }) as any,
    Worker: vi.fn(function (this: any, name: string, processor: any, opts: any) {
      const instance = {
        name,
        processor,
        opts,
        on: workerOn,
        close: workerClose,
      };
      Worker(name, processor, opts);
      return instance;
    }) as any,
  };
});

vi.mock('../src/config/env', () => {
  const loadConfig = vi.fn();
  const storage = getMockStorage();
  storage.loadConfig = loadConfig;

  return {
    loadConfig,
  };
});

vi.mock('../src/infrastructure/redis', () => ({
  createRedisClient: vi.fn().mockReturnValue({ mock: 'redis-connection' }),
}));

vi.mock('../src/infrastructure/logger', () => {
  const createJobLoggerInfo = vi.fn();
  const createJobLoggerError = vi.fn();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();

  const storage = getMockStorage();
  storage.createJobLoggerInfo = createJobLoggerInfo;
  storage.createJobLoggerError = createJobLoggerError;
  storage.loggerInfo = loggerInfo;
  storage.loggerError = loggerError;

  return {
    createJobLogger: vi.fn().mockReturnValue({
      info: createJobLoggerInfo,
      error: createJobLoggerError,
    }),
    logger: {
      info: loggerInfo,
      error: loggerError,
    },
  };
});

describe('infrastructure/queue-bullmq', () => {
  /**
   * Intent:
   * - Verify our contract with BullMQ:
   *   - Correct queue name and connection wiring.
   *   - enqueue() uses expected retry/backoff and cleanup semantics.
   *   - Worker is created with expected concurrency and hooks into logging.
   * - Avoid re-testing BullMQ itself; focus on our options and event wiring.
   */

  beforeEach(() => {
    vi.clearAllMocks();
    getMockStorage().queueGetJob.mockResolvedValue(null);

    // Stable test-local config values.
    getMockStorage().loadConfig.mockReturnValue({
      queue: { name: 'esl-jobs-test' },
      worker: {
        concurrency: 5,
        maxConcurrentFfmpeg: 3,
      },
      redis: {
        enabled: true,
        host: 'localhost',
        port: 6379,
      },
    });
  });

  it('createJobQueue creates Queue/QueueEvents once and enqueues with retry/backoff', async () => {
    const { enqueue } = createJobQueue();
    const mocks = getMockStorage();

    // Constructors are our hoisted mocks.
    expect(vi.isMockFunction(mocks.Queue)).toBe(true);
    expect(vi.isMockFunction(mocks.QueueEvents)).toBe(true);
    expect(mocks.Queue).toHaveBeenCalledTimes(1);
    expect(mocks.QueueEvents).toHaveBeenCalledTimes(1);

    expect(mocks.Queue).toHaveBeenCalledWith(
      'esl-jobs-test',
      expect.objectContaining({
        connection: { mock: 'redis-connection' },
      }),
    );

    expect(mocks.QueueEvents).toHaveBeenCalledWith(
      'esl-jobs-test',
      expect.objectContaining({
        connection: { mock: 'redis-connection' },
      }),
    );

    await enqueue({ jobId: 'job-1' });

    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = mocks.queueAdd.mock.calls[0];

    expect(name).toBe('assignment');
    expect(payload).toEqual({ jobId: 'job-1' });
    expect(opts).toMatchObject({
      jobId: 'job-1',
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });

    // Subsequent calls reuse singleton, not recreate.
    createJobQueue();
    expect(mocks.Queue).toHaveBeenCalledTimes(1);
    expect(mocks.QueueEvents).toHaveBeenCalledTimes(1);
  });

  it('reconciles missing, retained failed, and existing stable jobs without cloning identity', async () => {
    const { reconcile } = createJobQueue();
    const mocks = getMockStorage();

    await reconcile({ jobId: 'job-missing' });
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'assignment',
      { jobId: 'job-missing' },
      expect.objectContaining({ jobId: 'job-missing', attempts: 5 }),
    );

    const retry = vi.fn();
    mocks.queueAdd.mockClear();
    mocks.queueGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('failed'),
      retry,
    });
    await reconcile({ jobId: 'job-failed' });
    expect(retry).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(mocks.queueAdd).not.toHaveBeenCalled();

    mocks.queueGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('active'),
      retry: vi.fn(),
    });
    await reconcile({ jobId: 'job-active' });
    expect(mocks.queueAdd).not.toHaveBeenCalled();

    mocks.queueGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('completed'),
      retry: vi.fn(),
    });
    await expect(reconcile({ jobId: 'job-contradictory' })).rejects.toMatchObject({
      name: 'QueueJobStateConflictError',
      jobId: 'job-contradictory',
      queueState: 'completed',
    });

    mocks.queueAdd.mockClear();
    mocks.queueGetJob
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('failed'),
        retry: vi.fn().mockRejectedValue(new Error('job was removed concurrently')),
      })
      .mockResolvedValueOnce(null);
    await reconcile({ jobId: 'job-failed-removed' });
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'assignment',
      { jobId: 'job-failed-removed' },
      expect.objectContaining({ jobId: 'job-failed-removed' }),
    );
  });

  it('reactivates only the matching retained terminal root Share job', async () => {
    const mocks = getMockStorage();
    mocks.queueGetJob.mockResolvedValue(null);
    await recoverAssignmentShareQueue({ jobId: 'job-missing' });
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'assignment',
      { jobId: 'job-missing' },
      expect.objectContaining({ jobId: 'job-missing' }),
    );

    const retry = vi.fn();
    mocks.queueAdd.mockClear();
    mocks.queueGetJob.mockResolvedValue({
      data: { jobId: 'job-share' },
      getState: vi.fn().mockResolvedValue('failed'),
      retry,
    });
    await recoverAssignmentShareQueue({ jobId: 'job-share' });
    expect(retry).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });

    retry.mockClear();
    mocks.queueGetJob.mockResolvedValue({
      data: { jobId: 'job-share' },
      getState: vi.fn().mockResolvedValue('completed'),
      retry,
    });

    await recoverAssignmentShareQueue({ jobId: 'job-share' });

    expect(retry).toHaveBeenCalledWith('completed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(mocks.queueAdd).not.toHaveBeenCalled();

    mocks.queueGetJob.mockResolvedValue({
      data: { jobId: 'job-share', executionMode: 'correction' },
      getState: vi.fn().mockResolvedValue('completed'),
      retry: vi.fn(),
    });
    await expect(recoverAssignmentShareQueue({ jobId: 'job-share' })).rejects.toMatchObject({
      name: 'QueueJobStateConflictError',
      queueState: 'payload_mismatch',
    });

    mocks.queueGetJob.mockResolvedValue({
      data: { jobId: 'job-share' },
      getState: vi.fn().mockResolvedValue('active'),
      retry: vi.fn(),
    });
    await expect(recoverAssignmentShareQueue({ jobId: 'job-share' })).rejects.toMatchObject({
      name: 'QueueJobStateConflictError',
      queueState: 'active',
    });
  });

  it('createJobWorker constructs Worker with expected queue name and concurrency', () => {
    const processor = vi.fn();
    const worker = createJobWorker(processor);
    const mocks = getMockStorage();

    expect(vi.isMockFunction(mocks.Worker)).toBe(true);
    expect(mocks.Worker).toHaveBeenCalledTimes(1);
    const [queueName, passedProcessor, opts] = mocks.Worker.mock.calls[0] as unknown as [
      string,
      any,
      any,
    ];

    expect(queueName).toBe('esl-jobs-test');
    expect(passedProcessor).toBe(processor);
    expect(opts).toMatchObject({
      connection: { mock: 'redis-connection' },
      concurrency: 5,
    });

    // Ensures we register some event handlers; we do not assert exact messages.
    expect(mocks.workerOn).toHaveBeenCalled();
    // Verify the returned object is the worker instance itself
    expect(worker).toBeDefined();
  });

  it('cancelQueuedJob removes queue job when it exists and is removable', async () => {
    const { cancelQueuedJob } = createJobQueue();
    const mocks = getMockStorage();
    const remove = vi.fn(async () => {});
    mocks.queueGetJob.mockResolvedValue({ remove });

    await expect(cancelQueuedJob('job-2')).resolves.toBe('removed');
    expect(mocks.queueGetJob).toHaveBeenCalledWith('job-2');
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
