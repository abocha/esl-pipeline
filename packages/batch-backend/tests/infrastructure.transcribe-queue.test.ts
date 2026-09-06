import { beforeEach, describe, expect, it, vi } from 'vitest';

const queueAdd = vi.hoisted(() => vi.fn());
const queueGetJob = vi.hoisted(() => vi.fn());
vi.mock('bullmq', () => ({
  Queue: vi.fn(function () {
    return { add: queueAdd, getJob: queueGetJob };
  }),
  QueueEvents: vi.fn(function () {
    return { on: vi.fn() };
  }),
  Worker: vi.fn(),
}));
vi.mock('../src/config/env.js', () => ({
  loadConfig: vi.fn(() => ({ transcription: { queueName: 'transcribe-test', maxConcurrency: 1 } })),
}));
vi.mock('../src/infrastructure/redis.js', () => ({ createRedisClient: vi.fn(() => ({})) }));
vi.mock('../src/infrastructure/logger.js', () => ({
  createJobLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
  logger: { error: vi.fn() },
}));

import { createTranscribeQueue } from '../src/infrastructure/transcribe-queue.js';

describe('transcribe queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the stable run ID as the deterministic job ID and three bounded deliveries', async () => {
    await createTranscribeQueue().enqueue({ runId: 'run-1', recordingId: 'recording-1' });
    expect(queueAdd).toHaveBeenCalledWith(
      'transcribe',
      { runId: 'run-1', recordingId: 'recording-1' },
      expect.objectContaining({
        jobId: 'run-1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      }),
    );
  });

  it('keeps an already deliverable job instead of adding a replacement', async () => {
    queueGetJob.mockResolvedValue({ getState: vi.fn(async () => 'active') });
    await createTranscribeQueue().ensureDelivery({ runId: 'run-1', recordingId: 'recording-1' });
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
