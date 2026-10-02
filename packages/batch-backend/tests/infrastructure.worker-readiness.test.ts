import { hostname } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { reportWorkerReady } from '../src/infrastructure/worker-readiness.js';

describe('bounded worker readiness', () => {
  it('does not report readiness before initialization resolves', async () => {
    let initialize!: () => void;
    const info = vi.fn();
    const worker = {
      name: 'esl-jobs',
      isRunning: () => true,
      isPaused: () => false,
      waitUntilReady: () =>
        new Promise<void>((resolve) => {
          initialize = resolve;
        }),
    };
    const ready = reportWorkerReady(worker, 'batch-worker', { info });
    expect(info).not.toHaveBeenCalled();
    initialize();
    await ready;
    expect(info).toHaveBeenCalledWith(
      'BullMQ consumer initialized',
      expect.objectContaining({
        event: 'worker_ready',
        service: 'batch-worker',
        queue: 'esl-jobs',
        instance: { hostname: hostname(), pid: process.pid, startupId: expect.any(String) },
        timestamp: expect.any(String),
      }),
    );
  });

  it('rejects deadline, initialization failure, stopped and paused workers without evidence', async () => {
    const info = vi.fn();
    const worker = {
      name: 'esl-jobs',
      isRunning: () => true,
      isPaused: () => false,
      waitUntilReady: () => new Promise<void>(() => {}),
    };
    await expect(reportWorkerReady(worker, 'batch-worker', { info }, 5)).rejects.toThrow(
      'deadline',
    );
    await expect(
      reportWorkerReady(
        {
          ...worker,
          waitUntilReady: async () => {
            throw new Error('startup failed');
          },
        },
        'batch-worker',
        { info },
      ),
    ).rejects.toThrow('startup failed');
    for (const state of [{ isRunning: () => false }, { isPaused: () => true }]) {
      await expect(
        reportWorkerReady({ ...worker, ...state, waitUntilReady: async () => {} }, 'batch-worker', {
          info,
        }),
      ).rejects.toThrow('not running/unpaused');
    }
    expect(info).not.toHaveBeenCalled();
  });
});
