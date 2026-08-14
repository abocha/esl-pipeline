import { describe, expect, it } from 'vitest';

import type { AssignmentSession, DraftResponse } from '../../utils/api';
import {
  buildAssignmentCorrectionRequest,
  hasSavedUnpublishedDraft,
  isCompletedAssignmentSession,
} from './MinimalAssignment.correction';

const draft: DraftResponse = {
  id: 'draft-1',
  promptPackageId: 'prompt-1',
  studentId: 'student-1',
  lessonId: null,
  storageUri: 'memory://draft-1',
  createdBy: 'user-1',
  text: '# Current draft',
  workingVersion: 2,
  contentHash: 'c'.repeat(64),
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
};

const completedSession = {
  confirmed: {
    create: {
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      draftWorkingVersion: 1,
      draftStorageUri: 'memory://draft-1-v1',
      draftHash: 'b'.repeat(64),
    },
  },
  confirmedStep: 'share',
  shareJobId: 'job-1',
} as Pick<AssignmentSession, 'confirmed' | 'confirmedStep' | 'shareJobId'>;

describe('post-share assignment correction model', () => {
  it('recognizes a completed session without treating an active session as immutable', () => {
    expect(isCompletedAssignmentSession(completedSession)).toBe(true);
    expect(isCompletedAssignmentSession({ ...completedSession, shareJobId: null })).toBe(false);
  });

  it('marks only an authoritative saved version/hash change as unpublished', () => {
    expect(hasSavedUnpublishedDraft(completedSession.confirmed.create, draft, false)).toBe(true);
    expect(
      hasSavedUnpublishedDraft(
        completedSession.confirmed.create,
        { ...draft, workingVersion: 1, contentHash: 'b'.repeat(64) },
        false,
      ),
    ).toBe(false);
    expect(hasSavedUnpublishedDraft(completedSession.confirmed.create, draft, true)).toBe(false);
  });

  it('builds the correction payload from the saved draft authority', () => {
    expect(
      buildAssignmentCorrectionRequest({
        requestId: 'request-1',
        draft,
        confirmedCreate: completedSession.confirmed.create,
      }),
    ).toEqual({
      requestId: 'request-1',
      draftId: 'draft-1',
      draftWorkingVersion: 2,
      draftHash: 'c'.repeat(64),
    });
  });
});
