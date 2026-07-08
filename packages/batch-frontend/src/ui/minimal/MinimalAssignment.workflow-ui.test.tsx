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
      expect(screen.queryByRole('combobox', { name: /Transcript engine/i })).toBeNull();
      expect(screen.queryByText(/STT provider/i)).toBeNull();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await waitFor(() => {
        expect(screen.getByText(/Current focus: Add lesson source/i)).toBeTruthy();
      });
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: /Add lesson source/i })).toBeTruthy();
      expect(screen.getByRole('combobox', { name: /^Student$/i })).toBeTruthy();
      expect(screen.getByRole('combobox', { name: /Transcript engine/i })).toBeTruthy();
      expect(screen.getByText('Next step: choose the student for this lesson.')).toBeTruthy();
      expect(screen.queryByText(/Choose a student and upload a recording\./i)).toBeNull();
      expect(
        screen.queryByText(/Choose a student, upload a recording, and let the transcript/i),
      ).toBeNull();
      expect(screen.queryByText(/Select a student before uploading a recording\./i)).toBeNull();
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      expect(screen.getByText('Next step: upload the lesson recording.')).toBeTruthy();
      expect(screen.queryByText(/Drag a recording here or click to browse/i)).toBeNull();
      expect(screen.queryByText(/Learning profile context/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /^Generate assignment$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Preview assignment/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Share assignment/i })).toBeNull();
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      expect(screen.getByRole('heading', { name: /Learner context/i })).toBeTruthy();
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
    expect(within(progressList).queryByText(/Latest share status: succeeded\./i)).toBeNull();
    expect(within(progressList).getByText('Advanced actions')).toBeTruthy();
    expect(within(progressList).getAllByText('Done').length).toBeGreaterThan(0);
    expect(within(progressList).getByText('Available')).toBeTruthy();
    expect(within(progressList).queryByText('Locked')).toBeNull();
  });

  it('keeps the assignment overview header to title, focus, and compact progress', async () => {
    await renderPublishedAssignment(
      {
        draftText: '# Draft markdown',
        status: {
          studentId: 'student-alex',
        },
      },
      { user: createMinimalUser() },
    );

    expect(
      screen.getByRole('heading', { name: /Build and share a lesson assignment/i }),
    ).toBeTruthy();
    expect(screen.getByText(/Current focus: Advanced actions/i)).toBeTruthy();

    const overview = screen.getByRole('region', {
      name: /Build and share a lesson assignment/i,
    });
    expect(within(overview).queryByText(/^Assignment Builder$/i)).toBeNull();
    expect(within(overview).queryByText(/^Student$/i)).toBeNull();
    expect(within(overview).queryByText(/^Transcript$/i)).toBeNull();
    expect(within(overview).queryByText(/^Assignment$/i)).toBeNull();
    expect(within(overview).queryByText(/^Share status$/i)).toBeNull();

    const progressList = within(overview).getByRole('list', { name: /Assignment progress/i });
    expect(within(progressList).getByText('Resume or start')).toBeTruthy();
    expect(within(progressList).getByText('Advanced actions')).toBeTruthy();
    expect(within(progressList).queryByText(/Working with assignment/i)).toBeNull();
    expect(within(progressList).queryByText(/Transcript ready/i)).toBeNull();
    expect(within(progressList).queryByText(/Shared assignment ready/i)).toBeNull();
  });

  it(
    'keeps unlocked resumed stages distilled to task-critical controls',
    async () => {
      await renderPublishedAssignment(
        {
          draftText: '# Draft markdown',
          status: {
            studentId: 'student-alex',
          },
        },
        { user: createMinimalUser() },
      );

      expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      expect(screen.getByDisplayValue('# Draft markdown')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Refresh actions/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /Open Learning page/i })).toBeTruthy();

      expect(screen.queryByRole('button', { name: /Drop audio file/i })).toBeNull();
      expect(screen.queryByText(/Recording ID:/i)).toBeNull();
      expect(screen.queryByText(/Selected:/i)).toBeNull();
      expect(screen.queryByText(/Review the transcript here/i)).toBeNull();
      expect(screen.queryByText(/Review the durable learner context/i)).toBeNull();
      expect(screen.queryByText(/This gets woven into the assignment/i)).toBeNull();
      expect(screen.queryByText(/Generate a first draft from the lesson source/i)).toBeNull();
      expect(screen.queryByText(/Preview locks the current version/i)).toBeNull();
      expect(screen.queryByText(/Assignments publish as an Assignment Handout/i)).toBeNull();
      expect(screen.queryByText(/Anything you leave unchecked stays as-is/i)).toBeNull();
      expect(screen.queryByText(/Pronunciation chunks default to Google/i)).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'distills resume/start and rerun surfaces while keeping support details available',
    async () => {
      const user = createMinimalUser();

      await renderPublishedAssignment(
        {
          draftText: '# Draft markdown',
          status: {
            studentId: 'student-alex',
          },
        },
        { user },
      );

      expect(screen.getByRole('heading', { name: /Resume or start/i })).toBeTruthy();
      const resumeStage = screen
        .getByRole('heading', { name: /Resume or start/i })
        .closest('section');
      expect(resumeStage).toBeTruthy();
      const resumeScope = within(resumeStage as HTMLElement);
      expect(screen.getByRole('button', { name: /Resume recent work/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Start new assignment/i })).toBeTruthy();
      expect(resumeScope.queryByRole('button', { name: /Hide details|Show details/i })).toBeNull();
      expect(
        resumeScope.queryByRole('button', { name: /Refresh pronunciation audio/i }),
      ).toBeNull();
      expect(resumeScope.queryByRole('button', { name: /Republish current draft/i })).toBeNull();
      expect(resumeScope.queryByRole('button', { name: /Cancel job/i })).toBeNull();
      expect(resumeScope.queryByText(/Latest shared assignment ready/i)).toBeNull();
      expect(screen.queryByText(/Move from recording to published lesson/i)).toBeNull();
      expect(screen.queryByText(/Learning profile ready/i)).toBeNull();
      expect(screen.queryByText(/Transcript is ready for review and editing/i)).toBeNull();
      expect(screen.queryByText(/You can still edit wording before moving on/i)).toBeNull();
      expect(screen.queryByText(/Preview before publishing/i)).toBeNull();
      expect(screen.queryByText(/Choose how you want to continue/i)).toBeNull();
      expect(screen.queryByText(/Pick a lane once/i)).toBeNull();
      expect(screen.queryByText(/Reopen an existing assignment/i)).toBeNull();
      expect(screen.queryByText(/Begin clean and move straight/i)).toBeNull();

      expect(screen.getByRole('heading', { name: /Advanced actions/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Refresh actions/i })).toBeTruthy();
      const quickReruns = screen.getByRole('region', { name: /Quick reruns/i });
      expect(quickReruns).toBeTruthy();
      expect(quickReruns.className).not.toContain('minimal-rerun-quick');
      expect(quickReruns.querySelector('.minimal-rerun-action-card')).toBeNull();
      expect(within(quickReruns).getAllByRole('button')).toHaveLength(4);
      expect(screen.queryByText(/Each action changes only what it says/i)).toBeNull();
      expect(screen.queryByText(/Replace study-text, main pronunciation/i)).toBeNull();

      await user.click(screen.getByRole('button', { name: /^Custom rerun$/i }));

      expect(screen.getByRole('region', { name: /Custom rerun/i })).toBeTruthy();
      await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
      await user.click(screen.getByRole('checkbox', { name: /Main pronunciation audio/i }));
      await user.click(screen.getByRole('checkbox', { name: /Pronunciation chunk audio/i }));
      expect(screen.queryByText(/Select individual audio families and overrides/i)).toBeNull();
      expect(screen.queryByText(/Rebuild the lesson narration/i)).toBeNull();
      expect(screen.queryByText(/Replace the primary pronunciation clip/i)).toBeNull();
      expect(screen.queryByText(/Refresh word and chunk clips/i)).toBeNull();
      expect(screen.queryByText(/eleven_v3.*dialogue-only/i)).toBeNull();
      expect(screen.getByText(/^Study-text settings$/i)).toBeTruthy();
      expect(screen.getByText(/^Main pronunciation settings$/i)).toBeTruthy();
      expect(screen.getByText(/^Pronunciation chunk settings$/i)).toBeTruthy();
      expect(screen.queryByText(/^Study-text provider$/i)).toBeNull();
      expect(screen.queryByText(/^Main pronunciation provider$/i)).toBeNull();
      expect(screen.queryByText(/^Pronunciation chunk provider$/i)).toBeNull();
      expect(screen.getAllByText(/^Provider$/i)).toHaveLength(3);
      expect(screen.getAllByText(/^Model$/i)).toHaveLength(3);
      expect(screen.getAllByText(/^Voice ID$/i)).toHaveLength(3);
      expect(screen.getAllByText(/^Accent$/i)).toHaveLength(3);
      expect(screen.getAllByText(/^Strategy$/i)).toHaveLength(1);

      const previewButton = screen.getByRole('button', { name: /Preview assignment/i });
      expect(previewButton.className).toContain('minimal-preview-attention');
      expect(screen.queryByText(/Preview required before sharing/i)).toBeNull();
      expect(screen.queryByRole('heading', { name: /Job controls/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Cancel job$/i })).toBeNull();
      expect(screen.queryByText(/Cancel is only available/i)).toBeNull();
      expect(screen.getByText(/^Support details$/i)).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /Resume recent work/i }));

      expect(screen.getAllByText(/^Recent assignments$/i)).toHaveLength(1);
      expect(screen.queryByRole('button', { name: /Start new instead/i })).toBeNull();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));

      expect(screen.queryByRole('button', { name: /Switch to resume/i })).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'presents learner context as structured text without nested cards',
    async () => {
      await renderPublishedAssignment(
        {
          draftText: '# Draft markdown',
          status: {
            studentId: 'student-alex',
          },
        },
        { user: createMinimalUser() },
      );

      const learnerContext = screen
        .getByRole('heading', { name: /Learner context/i })
        .closest('.minimal-stage-panel');
      expect(learnerContext).toBeTruthy();
      const learnerScope = within(learnerContext as HTMLElement);

      expect(learnerContext?.querySelector('.minimal-profile-card')).toBeNull();
      expect(learnerContext?.querySelector('.minimal-profile-meta-grid')).toBeNull();
      expect(learnerContext?.querySelector('.minimal-profile-scan-group')).toBeNull();
      expect(learnerScope.getAllByText(/^Student Learning page$/i).length).toBeGreaterThan(0);
      expect(learnerScope.getByText(/^Selected$/i)).toBeTruthy();
      expect(learnerScope.getByText(/^Goals$/i)).toBeTruthy();
      expect(learnerScope.getByText(/^Communication contexts$/i)).toBeTruthy();
      expect(learnerScope.getByText(/^Strengths$/i)).toBeTruthy();
      expect(learnerScope.getByText(/^Challenges$/i)).toBeTruthy();
      expect(learnerScope.getByText(/Lead project updates clearly/i)).toBeTruthy();
      expect(learnerScope.getByRole('link', { name: /Open Learning page/i })).toBeTruthy();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it('keeps advanced actions tucked away until a shared assignment exists', async () => {
    const user = createMinimalUser();
    renderMinimalAssignment();

    await waitFor(() => {
      expect(api.fetchPromptOptions).toHaveBeenCalledTimes(1);
      expect(api.fetchJobOptions).toHaveBeenCalledTimes(1);
      expect(api.fetchStudentOptions).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('combobox', { name: /^Student$/i })).toBeNull();
    expect(screen.queryByText(/Share the assignment once to unlock updates/i)).toBeNull();
    expect(screen.getAllByText(/Available after sharing\./i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
    await screen.findByRole('option', { name: 'Alex' });

    expect(screen.queryByText(/Share the assignment once to unlock updates/i)).toBeNull();
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
