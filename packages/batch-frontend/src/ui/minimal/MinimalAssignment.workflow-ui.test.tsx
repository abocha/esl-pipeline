import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it } from 'vitest';

import {
  testAct as act,
  testApi as api,
  createMinimalUser,
  testExpect as expect,
  INTEGRATION_TEST_TIMEOUT_MS,
  makeRecording,
  openAdvancedActions,
  previewCurrentDraft,
  renderMinimalAssignment,
  renderPublishedAssignment,
  renderResumedAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testVi as vi,
  testWaitFor as waitFor,
  testWithin as within,
} from './MinimalAssignment.test-harness';
import { getTranscriptUnexpectedCharacterWarnings } from './MinimalAssignment.transcript-warnings';

describe('MinimalAssignment - staged workflow UI', () => {
  beforeEach(() => {
    setupMinimalAssignmentTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flags Spanish-looking accent characters in transcript text', () => {
    expect(getTranscriptUnexpectedCharacterWarnings('Student: Ajá, I understand.')).toEqual(['á']);
    expect(getTranscriptUnexpectedCharacterWarnings('Teacher: Ага, good.')).toEqual([]);
  });

  it(
    'guides a new assignment through staged teacher-facing workflow copy',
    async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      expect(
        screen.getByRole('heading', { name: /Build and share a lesson assignment/i }),
      ).toBeTruthy();
      expect(screen.getByText(/Current focus: Resume or start/i)).toBeTruthy();
      expect(screen.queryByRole('listbox', { name: /Recent assignments/i })).toBeNull();
      expect(screen.getByRole('combobox', { name: /Transcript engine/i })).toBeTruthy();
      expect(screen.queryByText(/STT provider/i)).toBeNull();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await waitFor(() => {
        expect(screen.getByText(/Current focus: Add lesson source/i)).toBeTruthy();
      });
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await waitFor(() => {
        expect(screen.getByText(/Current focus: Add teaching context/i)).toBeTruthy();
      });

      fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
        target: { value: 'Focus on past tense corrections and follow-up questions.' },
      });
      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));
      await screen.findByDisplayValue('# Generated assignment draft');
      await waitFor(() => {
        expect(screen.getByText(/Current focus: Review and share/i)).toBeTruthy();
      });

      fireEvent.change(screen.getByRole('textbox', { name: /Draft markdown/i }), {
        target: { value: '# Final lesson assignment' },
      });
      await waitFor(() => {
        expect(screen.getByText(/Current focus: Review and share/i)).toBeTruthy();
      });

      await previewCurrentDraft(user);
      await user.click(screen.getByRole('button', { name: /Share assignment/i }));

      await screen.findAllByText(/Job ID: job-1/i);
      await waitFor(() => {
        expect(screen.getByText(/Current focus: Advanced actions/i)).toBeTruthy();
      });
      expect(screen.getByRole('button', { name: /Show advanced actions/i })).toBeTruthy();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'keeps provider, template, quota, and audio model controls out of the normal tutor flow',
    async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');

      expect(screen.queryByRole('combobox', { name: /Prompt template/i })).toBeNull();
      expect(screen.queryByText(/Prompt text/i)).toBeNull();
      expect(screen.queryByText(/Generation settings/i)).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Generation provider/i })).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Generation model/i })).toBeNull();
      expect(screen.queryByText(/Generation limits/i)).toBeNull();
      expect(screen.queryByText(/\bRPM\b/i)).toBeNull();
      expect(screen.queryByText(/\bTPM\b/i)).toBeNull();
      expect(screen.queryByText(/\bRPD\b/i)).toBeNull();
      expect(screen.queryByText(/Assignments publish as HTML pages/i)).toBeNull();
      expect(screen.queryByText(/Audio and publishing settings/i)).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Voice engine/i })).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Reading style/i })).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Voice model/i })).toBeNull();

      const generateAssignmentButton = screen.getByRole('button', {
        name: /^Generate assignment$/i,
      });
      await waitFor(() => {
        expect((generateAssignmentButton as HTMLButtonElement).disabled).toBe(false);
      });
      await user.click(generateAssignmentButton);

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            templateId: 'tpl-default',
          }),
        );
        expect(api.generateDraft).toHaveBeenCalledWith({
          promptPackageId: 'pkg-1',
          provider: 'openai',
          model: 'gpt-5.2',
        });
      });
      expect(await screen.findByDisplayValue('# Generated assignment draft')).toBeTruthy();
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
    expect(within(progressList).queryByText('Locked')).toBeNull();
  });

  it('keeps advanced actions tucked away until a shared assignment exists', async () => {
    renderMinimalAssignment();

    await waitFor(() => {
      expect(api.fetchPromptOptions).toHaveBeenCalledTimes(1);
      expect(api.fetchJobOptions).toHaveBeenCalledTimes(1);
      expect(api.fetchStudentOptions).toHaveBeenCalledTimes(1);
    });
    await screen.findByRole('option', { name: 'Alex' });

    expect(
      screen.getByText(
        /Share the assignment once to unlock updates, audio refreshes, cancellation, and support details\./i,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show advanced actions/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh actions/i })).toBeNull();
  });

  it('keeps one recording SSE subscription alive across status refreshes', async () => {
    const user = createMinimalUser();
    const closeSse = vi.fn();
    vi.mocked(api.subscribeToJobEvents).mockReturnValue({ close: closeSse } as never);
    vi.mocked(api.uploadRecording).mockResolvedValueOnce(
      makeRecording({
        status: 'transcribing',
        transcriptId: null,
      }),
    );
    vi.mocked(api.getRecording).mockResolvedValue(
      makeRecording({
        status: 'transcribing',
        transcriptId: null,
        updatedAt: '2026-02-05T00:00:01.000Z',
      }),
    );

    renderMinimalAssignment();
    await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
    await screen.findByRole('option', { name: 'Alex' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^Student$/i }), 'student-alex');
    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(api.getRecording).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.subscribeToJobEvents).toHaveBeenCalledTimes(1);
    expect(closeSse).not.toHaveBeenCalled();
  });

  it('keeps advanced controls collapsed until the teacher opens them', async () => {
    const user = createMinimalUser();
    await renderResumedAssignment(
      {
        status: {
          state: 'succeeded',
        },
      },
      { waitFor: 'promptReady' },
    );

    expect(screen.getByRole('button', { name: /Show advanced actions/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Refresh actions/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Show advanced actions/i }));

    expect(await screen.findByRole('button', { name: /Refresh actions/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Republish current draft/i })).toBeTruthy();
  });

  it('shows support-facing audio notices in advanced support details', async () => {
    vi.mocked(api.fetchJobProvenance).mockResolvedValueOnce({
      job: {
        id: 'job-1',
        state: 'succeeded',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:01:00.000Z',
        startedAt: '2024-01-01T00:00:10.000Z',
        finishedAt: '2024-01-01T00:01:00.000Z',
        sourceJobId: 'job-0',
        manifestPath: '/tmp/manifest.json',
        htmlUrl: null,
        error: null,
      },
      sourceJob: null,
      recording: null,
      transcript: null,
      promptPackage: null,
      draft: null,
      tts: null,
      pronunciationWarnings: [
        {
          code: 'rerun_pronunciation_chunk_unknown_previous_provider',
          message:
            'Pronunciation chunk rerun could not confirm the previous clip provider; using provider-scoped fallback resolution instead.',
        },
      ],
      lineage: null,
      actions: [],
    });

    await renderPublishedAssignment();
    openAdvancedActions();

    expect(await screen.findByText(/Audio notices/i)).toBeTruthy();
    expect(screen.getByText(/using provider-scoped fallback resolution instead/i)).toBeTruthy();
  });
});
