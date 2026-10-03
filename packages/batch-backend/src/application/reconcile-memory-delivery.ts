import {
  listRecoverableMemoryDeliveries,
  markMemoryDeliveryChecked,
} from '../domain/memory-replay-delivery.js';
import { logger } from '../infrastructure/logger.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';

export async function reconcileMemoryDelivery(overrides?: {
  list?: typeof listRecoverableMemoryDeliveries;
  markChecked?: typeof markMemoryDeliveryChecked;
  queue?: Pick<ReturnType<typeof createStudentMemoryQueue>, 'reconcile'>;
}) {
  const payloads = await (overrides?.list ?? listRecoverableMemoryDeliveries)();
  const queue = overrides?.queue ?? createStudentMemoryQueue();
  for (const payload of payloads) {
    if (
      payload.kind !== 'homework-memory-generate' &&
      payload.kind !== 'student-memory-snapshot-refresh'
    )
      continue;
    try {
      await queue.reconcile(payload, {
        jobId:
          payload.kind === 'homework-memory-generate'
            ? `homework-memory:${payload.pendingEntryId}`
            : `student-memory-snapshot:${payload.studentId}:${payload.pendingEntryId}`,
        requeueCompleted: true,
      });
    } catch (error) {
      logger.warn('Memory intent delivery recovery failed', {
        pendingEntryId: payload.pendingEntryId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await (overrides?.markChecked ?? markMemoryDeliveryChecked)(payload);
    }
  }
}
