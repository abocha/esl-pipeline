import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork } from '../domain/student-memory-openai-batch-repository.js';
import {
  type EnsurePendingStudentMemorySnapshotResult,
  ensurePendingStudentMemorySnapshot,
} from '../domain/student-memory-snapshot-repository.js';
import { logger } from '../infrastructure/logger.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';
import { resolveGenerationTarget } from './generation-policy.js';
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
  replayKey?: string;
}

export interface RequestStudentMemorySnapshotRefreshDependencies {
  snapshots: {
    ensurePending: typeof ensurePendingStudentMemorySnapshot;
  };
  batchClaims: {
    supersedeForOnlineWork: typeof supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork;
  };
  queue: {
    reconcile: ReturnType<typeof createStudentMemoryQueue>['reconcile'];
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
    if (!args.params.replayKey?.trim())
      throw new Error('Manual snapshot replay requires replayKey');
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

  const target = resolveGenerationTarget({
    config: args.config.generation,
    workload: 'student_memory_snapshot',
    providerOverride: args.params.providerOverride,
    modelOverride: args.params.modelOverride,
  });

  const requestedAt = now();
  const isAutomaticHomeworkRefresh = args.params.trigger === 'homework-memory-ready';
  const isAutomaticRefresh = args.params.trigger !== 'manual-replay';
  const ensureParams = {
    replayKey: args.params.replayKey?.trim(),
    studentId: args.params.studentId,
    schemaVersion: STUDENT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: requestedAt,
    provider: target.provider,
    model: target.model,
    sourceEntryId,
    reuseReadyHomeworkSource: isAutomaticHomeworkRefresh,
    reuseReadyLessonSource: args.params.trigger === 'lesson-memory-ready',
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

  if (isAutomaticRefresh) {
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

  await queue.reconcile(
    {
      kind: 'student-memory-snapshot-refresh',
      studentId: args.params.studentId,
      pendingEntryId: pending.entry.id,
      provider: pending.entry.provider as GenerationProvider,
      model: pending.entry.model,
      trigger: args.params.trigger,
      sourceEntryId,
      strategy: args.params.strategy ?? null,
      operatorReason: args.params.operatorReason?.trim() || null,
      requestCandidateRefresh: args.params.requestCandidateRefresh === true,
    },
    {
      jobId: `student-memory-snapshot:${args.params.studentId}:${pending.entry.id}`,
      requeueCompleted: true,
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
