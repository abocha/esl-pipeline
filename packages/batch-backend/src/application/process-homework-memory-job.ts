import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  getHomeworkMemoryEntryById,
  getLatestReadyHomeworkMemoryByAssignmentLineageKey,
  markHomeworkMemoryEntryFailed,
  supersedePendingHomeworkMemoryEntriesForAssignmentLineage,
} from '../domain/homework-memory-repository.js';
import { obsoleteMemoryReplayIntent } from '../domain/memory-replay-delivery.js';
import { flattenGenerationRequestEnvelope } from './generation-request-envelope.js';
import {
  HistoricalAssignmentReadOnlyError,
  requireTypedAssignment,
} from './historical-assignment.js';
import { generateHomeworkMemoryFromSource } from './homework-memory-generation.js';
import { buildHomeworkMemoryEnvelope } from './homework-memory-prompt.js';
import { resolveHomeworkMemorySourceFromSucceededJob } from './homework-memory-source.js';
import { requestStudentMemorySnapshotRefresh } from './request-student-memory-snapshot-refresh.js';
import {
  createStudentMemoryGenerationPacer,
  isStudentMemoryPacingDeferredError,
  type StudentMemoryGenerationPacer,
} from './student-memory-generation-pacing.js';

export interface ProcessHomeworkMemoryJobPayload {
  kind: 'homework-memory-generate';
  jobId: string;
  studentId: string;
  pendingEntryId: string;
  provider: GenerationProvider;
  model: string;
}

export interface ProcessHomeworkMemoryJobDependencies {
  sourceResolver: typeof resolveHomeworkMemorySourceFromSucceededJob;
  generator: typeof generateHomeworkMemoryFromSource;
  homeworkMemory: {
    getById: typeof getHomeworkMemoryEntryById;
    getLatestReadyByAssignmentLineageKey: typeof getLatestReadyHomeworkMemoryByAssignmentLineageKey;
    markFailed: typeof markHomeworkMemoryEntryFailed;
    supersedePendingForAssignmentLineage: typeof supersedePendingHomeworkMemoryEntriesForAssignmentLineage;
    obsoleteIntent?: typeof obsoleteMemoryReplayIntent;
  };
  snapshots: {
    requestRefresh: typeof requestStudentMemorySnapshotRefresh;
  };
  pacer: StudentMemoryGenerationPacer;
}

export async function processHomeworkMemoryJob(args: {
  config: BatchBackendConfig;
  payload: ProcessHomeworkMemoryJobPayload;
  attemptsMade?: number;
  maxAttempts?: number;
  overrides?: Partial<ProcessHomeworkMemoryJobDependencies>;
}): Promise<void> {
  const sourceResolver =
    args.overrides?.sourceResolver ?? resolveHomeworkMemorySourceFromSucceededJob;
  const generator = args.overrides?.generator ?? generateHomeworkMemoryFromSource;
  const homeworkMemory = args.overrides?.homeworkMemory ?? {
    getById: getHomeworkMemoryEntryById,
    getLatestReadyByAssignmentLineageKey: getLatestReadyHomeworkMemoryByAssignmentLineageKey,
    markFailed: markHomeworkMemoryEntryFailed,
    supersedePendingForAssignmentLineage: supersedePendingHomeworkMemoryEntriesForAssignmentLineage,
  };
  const snapshots = args.overrides?.snapshots ?? {
    requestRefresh: requestStudentMemorySnapshotRefresh,
  };
  const pacer = args.overrides?.pacer ?? createStudentMemoryGenerationPacer(args.config);

  const pendingEntry = await homeworkMemory.getById(args.payload.pendingEntryId);
  if (!pendingEntry || pendingEntry.status !== 'pending') {
    if (pendingEntry) {
      try {
        requireTypedAssignment(
          (await sourceResolver(args.payload.jobId)).format === 'assignment_v1',
        );
      } catch (error) {
        if (error instanceof HistoricalAssignmentReadOnlyError) return;
        throw error;
      }
    }
    await reconcileSnapshotForCommittedHomeworkMemory({
      config: args.config,
      payload: args.payload,
      pendingEntry,
      homeworkMemory,
      snapshots,
    });
    return;
  }
  const forceRegenerate = pendingEntry.generationNotes?.forceRegenerate === true;
  if (
    pendingEntry.studentId !== args.payload.studentId ||
    pendingEntry.jobId !== args.payload.jobId
  ) {
    throw new Error('Homework intent ownership mismatch');
  }
  args = {
    ...args,
    payload: {
      ...args.payload,
      provider: pendingEntry.provider as GenerationProvider,
      model: pendingEntry.model,
    },
  };

  try {
    const source = await sourceResolver(args.payload.jobId);
    if (
      source.studentId !== pendingEntry.studentId ||
      source.contentHash !== pendingEntry.contentHash
    ) {
      await (homeworkMemory.obsoleteIntent ?? obsoleteMemoryReplayIntent)({
        family: 'homework',
        studentId: pendingEntry.studentId,
        pendingEntryId: pendingEntry.id,
        reason: 'source_changed',
      });
      return;
    }
    const latestReady = await homeworkMemory.getLatestReadyByAssignmentLineageKey(
      source.assignmentLineageKey,
    );
    if (
      !forceRegenerate &&
      latestReady &&
      (latestReady.contentHash ?? null) === source.contentHash
    ) {
      await homeworkMemory.supersedePendingForAssignmentLineage({
        assignmentLineageKey: source.assignmentLineageKey,
        supersededById: latestReady.id,
        supersededAt: latestReady.generatedAt,
        maxGeneratedAt: pendingEntry.generatedAt,
      });
      return;
    }

    const envelope = buildHomeworkMemoryEnvelope({
      source,
    });
    const prompt = flattenGenerationRequestEnvelope(envelope);

    const result = await pacer.run({
      workload: 'homework_memory',
      provider: args.payload.provider,
      model: args.payload.model,
      prompt,
      execute: async () => {
        const current = await homeworkMemory.getById(pendingEntry.id);
        if (current?.status !== 'pending')
          return { outcome: 'stale_discarded' as const, entry: null };
        return generator({
          config: args.config.generation,
          request: {
            source,
            pendingEntryId: pendingEntry.id,
            pendingGenerationNotes: pendingEntry.generationNotes ?? null,
            provider: args.payload.provider,
            model: args.payload.model,
            prompt,
            envelope,
          },
        });
      },
    });

    if (result.outcome !== 'canonical_committed' || result.entry?.status !== 'ready') {
      return;
    }

    await homeworkMemory.supersedePendingForAssignmentLineage({
      assignmentLineageKey: source.assignmentLineageKey,
      supersededById: result.entry.id,
      supersededAt: result.entry.generatedAt,
      maxGeneratedAt: pendingEntry.generatedAt,
    });
    await snapshots.requestRefresh({
      config: args.config,
      params: {
        studentId: args.payload.studentId,
        trigger: 'homework-memory-ready',
        sourceEntryId: result.entry.id,
      },
    });
  } catch (error) {
    if (error instanceof HistoricalAssignmentReadOnlyError) {
      await homeworkMemory.markFailed({ id: pendingEntry.id, errorMessage: error.code });
      return;
    }
    if (isStudentMemoryPacingDeferredError(error)) {
      throw error;
    }
    await markFailureIfFinalAttempt({
      payload: args.payload,
      attemptsMade: args.attemptsMade,
      maxAttempts: args.maxAttempts,
      homeworkMemory,
      error,
    });
    throw error;
  }
}

async function reconcileSnapshotForCommittedHomeworkMemory(args: {
  config: BatchBackendConfig;
  payload: ProcessHomeworkMemoryJobPayload;
  pendingEntry: Awaited<ReturnType<typeof getHomeworkMemoryEntryById>>;
  homeworkMemory: {
    getById: typeof getHomeworkMemoryEntryById;
  };
  snapshots: {
    requestRefresh: typeof requestStudentMemorySnapshotRefresh;
  };
}): Promise<void> {
  if (
    !args.pendingEntry ||
    args.pendingEntry.status !== 'superseded' ||
    args.pendingEntry.jobId !== args.payload.jobId ||
    args.pendingEntry.studentId !== args.payload.studentId ||
    !args.pendingEntry.supersededById
  ) {
    return;
  }

  const canonicalEntry = await args.homeworkMemory.getById(args.pendingEntry.supersededById);
  if (
    !canonicalEntry ||
    canonicalEntry.status !== 'ready' ||
    canonicalEntry.jobId !== args.pendingEntry.jobId ||
    canonicalEntry.studentId !== args.pendingEntry.studentId ||
    canonicalEntry.assignmentLineageKey !== args.pendingEntry.assignmentLineageKey ||
    (canonicalEntry.contentHash ?? null) !== (args.pendingEntry.contentHash ?? null) ||
    canonicalEntry.generationNotes?.pendingEntryId !== args.pendingEntry.id
  ) {
    return;
  }

  await args.snapshots.requestRefresh({
    config: args.config,
    params: {
      studentId: canonicalEntry.studentId,
      trigger: 'homework-memory-ready',
      sourceEntryId: canonicalEntry.id,
    },
  });
}

async function markFailureIfFinalAttempt(args: {
  payload: ProcessHomeworkMemoryJobPayload;
  attemptsMade?: number;
  maxAttempts?: number;
  homeworkMemory: {
    markFailed: typeof markHomeworkMemoryEntryFailed;
  };
  error: unknown;
}): Promise<void> {
  const maxAttempts = args.maxAttempts ?? 1;
  const attemptNumber = (args.attemptsMade ?? 0) + 1;
  const isFinalAttempt = attemptNumber >= maxAttempts;
  if (!isFinalAttempt) {
    return;
  }

  await args.homeworkMemory.markFailed({
    id: args.payload.pendingEntryId,
    errorMessage: args.error instanceof Error ? args.error.message : String(args.error),
  });
}
