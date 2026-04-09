import { afterEach, beforeEach, describe, it } from 'vitest';
import { fireEvent } from '@testing-library/react';

import {
  createMinimalUser,
  INTEGRATION_TEST_TIMEOUT_MS,
  openAdvancedActions,
  openPublishingSettings,
  previewCurrentDraft,
  renderMinimalAssignment,
  renderPublishedAssignment,
  renderResumedAssignment,
  setupMinimalAssignmentTest,
  testExpect as expect,
  testScreen as screen,
  testWaitFor as waitFor,
  testWithin as within,
  testVi as vi,
} from './MinimalAssignment.test-harness';

describe('MinimalAssignment - staged workflow UI', () => {
  beforeEach(() => {
    setupMinimalAssignmentTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    'guides a new assignment through staged teacher-facing workflow copy',
    async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

    expect(screen.getByRole('heading', { name: /Build and share a lesson assignment/i })).toBeTruthy();
    expect(screen.getByText(/Current focus: Resume or start/i)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Transcript engine/i })).toBeTruthy();
    expect(screen.queryByText(/STT provider/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await screen.findByDisplayValue('Student transcript text');
    await waitFor(() => {
      expect(screen.getByText(/Current focus: Add teaching context/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
      target: { value: 'Focus on past tense corrections and follow-up questions.' },
    });
    await user.click(screen.getByRole('button', { name: /Generate instructions/i }));
    await screen.findByDisplayValue('Prompt package output');
    await waitFor(() => {
      expect(screen.getByText(/Current focus: Create assignment/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: /Draft markdown/i }), {
      target: { value: '# Final lesson assignment' },
    });
    await waitFor(() => {
      expect(screen.getByText(/Current focus: Review and share/i)).toBeTruthy();
    });

    await previewCurrentDraft(user);
    openPublishingSettings();
    fireEvent.change(screen.getByRole('combobox', { name: /Learning preset/i }), {
      target: { value: 'b2-default' },
    });
    await user.click(screen.getByRole('button', { name: /Share assignment/i }));

    await screen.findAllByText(/Job ID: job-1/i);
    await waitFor(() => {
      expect(screen.getByText(/Current focus: Advanced actions/i)).toBeTruthy();
    });
      expect(screen.getByRole('button', { name: /Show advanced actions/i })).toBeTruthy();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it('lands resumed work in a later stage with progress markers', async () => {
    await renderResumedAssignment(
      {
        draftText: '# Draft markdown',
      },
      { waitFor: 'promptReady' },
    );

    expect(screen.getByText(/Current focus: Advanced actions/i)).toBeTruthy();
    const progressList = screen.getByRole('list', { name: /Assignment progress/i });
    expect(within(progressList).getByText('Review and share')).toBeTruthy();
    expect(within(progressList).getByText(/Latest share status: succeeded\./i)).toBeTruthy();
    expect(within(progressList).getByText('Advanced actions')).toBeTruthy();
    expect(within(progressList).getAllByText('Done').length).toBeGreaterThan(0);
    expect(within(progressList).getByText('Available')).toBeTruthy();
  });

  it('keeps advanced actions tucked away until a shared assignment exists', async () => {
    renderMinimalAssignment();

    expect(
      screen.getByText(/Share the assignment once to unlock republish, reruns, cancellation, and lineage details\./i),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show advanced actions/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh actions/i })).toBeNull();
  });

  it('keeps advanced controls collapsed until the teacher opens them', async () => {
    await renderPublishedAssignment();

    expect(screen.getByRole('button', { name: /Show advanced actions/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Refresh actions/i })).toBeNull();

    openAdvancedActions();

    expect(screen.getByRole('button', { name: /Refresh actions/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Republish current draft/i })).toBeTruthy();
  });
});
