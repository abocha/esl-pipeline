import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  renderWorkspaceCandidatesPanel,
  renderWorkspaceWithProfileCandidates,
  STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS,
  setupStudentWorkspaceTest,
  studentWorkspaceApiMocks,
} from './StudentWorkspace.test-harness';

describe('StudentWorkspace candidates', () => {
  beforeEach(() => {
    setupStudentWorkspaceTest();
  });

  it('renders pending profile candidates grouped by target section', async () => {
    renderWorkspaceCandidatesPanel();

    expect(
      screen.getAllByText(/Uses English with product and engineering teams at work\./i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(/Prefers structured homework with built-in review blocks\./i),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /Select All Approved/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Generate Draft Revision/i })).toBeNull();
  });

  it('renders pending candidates as compact review cards with details collapsed by default', async () => {
    const user = userEvent.setup();
    renderWorkspaceCandidatesPanel();

    const card = screen.getByTestId('profile-candidate-card-candidate-pending');
    expect(card.textContent).toContain('Uses English with product and engineering teams at work.');
    expect(card.textContent).not.toContain('Work and communication context');
    expect(card.textContent).toContain('Pending review');
    expect(card.textContent).not.toContain('high confidence');
    expect(card.textContent).not.toContain('1 evidence excerpt');
    expect(card.textContent).not.toContain('student stated');
    expect(card.textContent).not.toContain(
      'Repeatedly mentioned sprint planning and client calls.',
    );
    expect(screen.queryByText(/Review candidate profile facts here/i)).toBeNull();
    expect(screen.queryByLabelText(/Profile Candidate Review Bucket/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh Candidates/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Review details for candidate-pending/i }),
    ).toBeNull();
    expect(screen.queryByText(/Lesson memory IDs/i)).toBeNull();
    expect(screen.queryByLabelText(/Approved Fact Text candidate-pending/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByRole('button', { name: 'Hide details' })).toBeTruthy();
    expect(screen.getByText(/Lesson memory IDs/i)).toBeTruthy();
    expect(screen.getByText(/Source lesson:/i)).toBeTruthy();
    expect(screen.getByText('Sprint planning')).toBeTruthy();
    expect(screen.getByText(/Source memory IDs:/i)).toBeTruthy();
    expect(screen.getByText(/Dedup decision:/i)).toBeTruthy();
    expect(screen.getByLabelText(/Approved Fact Text candidate-pending/i)).toBeTruthy();
  });

  it('shows all candidate views and filters by exact review state', async () => {
    const user = userEvent.setup();
    renderWorkspaceCandidatesPanel();

    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pending' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reviewed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approved' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deferred' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Promoted' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'All' }));

    expect(
      screen.getAllByText(/Uses English with product and engineering teams at work\./i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Prefers structured homework with built-in review blocks\./i).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Approved' }));

    await screen.findAllByText(/Prefers structured homework with built-in review blocks\./i);
    expect(
      screen.queryByText(/Might be interested in pickleball strategy vocabulary\./i),
    ).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Deferred' }));

    expect(
      screen.getAllByText(/Might be interested in pickleball strategy vocabulary\./i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Deferred/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Rejected' }));

    expect(
      screen.getAllByText(/Wants long grammar lectures before practice\./i).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Promoted' }));

    expect(
      screen.getAllByText(/Uses role-play to prepare for client calls\./i).length,
    ).toBeGreaterThan(0);
  });

  it('approves a profile candidate with edited text and a reviewer note', async () => {
    const user = userEvent.setup();
    await renderWorkspaceWithProfileCandidates();

    await user.click(screen.getByRole('button', { name: 'Details' }));
    const approvedText = await screen.findByLabelText(
      /Approved Fact Text candidate-pending/i,
      {},
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    fireEvent.change(approvedText, {
      target: { value: 'Uses English with product, engineering, and client teams.' },
    });
    fireEvent.change(screen.getByLabelText(/Reviewer Note candidate-pending/i), {
      target: { value: 'Confirmed.' },
    });
    await user.click(screen.getByRole('button', { name: /^Approve$/i }));

    await waitFor(() => {
      expect(studentWorkspaceApiMocks.approveStudentProfileCandidate).toHaveBeenCalledWith(
        'student-default',
        'candidate-pending',
        {
          approvedFactText: 'Uses English with product, engineering, and client teams.',
          reviewerNote: 'Confirmed.',
        },
      );
    });
  }, 10000);

  it('promotes an explicit subset of approved profile candidates into a draft revision', async () => {
    const user = userEvent.setup();
    const onPromoteProfileCandidates = vi.fn();
    renderWorkspaceCandidatesPanel({
      profileCandidateFilter: 'approved',
      selectedCandidateIds: ['candidate-approved'],
      profileCandidatePromotionNote: '',
      onPromoteProfileCandidates,
    });

    fireEvent.change(screen.getByLabelText(/Promotion Note/i), {
      target: { value: 'Promote the verified study habits.' },
    });
    await user.click(screen.getByRole('button', { name: /Generate Draft Revision/i }));

    expect(onPromoteProfileCandidates).toHaveBeenCalled();
  }, 10000);

  it('keeps draft generation unavailable until an approved candidate is selected', async () => {
    const user = userEvent.setup();
    const onPromoteProfileCandidates = vi.fn();
    renderWorkspaceCandidatesPanel({
      profileCandidateFilter: 'approved',
      selectedCandidateIds: [],
      onPromoteProfileCandidates,
    });

    const generateButton = screen.getByRole('button', {
      name: /Generate Draft Revision/i,
    }) as HTMLButtonElement;
    expect(generateButton.disabled).toBe(true);
    expect(screen.getAllByLabelText(/Select candidate .* for promotion/i)).toHaveLength(1);
    expect(
      screen.queryByLabelText(/Select candidate candidate-deferred for promotion/i),
    ).toBeNull();
    expect(screen.queryByLabelText(/Select candidate candidate-pending for promotion/i)).toBeNull();

    await user.click(screen.getByLabelText(/Select candidate candidate-approved for promotion/i));

    expect(generateButton.disabled).toBe(false);
    await user.click(generateButton);
    expect(onPromoteProfileCandidates).toHaveBeenCalledTimes(1);
  });

  it('loads the generated draft revision into the foundational profile editor', async () => {
    const user = userEvent.setup();
    await renderWorkspaceWithProfileCandidates();

    await user.click(screen.getByRole('button', { name: 'Approved' }));
    await user.click(screen.getByLabelText(/Select candidate candidate-approved for promotion/i));
    await user.click(screen.getByRole('button', { name: /Generate Draft Revision/i }));

    await waitFor(() => {
      expect(studentWorkspaceApiMocks.getProfileRevision).toHaveBeenCalledWith(
        'profile-default.md',
        'revision-draft-2',
      );
    });

    await waitFor(() => {
      expect((screen.getByLabelText(/Current level/i) as HTMLInputElement).value).toBe('B2');
    });
    expect((screen.getByLabelText(/Primary goals/i) as HTMLTextAreaElement).value).toBe(
      'Lead product demos with more confidence.',
    );
  });

  it('reloads profile candidates after activating a profile revision', async () => {
    const user = userEvent.setup();
    const now = '2026-04-20T09:00:00.000Z';
    const pendingCandidate = {
      id: 'candidate-pending',
      studentId: 'student-default',
      proposedFact: 'Uses English with product and engineering teams at work.',
      approvedFactText: null,
      category: 'work_context',
      targetSection: 'work_communication_context',
      sourceSummary: 'Repeatedly mentioned sprint planning and client calls.',
      authority: 'student_stated',
      confidence: 'high',
      evidence: [],
      sourceSnapshotId: 'snapshot-1',
      sourceLessonMemoryIds: ['lesson-1'],
      status: 'pending_review',
      reviewState: 'unreviewed',
      reviewerId: null,
      reviewerNote: null,
      reviewedAt: null,
      promotedRevisionId: null,
      promotedAt: null,
      supersededById: null,
      createdAt: now,
      updatedAt: now,
    };
    const approvedCandidate = {
      id: 'candidate-approved',
      studentId: 'student-default',
      proposedFact: 'Prefers structured homework with clear review blocks.',
      approvedFactText: 'Prefers structured homework with built-in review blocks.',
      category: 'study_preferences',
      targetSection: 'learning_preferences_study_habits',
      sourceSummary: 'Consistent request across recent assignments.',
      authority: 'teacher_confirmed',
      confidence: 'high',
      evidence: [],
      sourceSnapshotId: 'snapshot-1',
      sourceLessonMemoryIds: ['lesson-1'],
      status: 'approved',
      reviewState: 'approved',
      reviewerId: 'user-1',
      reviewerNote: 'Matches long-running pattern.',
      reviewedAt: now,
      promotedRevisionId: null,
      promotedAt: null,
      supersededById: null,
      createdAt: now,
      updatedAt: now,
    };
    const promotedCandidate = {
      ...approvedCandidate,
      status: 'promoted',
      promotedRevisionId: 'revision-draft-2',
      promotedAt: now,
      updatedAt: now,
    };
    const candidateResponse = (items: unknown[]) => ({
      studentId: 'student-default',
      items,
      total: items.length,
      limit: 200,
      offset: 0,
      order: 'desc',
    });

    studentWorkspaceApiMocks.listProfileRevisions.mockResolvedValue({
      items: [
        {
          id: 'revision-draft-2',
          profileId: 'profile-default.md',
          contentHash: 'draft-hash-2',
          source: 'profile_revision_refresh',
          status: 'draft',
          versionNumber: 2,
          versionLabel: 'v2',
          activatedAt: null,
          deprecatedAt: null,
          createdAt: now,
          createdBy: 'user-1',
          restoredFromRevisionId: null,
        },
        {
          id: 'revision-1',
          profileId: 'profile-default.md',
          contentHash: 'hash-1',
          source: 'create',
          status: 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: now,
          deprecatedAt: null,
          createdAt: now,
          createdBy: 'user-1',
          restoredFromRevisionId: null,
        },
      ],
      total: 2,
      limit: 25,
      offset: 0,
      order: 'desc',
    });
    studentWorkspaceApiMocks.listStudentProfileCandidates
      .mockResolvedValueOnce(candidateResponse([pendingCandidate, approvedCandidate]))
      .mockResolvedValueOnce(candidateResponse([pendingCandidate, promotedCandidate]));

    await renderWorkspaceWithProfileCandidates();

    await user.click(screen.getByRole('button', { name: 'Approved' }));
    expect(
      await screen.findByText(/Prefers structured homework with built-in review blocks\./i),
    ).toBeTruthy();

    const draftRevisionLabel = await screen.findByText('v2');
    const draftRevisionItem = draftRevisionLabel.closest('.workspace-list-item');
    if (!draftRevisionItem) {
      throw new Error('Expected draft revision row to be rendered.');
    }
    await user.click(
      within(draftRevisionItem as HTMLElement).getByRole('button', { name: 'Activate' }),
    );

    await waitFor(
      () => {
        expect(studentWorkspaceApiMocks.activateProfileRevision).toHaveBeenCalledWith(
          'profile-default.md',
          'revision-draft-2',
        );
        expect(studentWorkspaceApiMocks.listStudentProfileCandidates).toHaveBeenCalledTimes(2);
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await waitFor(() => {
      expect(
        screen.queryByText(/Prefers structured homework with built-in review blocks\./i),
      ).toBeNull();
    });
    expect(
      screen.getByText(/No approved profile candidates visible for this student\./i),
    ).toBeTruthy();
  }, 10000);
});
