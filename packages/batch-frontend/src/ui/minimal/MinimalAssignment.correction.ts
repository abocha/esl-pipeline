import type {
  AssignmentSession,
  DraftResponse,
  JobStatus,
  PublishAssignmentCorrectionRequest,
} from '../../utils/api';

type ConfirmedCreateSnapshot = NonNullable<AssignmentSession['confirmed']['create']>;

export function isCompletedAssignmentSession(
  session: Pick<AssignmentSession, 'confirmedStep' | 'shareJobId'> | null | undefined,
): boolean {
  return session?.confirmedStep === 'share' && Boolean(session.shareJobId);
}

export function isValidAssignmentPublicationParent(
  session: Pick<AssignmentSession, 'id' | 'confirmedStep' | 'shareJobId'> | null | undefined,
  job: JobStatus | null | undefined,
): boolean {
  return Boolean(
    isCompletedAssignmentSession(session) &&
      job &&
      job.assignmentSessionId === session?.id &&
      job.state === 'succeeded' &&
      job.publishTarget === 'html' &&
      job.htmlUrl?.trim(),
  );
}

export function canRetryAssignmentPublication(
  session: Pick<AssignmentSession, 'id' | 'confirmedStep' | 'shareJobId'> | null | undefined,
  job: JobStatus | null | undefined,
): boolean {
  return Boolean(
    isCompletedAssignmentSession(session) &&
      job &&
      job.assignmentSessionId === session?.id &&
      job.jobId === session?.shareJobId &&
      (job.state === 'failed' || job.state === 'queued') &&
      !isValidAssignmentPublicationParent(session, job),
  );
}

export function hasSavedUnpublishedDraft(
  confirmedCreate: ConfirmedCreateSnapshot | null | undefined,
  draft: Pick<DraftResponse, 'id' | 'workingVersion' | 'contentHash'> | null | undefined,
  draftDirty: boolean,
): boolean {
  if (!confirmedCreate || !draft || draftDirty) return false;
  return (
    confirmedCreate.draftId === draft.id &&
    (confirmedCreate.draftWorkingVersion !== draft.workingVersion ||
      confirmedCreate.draftHash !== draft.contentHash)
  );
}

export function buildAssignmentCorrectionRequest({
  requestId,
  draft,
  confirmedCreate,
}: {
  requestId: string;
  draft: Pick<DraftResponse, 'id' | 'workingVersion' | 'contentHash'> | null | undefined;
  confirmedCreate: ConfirmedCreateSnapshot | null | undefined;
}): PublishAssignmentCorrectionRequest | null {
  if (!draft || !confirmedCreate || draft.id !== confirmedCreate.draftId) return null;
  return {
    requestId,
    draftId: draft.id,
    draftWorkingVersion: draft.workingVersion,
    draftHash: draft.contentHash,
  };
}
