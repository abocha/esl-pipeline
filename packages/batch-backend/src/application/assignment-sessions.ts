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

export async function createAssignmentSessionForUser(
  userId: string,
  request: CreateAssignmentSessionRequest,
): Promise<AssignmentSessionDto> {
  const session = await createOrReuseAssignmentSession({
    userId,
    ...request,
  });
  return toAssignmentSessionDto(session);
}

export async function updateAssignmentSessionForUser(
  userId: string,
  sessionId: string,
  request: UpdateAssignmentSessionRequest,
): Promise<AssignmentSessionDto | null> {
  const session = await updateAssignmentSession({
    id: sessionId,
    userId,
    ...request,
  });
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
