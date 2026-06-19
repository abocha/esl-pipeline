import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  getHomeworkMemoryEntryById,
  getLatestReadyHomeworkMemoryByAssignmentLineageKey,
  markHomeworkMemoryEntryFailed,
  supersedePendingHomeworkMemoryEntriesForAssignmentLineage,
} from '../domain/homework-memory-repository.js';
import { generateHomeworkMemoryFromSource } from './homework-memory-generation.js';
import {
  buildHomeworkMemoryEnvelope,
  buildHomeworkMemoryPrompt,
} from './homework-memory-prompt.js';
import { resolveHomeworkMemorySourceFromSucceededJob } from './homework-memory-source.js';
import { requestStudentMemorySnapshotRefresh } from './request-student-memory-snapshot-refresh.js';

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
  };
  snapshots: {
    requestRefresh: typeof requestStudentMemorySnapshotRefresh;
  };
}

export async function processHomeworkMemoryJob(args: {
  config: BatchBackendConfig['generation'];
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

  const pendingEntry = await homeworkMemory.getById(args.payload.pendingEntryId);
  if (!pendingEntry || pendingEntry.status !== 'pending') {
    return;
  }
  const forceRegenerate = pendingEntry.generationNotes?.forceRegenerate === true;

  try {
    const source = await sourceResolver(args.payload.jobId);
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

    const prompt = buildHomeworkMemoryPrompt({
      normalizedMarkdown: source.normalizedMarkdown,
      source,
    });
    const envelope = buildHomeworkMemoryEnvelope({
      normalizedMarkdown: source.normalizedMarkdown,
      source,
    });

    const result = await generator({
      config: args.config,
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

    await homeworkMemory.supersedePendingForAssignmentLineage({
      assignmentLineageKey: source.assignmentLineageKey,
      supersededById: result.entry.id,
      supersededAt: result.entry.generatedAt,
      maxGeneratedAt: pendingEntry.generatedAt,
    });
    await snapshots.requestRefresh({
      config: { generation: args.config } as BatchBackendConfig,
      params: {
        studentId: args.payload.studentId,
        trigger: 'homework-memory-ready',
        sourceEntryId: result.entry.id,
      },
    });
  } catch (error) {
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
