import { describe, expect, it } from 'vitest';

import {
  applyProfileCandidatePatch,
  validateProfileCandidatePatch,
} from '../src/application/profile-candidate-patch.js';
import { isStudentProfileCandidateRepresented } from '../src/domain/student-profile-candidate-model.js';

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
  it.each([
    { operation: 'apply', candidateIds: ['a', 'a'] },
    { operation: 'apply', candidateIds: [] },
    { operation: 'no_change', candidateIds: ['a'] },
    { operation: 'apply', candidateIds: ['a'], profile: {} },
  ])('rejects invalid closed decision %j', (decision) => {
    expect(() => validateProfileCandidatePatch(decision)).toThrow();
  });

  it('proves approved wording in its destination field without paraphrase or punctuation matching', () => {
    const candidate = {
      targetSection: 'interests_personal_context',
      fact: 'Old fact',
      approvedFact: 'Uses C++.',
    };
    expect(
      isStudentProfileCandidateRepresented(
        { interestsAndUsefulThemes: ['  USES  C++.  '] },
        candidate,
      ),
    ).toBe(true);
    expect(
      isStudentProfileCandidateRepresented({ interestsAndUsefulThemes: ['Uses C.'] }, candidate),
    ).toBe(false);
    expect(
      isStudentProfileCandidateRepresented(
        { interestsAndUsefulThemes: ['Programs in C++.'] },
        candidate,
      ),
    ).toBe(false);
    expect(isStudentProfileCandidateRepresented({ primaryGoals: ['Uses C++.'] }, candidate)).toBe(
      false,
    );
    expect(
      isStudentProfileCandidateRepresented(
        { persistentChallenges: [], durableConstraints: ['Limited time.'] },
        { targetSection: 'persistent_challenges_constraints', fact: 'Limited time.' },
      ),
    ).toBe(true);
  });
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
