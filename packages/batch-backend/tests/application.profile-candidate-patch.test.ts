import { describe, expect, it } from 'vitest';

import {
  applyProfileCandidatePatch,
  validateProfileCandidatePatch,
} from '../src/application/profile-candidate-patch.js';

const baseProfile = {
  schemaVersion: 'foundational_profile_v1' as const,
  overallLevel: 'B2',
  primaryGoals: ['Lead clearer product demos.'],
  communicationContexts: ['Weekly product reviews.'],
  interestsAndUsefulThemes: ['Travel'],
  stableStrengths: ['Prepared notes'],
  persistentChallenges: ['Transitions between points'],
  studyPreferences: ['Short practical tasks'],
  durableConstraints: [],
  teacherNotes: 'Preserve this teacher-authored note.',
};

describe('application/profile-candidate-patch', () => {
  it('applies only selected approved facts and preserves every unrelated field', () => {
    const result = applyProfileCandidatePatch({
      baseProfile,
      patch: validateProfileCandidatePatch({ operation: 'apply', candidateIds: ['candidate-1'] }),
      selectedCandidates: [
        {
          id: 'candidate-1',
          targetSection: 'interests_personal_context',
          fact: 'Plays pickleball.',
          approvedFact: 'Plays pickleball every week.',
        },
      ],
    });

    expect(result).toEqual({
      ...baseProfile,
      interestsAndUsefulThemes: ['Travel', 'Plays pickleball every week.'],
    });
  });

  it('leaves the base profile untouched for no_change', () => {
    expect(
      applyProfileCandidatePatch({
        baseProfile,
        patch: validateProfileCandidatePatch({ operation: 'no_change', candidateIds: [] }),
        selectedCandidates: [],
      }),
    ).toBe(baseProfile);
  });

  it('rejects candidate IDs that were not selected and approved for this request', () => {
    expect(() =>
      applyProfileCandidatePatch({
        baseProfile,
        patch: validateProfileCandidatePatch({ operation: 'apply', candidateIds: ['unknown'] }),
        selectedCandidates: [],
      }),
    ).toThrow('Candidate patch referenced unselected candidate IDs: unknown');
  });
});
