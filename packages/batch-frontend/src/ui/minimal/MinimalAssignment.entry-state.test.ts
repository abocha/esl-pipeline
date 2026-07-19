import { describe, expect, it } from 'vitest';

import type { AssignmentSession } from '../../utils/api';
import {
  getJobRecentAssignmentPresentation,
  getSessionRecentAssignmentPresentation,
} from './MinimalAssignment.entry-state';

function session(confirmedStep: AssignmentSession['confirmedStep']): AssignmentSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    studentId: 'student-1',
    lessonId: null,
    recordingId: confirmedStep === 'student' ? null : 'recording-1',
    transcriptId: confirmedStep === 'student' ? null : 'transcript-1',
    promptPackageId: confirmedStep === 'create' || confirmedStep === 'share' ? 'prompt-1' : null,
    draftId: confirmedStep === 'create' || confirmedStep === 'share' ? 'draft-1' : null,
    revision: 1,
    confirmedStep,
    confirmed: {
      student: { studentId: 'student-1' },
      source:
        confirmedStep === 'student'
          ? null
          : {
              lessonId: null,
              recordingId: 'recording-1',
              transcriptId: 'transcript-1',
              transcriptWorkingVersion: 1,
              transcriptStorageUri: 'local://transcript-1',
              transcriptHash: 'a'.repeat(64),
            },
      context:
        confirmedStep === 'student' || confirmedStep === 'source'
          ? null
          : {
              teacherNotes: null,
              profileId: null,
              profileRevisionId: null,
              profileRevisionHash: null,
            },
      create:
        confirmedStep === 'create' || confirmedStep === 'share'
          ? {
              promptPackageId: 'prompt-1',
              draftId: 'draft-1',
              draftWorkingVersion: 1,
              draftStorageUri: 'local://draft-1',
              draftHash: 'b'.repeat(64),
            }
          : null,
    },
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
    shareJobId: confirmedStep === 'share' ? 'job-1' : null,
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  };
}

describe('assignment entry state presentation', () => {
  it.each([
    ['queued', false, 'in-progress', 'In progress', 'Review progress'],
    ['running', false, 'in-progress', 'In progress', 'Review progress'],
    ['awaiting_approval', false, 'ready-to-share', 'Ready to share', 'Review assignment'],
    ['succeeded', false, 'ready-to-share', 'Ready to share', 'Review assignment'],
    ['succeeded', true, 'published', 'Published', 'Open assignment'],
    ['failed', false, 'needs-attention', 'Needs attention', 'Review issue'],
  ] as const)('maps %s jobs to the teacher-facing resume state', (jobState, isPublished, state, statusLabel, actionLabel) => {
    expect(getJobRecentAssignmentPresentation(jobState, isPublished)).toMatchObject({
      state,
      statusLabel,
      actionLabel,
      destination: 'review',
    });
  });

  it.each([
    ['student', 'Lesson source in progress', 'source'],
    ['source', 'Learner context in progress', 'context'],
    ['context', 'Draft in progress', 'assignment'],
    ['create', 'Ready to preview or share', 'review'],
  ] as const)('derives a %s-confirmed session presentation', (confirmedStep, activityLabel, destination) => {
    expect(getSessionRecentAssignmentPresentation(session(confirmedStep))).toMatchObject({
      state: 'unfinished',
      activityLabel,
      actionLabel: 'Continue assignment',
      destination,
    });
  });

  it('rejects completed Share sessions from the resumable-session presentation path', () => {
    expect(() => getSessionRecentAssignmentPresentation(session('share'))).toThrow(
      'Completed Share sessions must be presented through their linked job',
    );
  });
});
