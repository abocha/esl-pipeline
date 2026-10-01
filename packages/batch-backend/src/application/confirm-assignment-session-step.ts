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
import { resolveGenerationTarget } from './generation-policy.js';
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
  const target =
    args.request.step === 'source'
      ? resolveGenerationTarget({
          config: args.config.generation,
          workload: 'lesson_memory',
        })
      : undefined;
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
    lessonMemory: target
      ? {
          schemaVersion: LESSON_MEMORY_SCHEMA_VERSION,
          provider: target.provider,
          model: target.model,
          requestedAt: now(),
        }
      : undefined,
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
      assignmentSessionId: result.session.id,
      provider: result.lessonMemoryIntent.provider as never,
      model: result.lessonMemoryIntent.model,
    });
  }
  return { session: toAssignmentSessionDto(result.session), invalidated: result.invalidated };
}
