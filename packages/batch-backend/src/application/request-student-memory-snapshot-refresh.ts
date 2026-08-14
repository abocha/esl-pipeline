import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork } from '../domain/student-memory-openai-batch-repository.js';
import {
  type EnsurePendingStudentMemorySnapshotResult,
  ensurePendingStudentMemorySnapshot,
} from '../domain/student-memory-snapshot-repository.js';
import { logger } from '../infrastructure/logger.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';
import { resolveGenerationCandidates } from './generation-policy.js';
import { STUDENT_MEMORY_SNAPSHOT_SCHEMA_VERSION } from './student-memory-snapshot-generation.js';
import type { StudentMemorySnapshotRefreshStrategy } from './student-memory-snapshot-generation-notes.js';

export interface RequestStudentMemorySnapshotRefreshParams {
  studentId: string;
  trigger: 'lesson-memory-ready' | 'homework-memory-ready' | 'manual-replay';
  sourceEntryId?: string | null;
  strategy?: StudentMemorySnapshotRefreshStrategy;
  operatorReason?: string | null;
  requestCandidateRefresh?: boolean | null;
  providerOverride?: GenerationProvider;
  modelOverride?: string;
}

export interface RequestStudentMemorySnapshotRefreshDependencies {
  snapshots: {
    ensurePending: typeof ensurePendingStudentMemorySnapshot;
  };
  batchClaims: {
    supersedeForOnlineWork: typeof supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork;
  };
  queue: {
    enqueue: ReturnType<typeof createStudentMemoryQueue>['enqueue'];
  };
  now: () => Date;
}

export async function requestStudentMemorySnapshotRefresh(args: {
  config: BatchBackendConfig;
  params: RequestStudentMemorySnapshotRefreshParams;
  overrides?: Partial<RequestStudentMemorySnapshotRefreshDependencies>;
}): Promise<EnsurePendingStudentMemorySnapshotResult> {
  const snapshots = args.overrides?.snapshots ?? {
    ensurePending: ensurePendingStudentMemorySnapshot,
  };
  const batchClaims = args.overrides?.batchClaims ?? {
    supersedeForOnlineWork: supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork,
  };
  const queue = args.overrides?.queue ?? createStudentMemoryQueue();
  const now = args.overrides?.now ?? (() => new Date());
  const sourceEntryId = args.params.sourceEntryId?.trim() || null;

  if (args.params.trigger === 'manual-replay') {
    if (!args.params.strategy) {
      throw new Error('Manual student-memory snapshot replay requires --strategy');
    }
    if (!args.params.operatorReason?.trim()) {
      throw new Error('Manual student-memory snapshot replay requires --reason');
    }
    if (
      args.params.strategy !== 'manual_rebuild_v1_1' &&
      args.params.strategy !== 'full_rebuild_v1'
    ) {
      throw new Error('Manual student-memory snapshot replay requires a manual rebuild strategy');
    }
  } else if (!sourceEntryId) {
    throw new Error('Student-memory snapshot refresh requires sourceEntryId');
  }

  const candidate = resolveGenerationCandidates({
    config: args.config.generation,
    workload: 'student_memory_extraction',
    providerOverride: args.params.providerOverride,
    modelOverride: args.params.modelOverride,
  })[0];
  if (!candidate) {
    throw new Error('No generation candidate is available for student-memory snapshot extraction');
  }

  const requestedAt = now();
  const isAutomaticHomeworkRefresh = args.params.trigger === 'homework-memory-ready';
  const ensureParams = {
    studentId: args.params.studentId,
    schemaVersion: STUDENT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: requestedAt,
    provider: candidate.provider,
    model: candidate.model,
    sourceEntryId,
    reuseReadyHomeworkSource: isAutomaticHomeworkRefresh,
    generationNotes: {
      trigger: args.params.trigger,
      sourceEntryId,
      strategy: args.params.strategy ?? null,
      operatorReason: args.params.operatorReason?.trim() || null,
      requestCandidateRefresh: args.params.requestCandidateRefresh === true,
      requestedAt: requestedAt.toISOString(),
    },
  };
  let pending = await snapshots.ensurePending(ensureParams);

  if (pending.outcome === 'already_reconciled') {
    logger.info('Student-memory snapshot refresh requested', {
      event: 'student_memory_snapshot_refresh_requested',
      studentId: args.params.studentId,
      trigger: args.params.trigger,
      sourceEntryId,
      pendingEntryId: pending.entry.id,
      outcome: pending.outcome,
    });
    return pending;
  }

  await batchClaims.supersedeForOnlineWork({
    workload: 'student_memory_snapshot',
    canonicalScopeKey: args.params.studentId,
  });

  if (isAutomaticHomeworkRefresh) {
    pending = await snapshots.ensurePending(ensureParams);
    if (pending.outcome === 'already_reconciled') {
      logger.info('Student-memory snapshot refresh requested', {
        event: 'student_memory_snapshot_refresh_requested',
        studentId: args.params.studentId,
        trigger: args.params.trigger,
        sourceEntryId,
        pendingEntryId: pending.entry.id,
        outcome: pending.outcome,
      });
      return pending;
    }
  }

  await queue.enqueue(
    {
      kind: 'student-memory-snapshot-refresh',
      studentId: args.params.studentId,
      pendingEntryId: pending.entry.id,
      provider: candidate.provider,
      model: candidate.model,
      trigger: args.params.trigger,
      sourceEntryId,
      strategy: args.params.strategy ?? null,
      operatorReason: args.params.operatorReason?.trim() || null,
      requestCandidateRefresh: args.params.requestCandidateRefresh === true,
    },
    {
      jobId: `student-memory-snapshot:${args.params.studentId}:${pending.entry.id}`,
    },
  );

  logger.info('Student-memory snapshot refresh requested', {
    event: 'student_memory_snapshot_refresh_requested',
    studentId: args.params.studentId,
    trigger: args.params.trigger,
    sourceEntryId,
    pendingEntryId: pending.entry.id,
    outcome: pending.outcome,
  });

  return pending;
}
