import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const worker = {
  name: 'test-queue',
  waitUntilReady: vi.fn(async () => undefined),
  isRunning: () => true,
  isPaused: () => false,
  on: vi.fn(),
  close: vi.fn(async () => undefined),
};
const config = {
  pg: {
    enabled: true,
    autoMigrateOnBoot: false,
    poolMax: 4,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 5_000,
  },
  transcription: { reconciliationBatchSize: 5, reconciliationIntervalMs: 30_000 },
  stt: { storeRawResponse: false },
  recordings: { audioCleanupEnabled: false, audioRecoveryTtlDays: 7 },
};

vi.mock('../src/bootstrap/env.js', () => ({ loadBatchBackendEnv: vi.fn() }));
vi.mock('../src/config/env.js', () => ({ loadConfig: vi.fn(() => config) }));
vi.mock('../src/infrastructure/migrations.js', () => ({
  runMigrationsIfConfigured: vi.fn(async () => undefined),
}));
vi.mock('../src/application/validate-transcription-config.js', () => ({
  validateTranscriptionConfig: vi.fn(async () => undefined),
}));
vi.mock('../src/infrastructure/recording-event-redis-bridge.js', () => ({
  enableRedisRecordingEventBridge: vi.fn(async () => undefined),
}));
vi.mock('../src/application/reconcile-transcription-delivery.js', () => ({
  reconcileTranscriptionDelivery: vi.fn(async () => 0),
}));
vi.mock('../src/application/reconcile-upload-candidates.js', () => ({
  reconcileUploadCandidates: vi.fn(async () => 0),
}));
vi.mock('../src/application/process-transcribe-job.js', () => ({
  processTranscribeJob: vi.fn(async () => undefined),
}));
vi.mock('../src/application/sweep-recording-audio.js', () => ({
  sweepRecordingAudio: vi.fn(async () => ({ claimed: 0, deleted: 0, failed: 0 })),
}));
vi.mock('../src/infrastructure/transcribe-queue.js', () => ({
  createTranscribeWorker: vi.fn(() => worker),
}));
vi.mock('../src/infrastructure/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { sweepRecordingAudio } from '../src/application/sweep-recording-audio.js';
import { logger } from '../src/infrastructure/logger.js';
import { startTranscribeWorker } from '../src/transport/transcribe-worker.js';

describe('transport/transcribe-worker recording audio cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    config.recordings.audioCleanupEnabled = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves recording cleanup idle when the deployment gate is disabled', async () => {
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process);
    try {
      await startTranscribeWorker();
      expect(sweepRecordingAudio).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Startup configuration resolved',
        expect.objectContaining({ sttStoreRawResponse: false }),
      );
    } finally {
      processOn.mockRestore();
    }
  });

  it('runs bounded cleanup without crashing the worker when a sweep fails', async () => {
    config.recordings.audioCleanupEnabled = true;
    vi.mocked(sweepRecordingAudio).mockRejectedValueOnce(new Error('storage unavailable'));
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process);
    try {
      await expect(startTranscribeWorker()).resolves.toBeUndefined();
      expect(sweepRecordingAudio).toHaveBeenCalledWith({
        enabled: true,
        recoveryTtlDays: 7,
        limit: 5,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ message: 'Recording audio cleanup sweep failed' }),
      );
    } finally {
      processOn.mockRestore();
    }
  });
});
