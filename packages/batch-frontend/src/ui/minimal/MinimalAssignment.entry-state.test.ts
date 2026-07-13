import { describe, expect, it } from 'vitest';

import {
  getJobRecentAssignmentPresentation,
  getSessionRecentAssignmentPresentation,
} from './MinimalAssignment.entry-state';

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
    ['source', 'Lesson source in progress'],
    ['context', 'Learner context in progress'],
    ['assignment', 'Draft in progress'],
    ['review', 'Ready to preview or share'],
  ] as const)('maps a saved %s session to its persisted destination', (stage, activityLabel) => {
    expect(getSessionRecentAssignmentPresentation(stage)).toMatchObject({
      state: 'unfinished',
      activityLabel,
      actionLabel: 'Continue assignment',
      destination: stage === 'assignment' ? 'create' : stage,
    });
  });
});
