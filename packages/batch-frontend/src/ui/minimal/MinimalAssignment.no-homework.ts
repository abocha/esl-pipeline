import type { AssignmentSession, FinishTranscriptAssignmentSessionRequest } from '../../utils/api';

export function isTranscriptOnlyCompleted(session: AssignmentSession | null | undefined): boolean {
  return session?.homeworkIntent === 'none' && Boolean(session.transcriptCompletedAt);
}

export function noHomeworkUnavailableReason(session: AssignmentSession | null): string | null {
  if (!session) return 'Start a lesson before choosing its homework plan.';
  if (session.historicalReadOnly) return 'Historical assignments are read-only.';
  if (isTranscriptOnlyCompleted(session)) return 'Use Create homework to reopen this lesson.';
  if (
    session.confirmed.context ||
    session.confirmed.create ||
    session.promptPackageId ||
    session.draftId ||
    session.shareJobId ||
    session.confirmedStep === 'share'
  ) {
    return 'Homework has already started. Existing teaching context and assignment work must be preserved.';
  }
  return null;
}

// A historical source match is insufficient after promotion or a subsequent finish.
export function isTranscriptFinishApplied(
  session: AssignmentSession,
  request: FinishTranscriptAssignmentSessionRequest,
): boolean {
  const event = session.transcriptCompletionHistory?.at(-1);
  const source = event?.source;
  return Boolean(
    isTranscriptOnlyCompleted(session) &&
      event &&
      source &&
      session.transcriptCompletedAt === event.completedAt &&
      event.expectedRevision === request.expectedRevision &&
      event.resultingRevision === session.revision &&
      source.lessonId === request.lessonId &&
      source.recordingId === request.recordingId &&
      source.transcriptId === request.transcriptId &&
      source.transcriptWorkingVersion === request.transcriptWorkingVersion &&
      source.transcriptHash === request.transcriptHash,
  );
}
