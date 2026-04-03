import { describe, expect, it } from 'vitest';

import type { StudentProfileCandidate } from '../../utils/api';
import {
  buildCreateStudentPayload,
  buildStarterProfileInput,
  CREATE_STUDENT_NAME_REQUIRED_MESSAGE,
  CREATE_STUDENT_STARTER_PROFILE_REQUIRED_MESSAGE,
  formatCandidateSectionLabel,
  formatCandidateStateLabel,
  groupVisibleCandidatesBySection,
  INITIAL_CREATE_STUDENT_FORM,
  isSelectableForPromotion,
  type ProfileCandidateFilter,
} from './StudentWorkspace.logic';

describe('StudentWorkspace logic', () => {
  it('builds a profile-bound payload when the starter profile is empty', () => {
    const result = buildCreateStudentPayload({
      ...INITIAL_CREATE_STUDENT_FORM,
      student: 'Alex',
      profileId: 'profile-alt.md',
      manifestPreset: 'lesson-manifest',
    });

    expect(result.validationError).toBeUndefined();
    expect(result.payload).toEqual({
      student: 'Alex',
      profileId: 'profile-alt.md',
      manifestPreset: 'lesson-manifest',
    });
    expect(result.starterProfile).toEqual({
      starterProfile: undefined,
      hasAnyValue: false,
      hasMissingRequired: false,
    });
  });

  it('builds a starter-profile payload and suppresses the profile picker binding', () => {
    const result = buildCreateStudentPayload({
      ...INITIAL_CREATE_STUDENT_FORM,
      student: 'Mira',
      profileId: 'profile-alt.md',
      starterLevel: 'B1',
      starterGoals: 'Speak more clearly at work.',
      starterProfessionOrContext: 'CSM with intl clients.',
      starterInterests: 'Travel and books.',
      starterLongRunningChallenges: 'Needs clearer tense control.',
      starterStudyPreferencesOrConstraints: 'Prefers structured review blocks.',
    });

    expect(result.validationError).toBeUndefined();
    expect(result.payload).toEqual({
      student: 'Mira',
      starterProfile: {
        level: 'B1',
        goals: 'Speak more clearly at work.',
        professionOrContext: 'CSM with intl clients.',
        interests: 'Travel and books.',
        longRunningChallenges: 'Needs clearer tense control.',
        studyPreferencesOrConstraints: 'Prefers structured review blocks.',
      },
    });
    expect(result.starterProfile).toEqual({
      starterProfile: {
        level: 'B1',
        goals: 'Speak more clearly at work.',
        professionOrContext: 'CSM with intl clients.',
        interests: 'Travel and books.',
        longRunningChallenges: 'Needs clearer tense control.',
        studyPreferencesOrConstraints: 'Prefers structured review blocks.',
      },
      hasAnyValue: true,
      hasMissingRequired: false,
    });
  });

  it('reports the same validation messages as the workspace UI', () => {
    expect(
      buildCreateStudentPayload({
        ...INITIAL_CREATE_STUDENT_FORM,
        student: '   ',
      }).validationError,
    ).toBe(CREATE_STUDENT_NAME_REQUIRED_MESSAGE);

    expect(
      buildCreateStudentPayload({
        ...INITIAL_CREATE_STUDENT_FORM,
        student: 'Mira',
        starterGoals: 'Speak more clearly at work.',
      }).validationError,
    ).toBe(CREATE_STUDENT_STARTER_PROFILE_REQUIRED_MESSAGE);
  });

  it('trims starter profile values consistently', () => {
    expect(
      buildStarterProfileInput({
        ...INITIAL_CREATE_STUDENT_FORM,
        starterLevel: ' B1 ',
        starterGoals: ' Speak more clearly at work. ',
        starterProfessionOrContext: ' CSM with intl clients. ',
        starterInterests: ' Travel and books. ',
        starterLongRunningChallenges: ' Needs clearer tense control. ',
        starterStudyPreferencesOrConstraints: ' Prefers structured review blocks. ',
        starterTeacherNotes: '  ',
      }),
    ).toEqual({
      starterProfile: {
        level: 'B1',
        goals: 'Speak more clearly at work.',
        professionOrContext: 'CSM with intl clients.',
        interests: 'Travel and books.',
        longRunningChallenges: 'Needs clearer tense control.',
        studyPreferencesOrConstraints: 'Prefers structured review blocks.',
      },
      hasAnyValue: true,
      hasMissingRequired: false,
    });
  });

  it('formats candidate labels consistently with the workspace UI', () => {
    expect(formatCandidateSectionLabel('work_communication_context')).toBe(
      'Work and communication context',
    );
    expect(
      formatCandidateStateLabel({
        status: 'approved',
        reviewState: 'approved',
      } as StudentProfileCandidate),
    ).toBe('Approved, not yet promoted');
  });

  it('groups visible candidates by section and promotion readiness', () => {
    const filter: ProfileCandidateFilter = 'reviewed';
    const candidates = [
      {
        id: 'candidate-pending',
        studentId: 'student-pending',
        status: 'pending_review',
        reviewState: 'unreviewed',
        targetSection: 'work_communication_context',
        proposedFact: 'A',
        approvedFactText: null,
        category: 'work_context',
        sourceSummary: null,
        authority: null,
        confidence: null,
        evidence: [],
        sourceSnapshotId: null,
        sourceLessonMemoryIds: [],
        reviewerId: null,
        reviewerNote: null,
        reviewedAt: null,
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'candidate-approved',
        studentId: 'student-approved',
        status: 'approved',
        reviewState: 'approved',
        targetSection: 'learning_preferences_study_habits',
        proposedFact: 'B',
        approvedFactText: 'B',
        category: 'study_preferences',
        sourceSummary: null,
        authority: null,
        confidence: null,
        evidence: [],
        sourceSnapshotId: null,
        sourceLessonMemoryIds: [],
        reviewerId: null,
        reviewerNote: null,
        reviewedAt: null,
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        createdAt: '',
        updatedAt: '',
      },
    ] as StudentProfileCandidate[];

    expect(groupVisibleCandidatesBySection(candidates, filter)).toEqual([
      [
        'learning_preferences_study_habits',
        [
          {
            id: 'candidate-approved',
            studentId: 'student-approved',
            status: 'approved',
            reviewState: 'approved',
            targetSection: 'learning_preferences_study_habits',
            proposedFact: 'B',
            approvedFactText: 'B',
            category: 'study_preferences',
            sourceSummary: null,
            authority: null,
            confidence: null,
            evidence: [],
            sourceSnapshotId: null,
            sourceLessonMemoryIds: [],
            reviewerId: null,
            reviewerNote: null,
            reviewedAt: null,
            promotedRevisionId: null,
            promotedAt: null,
            supersededById: null,
            createdAt: '',
            updatedAt: '',
          },
        ],
      ],
    ]);
    expect(isSelectableForPromotion(candidates[1] as StudentProfileCandidate)).toBe(true);
    expect(isSelectableForPromotion(candidates[0] as StudentProfileCandidate)).toBe(false);
  });
});
