import { describe, expect, it } from 'vitest';

import {
  deriveAssignmentWorkflow,
  getInvalidatedArtifacts,
  mapSessionStageToStep,
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
    expect(mapSessionStageToStep('source', empty)).toBe('student');
    expect(mapSessionStageToStep('source', { ...empty, selectedStudent: true })).toBe('source');
    expect(mapSessionStageToStep('context', empty)).toBe('context');
    expect(mapSessionStageToStep('assignment', empty)).toBe('create');
    expect(mapSessionStageToStep('review', empty)).toBe('review');
  });
});
