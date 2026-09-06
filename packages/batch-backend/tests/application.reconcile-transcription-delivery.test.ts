import { describe, expect, it, vi } from 'vitest';

import { reconcileTranscriptionDelivery } from '../src/application/reconcile-transcription-delivery.js';

describe('reconcile transcription delivery', () => {
  it('restores delivery for each durable nonterminal run without manufacturing a run', async () => {
    const ensureDelivery = vi.fn(async () => undefined);
    await reconcileTranscriptionDelivery({
      runs: {
        listRequiringDelivery: async () => [
          { id: 'run-queued', recordingId: 'recording-queued' },
          { id: 'run-retry', recordingId: 'recording-retry' },
        ],
      },
      queue: { ensureDelivery },
      limit: 10,
    });
    expect(ensureDelivery).toHaveBeenCalledTimes(2);
    expect(ensureDelivery).toHaveBeenNthCalledWith(1, {
      runId: 'run-queued',
      recordingId: 'recording-queued',
    });
  });
});
