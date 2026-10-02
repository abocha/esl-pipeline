import { beforeEach, describe, expect, it, vi } from 'vitest';

let capturedProcessor: ((job: { data: Record<string, unknown> }) => Promise<void>) | undefined;

const worker = {
  name: 'test-queue',
  waitUntilReady: vi.fn(async () => undefined),
  isRunning: () => true,
  isPaused: () => false,
  on: vi.fn(),
  close: vi.fn(),
};

vi.mock('../src/application/process-queue-job.js', () => ({
  processQueueJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/bootstrap/env.js', () => ({
  loadBatchBackendEnv: vi.fn(),
}));

vi.mock('../src/config/env.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    pg: {
      enabled: true,
      autoMigrateOnBoot: false,
      applicationName: 'esl-pipeline-test-worker',
      poolMax: 8,
      idleTimeoutMs: 30000,
      connectionTimeoutMs: 5000,
    },
  }),
}));

vi.mock('../src/infrastructure/job-event-redis-bridge.js', () => ({
  enableRedisJobEventBridge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/infrastructure/migrations.js', () => ({
  runMigrationsIfConfigured: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/infrastructure/queue-bullmq.js', () => ({
  createJobWorker: vi.fn((processor: (job: { data: Record<string, unknown> }) => Promise<void>) => {
    capturedProcessor = processor;
    return worker;
  }),
}));

import { processQueueJob } from '../src/application/process-queue-job.js';
import { createJobWorker } from '../src/infrastructure/queue-bullmq.js';
import { startWorker } from '../src/transport/worker-runner.js';

describe('transport/worker-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = undefined;
  });

  it('forwards the full BullMQ payload to processQueueJob', async () => {
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((..._args: unknown[]) => {
      return process;
    }) as typeof process.on);

    try {
      await startWorker();

      expect(createJobWorker).toHaveBeenCalledTimes(1);
      expect(capturedProcessor).toBeTypeOf('function');

      const payload = {
        jobId: 'job-rerun-1',
        executionMode: 'rerun' as const,
        sourceJobId: 'job-root-1',
        rerun: {
          regeneratePronunciationChunkAudio: true,
          pronunciationChunkTtsProvider: 'elevenlabs' as const,
          pronunciationChunkTtsModel: 'eleven_multilingual_v2' as const,
        },
      };

      await capturedProcessor?.({ data: payload });

      expect(processQueueJob).toHaveBeenCalledWith(payload);
    } finally {
      processOnSpy.mockRestore();
    }
  });
});
