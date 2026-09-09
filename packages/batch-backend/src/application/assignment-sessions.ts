import type {
  AssignmentSessionDto,
  AssignmentSessionListResponse,
  ConfirmStudentAssignmentSessionRequest,
  UpdateAssignmentSessionRecoveryRequest,
} from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { AssignmentSessionRecord } from '../domain/assignment-session-model.js';
import {
  confirmStudentAssignmentSession,
  countAssignmentSessionsForUser,
  getActiveAssignmentSessionByRecording,
  getAssignmentSessionByIdForUser,
  listAssignmentSessionsForUser,
  updateAssignmentSessionRecovery,
  AssignmentSessionRepositoryError,
} from '../domain/assignment-session-repository.js';
import { getTranscriptByIdForWorkspace } from '../domain/transcript-repository.js';
import { getStudentById } from '../domain/student-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import { requestLessonMemoryGeneration } from './request-lesson-memory-generation.js';
import { completeElapsedScheduledLessonForHomework } from './student-schedule-billing.js';
import { resolvePrimaryWorkspaceIdForUser } from './workspace-context.js';

export async function confirmStudentAssignmentSessionForUser(
  userId: string,
  request: ConfirmStudentAssignmentSessionRequest,
): Promise<AssignmentSessionDto> {
  const lessonId = request.lessonId ?? null;
  const workspaceId = await resolvePrimaryWorkspaceIdForUser(userId);
  const student = await getStudentById(request.studentId, { workspaceId });
  if (!student) throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_NOT_FOUND');
  await validateLessonStudentPair(lessonId, request.studentId, workspaceId);
  const session = await confirmStudentAssignmentSession({
    userId,
    requestId: request.requestId,
    studentId: request.studentId,
    lessonId,
  });
  await completeLinkedElapsedLessonForHomework(userId, workspaceId, session);
  return toAssignmentSessionDto(session);
}

export async function updateAssignmentSessionRecoveryForUser(
  userId: string,
  sessionId: string,
  request: UpdateAssignmentSessionRecoveryRequest,
): Promise<AssignmentSessionDto> {
  if (request.patch.lessonId !== undefined) {
    const existing = await getAssignmentSessionByIdForUser(sessionId, userId);
    if (existing) {
      const workspaceId = await resolvePrimaryWorkspaceIdForUser(userId);
      await validateLessonStudentPair(request.patch.lessonId, existing.studentId, workspaceId);
    }
  }
  const session = await updateAssignmentSessionRecovery({
    id: sessionId,
    userId,
    expectedRevision: request.expectedRevision,
    patch: request.patch,
  });
  const workspaceId = await resolvePrimaryWorkspaceIdForUser(userId);
  await completeLinkedElapsedLessonForHomework(userId, workspaceId, session);
  return toAssignmentSessionDto(session);
}

export async function getAssignmentSessionForUser(
  userId: string,
  sessionId: string,
  config?: BatchBackendConfig,
): Promise<AssignmentSessionDto | null> {
  const requested = await getAssignmentSessionByIdForUser(sessionId, userId);
  const session = requested ? await resolveCanonicalSourceSession(userId, requested) : null;
  if (session && config) await reconcileConfirmedSourceMemory(session, config);
  return session ? toAssignmentSessionDto(session) : null;
}

export async function listAssignmentSessionsForUserDto(
  userId: string,
  limit: number,
): Promise<AssignmentSessionListResponse> {
  const boundedLimit = Math.min(Math.max(limit, 1), 50);
  const [sessions, total] = await Promise.all([
    listAssignmentSessionsForUser(userId, boundedLimit),
    countAssignmentSessionsForUser(userId),
  ]);
  return { sessions: sessions.map(toAssignmentSessionDto), total, limit: boundedLimit };
}

export function toAssignmentSessionDto(session: AssignmentSessionRecord): AssignmentSessionDto {
  return {
    id: session.id,
    userId: session.userId,
    studentId: session.studentId,
    lessonId: session.lessonId,
    recordingId: session.recordingId,
    transcriptId: session.transcriptId,
    promptPackageId: session.promptPackageId,
    draftId: session.draftId,
    revision: session.revision,
    confirmedStep: session.confirmedStep,
    confirmed: session.confirmed,
    publishTarget: session.publishTarget,
    selectedTtsProvider: session.selectedTtsProvider,
    selectedTtsStrategy: session.selectedTtsStrategy,
    selectedTtsModel: session.selectedTtsModel,
    selectedPreset: session.selectedPreset,
    selectedGenerationProvider: session.selectedGenerationProvider,
    selectedGenerationModel: session.selectedGenerationModel,
    teacherNotes: session.teacherNotes,
    selectedProfileId: session.selectedProfileId,
    selectedProfileRevisionId: session.selectedProfileRevisionId,
    selectedProfileRevisionHash: session.selectedProfileRevisionHash,
    shareJobId: session.shareJobId,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

async function completeLinkedElapsedLessonForHomework(
  userId: string,
  workspaceId: string,
  session: AssignmentSessionRecord,
): Promise<void> {
  if (!session.lessonId) return;
  await completeElapsedScheduledLessonForHomework(workspaceId, session.studentId, session.lessonId, userId);
}

async function validateLessonStudentPair(
  lessonId: string | null,
  studentId: string,
  workspaceId: string,
): Promise<void> {
  if (!lessonId) return;
  const belongsToStudent = await withPgClient(async (client) => {
    const result = await client.query(
      `SELECT 1 FROM student_lessons sl
       JOIN students s ON s.id = sl.student_id
       WHERE sl.id = $1 AND sl.student_id = $2 AND s.workspace_id = $3`,
      [lessonId, studentId, workspaceId],
    );
    return (result.rowCount ?? 0) > 0;
  });
  if (!belongsToStudent) {
    throw new Error('Assignment session lesson must belong to the selected student');
  }
}

async function resolveCanonicalSourceSession(
  userId: string,
  session: AssignmentSessionRecord,
): Promise<AssignmentSessionRecord> {
  const transcriptId = session.transcriptId;
  const canResolvePartialSource =
    session.confirmedStep === 'student' &&
    session.recordingId === null &&
    transcriptId !== null &&
    session.promptPackageId === null &&
    session.draftId === null &&
    session.shareJobId === null;
  if (!canResolvePartialSource) return session;

  const workspaceId = await resolvePrimaryWorkspaceIdForUser(userId);
  const transcript = await getTranscriptByIdForWorkspace(transcriptId, workspaceId);
  if (!transcript) return session;
  const canonical = await getActiveAssignmentSessionByRecording(userId, transcript.recordingId);
  if (!canonical || canonical.id === session.id || canonical.studentId !== session.studentId) {
    return session;
  }
  logger.info('Assignment source alias resolved to canonical session', {
    event: 'assignment_source_alias_resolved',
    requestedAssignmentSessionId: session.id,
    canonicalAssignmentSessionId: canonical.id,
    recordingId: transcript.recordingId,
    userId,
  });
  return canonical;
}

async function reconcileConfirmedSourceMemory(
  session: AssignmentSessionRecord,
  config: BatchBackendConfig,
): Promise<void> {
  const source = session.confirmed.source;
  if (!source) return;
  try {
    await requestLessonMemoryGeneration({
      config,
      params: {
        studentId: session.studentId,
        transcriptId: source.transcriptId,
        recordingId: source.recordingId,
        lessonId: source.lessonId,
        sourceStorageUri: source.transcriptStorageUri,
        sourceContentHash: source.transcriptHash,
        trigger: 'replay',
      },
    });
  } catch (error) {
    logger.warn('Confirmed lesson-memory intent reconciliation failed during session load', {
      event: 'confirmed_lesson_memory_reconcile_failed',
      assignmentSessionId: session.id,
      transcriptId: source.transcriptId,
      sourceContentHash: source.transcriptHash,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
