import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudentProfileCandidate } from '../../utils/api';
import { ProfileCandidatesPanel } from './ProfileCandidatesPanel';
import {
  PROFILE_CANDIDATE_APPROVED_FILTER,
  type ProfileCandidateFilter,
} from './StudentProfileUi.logic';

const NOW = '2026-04-20T09:00:00.000Z';

function profileCandidate(
  id: string,
  status: StudentProfileCandidate['status'],
  reviewState: StudentProfileCandidate['reviewState'],
  approvedFactText: string | null,
): StudentProfileCandidate {
  return {
    id,
    studentId: 'student-default',
    proposedFact: approvedFactText ?? 'Uses English with product and engineering teams at work.',
    approvedFactText,
    category: 'study_preferences',
    targetSection: 'learning_preferences_study_habits',
    sourceSummary: 'Consistent request across recent assignments.',
    authority: 'teacher_confirmed',
    confidence: 'high',
    evidence: [
      {
        quote: 'Please include review tasks so I do not forget old material.',
        speakerRole: 'student',
        transcriptSpan: '00:31-00:35',
        evidenceNote: 'Direct study preference.',
        sourceKind: 'student_memory_snapshot',
        sourceArtifactId: 'snapshot-1',
      },
    ],
    sourceSnapshotId: 'snapshot-1',
    sourceLessonMemoryIds: ['lesson-1'],
    status,
    reviewState,
    reviewerId: 'user-1',
    reviewerNote: null,
    reviewedAt: NOW,
    promotedRevisionId: status === 'promoted' ? 'revision-active' : null,
    promotedAt: status === 'promoted' ? NOW : null,
    supersededById: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function renderProfileCandidatesPanel(options: {
  candidates?: StudentProfileCandidate[];
  filter?: ProfileCandidateFilter;
  selectedCandidateIds?: string[];
  onPromoteProfileCandidates?: () => void | Promise<void>;
}) {
  function Harness() {
    const [profileCandidateFilter, setProfileCandidateFilter] = useState<ProfileCandidateFilter>(
      options.filter ?? 'pending',
    );
    const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>(
      options.selectedCandidateIds ?? [],
    );
    const [profileCandidateDrafts, setProfileCandidateDrafts] = useState<
      Record<string, { approvedFactText: string; reviewerNote: string }>
    >({});

    return (
      <ProfileCandidatesPanel
        selectedStudentId="student-default"
        profileCandidates={
          options.candidates ?? [
            profileCandidate(
              'candidate-pending',
              'pending_review',
              'unreviewed',
              'Uses English with product and engineering teams at work.',
            ),
            profileCandidate(
              'candidate-approved',
              'approved',
              'approved',
              'Prefers structured homework with built-in review blocks.',
            ),
          ]
        }
        profileCandidatesLoading={false}
        profileCandidatesError={null}
        profileCandidateFilter={profileCandidateFilter}
        setProfileCandidateFilter={setProfileCandidateFilter}
        profileCandidateAction={null}
        profileCandidateDrafts={profileCandidateDrafts}
        updateProfileCandidateDraft={(candidateId, patch) =>
          setProfileCandidateDrafts((current) => ({
            ...current,
            [candidateId]: {
              approvedFactText:
                patch.approvedFactText ?? current[candidateId]?.approvedFactText ?? '',
              reviewerNote: patch.reviewerNote ?? current[candidateId]?.reviewerNote ?? '',
            },
          }))
        }
        selectedCandidateIds={selectedCandidateIds}
        setSelectedCandidateIds={setSelectedCandidateIds}
        profileCandidatePromotionNote=""
        setProfileCandidatePromotionNote={() => {}}
        profileCandidatePromotionBusy={false}
        profileCandidatePromotionError={null}
        profileCandidatePromotionSuccess={null}
        onRefreshCandidates={() => {}}
        onPromoteProfileCandidates={options.onPromoteProfileCandidates ?? (() => {})}
        onReviewProfileCandidate={() => {}}
      />
    );
  }

  return render(<Harness />);
}

describe('ProfileCandidatesPanel', () => {
  it('filters approved candidates without showing promoted candidates in the approved queue', async () => {
    const user = userEvent.setup();
    renderProfileCandidatesPanel({
      candidates: [
        profileCandidate(
          'candidate-approved',
          'approved',
          'approved',
          'Prefers structured homework with built-in review blocks.',
        ),
        profileCandidate(
          'candidate-promoted',
          'promoted',
          'approved',
          'Uses role-play to prepare for client calls.',
        ),
      ],
      filter: PROFILE_CANDIDATE_APPROVED_FILTER,
    });

    expect(
      screen.getByText(/Prefers structured homework with built-in review blocks\./i),
    ).toBeTruthy();
    expect(screen.queryByText(/Uses role-play to prepare for client calls\./i)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Promoted' }));

    expect(screen.getByText(/Uses role-play to prepare for client calls\./i)).toBeTruthy();
  });

  it('promotes only explicitly selected approved candidates', async () => {
    const user = userEvent.setup();
    const onPromoteProfileCandidates = vi.fn();
    renderProfileCandidatesPanel({
      filter: PROFILE_CANDIDATE_APPROVED_FILTER,
      selectedCandidateIds: ['candidate-approved'],
      onPromoteProfileCandidates,
    });

    fireEvent.change(screen.getByLabelText(/Promotion Note/i), {
      target: { value: 'Promote the verified study habits.' },
    });
    await user.click(screen.getByRole('button', { name: /Generate Draft Revision/i }));

    expect(onPromoteProfileCandidates).toHaveBeenCalledTimes(1);
  });
});
