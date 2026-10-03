import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  type EnsurePendingHomeworkMemoryEntryResult,
  ensurePendingHomeworkMemoryEntry,
} from '../domain/homework-memory-repository.js';
import { supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork } from '../domain/student-memory-openai-batch-repository.js';
import { logger } from '../infrastructure/logger.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';
import { resolveGenerationTarget } from './generation-policy.js';
import { HOMEWORK_MEMORY_SCHEMA_VERSION } from './homework-memory-generation.js';
import { resolveHomeworkMemorySourceFromSucceededJob } from './homework-memory-source.js';

export interface RequestHomeworkMemoryGenerationDependencies {
  source: {
    resolveFromSucceededJob: typeof resolveHomeworkMemorySourceFromSucceededJob;
  };
  homeworkMemory: {
    ensurePending: typeof ensurePendingHomeworkMemoryEntry;
  };
  batchClaims: {
    supersedeForOnlineWork: typeof supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork;
  };
  queue: {
    reconcile: ReturnType<typeof createStudentMemoryQueue>['reconcile'];
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
    replayKey?: string;
    publishKind?: 'initial' | 'correction';
  };
  overrides?: Partial<RequestHomeworkMemoryGenerationDependencies>;
}): Promise<EnsurePendingHomeworkMemoryEntryResult | null> {
  if (!args.params.studentId) {
    return null;
  }
  if (args.params.forceRegenerate && !args.params.replayKey?.trim())
    throw new Error('Homework regeneration requires replayKey');

  const source = args.overrides?.source ?? {
    resolveFromSucceededJob: resolveHomeworkMemorySourceFromSucceededJob,
  };
  const homeworkMemory = args.overrides?.homeworkMemory ?? {
    ensurePending: ensurePendingHomeworkMemoryEntry,
  };
  const batchClaims = args.overrides?.batchClaims ?? {
    supersedeForOnlineWork: supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork,
  };
  const queue = args.overrides?.queue ?? createStudentMemoryQueue();
  const now = args.overrides?.now ?? (() => new Date());

  const target = resolveGenerationTarget({
    config: args.config.generation,
    workload: 'homework_memory',
    providerOverride: args.params.providerOverride,
    modelOverride: args.params.modelOverride,
  });

  const sourceBundle = await source.resolveFromSucceededJob(args.params.jobId);
  const publishKind = args.params.publishKind ?? 'initial';
  if (sourceBundle.assignmentLineageKey !== args.params.jobId && publishKind !== 'correction') {
    logger.info('Homework-memory generation rejected for non-correction descendant job', {
      event: 'homework_memory_generation_rejected_descendant',
      jobId: args.params.jobId,
      assignmentLineageKey: sourceBundle.assignmentLineageKey,
      studentId: args.params.studentId,
    });
    return null;
  }

  await batchClaims.supersedeForOnlineWork({
    workload: 'homework_memory',
    canonicalScopeKey: sourceBundle.assignmentLineageKey,
  });

  const requestedAt = now();
  const pending = await homeworkMemory.ensurePending({
    replayKey: args.params.replayKey?.trim(),
    studentId: sourceBundle.studentId,
    jobId: sourceBundle.jobId,
    assignmentLineageKey: sourceBundle.assignmentLineageKey,
    promptPackageId: sourceBundle.promptPackageId ?? null,
    draftId: sourceBundle.draftId ?? null,
    lessonId: sourceBundle.lessonId ?? null,
    recordingId: sourceBundle.recordingId ?? null,
    transcriptId: sourceBundle.transcriptId ?? null,
    schemaVersion: HOMEWORK_MEMORY_SCHEMA_VERSION,
    generatedAt: requestedAt,
    provider: target.provider,
    model: target.model,
    contentHash: sourceBundle.contentHash,
    bypassReadyReuse: args.params.forceRegenerate ?? false,
    generationNotes: {
      trigger: publishKind === 'correction' ? 'publish-correction-succeeded' : 'publish-succeeded',
      publishKind,
      requestedAt: requestedAt.toISOString(),
      requestedJobId: args.params.jobId,
      forceRegenerate: args.params.forceRegenerate ?? false,
    },
    publishedAt: sourceBundle.publishedAt,
    publishTargets: sourceBundle.publishTargets,
  });

  if (pending.outcome === 'created' || pending.outcome === 'pending_exists') {
    await queue.reconcile(
      {
        kind: 'homework-memory-generate',
        jobId: pending.entry.jobId,
        studentId: pending.entry.studentId,
        pendingEntryId: pending.entry.id,
        provider: pending.entry.provider as GenerationProvider,
        model: pending.entry.model,
      },
      {
        jobId: `homework-memory:${pending.entry.id}`,
        requeueCompleted: true,
      },
    );
  }

  logger.info('Homework-memory generation requested', {
    event: 'homework_memory_generation_requested',
    jobId: args.params.jobId,
    assignmentLineageKey: sourceBundle.assignmentLineageKey,
    publishKind,
    pendingEntryId: pending.entry.id,
    outcome: pending.outcome,
    studentId: args.params.studentId,
  });

  return pending;
}
