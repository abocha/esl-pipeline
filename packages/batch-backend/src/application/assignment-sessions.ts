import type {
  AssignmentSessionDto,
  AssignmentSessionListResponse,
  CreateAssignmentSessionRequest,
  UpdateAssignmentSessionRequest,
} from '@esl-pipeline/contracts';

import type { AssignmentSessionRecord } from '../domain/assignment-session-model.js';
import {
  archiveAssignmentSession,
  countAssignmentSessionsForUser,
  createOrReuseAssignmentSession,
  getAssignmentSessionByIdForUser,
  listAssignmentSessionsForUser,
  updateAssignmentSession,
} from '../domain/assignment-session-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import { completeElapsedScheduledLessonForHomework } from './student-schedule-billing.js';

export async function createAssignmentSessionForUser(
  userId: string,
  request: CreateAssignmentSessionRequest,
): Promise<AssignmentSessionDto> {
  await validateLessonStudentPair(request);
  const session = await createOrReuseAssignmentSession({
    userId,
    ...request,
  });
  await completeLinkedElapsedLessonForHomework(userId, session);
  return toAssignmentSessionDto(session);
}

export async function updateAssignmentSessionForUser(
  userId: string,
  sessionId: string,
  request: UpdateAssignmentSessionRequest,
): Promise<AssignmentSessionDto | null> {
  await validateLessonStudentPair(request, { userId, sessionId });
  const session = await updateAssignmentSession({
    id: sessionId,
    userId,
    ...request,
  });
  if (session) {
    await completeLinkedElapsedLessonForHomework(userId, session);
  }
  return session ? toAssignmentSessionDto(session) : null;
}

export async function getAssignmentSessionForUser(
  userId: string,
  sessionId: string,
): Promise<AssignmentSessionDto | null> {
  const session = await getAssignmentSessionByIdForUser(sessionId, userId);
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
  return {
    sessions: sessions.map(toAssignmentSessionDto),
    total,
    limit: boundedLimit,
  };
}

export async function archiveAssignmentSessionForUser(
  userId: string,
  sessionId: string,
): Promise<AssignmentSessionDto | null> {
  const session = await archiveAssignmentSession(sessionId, userId);
  return session ? toAssignmentSessionDto(session) : null;
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
    currentStage: session.currentStage,
    publishTarget: session.publishTarget,
    selectedTtsProvider: session.selectedTtsProvider,
    selectedTtsStrategy: session.selectedTtsStrategy,
    selectedTtsModel: session.selectedTtsModel,
    selectedPreset: session.selectedPreset,
    selectedGenerationProvider: session.selectedGenerationProvider,
    selectedGenerationModel: session.selectedGenerationModel,
    teacherNotes: session.teacherNotes,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    archivedAt: session.archivedAt?.toISOString() ?? null,
  };
}

async function completeLinkedElapsedLessonForHomework(
  userId: string,
  session: AssignmentSessionRecord,
): Promise<void> {
  if (!session.studentId || !session.lessonId) return;
  await completeElapsedScheduledLessonForHomework(session.studentId, session.lessonId, userId);
}

async function validateLessonStudentPair(
  request: Pick<CreateAssignmentSessionRequest, 'lessonId' | 'studentId'>,
  existingSession?: { userId: string; sessionId: string },
): Promise<void> {
  if (request.lessonId === undefined && request.studentId === undefined) return;

  const session = existingSession
    ? await getAssignmentSessionByIdForUser(existingSession.sessionId, existingSession.userId)
    : null;
  if (existingSession && !session) return;

  const lessonId = request.lessonId !== undefined ? request.lessonId : session?.lessonId;
  const studentId = request.studentId !== undefined ? request.studentId : session?.studentId;

  if (!lessonId) return;

  if (!studentId) {
    throw new Error('Assignment session lesson requires a selected student');
  }

  const belongsToStudent = await withPgClient(async (client) => {
    const result = await client.query(
      'SELECT 1 FROM student_lessons WHERE id = $1 AND student_id = $2',
      [lessonId, studentId],
    );
    return (result.rowCount ?? 0) > 0;
  });

  if (!belongsToStudent) {
    throw new Error('Assignment session lesson must belong to the selected student');
  }
}
