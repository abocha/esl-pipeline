import { describe, expect, it } from 'vitest';

import {
  deriveAssignmentWorkflow,
  getInvalidatedArtifacts,
  getTeacherNotesCommitDecision,
  resolveInitialAssignmentStep,
} from './assignment-workflow';

describe('assignment workflow model', () => {
  it.each([
    [{}, 'student'],
    [{ selectedStudent: true }, 'source'],
    [{ selectedStudent: true, transcriptReady: true }, 'context'],
    [{ selectedStudent: true, transcriptReady: true, promptReady: true }, 'create'],
    [
      { selectedStudent: true, transcriptReady: true, promptReady: true, draftReady: true },
      'review',
    ],
  ] as const)('derives the current step from %o', (partial, expectedCurrent) => {
    const steps = deriveAssignmentWorkflow({
      selectedStudent: false,
      transcriptReady: false,
      promptReady: false,
      draftReady: false,
      previewReady: false,
      published: false,
      ...partial,
    });

    expect(steps.find((step) => step.status === 'current')?.id).toBe(expectedCurrent);
    expect(steps.map((step) => step.label)).toEqual([
      'Student',
      'Lesson source',
      'Teaching context',
      'Create',
      'Review & share',
    ]);
  });

  it('keeps Review and share reachable for a published legacy job with missing artifact links', () => {
    const steps = deriveAssignmentWorkflow({
      selectedStudent: false,
      transcriptReady: false,
      promptReady: false,
      draftReady: false,
      previewReady: false,
      published: true,
    });

    expect(steps.find((step) => step.status === 'current')?.id).toBe('review');
    expect(steps.slice(0, -1).every((step) => step.status === 'complete')).toBe(true);
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

  it('maps durable session stages into focused UI steps', () => {
    const empty = {
      selectedStudent: false,
      transcriptReady: false,
      promptReady: false,
      draftReady: false,
      previewReady: false,
      published: false,
    };
    expect(resolveInitialAssignmentStep('source', empty)).toBe('student');
    expect(resolveInitialAssignmentStep('source', { ...empty, selectedStudent: true })).toBe(
      'source',
    );
    expect(resolveInitialAssignmentStep('context', empty)).toBe('context');
    expect(resolveInitialAssignmentStep('assignment', empty)).toBe('create');
    expect(resolveInitialAssignmentStep('review', empty)).toBe('review');
  });

  it('treats teacher notes with equivalent trimmed content as unchanged', () => {
    expect(
      getTeacherNotesCommitDecision({
        currentNotes: ' Focus on articles. ',
        committedNotes: 'Focus on articles.',
        hasDownstreamAssignment: true,
      }),
    ).toBe('unchanged');
  });

  it('commits changed teacher notes when no downstream assignment exists', () => {
    expect(
      getTeacherNotesCommitDecision({
        currentNotes: 'Focus on articles.',
        committedNotes: '',
        hasDownstreamAssignment: false,
      }),
    ).toBe('commit');
  });

  it('confirms invalidation before committing changed notes with downstream assignment', () => {
    expect(
      getTeacherNotesCommitDecision({
        currentNotes: 'Focus on articles.',
        committedNotes: 'Focus on stress.',
        hasDownstreamAssignment: true,
      }),
    ).toBe('confirm-and-invalidate');
  });
});
