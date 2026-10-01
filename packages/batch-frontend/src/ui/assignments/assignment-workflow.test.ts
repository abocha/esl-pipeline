import { describe, expect, it } from 'vitest';

import type { AssignmentSession } from '../../utils/api';
import {
  deriveAssignmentWorkflow,
  getInvalidatedArtifacts,
  getTeacherNotesCommitDecision,
} from './assignment-workflow';

function session(overrides: Partial<AssignmentSession> = {}): AssignmentSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    studentId: 'student-1',
    lessonId: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    revision: 1,
    confirmedStep: 'student',
    confirmed: { student: { studentId: 'student-1' }, source: null, context: null, create: null },
    publishTarget: null,
    selectedTtsProvider: null,
    selectedTtsStrategy: null,
    selectedTtsModel: null,
    selectedPreset: null,
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: null,
    selectedProfileId: null,
    selectedProfileRevisionId: null,
    selectedProfileRevisionHash: null,
    shareJobId: null,
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('assignment workflow model', () => {
  it.each([
    [null, 'student'],
    [session(), 'source'],
    [session({ confirmedStep: 'source' }), 'context'],
    [session({ confirmedStep: 'context' }), 'assignment'],
    [session({ confirmedStep: 'create' }), 'review'],
  ] as const)('derives the current step from confirmed progress', (value, expectedCurrent) => {
    const steps = deriveAssignmentWorkflow(value);

    expect(steps.find((step) => step.status === 'current')?.id).toBe(expectedCurrent);
    expect(steps.map((step) => step.label)).toEqual([
      'Student',
      'Lesson source',
      'Teaching context',
      'Create',
      'Review & share',
    ]);
  });

  it('does not mark a ready but unconfirmed draft complete', () => {
    const unconfirmedDraft = session({
      confirmedStep: 'context',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
    });

    expect(
      deriveAssignmentWorkflow(unconfirmedDraft).find((step) => step.id === 'assignment')?.status,
    ).toBe('current');
    expect(
      deriveAssignmentWorkflow(unconfirmedDraft).find((step) => step.id === 'review')?.status,
    ).toBe('locked');
  });

  it('returns to the earliest dirty confirmed boundary', () => {
    const confirmed = session({
      confirmedStep: 'create',
      lessonId: 'lesson-b',
      recordingId: 'recording-a',
      transcriptId: 'transcript-a',
      teacherNotes: 'saved notes',
      promptPackageId: 'prompt-a',
      draftId: 'draft-a',
      confirmed: {
        student: { studentId: 'student-1' },
        source: {
          lessonId: 'lesson-a',
          recordingId: 'recording-a',
          transcriptId: 'transcript-a',
          transcriptWorkingVersion: 1,
          transcriptStorageUri: 'local://transcript-a',
          transcriptHash: 'a'.repeat(64),
        },
        context: {
          teacherNotes: 'saved notes',
          profileRevisionId: null,
          profileRevisionHash: null,
        },
        create: {
          promptPackageId: 'prompt-a',
          draftId: 'draft-a',
          draftWorkingVersion: 1,
          draftStorageUri: 'local://draft-a',
          draftHash: 'b'.repeat(64),
        },
      },
    });

    expect(deriveAssignmentWorkflow(confirmed).find((step) => step.status === 'current')?.id).toBe(
      'source',
    );
  });

  it('marks a confirmed Share session complete without an editable current step', () => {
    const steps = deriveAssignmentWorkflow(
      session({ confirmedStep: 'share', shareJobId: 'job-1' }),
    );
    expect(steps.every((step) => step.status === 'complete')).toBe(true);
  });

  it('invalidates only dependent downstream artifacts', () => {
    expect(getInvalidatedArtifacts('student')).toEqual([
      'transcript',
      'prompt',
      'draft',
      'preview',
      'publishedJob',
    ]);
    expect(getInvalidatedArtifacts('recording')).toEqual([
      'transcript',
      'prompt',
      'draft',
      'preview',
      'publishedJob',
    ]);
    expect(getInvalidatedArtifacts('transcript')).toEqual([
      'prompt',
      'draft',
      'preview',
      'publishedJob',
    ]);
    expect(getInvalidatedArtifacts('teacherNotes')).toEqual([
      'prompt',
      'draft',
      'preview',
      'publishedJob',
    ]);
    expect(getInvalidatedArtifacts('draft')).toEqual(['preview', 'publishedJob']);
  });

  it('classifies teacher-note commits without changing the existing invalidation prompt', () => {
    expect(
      getTeacherNotesCommitDecision({
        currentNotes: ' Focus on articles. ',
        committedNotes: 'Focus on articles.',
        hasDownstreamAssignment: true,
      }),
    ).toBe('unchanged');
    expect(
      getTeacherNotesCommitDecision({
        currentNotes: 'Focus on articles.',
        committedNotes: '',
        hasDownstreamAssignment: false,
      }),
    ).toBe('commit');
    expect(
      getTeacherNotesCommitDecision({
        currentNotes: 'Focus on articles.',
        committedNotes: '',
        hasDownstreamAssignment: true,
      }),
    ).toBe('confirm-and-invalidate');
  });
});
