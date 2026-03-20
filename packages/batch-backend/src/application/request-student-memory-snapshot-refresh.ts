import { randomUUID } from 'node:crypto';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';
import { logger } from '../infrastructure/logger.js';
import { resolveGenerationCandidates } from './generation-policy.js';

export interface RequestStudentMemorySnapshotRefreshParams {
  studentId: string;
  trigger: 'lesson-memory-ready' | 'homework-memory-ready' | 'manual-replay';
  sourceEntryId?: string | null;
  providerOverride?: GenerationProvider;
  modelOverride?: string;
}

export async function requestStudentMemorySnapshotRefresh(args: {
  config: BatchBackendConfig;
  params: RequestStudentMemorySnapshotRefreshParams;
}): Promise<void> {
  const candidate = resolveGenerationCandidates({
    config: args.config.generation,
    providerOverride: args.params.providerOverride,
    modelOverride: args.params.modelOverride,
  })[0];
  if (!candidate) {
    throw new Error('No generation candidate is available for student-memory snapshot extraction');
  }

  const queueSuffix =
    args.params.sourceEntryId && args.params.sourceEntryId.trim().length > 0
      ? args.params.sourceEntryId
      : `${args.params.trigger}:${randomUUID()}`;

  await createStudentMemoryQueue().enqueue(
    {
      kind: 'student-memory-snapshot-refresh',
      studentId: args.params.studentId,
      provider: candidate.provider,
      model: candidate.model,
      trigger: args.params.trigger,
      sourceEntryId: args.params.sourceEntryId ?? null,
    },
    {
      jobId: `student-memory-snapshot:${args.params.studentId}:${queueSuffix}`,
    },
  );

  logger.info('Student-memory snapshot refresh requested', {
    event: 'student_memory_snapshot_refresh_requested',
    studentId: args.params.studentId,
    trigger: args.params.trigger,
    sourceEntryId: args.params.sourceEntryId ?? null,
  });
}
