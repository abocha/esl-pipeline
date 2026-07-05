import { describe, expect, it } from 'vitest';

import type { StudentProfileCandidate } from '../../utils/api';
import {
  buildCreateStudentPayload,
  buildStarterProfileInput,
  CREATE_STUDENT_NAME_REQUIRED_MESSAGE,
  formatCandidateSectionLabel,
  formatCandidateStateLabel,
  groupVisibleCandidatesBySection,
  INITIAL_CREATE_STUDENT_FORM,
  isSelectableForPromotion,
  type ProfileCandidateFilter,
} from './StudentProfileUi.logic';

function candidateForFilter(
  id: string,
  status: StudentProfileCandidate['status'],
  reviewState: StudentProfileCandidate['reviewState'],
): StudentProfileCandidate {
  return {
    id,
    studentId: `student-${id}`,
    status,
    reviewState,
    targetSection: 'learning_preferences_study_habits',
    proposedFact: id,
    approvedFactText: status === 'approved' || status === 'promoted' ? id : null,
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
    promotedRevisionId: status === 'promoted' ? 'revision-1' : null,
    promotedAt: status === 'promoted' ? '' : null,
    supersededById: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('StudentProfileUi logic', () => {
  it('builds a student-owned payload and ignores legacy advanced fields', () => {
    const result = buildCreateStudentPayload({
      ...INITIAL_CREATE_STUDENT_FORM,
      student: 'Alex',
      profileId: 'profile-alt.md',
      colorPreset: 'legacy-color',
      accentPreference: 'legacy-accent',
      manifestPreset: 'lesson-manifest',
    } as never);

    expect(result.validationError).toBeUndefined();
    expect(result.payload).toEqual({
      student: 'Alex',
    });
    expect(result.starterProfile).toEqual({
      starterProfile: undefined,
      hasAnyValue: false,
    });
  });

  it('builds a partial canonical starter-profile payload', () => {
    const result = buildCreateStudentPayload({
      ...INITIAL_CREATE_STUDENT_FORM,
      student: 'Mira',
      overallLevel: 'B1',
      primaryGoals: 'Speak more clearly at work.',
      stableStrengths: 'Prepared and curious.',
      durableConstraints: 'Mostly studies on mobile.',
    });

    expect(result.validationError).toBeUndefined();
    expect(result.payload).toEqual({
      student: 'Mira',
      starterProfile: {
        overallLevel: 'B1',
        primaryGoals: 'Speak more clearly at work.',
        stableStrengths: 'Prepared and curious.',
        durableConstraints: 'Mostly studies on mobile.',
      },
    });
    expect(result.starterProfile).toEqual({
      starterProfile: {
        overallLevel: 'B1',
        primaryGoals: 'Speak more clearly at work.',
        stableStrengths: 'Prepared and curious.',
        durableConstraints: 'Mostly studies on mobile.',
      },
      hasAnyValue: true,
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
        primaryGoals: 'Speak more clearly at work.',
      }).validationError,
    ).toBeUndefined();
  });

  it('trims starter profile values consistently', () => {
    expect(
      buildStarterProfileInput({
        ...INITIAL_CREATE_STUDENT_FORM,
        overallLevel: ' B1 ',
        primaryGoals: ' Speak more clearly at work. ',
        communicationContexts: ' CSM with intl clients. ',
        interestsAndUsefulThemes: ' Travel and books. ',
        persistentChallenges: ' Needs clearer tense control. ',
        studyPreferences: ' Prefers structured review blocks. ',
        teacherNotes: '  ',
      }),
    ).toEqual({
      starterProfile: {
        overallLevel: 'B1',
        primaryGoals: 'Speak more clearly at work.',
        communicationContexts: 'CSM with intl clients.',
        interestsAndUsefulThemes: 'Travel and books.',
        persistentChallenges: 'Needs clearer tense control.',
        studyPreferences: 'Prefers structured review blocks.',
      },
      hasAnyValue: true,
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
    const filter: ProfileCandidateFilter = 'approved';
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

  it('filters profile candidates by exact review view', () => {
    const candidates = [
      candidateForFilter('candidate-pending', 'pending_review', 'unreviewed'),
      candidateForFilter('candidate-approved', 'approved', 'approved'),
      candidateForFilter('candidate-deferred', 'pending_review', 'deferred'),
      candidateForFilter('candidate-rejected', 'rejected', 'rejected'),
      candidateForFilter('candidate-promoted', 'promoted', 'approved'),
    ];

    const idsFor = (filter: ProfileCandidateFilter) =>
      groupVisibleCandidatesBySection(candidates, filter).flatMap(([, items]) =>
        items.map((candidate) => candidate.id),
      );

    expect(idsFor('all')).toEqual([
      'candidate-pending',
      'candidate-approved',
      'candidate-deferred',
      'candidate-rejected',
      'candidate-promoted',
    ]);
    expect(idsFor('pending')).toEqual(['candidate-pending']);
    expect(idsFor('reviewed')).toEqual([
      'candidate-approved',
      'candidate-deferred',
      'candidate-rejected',
      'candidate-promoted',
    ]);
    expect(idsFor('approved')).toEqual(['candidate-approved']);
    expect(idsFor('deferred')).toEqual(['candidate-deferred']);
    expect(idsFor('rejected')).toEqual(['candidate-rejected']);
    expect(idsFor('promoted')).toEqual(['candidate-promoted']);
  });
});
