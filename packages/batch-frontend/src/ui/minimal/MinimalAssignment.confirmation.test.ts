import { describe, expect, it } from 'vitest';

import type { AssignmentSession } from '../../utils/api';
import {
  canNavigateToStep,
  canShareAssignment,
  deriveAssignmentDirtyState,
  deriveResumeDestination,
  getConflictResolutionDecision,
  isAssignmentConfirmationApplied,
  shouldGuardAssignmentExit,
  shouldRefreshAssignmentData,
} from './MinimalAssignment.confirmation';

function session(overrides: Partial<AssignmentSession> = {}): AssignmentSession {
  return {
    homeworkIntent: 'create',
    transcriptCompletedAt: null,
    completionKind: null,
    transcriptCompletionHistory: [],
    id: 'session-1',
    userId: 'user-1',
    studentId: 'student-1',
    lessonId: 'lesson-1',
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    promptPackageId: 'prompt-1',
    draftId: 'draft-1',
    revision: 4,
    confirmedStep: 'create',
    confirmed: {
      student: { studentId: 'student-1' },
      source: {
        lessonId: 'lesson-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
        transcriptStorageUri: 'local://transcript-a',
        transcriptHash: 'a'.repeat(64),
      },
      context: {
        teacherNotes: 'Focus on articles.',
        profileId: 'profile-1',
        profileRevisionId: 'profile-revision-1',
        profileRevisionHash: 'b'.repeat(64),
      },
      create: {
        promptPackageId: 'prompt-1',
        draftId: 'draft-1',
        draftWorkingVersion: 1,
        draftStorageUri: 'local://draft-a',
        draftHash: 'c'.repeat(64),
      },
    },
    publishTarget: null,
    selectedTtsProvider: null,
    selectedTtsStrategy: null,
    selectedTtsModel: null,
    selectedPreset: null,
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: ' Focus on articles. ',
    selectedProfileId: 'profile-1',
    selectedProfileRevisionId: 'profile-revision-1',
    selectedProfileRevisionHash: 'b'.repeat(64),
    shareJobId: null,
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

const cleanArtifacts = {
  transcript: { workingVersion: 1, contentHash: 'a'.repeat(64) },
  draft: { workingVersion: 1, contentHash: 'c'.repeat(64) },
};

describe('assignment confirmation decisions', () => {
  it('normalizes notes and derives clean confirmed boundaries', () => {
    expect(deriveAssignmentDirtyState(session(), cleanArtifacts)).toEqual({
      source: false,
      context: false,
      create: false,
    });
    expect(deriveResumeDestination(session(), cleanArtifacts)).toBe('review');
  });

  it('ignores obsolete standalone profile identity when revision lineage is unchanged', () => {
    const saved = session({ selectedProfileId: 'obsolete-other-profile' });
    expect(deriveAssignmentDirtyState(saved, cleanArtifacts).context).toBe(false);
    saved.selectedProfileRevisionHash = 'changed-revision-hash';
    expect(deriveAssignmentDirtyState(saved, cleanArtifacts).context).toBe(true);
  });

  it('resumes at the earliest dirty durable boundary', () => {
    const dirty = session({ lessonId: 'lesson-2', teacherNotes: 'New notes' });
    expect(deriveResumeDestination(dirty, cleanArtifacts)).toBe('source');
    expect(deriveResumeDestination(session({ teacherNotes: 'New notes' }), cleanArtifacts)).toBe(
      'context',
    );
    expect(deriveResumeDestination(session({ draftId: 'draft-2' }), cleanArtifacts)).toBe(
      'assignment',
    );
  });

  it('treats newer artifact working content as dirty recovery', () => {
    expect(
      deriveAssignmentDirtyState(session(), {
        ...cleanArtifacts,
        transcript: { workingVersion: 2, contentHash: 'd'.repeat(64) },
      }).source,
    ).toBe(true);
    expect(
      deriveAssignmentDirtyState(session(), {
        ...cleanArtifacts,
        draft: { workingVersion: 2, contentHash: 'e'.repeat(64) },
      }).create,
    ).toBe(true);
  });

  it('derives clean progress and completed Share without persisted stage', () => {
    expect(
      deriveResumeDestination(
        session({ confirmedStep: 'context', confirmed: { ...session().confirmed, create: null } }),
        { transcript: cleanArtifacts.transcript, draft: null },
      ),
    ).toBe('assignment');
    expect(
      deriveResumeDestination(
        session({ confirmedStep: 'share', shareJobId: 'job-1' }),
        cleanArtifacts,
      ),
    ).toEqual({ jobId: 'job-1' });
  });

  it('blocks forward navigation and Share at dirty unconfirmed boundaries', () => {
    const dirtyContext = session({ teacherNotes: 'New notes' });
    expect(canNavigateToStep(dirtyContext, cleanArtifacts, 'review')).toBe(false);
    expect(canNavigateToStep(dirtyContext, cleanArtifacts, 'source')).toBe(true);
    expect(canShareAssignment(dirtyContext, cleanArtifacts)).toEqual({
      allowed: false,
      reason: 'Confirm Teaching context before sharing.',
    });
    expect(canShareAssignment(session(), cleanArtifacts)).toEqual({ allowed: true });
  });

  it('guards exit only for unrecovered or ambiguous work', () => {
    expect(shouldGuardAssignmentExit({ recovery: 'saved', mutation: 'settled' })).toBe(false);
    expect(shouldGuardAssignmentExit({ recovery: 'pending', mutation: 'settled' })).toBe(true);
    expect(shouldGuardAssignmentExit({ recovery: 'failed', mutation: 'settled' })).toBe(true);
    expect(shouldGuardAssignmentExit({ recovery: 'saved', mutation: 'ambiguous' })).toBe(true);
  });

  it('limits refresh to lifecycle and genuine async work', () => {
    expect(shouldRefreshAssignmentData({ trigger: 'load' })).toBe(true);
    expect(shouldRefreshAssignmentData({ trigger: 'focus' })).toBe(true);
    expect(shouldRefreshAssignmentData({ trigger: 'mutation' })).toBe(true);
    expect(shouldRefreshAssignmentData({ trigger: 'poll', asynchronous: true })).toBe(true);
    expect(shouldRefreshAssignmentData({ trigger: 'poll', asynchronous: false })).toBe(false);
    expect(shouldRefreshAssignmentData({ trigger: 'interval' })).toBe(false);
  });

  it('preserves local input on overlapping cross-tab conflicts', () => {
    expect(getConflictResolutionDecision({ hasLocalDirty: false, overlapsRemote: false })).toBe(
      'adopt-server',
    );
    expect(getConflictResolutionDecision({ hasLocalDirty: true, overlapsRemote: false })).toBe(
      'rebase-once',
    );
    expect(getConflictResolutionDecision({ hasLocalDirty: true, overlapsRemote: true })).toBe(
      'preserve-local-and-reconcile',
    );
  });

  it('recognizes a lost confirmation response from the latest server snapshot', () => {
    const confirmed = session();
    expect(
      isAssignmentConfirmationApplied(confirmed, {
        step: 'create',
        expectedRevision: 3,
        promptPackageId: 'prompt-1',
        draftId: 'draft-1',
        draftWorkingVersion: 1,
      }),
    ).toBe(true);
    expect(
      isAssignmentConfirmationApplied(confirmed, {
        step: 'create',
        expectedRevision: 3,
        promptPackageId: 'prompt-1',
        draftId: 'draft-1',
        draftWorkingVersion: 2,
      }),
    ).toBe(false);
  });
});
