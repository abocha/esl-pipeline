import { describe, expect, it } from 'vitest';

import type { ProfileData } from './learning-data';
import { profileChanges, undoProfileChange } from './profile-updates';

const before: ProfileData = {
  level: 'B1',
  goal: 'Tell a clear story.',
  contexts: 'Travel',
  interests: 'Photography',
  strengths: 'Keeps a conversation going.',
  challenge: 'Past tense retrieval.',
  preferences: 'Short preparation.',
  constraints: 'Phone friendly.',
  focus: '',
};

const provenance = {
  learnerId: 'alex',
  sourceAssignmentId: 'assignment-alex',
  sourceId: 'source-alex-lesson',
  sourceTitle: 'A change of plans',
  reason: 'A teaching suggestion from the saved conversation source.',
  updatedAt: '2026-10-31T10:30:00+07:00',
};

describe('profile update model', () => {
  it('records each changed field with its before and after values and source', () => {
    const after: ProfileData = {
      ...before,
      challenge: 'Past tense retrieval.\nStart with a concrete example.',
      focus: 'Practise a short narrative plan.',
    };

    const changes = profileChanges(before, after, provenance);

    expect(changes).toHaveLength(2);
    expect(changes).toEqual([
      {
        id: JSON.stringify([
          'alex',
          'assignment-alex',
          'source-alex-lesson',
          'challenge',
          before.challenge,
          after.challenge,
        ]),
        learnerId: 'alex',
        field: 'challenge',
        before: before.challenge,
        after: after.challenge,
        sourceAssignmentId: 'assignment-alex',
        sourceId: 'source-alex-lesson',
        sourceTitle: 'A change of plans',
        reason: 'A teaching suggestion from the saved conversation source.',
        status: 'applied',
        updatedAt: '2026-10-31T10:30:00+07:00',
      },
      {
        id: JSON.stringify([
          'alex',
          'assignment-alex',
          'source-alex-lesson',
          'focus',
          before.focus,
          after.focus,
        ]),
        learnerId: 'alex',
        field: 'focus',
        before: before.focus,
        after: after.focus,
        sourceAssignmentId: 'assignment-alex',
        sourceId: 'source-alex-lesson',
        sourceTitle: 'A change of plans',
        reason: 'A teaching suggestion from the saved conversation source.',
        status: 'applied',
        updatedAt: '2026-10-31T10:30:00+07:00',
      },
    ]);

    expect(profileChanges(before, after, provenance).map(({ id }) => id)).toEqual(
      changes.map(({ id }) => id),
    );
  });

  it('undoes one field while preserving unrelated profile values', () => {
    const after: ProfileData = {
      ...before,
      challenge: 'Past tense retrieval.\nStart with a concrete example.',
      focus: 'Practise a short narrative plan.',
    };
    const challengeChange = profileChanges(before, after, provenance)[0]!;

    expect(undoProfileChange(after, challengeChange)).toEqual({
      ...before,
      focus: after.focus,
    });
    expect(after.challenge).toBe(challengeChange.after);
  });

  it('blocks undo when the field has changed again since the update', () => {
    const after = { ...before, challenge: 'Add a concrete example.' };
    const change = profileChanges(before, after, provenance)[0]!;

    expect(
      undoProfileChange({ ...after, challenge: 'Tutor added a newer note.' }, change),
    ).toBeNull();
  });

  it('blocks undo for an entry already marked undone', () => {
    const after = { ...before, focus: 'Practise a short narrative plan.' };
    const change = profileChanges(before, after, provenance)[0]!;

    expect(undoProfileChange(after, { ...change, status: 'undone' })).toBeNull();
  });
});
