import type {
  ConfirmAssignmentSessionStepRequest,
  ConfirmAssignmentSessionStepResponse,
} from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  type ConfirmAssignmentSessionStepPersistenceResult,
  confirmAssignmentSessionStepPersistence,
} from '../domain/assignment-session-repository.js';
import { toAssignmentSessionDto } from './assignment-sessions.js';
import { LESSON_MEMORY_SCHEMA_VERSION } from './generate-lesson-memory-entry.js';
import { resolveGenerationCandidates } from './generation-policy.js';
import { enqueueConfirmedLessonMemoryIntent } from './request-lesson-memory-generation.js';

export interface ConfirmAssignmentSessionStepDependencies {
  confirmation: { confirm: typeof confirmAssignmentSessionStepPersistence };
  lessonMemory: { enqueueConfirmedIntent: typeof enqueueConfirmedLessonMemoryIntent };
  now: () => Date;
}

export async function confirmAssignmentSessionStep(args: {
  config: BatchBackendConfig;
  userId: string;
  sessionId: string;
  request: ConfirmAssignmentSessionStepRequest;
  overrides?: Partial<ConfirmAssignmentSessionStepDependencies>;
}): Promise<ConfirmAssignmentSessionStepResponse> {
  const candidate = resolveGenerationCandidates({
    config: args.config.generation,
    workload: 'student_memory_extraction',
  })[0];
  if (!candidate)
    throw new Error('No generation candidate is available for lesson-memory extraction');
  const confirmation = args.overrides?.confirmation ?? {
    confirm: confirmAssignmentSessionStepPersistence,
  };
  const lessonMemory = args.overrides?.lessonMemory ?? {
    enqueueConfirmedIntent: enqueueConfirmedLessonMemoryIntent,
  };
  const now = args.overrides?.now ?? (() => new Date());

  const result: ConfirmAssignmentSessionStepPersistenceResult = await confirmation.confirm({
    id: args.sessionId,
    userId: args.userId,
    request: args.request,
    lessonMemory: {
      schemaVersion: LESSON_MEMORY_SCHEMA_VERSION,
      provider: candidate.provider,
      model: candidate.model,
      requestedAt: now(),
    },
  });
  if (result.lessonMemoryIntent) {
    await lessonMemory.enqueueConfirmedIntent({
      kind: 'lesson-memory-generate',
      transcriptId: result.lessonMemoryIntent.transcriptId,
      recordingId: result.lessonMemoryIntent.recordingId,
      studentId: result.lessonMemoryIntent.studentId,
      lessonId: result.lessonMemoryIntent.lessonId,
      sourceStorageUri: result.lessonMemoryIntent.sourceStorageUri,
      sourceContentHash: result.lessonMemoryIntent.sourceContentHash,
      pendingEntryId: result.lessonMemoryIntent.entryId,
      provider: result.lessonMemoryIntent.provider as never,
      model: result.lessonMemoryIntent.model,
    });
  }
  return { session: toAssignmentSessionDto(result.session), invalidated: result.invalidated };
}
