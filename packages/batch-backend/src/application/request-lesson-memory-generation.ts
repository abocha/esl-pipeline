import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  type EnsurePendingLessonMemoryEntryResult,
  ensurePendingLessonMemoryEntry,
} from '../domain/lesson-memory-repository.js';
import { supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork } from '../domain/student-memory-openai-batch-repository.js';
import { logger } from '../infrastructure/logger.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';
import { LESSON_MEMORY_SCHEMA_VERSION } from './generate-lesson-memory-entry.js';
import { resolveGenerationCandidates } from './generation-policy.js';
import type { ProcessLessonMemoryJobPayload } from './process-lesson-memory-job.js';

export interface RequestLessonMemoryGenerationParams {
  studentId: string | null;
  transcriptId: string;
  recordingId: string;
  assignmentSessionId: string;
  sourceStorageUri: string;
  sourceContentHash: string;
  lessonId?: string | null;
  trigger: 'teacher-confirmed-transcript' | 'replay';
  providerOverride?: GenerationProvider | null;
  modelOverride?: string | null;
}

export interface RequestLessonMemoryGenerationDependencies {
  lessonMemory: {
    ensurePending: typeof ensurePendingLessonMemoryEntry;
  };
  batchClaims: {
    supersedeForOnlineWork: typeof supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork;
  };
  queue: {
    reconcile: ReturnType<typeof createStudentMemoryQueue>['reconcile'];
  };
  now: () => Date;
}

export async function enqueueConfirmedLessonMemoryIntent(
  payload: ProcessLessonMemoryJobPayload,
  overrides?: {
    batchClaims?: RequestLessonMemoryGenerationDependencies['batchClaims'];
    queue?: RequestLessonMemoryGenerationDependencies['queue'];
  },
): Promise<void> {
  const batchClaims = overrides?.batchClaims ?? {
    supersedeForOnlineWork: supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork,
  };
  const queue = overrides?.queue ?? createStudentMemoryQueue();
  await batchClaims.supersedeForOnlineWork({
    workload: 'lesson_memory',
    canonicalScopeKey: payload.transcriptId,
  });
  await queue.reconcile(payload, {
    jobId: `lesson-memory:${payload.transcriptId}:${payload.sourceContentHash}`,
  });
}

export async function requestLessonMemoryGeneration(args: {
  config: BatchBackendConfig;
  params: RequestLessonMemoryGenerationParams;
  overrides?: Partial<RequestLessonMemoryGenerationDependencies>;
}): Promise<EnsurePendingLessonMemoryEntryResult | null> {
  if (!args.params.studentId) {
    return null;
  }

  const lessonMemory = args.overrides?.lessonMemory ?? {
    ensurePending: ensurePendingLessonMemoryEntry,
  };
  const batchClaims = args.overrides?.batchClaims ?? {
    supersedeForOnlineWork: supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork,
  };
  const queue = args.overrides?.queue ?? createStudentMemoryQueue();
  const now = args.overrides?.now ?? (() => new Date());

  const defaultCandidate = resolveGenerationCandidates({
    config: args.config.generation,
    workload: 'student_memory_extraction',
  })[0];
  const candidate =
    args.params.providerOverride && args.params.modelOverride
      ? {
          provider: args.params.providerOverride,
          model: args.params.modelOverride,
        }
      : defaultCandidate;
  if (!candidate) {
    throw new Error('No generation candidate is available for lesson-memory extraction');
  }

  const requestedAt = now();
  const pending = await lessonMemory.ensurePending({
    studentId: args.params.studentId,
    transcriptId: args.params.transcriptId,
    recordingId: args.params.recordingId,
    assignmentSessionId: args.params.assignmentSessionId,
    schemaVersion: LESSON_MEMORY_SCHEMA_VERSION,
    generatedAt: requestedAt,
    provider: candidate.provider,
    model: candidate.model,
    generationNotes: {
      trigger: args.params.trigger,
      lessonId: args.params.lessonId ?? null,
      requestedAt: requestedAt.toISOString(),
    },
    sourceStorageUri: args.params.sourceStorageUri,
    sourceContentHash: args.params.sourceContentHash,
  });

  if (pending.outcome === 'ready_exists') {
    return pending;
  }

  await enqueueConfirmedLessonMemoryIntent(
    {
      kind: 'lesson-memory-generate',
      transcriptId: args.params.transcriptId,
      recordingId: args.params.recordingId,
      studentId: args.params.studentId,
      lessonId: args.params.lessonId ?? null,
      sourceStorageUri: args.params.sourceStorageUri,
      sourceContentHash: args.params.sourceContentHash,
      pendingEntryId: pending.entry.id,
      assignmentSessionId: args.params.assignmentSessionId,
      provider: candidate.provider,
      model: candidate.model,
    },
    {
      batchClaims,
      queue,
    },
  );

  logger.info('Lesson-memory generation requested', {
    event: 'lesson_memory_generation_requested',
    transcriptId: args.params.transcriptId,
    sourceContentHash: args.params.sourceContentHash,
    pendingEntryId: pending.entry.id,
    trigger: args.params.trigger,
    outcome: pending.outcome,
  });

  return pending;
}
