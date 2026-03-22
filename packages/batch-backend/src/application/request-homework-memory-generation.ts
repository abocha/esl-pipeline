import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  ensurePendingHomeworkMemoryEntry,
  type EnsurePendingHomeworkMemoryEntryResult,
} from '../domain/homework-memory-repository.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';
import { logger } from '../infrastructure/logger.js';
import { resolveGenerationCandidates } from './generation-policy.js';
import { HOMEWORK_MEMORY_SCHEMA_VERSION } from './homework-memory-generation.js';
import { resolveHomeworkMemorySourceFromSucceededJob } from './homework-memory-source.js';

export interface RequestHomeworkMemoryGenerationDependencies {
  source: {
    resolveFromSucceededJob: typeof resolveHomeworkMemorySourceFromSucceededJob;
  };
  homeworkMemory: {
    ensurePending: typeof ensurePendingHomeworkMemoryEntry;
  };
  queue: {
    enqueue: ReturnType<typeof createStudentMemoryQueue>['enqueue'];
  };
  now: () => Date;
}

export async function requestHomeworkMemoryGeneration(args: {
  config: BatchBackendConfig;
  params: {
    jobId: string;
    studentId: string | null;
    providerOverride?: GenerationProvider;
    modelOverride?: string;
    forceRegenerate?: boolean;
  };
  overrides?: Partial<RequestHomeworkMemoryGenerationDependencies>;
}): Promise<EnsurePendingHomeworkMemoryEntryResult | null> {
  if (!args.params.studentId) {
    return null;
  }

  const source = args.overrides?.source ?? {
    resolveFromSucceededJob: resolveHomeworkMemorySourceFromSucceededJob,
  };
  const homeworkMemory = args.overrides?.homeworkMemory ?? {
    ensurePending: ensurePendingHomeworkMemoryEntry,
  };
  const queue = args.overrides?.queue ?? createStudentMemoryQueue();
  const now = args.overrides?.now ?? (() => new Date());

  const candidate = resolveGenerationCandidates({
    config: args.config.generation,
    providerOverride: args.params.providerOverride,
    modelOverride: args.params.modelOverride,
  })[0];
  if (!candidate) {
    throw new Error('No generation candidate is available for homework-memory extraction');
  }

  const sourceBundle = await source.resolveFromSucceededJob(args.params.jobId);
  if (sourceBundle.assignmentLineageKey !== args.params.jobId) {
    logger.info('Homework-memory generation skipped for rerun descendant job', {
      event: 'homework_memory_generation_skipped_rerun_descendant',
      jobId: args.params.jobId,
      assignmentLineageKey: sourceBundle.assignmentLineageKey,
      studentId: args.params.studentId,
    });
    return null;
  }

  const requestedAt = now();
  const pending = await homeworkMemory.ensurePending({
    studentId: sourceBundle.studentId,
    jobId: sourceBundle.jobId,
    assignmentLineageKey: sourceBundle.assignmentLineageKey,
    promptPackageId: sourceBundle.promptPackageId ?? null,
    draftId: sourceBundle.draftId ?? null,
    recordingId: sourceBundle.recordingId ?? null,
    transcriptId: sourceBundle.transcriptId ?? null,
    schemaVersion: HOMEWORK_MEMORY_SCHEMA_VERSION,
    generatedAt: requestedAt,
    provider: candidate.provider,
    model: candidate.model,
    contentHash: sourceBundle.contentHash,
    bypassReadyReuse: args.params.forceRegenerate ?? false,
    generationNotes: {
      trigger: 'publish-succeeded',
      requestedAt: requestedAt.toISOString(),
      requestedJobId: args.params.jobId,
      forceRegenerate: args.params.forceRegenerate ?? false,
    },
    publishedAt: sourceBundle.publishedAt,
    publishTargets: sourceBundle.publishTargets,
  });

  if (pending.outcome !== 'ready_exists') {
    await queue.enqueue(
      {
        kind: 'homework-memory-generate',
        jobId: args.params.jobId,
        studentId: args.params.studentId,
        pendingEntryId: pending.entry.id,
        provider: candidate.provider,
        model: candidate.model,
      },
      {
        jobId: `homework-memory:${pending.entry.id}`,
      },
    );
  }

  logger.info('Homework-memory generation requested', {
    event: 'homework_memory_generation_requested',
    jobId: args.params.jobId,
    assignmentLineageKey: sourceBundle.assignmentLineageKey,
    pendingEntryId: pending.entry.id,
    outcome: pending.outcome,
    studentId: args.params.studentId,
  });

  return pending;
}
