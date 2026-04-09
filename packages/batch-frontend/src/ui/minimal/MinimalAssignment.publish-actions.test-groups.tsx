import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it } from 'vitest';

import {
  testApi as api,
  createMinimalUser,
  createTimerAwareMinimalUser,
  testExpect as expect,
  INTEGRATION_TEST_TIMEOUT_MS,
  previewCurrentDraft,
  renderDraftReadyAssignment,
  renderMinimalAssignment,
  renderPreviewReadyAssignment,
  renderPromptReadyAssignment,
  renderPublishedActionsAssignment,
  renderPublishedAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testVi as vi,
  testWaitFor as waitFor,
  testWithin as within,
} from './MinimalAssignment.test-harness';

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

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await screen.findByText('Upload failed at gateway');
    });

    it('prevents draft save when markdown validation fails', async () => {
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

      await user.click(screen.getByRole('button', { name: /Save draft/i }));

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
      await user.selectOptions(screen.getByRole('combobox', { name: /Preset/i }), 'b2-default');
      await previewCurrentDraft(user);
      await user.click(screen.getByRole('button', { name: /Publish assignment/i }));

      await waitFor(() => {
        expect(api.createDraft).toHaveBeenCalledWith('pkg-1', '# Final draft');
      });
      const validationCall = vi.mocked(api.validateMarkdown).mock.calls.at(-1);
      expect(validationCall?.[0]).toBe('# Final draft');
      expect(validationCall?.[1]).toBe(true);
      expect(validationCall?.[2]).toBeUndefined();
      expect(api.materializeDraft).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({
          jobOverrides: {
            publishTarget: 'html',
            withTts: true,
            ttsProvider: 'elevenlabs',
          },
        }),
      );
      expect(api.approveJob).toHaveBeenCalledWith('job-1', {
        md: '/tmp/assignment.md',
        mdStorageUri: 's3://esl/drafts/draft-1.md',
      });

      await screen.findAllByText(/Job ID: job-1/i);
      expect(screen.getByText(/Status: succeeded/i)).toBeTruthy();
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
      'requires preview before publish and requires re-preview after draft edits',
      async () => {
        const user = createMinimalUser();
        await renderPreviewReadyAssignment();

        const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
        fireEvent.change(draftTextarea, { target: { value: '# Preview gated draft' } });

        const publishButton = screen.getByRole('button', { name: /Publish assignment/i });
        expect((publishButton as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('Preview required before publish.')).toBeTruthy();
        expect(api.materializeDraft).not.toHaveBeenCalled();

        await previewCurrentDraft(user);
        expect((publishButton as HTMLButtonElement).disabled).toBe(false);

        fireEvent.change(draftTextarea, {
          target: { value: '# Preview gated draft\nOne more line' },
        });
        await waitFor(() => {
          expect((publishButton as HTMLButtonElement).disabled).toBe(true);
        });
        expect(screen.getByText('Preview required before publish.')).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'queues the pronunciation rerun preset for the current job',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = createTimerAwareMinimalUser();
        await renderPublishedActionsAssignment({ status: { state: 'succeeded' } });

        await user.click(screen.getByRole('button', { name: /Regenerate pronunciation audio/i }));

        await waitFor(() => {
          expect(api.rerunJob).toHaveBeenCalledWith('job-1', {
            regeneratePronunciationMainAudio: true,
            regeneratePronunciationChunkAudio: true,
          });
        });
        expect(screen.getByText(/Rerun queued/i)).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'submits custom rerun payload values',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = createTimerAwareMinimalUser();
        await renderPublishedAssignment();

        await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
        fireEvent.change(screen.getByRole('textbox', { name: /Study-text voice ID/i }), {
          target: { value: 'voice-new' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: /Study-text accent/i }), {
          target: { value: 'british' },
        });
        await user.selectOptions(
          screen.getByRole('combobox', { name: /Study-text strategy/i }),
          'dialogue',
        );
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
              studyTextDialogueLanguage: 'es',
              studyTextDialogueStability: 0.42,
              studyTextDialogueSeed: 7,
            }),
          );
        });
        expect(vi.mocked(api.rerunJob).mock.calls.at(-1)?.[1]).not.toHaveProperty(
          'studyTextElevenlabsModel',
        );
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'defaults pronunciation chunk provider from the saved rerun target draft, not the edited textarea',
      async () => {
        const connectedSpeechDraft = `# Draft markdown

**Mode:** connected_speech
1. "as heavy as" -> as-heavy-as
**Natural sentence practice:** The device is as heavy as the old one.`;
        const user = createMinimalUser();
        await renderPublishedAssignment({ draftText: connectedSpeechDraft });
        await waitFor(() => {
          expect(api.fetchDraft).toHaveBeenCalledWith('draft-1');
        });
        expect(
          (screen.getByRole('textbox', { name: /Draft markdown/i }) as HTMLTextAreaElement).value,
        ).toBe(connectedSpeechDraft);

        fireEvent.change(screen.getByRole('textbox', { name: /Draft markdown/i }), {
          target: {
            value: `# Draft markdown

**Mode:** minimal_pair
1. ship / sheep`,
          },
        });

        await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
        await user.click(screen.getByRole('checkbox', { name: /Pronunciation chunk audio/i }));

        expect(
          (
            screen.getByRole('combobox', {
              name: /Pronunciation chunk provider/i,
            }) as HTMLSelectElement
          ).value,
        ).toBe('elevenlabs');
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'defaults pronunciation chunk provider from the persisted job pronunciation mode when no draft is linked',
      async () => {
        const user = createMinimalUser();
        await renderPublishedAssignment({
          status: {
            draftId: null,
            pronunciationMode: 'connected_speech',
          },
        });

        await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
        await user.click(screen.getByRole('checkbox', { name: /Pronunciation chunk audio/i }));

        expect(
          (
            screen.getByRole('combobox', {
              name: /Pronunciation chunk provider/i,
            }) as HTMLSelectElement
          ).value,
        ).toBe('elevenlabs');
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'limits elevenlabs rerun model choices to valid paths',
      async () => {
        const user = createMinimalUser();
        await renderPublishedAssignment();

        await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
        await user.click(screen.getByRole('checkbox', { name: /Main pronunciation audio/i }));
        await user.click(screen.getByRole('checkbox', { name: /Pronunciation chunk audio/i }));
        await user.selectOptions(
          screen.getByRole('combobox', { name: /Pronunciation chunk provider/i }),
          'elevenlabs',
        );

        const studyModel = screen.getByRole('combobox', { name: /Study-text model/i });
        const mainModel = screen.getByRole('combobox', { name: /Main pronunciation model/i });
        const chunkModel = screen.getByRole('combobox', { name: /Pronunciation chunk model/i });

        expect(within(studyModel).queryByRole('option', { name: 'eleven_v3' })).toBeNull();
        expect(within(mainModel).queryByRole('option', { name: 'eleven_v3' })).toBeNull();
        expect(within(chunkModel).queryByRole('option', { name: 'eleven_v3' })).toBeNull();

        await user.selectOptions(
          screen.getByRole('combobox', { name: /Study-text strategy/i }),
          'dialogue',
        );
        expect(within(studyModel).getByRole('option', { name: 'eleven_v3' })).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'queues a republish-only rerun action for the current job',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = createTimerAwareMinimalUser();
        await renderPublishedAssignment();

        await user.click(screen.getByRole('button', { name: /Republish current draft/i }));

        await waitFor(() => {
          expect(api.rerunJob).toHaveBeenCalledWith('job-1', { republishOnly: true });
        });
        expect(screen.getByText('Rerun queued')).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'submits cancel action with an optional reason when job is running',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = createTimerAwareMinimalUser();
        const publishedAssignment = await renderPublishedAssignment({
          status: {
            state: 'running',
            publishTarget: 'notion',
            notionUrl: null,
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

        const reasonInput = screen.getByPlaceholderText('reason for cancellation');
        fireEvent.change(reasonInput, { target: { value: 'duplicate run' } });
        const actionsHeading = screen.getByRole('heading', { name: /8\. Job actions/i });
        const actionsSection = actionsHeading.closest('section');
        if (!actionsSection) {
          throw new Error('Expected job actions section to be rendered');
        }
        await user.click(within(actionsSection).getByRole('button', { name: /Cancel job/i }));

        await waitFor(() => {
          expect(api.cancelJob).toHaveBeenCalledWith('job-1', { reason: 'duplicate run' });
        });
        expect(screen.getByText(/Job cancelled/i)).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'keeps cancel disabled for terminal jobs',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await renderPublishedAssignment({ status: { state: 'succeeded' } });

        const actionsHeading = screen.getByRole('heading', { name: /8\. Job actions/i });
        const actionsSection = actionsHeading.closest('section');
        if (!actionsSection) {
          throw new Error('Expected job actions section to be rendered');
        }
        const cancelButton = within(actionsSection).getByRole('button', { name: /Cancel job/i });
        expect(cancelButton.getAttribute('disabled')).not.toBeNull();
        expect(
          screen.getByText(/Cancel is only available for queued or running jobs\./i),
        ).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );
  });
}
