import { fireEvent, screen, waitFor } from '@testing-library/react';
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
  });

  it('renders pending candidates as compact review cards with details collapsed by default', async () => {
    const user = userEvent.setup();
    renderWorkspaceCandidatesPanel();

    const card = screen.getByTestId('profile-candidate-card-candidate-pending');
    expect(card.textContent).toContain('Uses English with product and engineering teams at work.');
    expect(card.textContent).toContain('Work and communication context');
    expect(card.textContent).toContain('Pending review');
    expect(card.textContent).toContain('high confidence');
    expect(card.textContent).toContain('1 evidence excerpt');
    expect(card.textContent).toContain('Repeatedly mentioned sprint planning and client calls.');
    expect(screen.queryByText(/Lesson memory IDs/i)).toBeNull();
    expect(screen.queryByLabelText(/Approved Fact Text candidate-pending/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /Review details for candidate-pending/i }));

    expect(
      screen.getByRole('button', { name: /Hide details for candidate-pending/i }),
    ).toBeTruthy();
    expect(screen.getByText(/Lesson memory IDs/i)).toBeTruthy();
    expect(screen.getByText(/Source lesson:/i)).toBeTruthy();
    expect(screen.getByText('Sprint planning')).toBeTruthy();
    expect(screen.getByText(/Source memory IDs:/i)).toBeTruthy();
    expect(screen.getByText(/Dedup decision:/i)).toBeTruthy();
    expect(screen.getByLabelText(/Approved Fact Text candidate-pending/i)).toBeTruthy();
  });

  it('shows reviewed profile candidates including deferred items', async () => {
    const user = userEvent.setup();
    renderWorkspaceCandidatesPanel();

    await user.selectOptions(screen.getByLabelText(/Profile Candidate Review Bucket/i), 'reviewed');

    await screen.findAllByText(/Prefers structured homework with built-in review blocks\./i);
    expect(
      screen.getAllByText(/Might be interested in pickleball strategy vocabulary\./i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Deferred/i).length).toBeGreaterThan(0);
  });

  it('approves a profile candidate with edited text and a reviewer note', async () => {
    const user = userEvent.setup();
    await renderWorkspaceWithProfileCandidates();

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
      profileCandidateFilter: 'reviewed',
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
      profileCandidateFilter: 'reviewed',
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

    await user.selectOptions(screen.getByLabelText(/Profile Candidate Review Bucket/i), 'reviewed');
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
});
