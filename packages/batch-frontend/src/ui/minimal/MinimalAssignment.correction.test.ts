import { describe, expect, it } from 'vitest';

import type { AssignmentSession, DraftResponse, JobStatus } from '../../utils/api';
import {
  buildAssignmentCorrectionRequest,
  canRetryAssignmentPublication,
  hasSavedUnpublishedDraft,
  isCompletedAssignmentSession,
  isValidAssignmentPublicationParent,
} from './MinimalAssignment.correction';

const artifact = {
  format: 'assignment_v1' as const,
  schemaVersion: 1 as const,
  serializationVersion: 1 as const,
  workingVersion: 2,
  storageUri: 'memory://draft/content.json',
  contentHash: 'c'.repeat(64),
};

const draft: DraftResponse = {
  format: 'assignment_v1',
  artifact,
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
      artifact,
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
  it('rejects historical Markdown correction and retry even when published history is readable', () => {
    const session = { ...completedSession, id: 'session-1' };
    const job = {
      jobId: 'job-1',
      assignmentSessionId: 'session-1',
      state: 'succeeded',
      publishTarget: 'html',
      htmlUrl: 'https://example.test/history',
      assignmentArtifact: null,
    } as JobStatus;
    expect(isValidAssignmentPublicationParent(session, job)).toBe(false);
    expect(canRetryAssignmentPublication(session, { ...job, state: 'failed' })).toBe(false);
    expect(
      buildAssignmentCorrectionRequest({
        requestId: 'request-1',
        draft: { ...draft, artifact: undefined },
        confirmedCreate: completedSession.confirmed.create,
      }),
    ).toBeNull();
  });
  it('recognizes a completed session without treating an active session as immutable', () => {
    expect(isCompletedAssignmentSession(completedSession)).toBe(true);
    expect(isCompletedAssignmentSession({ ...completedSession, shareJobId: null })).toBe(false);
  });

  it('separates structural completion, valid publication ancestry, and root recovery', () => {
    const session = { ...completedSession, id: 'session-1' };
    const published = {
      assignmentArtifact: artifact,
      jobId: 'job-1',
      assignmentSessionId: 'session-1',
      state: 'succeeded',
      publishTarget: 'html',
      htmlUrl: 'https://example.test/assignment',
    } as JobStatus;
    expect(isValidAssignmentPublicationParent(session, published)).toBe(true);
    expect(canRetryAssignmentPublication(session, published)).toBe(false);
    expect(isValidAssignmentPublicationParent(session, { ...published, htmlUrl: null })).toBe(
      false,
    );

    const failedRoot = { ...published, state: 'failed' as const, htmlUrl: null };
    expect(isValidAssignmentPublicationParent(session, failedRoot)).toBe(false);
    expect(canRetryAssignmentPublication(session, failedRoot)).toBe(true);
    expect(canRetryAssignmentPublication(session, { ...failedRoot, jobId: 'child-1' })).toBe(false);
    expect(
      isValidAssignmentPublicationParent(session, { ...published, assignmentSessionId: 'other' }),
    ).toBe(false);
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
      artifact,
      requestId: 'request-1',
      draftId: 'draft-1',
      draftWorkingVersion: 2,
      draftHash: 'c'.repeat(64),
    });
  });
});
