import type {
  FinishTranscriptAssignmentSessionRequest,
  TranscriptAssignmentSessionResponse,
} from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  finishTranscriptAssignmentSessionPersistence,
  startHomeworkAssignmentSessionPersistence,
} from '../domain/assignment-session-repository.js';
import { logger } from '../infrastructure/logger.js';
import { toAssignmentSessionDto } from './assignment-sessions.js';
import { LESSON_MEMORY_SCHEMA_VERSION } from './generate-lesson-memory-entry.js';
import { resolveGenerationTarget } from './generation-policy.js';
import { enqueueConfirmedLessonMemoryIntent } from './request-lesson-memory-generation.js';
import { getTranscriptProcessingStatus } from './transcript-processing-status.js';

export async function finishTranscriptAssignmentSession(args: {
  config: BatchBackendConfig;
  userId: string;
  sessionId: string;
  request: FinishTranscriptAssignmentSessionRequest;
}): Promise<TranscriptAssignmentSessionResponse> {
  const target = resolveGenerationTarget({
    config: args.config.generation,
    workload: 'lesson_memory',
  });
  const result = await finishTranscriptAssignmentSessionPersistence({
    id: args.sessionId,
    userId: args.userId,
    request: args.request,
    lessonMemory: {
      schemaVersion: LESSON_MEMORY_SCHEMA_VERSION,
      provider: target.provider,
      model: target.model,
      requestedAt: new Date(),
    },
  });
  if (result.lessonMemoryIntent) {
    const intent = result.lessonMemoryIntent;
    try {
      await enqueueConfirmedLessonMemoryIntent({
        kind: 'lesson-memory-generate',
        transcriptId: intent.transcriptId,
        recordingId: intent.recordingId,
        studentId: intent.studentId,
        lessonId: intent.lessonId,
        sourceStorageUri: intent.sourceStorageUri,
        sourceContentHash: intent.sourceContentHash,
        pendingEntryId: intent.entryId,
        assignmentSessionId: result.session.id,
        provider: intent.provider as never,
        model: intent.model,
      });
    } catch (error) {
      logger.warn('Transcript finished; durable lesson-memory delivery remains pending', {
        event: 'transcript_finish_memory_delivery_pending',
        assignmentSessionId: result.session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    session: {
      ...toAssignmentSessionDto(result.session),
      transcriptProcessing: await getTranscriptProcessingStatus(result.session.id),
    },
  };
}

export async function startHomeworkAssignmentSession(args: {
  userId: string;
  sessionId: string;
  request: { expectedRevision: number };
}): Promise<TranscriptAssignmentSessionResponse> {
  const session = await startHomeworkAssignmentSessionPersistence({
    id: args.sessionId,
    userId: args.userId,
    expectedRevision: args.request.expectedRevision,
  });
  return { session: toAssignmentSessionDto(session) };
}
