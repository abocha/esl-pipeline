import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS,
  renderWorkspaceWithProfileCandidates,
  setupStudentWorkspaceTest,
} from './StudentWorkspace.test-harness';
import * as api from '../../utils/api';

describe('StudentWorkspace candidates', () => {
  beforeEach(() => {
    setupStudentWorkspaceTest();
  });

  it('renders pending profile candidates grouped by target section', async () => {
    await renderWorkspaceWithProfileCandidates();

    expect(
      screen.getAllByText(/Uses English with product and engineering teams at work\./i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(/Prefers structured homework with built-in review blocks\./i),
    ).toBeNull();
  });

  it('shows reviewed profile candidates including deferred items', async () => {
    const user = userEvent.setup();
    await renderWorkspaceWithProfileCandidates();

    await user.selectOptions(
      screen.getByLabelText(/Profile Candidate Review Bucket/i),
      'reviewed',
    );

    await screen.findAllByText(/Prefers structured homework with built-in review blocks\./i);
    expect(
      screen.getAllByText(/Might be interested in pickleball strategy vocabulary\./i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Deferred/i).length).toBeGreaterThan(0);
  });

  it(
    'approves a profile candidate with edited text and a reviewer note',
    async () => {
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
        expect(api.approveStudentProfileCandidate).toHaveBeenCalledWith(
          'student-default',
          'candidate-pending',
          {
            approvedFactText: 'Uses English with product, engineering, and client teams.',
            reviewerNote: 'Confirmed.',
          },
        );
      });
    },
    10000,
  );

  it(
    'promotes an explicit subset of approved profile candidates into a draft revision',
    async () => {
      const user = userEvent.setup();
      await renderWorkspaceWithProfileCandidates();

      await user.selectOptions(
        screen.getByLabelText(/Profile Candidate Review Bucket/i),
        'reviewed',
      );
      await screen.findAllByText(/Prefers structured homework with built-in review blocks\./i);

      await user.click(screen.getByLabelText(/Select candidate candidate-approved for promotion/i));
      fireEvent.change(screen.getByLabelText(/Promotion Note/i), {
        target: { value: 'Promote the verified study habits.' },
      });
      await user.click(screen.getByRole('button', { name: /Generate Draft Revision/i }));

      await waitFor(() => {
        expect(api.promoteStudentProfileCandidates).toHaveBeenCalledWith('student-default', {
          candidateIds: ['candidate-approved'],
          reviewerNote: 'Promote the verified study habits.',
        });
      });

      expect(screen.getByText(/Draft revision revision-draft-2 created/i)).toBeTruthy();
    },
    10000,
  );
});
