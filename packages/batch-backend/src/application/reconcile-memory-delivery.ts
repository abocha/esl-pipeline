import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import {
  deliverCanonicalPendingLessonMemory,
  listReadyLessonMemoryMissingSnapshotObligations,
  listRecoverableMemoryDeliveries,
  markMemoryDeliveryChecked,
} from '../domain/memory-replay-delivery.js';
import { supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork } from '../domain/student-memory-openai-batch-repository.js';
import { logger } from '../infrastructure/logger.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';
import { requestStudentMemorySnapshotRefresh } from './request-student-memory-snapshot-refresh.js';

export async function reconcileMemoryDelivery(overrides?: {
  list?: typeof listRecoverableMemoryDeliveries;
  markChecked?: typeof markMemoryDeliveryChecked;
  queue?: Pick<ReturnType<typeof createStudentMemoryQueue>, 'reconcile'>;
  supersedeBatchClaims?: typeof supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork;
  listReadyLessons?: typeof listReadyLessonMemoryMissingSnapshotObligations;
  requestRefresh?: typeof requestStudentMemorySnapshotRefresh;
  config?: BatchBackendConfig;
}) {
  const payloads = await (overrides?.list ?? listRecoverableMemoryDeliveries)();
  const queue = overrides?.queue ?? createStudentMemoryQueue();
  for (const payload of payloads) {
    if (
      payload.kind !== 'homework-memory-generate' &&
      payload.kind !== 'lesson-memory-generate' &&
      payload.kind !== 'student-memory-snapshot-refresh'
    )
      continue;
    try {
      // Intent may have committed before request-time Batch fencing completed.
      // Repair that prerequisite before making ordinary snapshot work runnable.
      if (payload.kind === 'student-memory-snapshot-refresh') {
        await (
          overrides?.supersedeBatchClaims ?? supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork
        )({
          workload: 'student_memory_snapshot',
          canonicalScopeKey: payload.studentId,
          pendingSnapshotIntentId: payload.pendingEntryId,
        });
      } else if (payload.kind === 'lesson-memory-generate') {
        await deliverCanonicalPendingLessonMemory(payload, async (client) => {
          await (
            overrides?.supersedeBatchClaims ?? supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork
          )({ workload: 'lesson_memory', canonicalScopeKey: payload.transcriptId }, { client });
          await queue.reconcile(payload, {
            jobId: `lesson-memory:${payload.transcriptId}:${payload.sourceContentHash}`,
            requeueCompleted: true,
          });
        });
        continue;
      }
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
  for (const source of await (
    overrides?.listReadyLessons ?? listReadyLessonMemoryMissingSnapshotObligations
  )()) {
    try {
      await (overrides?.requestRefresh ?? requestStudentMemorySnapshotRefresh)({
        config: overrides?.config ?? loadConfig(),
        params: { ...source, trigger: 'lesson-memory-ready' },
        overrides: { queue },
      });
    } catch (error) {
      logger.warn('Ready lesson-memory snapshot handoff recovery failed', {
        lessonMemoryEntryId: source.sourceEntryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
