import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it } from 'vitest';

import {
  testAct as act,
  testApi as api,
  createMinimalUser,
  createTimerAwareMinimalUser,
  testExpect as expect,
  INTEGRATION_TEST_TIMEOUT_MS,
  makeAssignmentSession,
  makeJobStatus,
  openAdvancedActions,
  previewCurrentDraft,
  renderDraftReadyAssignment,
  renderMinimalAssignment,
  renderPreviewReadyAssignment,
  renderPromptReadyAssignment,
  renderPublishedActionsAssignment,
  renderPublishedAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  startNewAssignmentForLearner,
  testVi as vi,
  testWaitFor as waitFor,
  testWithin as within,
} from './MinimalAssignment.test-harness';

function getCustomRerunSettingsGroup(name: RegExp): HTMLElement {
  const heading = screen.getByText(name);
  const group = heading.closest('.minimal-rerun-control-group');
  expect(group).toBeTruthy();
  return group as HTMLElement;
}

function openTechnicalRerunSettings(user: ReturnType<typeof createMinimalUser>) {
  return user.click(screen.getByRole('button', { name: /^Technical rerun settings$/i }));
}

export function registerPublishValidationTests() {
  describe('MinimalAssignment - publish validation', () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows upload errors when upload fails', async () => {
      const user = createMinimalUser();
      vi.mocked(api.uploadRecording).mockRejectedValueOnce(new Error('Upload failed at gateway'));

      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await screen.findByText('Upload failed at gateway');
    });

    it('prevents Create confirmation when automatic draft validation fails', async () => {
      const user = createMinimalUser();
      vi.mocked(api.validateMarkdown).mockResolvedValueOnce({
        ok: false,
        errors: ['Missing study text block'],
        warnings: [],
      });

      await renderDraftReadyAssignment();

      const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
      expect(draftTextarea).toBeTruthy();
      if (!draftTextarea) {
        throw new Error('Expected draft textarea to be rendered');
      }
      fireEvent.change(draftTextarea, { target: { value: '# Broken draft' } });

      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));

      await screen.findByText('Fix validation errors before saving.');
      expect(api.createDraft).not.toHaveBeenCalled();
    }, 30_000);

    it('publishes a valid draft and displays the resulting job link', async () => {
      const { user } = await renderPromptReadyAssignment();

      const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
      expect(draftTextarea).toBeTruthy();
      if (!draftTextarea) {
        throw new Error('Expected draft textarea to be rendered');
      }
      fireEvent.change(draftTextarea, { target: { value: '# Final draft' } });
      await previewCurrentDraft(user);
      await user.click(screen.getByRole('button', { name: /Share assignment/i }));

      await waitFor(() => {
        expect(api.updateDraft).toHaveBeenCalledWith('draft-1', '# Final draft', 1);
      });
      const validationCall = vi.mocked(api.validateMarkdown).mock.calls.at(-1);
      expect(validationCall?.[0]).toBe('# Final draft');
      expect(validationCall?.[1]).toBe(true);
      expect(validationCall?.[2]).toBeUndefined();
      await waitFor(() => {
        expect(api.shareAssignmentSession).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({
            expectedRevision: expect.any(Number),
            requestId: expect.any(String),
          }),
        );
      });

      await screen.findAllByText(/Job ID:/i);
      expect(screen.getAllByText(/Ready/i).length).toBeGreaterThan(0);
    }, 30_000);

    it('disables Share while its submission is in flight', async () => {
      const { user } = await renderPromptReadyAssignment();
      fireEvent.change(screen.getByRole('textbox', { name: /Draft markdown/i }), {
        target: { value: '# Final draft' },
      });
      await previewCurrentDraft(user);
      let resolveShare!: (value: Awaited<ReturnType<typeof api.shareAssignmentSession>>) => void;
      vi.mocked(api.shareAssignmentSession).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveShare = resolve;
          }),
      );

      const shareButton = screen.getByRole('button', { name: /Share assignment/i });
      await waitFor(() => expect((shareButton as HTMLButtonElement).disabled).toBe(false));
      await user.click(shareButton);
      const sharingButton = await screen.findByRole('button', { name: /Sharing/i });
      expect((sharingButton as HTMLButtonElement).disabled).toBe(true);
      await user.click(sharingButton);
      expect(api.shareAssignmentSession).toHaveBeenCalledTimes(1);

      const requestId = vi.mocked(api.shareAssignmentSession).mock.calls[0]![1].requestId;
      resolveShare({
        session: makeAssignmentSession({ confirmedStep: 'share', shareJobId: requestId }),
        job: makeJobStatus({ jobId: requestId, state: 'queued' }),
      });
      await screen.findByText(/Publishing assignment/i);
    }, 30_000);

    it('reconciles dirty profile recovery and returns to Teaching context after Share rejects it', async () => {
      const { user } = await renderPromptReadyAssignment();
      fireEvent.change(screen.getByRole('textbox', { name: /Draft markdown/i }), {
        target: { value: '# Final draft' },
      });
      await previewCurrentDraft(user);

      const dirtySession = makeAssignmentSession({
        studentId: 'student-alex',
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        promptPackageId: 'pkg-1',
        draftId: 'draft-1',
        confirmedStep: 'create',
        selectedProfileId: null,
        selectedProfileRevisionId: null,
        selectedProfileRevisionHash: null,
      });
      dirtySession.confirmed.context = {
        teacherNotes: null,
        profileId: 'profiles/alex.md',
        profileRevisionId: 'revision-active',
        profileRevisionHash: 'hash-active',
      };
      vi.mocked(api.shareAssignmentSession).mockRejectedValueOnce(
        new Error('HTTP 409: assignment_share_dirty_recovery'),
      );
      vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(dirtySession);

      const shareButton = screen.getByRole('button', { name: /Share assignment/i });
      await waitFor(() => expect((shareButton as HTMLButtonElement).disabled).toBe(false));
      await user.click(shareButton);

      expect(api.shareAssignmentSession).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByText(/Review and confirm Teaching context before sharing\./i),
      ).toBeTruthy();
      expect(await screen.findByRole('heading', { name: /Add teaching context/i })).toBeTruthy();
      expect(screen.queryByText(/HTTP 409: assignment_share_dirty_recovery/i)).toBeNull();
    }, 30_000);

    it('keeps Share disabled while confirmed Context recovery is dirty', async () => {
      const { user } = await renderPromptReadyAssignment();
      fireEvent.change(screen.getByRole('textbox', { name: /Draft markdown/i }), {
        target: { value: '# Final draft' },
      });
      await previewCurrentDraft(user);

      const dirtySession = makeAssignmentSession({
        id: 'session-1',
        studentId: 'student-alex',
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        promptPackageId: 'pkg-1',
        draftId: 'draft-1',
        confirmedStep: 'create',
        selectedProfileId: null,
        selectedProfileRevisionId: null,
        selectedProfileRevisionHash: null,
      });
      dirtySession.confirmed.context = {
        teacherNotes: null,
        profileId: 'profiles/alex.md',
        profileRevisionId: 'revision-active',
        profileRevisionHash: 'hash-active',
      };
      vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(dirtySession);

      await act(async () => {
        globalThis.dispatchEvent(new Event('focus'));
      });

      const shareButton = await screen.findByRole('button', { name: /Share assignment/i });
      await waitFor(() => expect((shareButton as HTMLButtonElement).disabled).toBe(true));
      await user.click(shareButton);
      expect(api.shareAssignmentSession).not.toHaveBeenCalled();
    }, 30_000);
  });
}

export function registerJobActionTests() {
  describe('MinimalAssignment - job actions', () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it(
      'requires preview before publish and enables share after preview',
      async () => {
        const user = createMinimalUser();
        await renderPreviewReadyAssignment();

        await user.click(screen.getByRole('button', { name: /Create/i }));
        const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
        fireEvent.change(draftTextarea, { target: { value: '# Preview gated draft' } });
        await user.click(screen.getByRole('button', { name: /Review & share/i }));
        expect(screen.getByRole('heading', { name: /Create assignment/i })).toBeTruthy();
        await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
        await screen.findByRole('heading', { name: /Review and share/i });
        const initialPublishButton = screen.getByRole('button', { name: /Share assignment/i });
        const initialPreviewButton = screen.getByRole('button', { name: /Preview assignment/i });
        expect((initialPublishButton as HTMLButtonElement).disabled).toBe(true);
        expect(initialPublishButton.className).toContain('minimal-secondary');
        expect(initialPreviewButton.className).toContain('minimal-primary');
        expect(initialPreviewButton.className).toContain('minimal-preview-attention');
        expect(initialPreviewButton.className).toContain('minimal-guided-button--secondary');
        expect(screen.queryByText('Preview required before sharing.')).toBeNull();
        expect(api.materializeDraft).not.toHaveBeenCalled();
        await previewCurrentDraft(user);
        const publishButton = screen.getByRole('button', { name: /Share assignment/i });
        expect((publishButton as HTMLButtonElement).disabled).toBe(false);
        expect(publishButton.className).toContain('minimal-primary');
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'queues the pronunciation rerun preset for the current job',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = createTimerAwareMinimalUser();
        await renderPublishedActionsAssignment({ status: { state: 'succeeded' } });
        openAdvancedActions();

        await user.click(screen.getByRole('button', { name: /Regenerate pronunciation audio/i }));

        await waitFor(() => {
          expect(api.rerunJob).toHaveBeenCalledWith(
            'job-1',
            expect.objectContaining({
              regeneratePronunciationMainAudio: true,
              pronunciationMainTtsProvider: 'elevenlabs',
              regeneratePronunciationChunkAudio: true,
              pronunciationChunkTtsProvider: 'google',
              pronunciationChunkTtsModel: 'chirp3_hd',
            }),
          );
        });
        expect(screen.getByText(/Rerun queued/i)).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it.each([
      {
        label: 'Republish published version',
        description: 'Refresh the HTML page without regenerating any audio.',
        payload: { republishOnly: true },
      },
      {
        label: 'Regenerate study-text audio',
        description: 'Replace only the study-text narration.',
        payload: { regenerateStudyTextAudio: true, studyTextTtsProvider: 'elevenlabs' },
      },
      {
        label: 'Regenerate pronunciation audio',
        description: 'Replace main pronunciation and pronunciation chunk clips.',
        payload: {
          regeneratePronunciationMainAudio: true,
          pronunciationMainTtsProvider: 'elevenlabs',
          regeneratePronunciationChunkAudio: true,
          pronunciationChunkTtsProvider: 'google',
          pronunciationChunkTtsModel: 'chirp3_hd',
        },
      },
      {
        label: 'Regenerate all audio',
        description: 'Replace study-text, main pronunciation, and pronunciation chunk audio.',
        payload: {
          regenerateStudyTextAudio: true,
          studyTextTtsProvider: 'elevenlabs',
          regeneratePronunciationMainAudio: true,
          pronunciationMainTtsProvider: 'elevenlabs',
          regeneratePronunciationChunkAudio: true,
          pronunciationChunkTtsProvider: 'google',
          pronunciationChunkTtsModel: 'chirp3_hd',
        },
      },
    ])('queues the $label quick rerun payload', async ({ label, payload }) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = createTimerAwareMinimalUser();
      await renderPublishedActionsAssignment({ status: { state: 'succeeded' } });
      openAdvancedActions();

      const quickReruns = screen.getByRole('region', { name: /Quick reruns/i });
      await user.click(within(quickReruns).getByRole('button', { name: label }));

      await waitFor(() => {
        expect(api.rerunJob).toHaveBeenCalledWith('job-1', expect.objectContaining(payload));
      });
    });

    it(
      'submits custom rerun payload values',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = createTimerAwareMinimalUser();
        await renderPublishedAssignment();
        openAdvancedActions();

        await openTechnicalRerunSettings(user);
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
        const studyTextSettings = getCustomRerunSettingsGroup(/^Study-text settings$/i);
        fireEvent.change(within(studyTextSettings).getByRole('textbox', { name: /^Voice ID$/i }), {
          target: { value: 'voice-new' },
        });
        fireEvent.change(within(studyTextSettings).getByRole('textbox', { name: /^Accent$/i }), {
          target: { value: 'british' },
        });
        fireEvent.change(within(studyTextSettings).getByRole('combobox', { name: /^Strategy$/i }), {
          target: { value: 'dialogue' },
        });
        expect(
          (
            within(studyTextSettings).getByRole('combobox', {
              name: /^Model$/i,
            }) as HTMLSelectElement
          ).value,
        ).toBe('eleven_v3');
        fireEvent.change(screen.getByPlaceholderText('e.g. es'), { target: { value: 'es' } });
        fireEvent.change(screen.getByPlaceholderText('0.42'), { target: { value: '0.42' } });
        fireEvent.change(screen.getByPlaceholderText('7'), { target: { value: '7' } });

        await user.click(screen.getByRole('button', { name: /Queue custom rerun/i }));

        await waitFor(() => {
          expect(api.rerunJob).toHaveBeenCalledWith(
            'job-1',
            expect.objectContaining({
              regenerateStudyTextAudio: true,
              studyTextVoiceId: 'voice-new',
              studyTextVoiceAccent: 'british',
              studyTextTtsStrategy: 'dialogue',
              studyTextTtsProvider: 'elevenlabs',
              studyTextTtsModel: 'eleven_v3',
              studyTextDialogueLanguage: 'es',
              studyTextDialogueStability: 0.42,
              studyTextDialogueSeed: 7,
            }),
          );
        });
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'defaults pronunciation chunk provider from the persisted job pronunciation mode when no draft is linked',
      async () => {
        const user = createMinimalUser();
        const _rendered = await renderPublishedAssignment({
          status: {
            draftId: null,
            pronunciationMode: 'connected_speech',
          },
        });
        openAdvancedActions();

        await openTechnicalRerunSettings(user);
        await user.click(screen.getByRole('checkbox', { name: /Pronunciation chunk audio/i }));
        const chunkSettings = getCustomRerunSettingsGroup(/^Pronunciation chunk settings$/i);

        expect(
          (
            within(chunkSettings).getByRole('combobox', {
              name: /^Provider$/i,
            }) as HTMLSelectElement
          ).value,
        ).toBe('google');
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'limits elevenlabs rerun model choices to valid paths',
      async () => {
        const user = createMinimalUser();
        await renderPublishedAssignment();
        openAdvancedActions();

        await openTechnicalRerunSettings(user);
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
        await user.click(screen.getByRole('checkbox', { name: /Main pronunciation audio/i }));
        await user.click(screen.getByRole('checkbox', { name: /Pronunciation chunk audio/i }));
        const studySettings = getCustomRerunSettingsGroup(/^Study-text settings$/i);
        const mainSettings = getCustomRerunSettingsGroup(/^Main pronunciation settings$/i);
        const chunkSettings = getCustomRerunSettingsGroup(/^Pronunciation chunk settings$/i);
        fireEvent.change(within(chunkSettings).getByRole('combobox', { name: /^Provider$/i }), {
          target: { value: 'elevenlabs' },
        });

        const studyModel = within(studySettings).getByRole('combobox', { name: /^Model$/i });
        const mainModel = within(mainSettings).getByRole('combobox', { name: /^Model$/i });
        const chunkModel = within(chunkSettings).getByRole('combobox', { name: /^Model$/i });

        expect(within(studyModel).queryByRole('option', { name: 'eleven_v3' })).toBeNull();
        expect(within(mainModel).queryByRole('option', { name: 'eleven_v3' })).toBeNull();
        expect(within(chunkModel).queryByRole('option', { name: 'eleven_v3' })).toBeNull();

        fireEvent.change(within(studySettings).getByRole('combobox', { name: /^Strategy$/i }), {
          target: { value: 'dialogue' },
        });
        expect(within(studyModel).getByRole('option', { name: 'eleven_v3' })).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'resets custom rerun settings when resuming a different assignment',
      async () => {
        const user = createMinimalUser();
        const jobA = makeJobStatus({
          jobId: 'job-a',
          studentId: 'student-alex',
          state: 'succeeded',
          htmlUrl: 'https://example.com/job-a.html',
          ttsProvider: 'elevenlabs',
          ttsModel: 'eleven_flash_v2_5',
        });
        const jobB = makeJobStatus({
          jobId: 'job-b',
          studentId: 'student-bella',
          state: 'succeeded',
          htmlUrl: 'https://example.com/job-b.html',
          ttsProvider: 'google',
          ttsModel: 'studio',
        });

        const rendered = await renderPublishedAssignment({
          status: jobA,
          jobs: [jobA, jobB],
        });
        openAdvancedActions();

        await openTechnicalRerunSettings(user);
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
        let studySettings = getCustomRerunSettingsGroup(/^Study-text settings$/i);
        fireEvent.change(within(studySettings).getByRole('textbox', { name: /^Voice ID$/i }), {
          target: { value: 'voice-from-a' },
        });
        fireEvent.change(within(studySettings).getByRole('combobox', { name: /^Provider$/i }), {
          target: { value: 'elevenlabs' },
        });

        vi.mocked(api.getJobStatus).mockResolvedValueOnce(jobB);
        vi.mocked(api.fetchJobProvenance).mockResolvedValueOnce({
          job: { sourceJobId: 'job-a' },
          promptPackage: { id: 'pkg-1' },
          draft: { id: 'draft-1' },
          tts: null,
          pronunciationWarnings: [],
          lineage: {},
          actions: [],
        } as never);

        rendered.unmount();
        globalThis.history.replaceState(null, '', '/?jobId=job-b');
        renderMinimalAssignment();

        await waitFor(() => {
          expect(screen.getAllByText(/Job ID: job-b/i).length).toBeGreaterThan(0);
        });

        openAdvancedActions();
        await openTechnicalRerunSettings(user);
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
        studySettings = getCustomRerunSettingsGroup(/^Study-text settings$/i);

        expect(
          (
            within(studySettings).getByRole('combobox', {
              name: /^Provider$/i,
            }) as HTMLSelectElement
          ).value,
        ).toBe('google');
        expect(
          (within(studySettings).getByRole('combobox', { name: /^Model$/i }) as HTMLSelectElement)
            .value,
        ).toBe('studio');
        expect(
          (within(studySettings).getByRole('textbox', { name: /^Voice ID$/i }) as HTMLInputElement)
            .value,
        ).toBe('');

        await user.click(screen.getByRole('button', { name: /Queue custom rerun/i }));

        await waitFor(() => {
          expect(api.rerunJob).toHaveBeenLastCalledWith(
            'job-b',
            expect.objectContaining({
              regenerateStudyTextAudio: true,
              studyTextTtsProvider: 'google',
              studyTextTtsModel: 'studio',
            }),
          );
        });
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'queues a republish-only rerun action for the current job',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = createTimerAwareMinimalUser();
        await renderPublishedAssignment();
        openAdvancedActions();

        await user.click(screen.getByRole('button', { name: /Republish published version/i }));

        await waitFor(() => {
          expect(api.rerunJob).toHaveBeenCalledWith('job-1', { republishOnly: true });
        });
        expect(screen.getByText('Rerun queued')).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'keeps advanced actions open when a queued rerun switches to a new job id',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = createTimerAwareMinimalUser();
        vi.mocked(api.rerunJob).mockResolvedValueOnce({
          success: true,
          message: 'Republish queued for follow-up job',
          jobId: 'job-2',
          actionType: 'rerun',
        });

        await renderPublishedAssignment();
        openAdvancedActions();
        vi.mocked(api.getJobStatus).mockResolvedValueOnce(
          makeJobStatus({
            jobId: 'job-2',
            state: 'queued',
          }) as never,
        );

        await user.click(screen.getByRole('button', { name: /Republish published version/i }));

        await waitFor(() => {
          expect(api.rerunJob).toHaveBeenCalledWith('job-1', { republishOnly: true });
          expect(screen.getByText('Republish queued for follow-up job')).toBeTruthy();
          expect(screen.queryByRole('button', { name: /Hide advanced actions/i })).toBeNull();
          expect(screen.queryByRole('button', { name: /Refresh actions/i })).toBeNull();
          expect(screen.getAllByText(/Job ID: job-2/i).length).toBeGreaterThan(0);
        });
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'offers cancellation without reopening Share while a historical job is running',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = createTimerAwareMinimalUser();
        let resolveCancel!: (value: Awaited<ReturnType<typeof api.cancelJob>>) => void;
        vi.mocked(api.cancelJob).mockReturnValueOnce(
          new Promise((resolve) => {
            resolveCancel = resolve;
          }),
        );
        const publishedAssignment = await renderPublishedAssignment({
          status: {
            state: 'running',
            publishTarget: 'html',
            htmlUrl: null,
          },
        });
        const runningStatus = publishedAssignment.status;
        vi.mocked(api.getJobStatus)
          .mockResolvedValueOnce({
            ...runningStatus,
            state: 'running',
          } as never)
          .mockResolvedValueOnce({
            ...runningStatus,
            state: 'failed',
            error: 'cancelled: duplicate run',
          } as never);

        const reviewHeading = screen.getByRole('heading', { name: /Review and share/i });
        const reviewSection = reviewHeading.closest('section');
        if (!reviewSection) {
          throw new Error('Expected review section to be rendered');
        }
        expect(
          within(reviewSection).queryByRole('button', { name: /Share assignment/i }),
        ).toBeNull();
        expect(screen.queryByPlaceholderText('reason for cancellation')).toBeNull();

        const cancelButton = within(reviewSection).getByRole('button', { name: /^Cancel$/i });
        expect(cancelButton.className).toContain('product-button');
        expect(cancelButton.className).toContain('product-button--secondary');
        expect(cancelButton.className).not.toContain('minimal-secondary');

        await user.click(cancelButton);

        const busyCancelButton = within(reviewSection).getByRole('button', {
          name: /^Cancelling\.\.\.$/i,
        });
        expect(busyCancelButton.getAttribute('aria-busy')).toBe('true');
        expect((busyCancelButton as HTMLButtonElement).disabled).toBe(true);

        resolveCancel({
          success: true,
          message: 'Job cancelled',
          actionType: 'cancel',
          jobId: 'job-1',
        });

        await waitFor(() => {
          expect(api.cancelJob).toHaveBeenCalledWith('job-1');
        });
        expect(screen.getByText(/Job cancelled/i)).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'hides cancel for terminal jobs in review without duplicating it in advanced actions',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await renderPublishedAssignment({ status: { state: 'succeeded' } });
        openAdvancedActions();

        const reviewHeading = screen.getByRole('heading', { name: /Review and share/i });
        const reviewSection = reviewHeading.closest('section');
        if (!reviewSection) {
          throw new Error('Expected review section to be rendered');
        }
        expect(within(reviewSection).queryByRole('button', { name: /^Cancel$/i })).toBeNull();

        const actionsHeading = screen.getByRole('heading', { name: /Republish and recovery/i });
        const actionsSection = actionsHeading.closest('section');
        if (!actionsSection) {
          throw new Error('Expected job actions section to be rendered');
        }
        expect(within(actionsSection).queryByRole('heading', { name: /Job controls/i })).toBeNull();
        expect(within(actionsSection).queryByRole('button', { name: /Cancel job/i })).toBeNull();
        expect(
          screen.queryByText(/Cancel is only available for queued or running jobs\./i),
        ).toBeNull();
        const support = screen.getByText(/^Support details$/i).closest('details')!;
        expect(actionsSection.contains(support)).toBe(false);
        expect(within(support).queryByRole('region', { name: /Quick reruns/i })).toBeNull();
        expect(
          within(support).queryByRole('button', { name: /^Technical rerun settings$/i }),
        ).toBeNull();
        expect(within(actionsSection).getByRole('region', { name: /Quick reruns/i })).toBeTruthy();
        expect(
          within(actionsSection).getByRole('button', { name: /^Technical rerun settings$/i }),
        ).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );
  });
}
