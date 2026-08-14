import type {
  AssignmentSession,
  DraftResponse,
  PublishAssignmentCorrectionRequest,
} from '../../utils/api';

type ConfirmedCreateSnapshot = NonNullable<AssignmentSession['confirmed']['create']>;

export function isCompletedAssignmentSession(
  session: Pick<AssignmentSession, 'confirmedStep' | 'shareJobId'> | null | undefined,
): boolean {
  return session?.confirmedStep === 'share' && Boolean(session.shareJobId);
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
