import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it } from 'vitest';

import {
  testApi as api,
  createMinimalUser,
  createTimerAwareMinimalUser,
  testExpect as expect,
  INTEGRATION_TEST_TIMEOUT_MS,
  makeJobStatus,
  openAdvancedActions,
  openPublishingSettings,
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

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
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

      await user.click(screen.getByRole('button', { name: /Save assignment content/i }));

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
      openPublishingSettings();
      fireEvent.change(screen.getByRole('combobox', { name: /Learning preset/i }), {
        target: { value: 'b2-default' },
      });
      await previewCurrentDraft(user);
      await user.click(screen.getByRole('button', { name: /Share assignment/i }));

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
            ttsStrategy: 'auto',
          },
        }),
      );
      expect(api.approveJob).toHaveBeenCalledWith('job-1', {
        md: '/tmp/assignment.md',
        mdStorageUri: 's3://esl/drafts/draft-1.md',
      });

      await screen.findAllByText(/Job ID: job-1/i);
      expect(screen.getAllByText(/Ready/i).length).toBeGreaterThan(0);
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

        const publishButton = screen.getByRole('button', { name: /Share assignment/i });
        expect((publishButton as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('Preview required before sharing.')).toBeTruthy();
        expect(api.materializeDraft).not.toHaveBeenCalled();

        await previewCurrentDraft(user);
        expect((publishButton as HTMLButtonElement).disabled).toBe(false);

        fireEvent.change(draftTextarea, {
          target: { value: '# Preview gated draft\nOne more line' },
        });
        await waitFor(() => {
          expect((publishButton as HTMLButtonElement).disabled).toBe(true);
        });
        expect(screen.getByText('Preview required before sharing.')).toBeTruthy();
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
        openAdvancedActions();

        await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
        fireEvent.change(screen.getByRole('textbox', { name: /Study-text voice ID/i }), {
          target: { value: 'voice-new' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: /Study-text accent/i }), {
          target: { value: 'british' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: /Study-text strategy/i }), {
          target: { value: 'dialogue' },
        });
        expect(
          (screen.getByRole('combobox', { name: /Study-text model/i }) as HTMLSelectElement).value,
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
              studyTextElevenlabsModel: 'eleven_v3',
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
      'defaults pronunciation chunk provider from the saved rerun target draft, not the edited textarea',
      async () => {
        const connectedSpeechDraft = `# Draft markdown

**Mode:** connected_speech
1. "as heavy as" -> as-heavy-as
**Natural sentence practice:** The device is as heavy as the old one.`;
        const user = createMinimalUser();
        await renderPublishedAssignment({ draftText: connectedSpeechDraft });
        openAdvancedActions();
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
        openAdvancedActions();

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
        openAdvancedActions();

        await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
        await user.click(screen.getByRole('checkbox', { name: /Main pronunciation audio/i }));
        await user.click(screen.getByRole('checkbox', { name: /Pronunciation chunk audio/i }));
        fireEvent.change(screen.getByRole('combobox', { name: /Pronunciation chunk provider/i }), {
          target: { value: 'elevenlabs' },
        });

        const studyModel = screen.getByRole('combobox', { name: /Study-text model/i });
        const mainModel = screen.getByRole('combobox', { name: /Main pronunciation model/i });
        const chunkModel = screen.getByRole('combobox', { name: /Pronunciation chunk model/i });

        expect(within(studyModel).queryByRole('option', { name: 'eleven_v3' })).toBeNull();
        expect(within(mainModel).queryByRole('option', { name: 'eleven_v3' })).toBeNull();
        expect(within(chunkModel).queryByRole('option', { name: 'eleven_v3' })).toBeNull();

        fireEvent.change(screen.getByRole('combobox', { name: /Study-text strategy/i }), {
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
          state: 'succeeded',
          ttsProvider: 'elevenlabs',
          studyTextElevenlabsModel: 'eleven_flash_v2_5',
        });
        const jobB = makeJobStatus({
          jobId: 'job-b',
          state: 'succeeded',
          ttsProvider: 'google',
          googleTtsModel: 'studio',
        });

        await renderPublishedAssignment({
          status: jobA,
          jobs: [jobA, jobB],
        });
        openAdvancedActions();

        await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
        fireEvent.change(screen.getByRole('textbox', { name: /Study-text voice ID/i }), {
          target: { value: 'voice-from-a' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: /Study-text provider/i }), {
          target: { value: 'elevenlabs' },
        });

        vi.mocked(api.getJobStatus).mockResolvedValueOnce(jobB);
        vi.mocked(api.fetchJobProvenance).mockResolvedValueOnce({
          job: { sourceJobId: 'job-a' },
          promptPackage: { id: 'pkg-1' },
          draft: { id: 'draft-1' },
          tts: null,
          lineage: {},
          actions: [],
        } as never);

        await user.click(screen.getByRole('button', { name: /Switch to resume/i }));
        const resumeList = await screen.findByRole('listbox', { name: /Recent assignments/i });
        fireEvent.click(within(resumeList).getByRole('option', { name: /ID job-b/i }));
        await user.click(screen.getByRole('button', { name: /Resume selected assignment/i }));

        await waitFor(() => {
          expect(screen.getAllByText(/Job ID: job-b/i).length).toBeGreaterThan(0);
        });

        openAdvancedActions();
        await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
        await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));

        expect(
          (screen.getByRole('combobox', { name: /Study-text provider/i }) as HTMLSelectElement)
            .value,
        ).toBe('google');
        expect(
          (screen.getByRole('combobox', { name: /Study-text model/i }) as HTMLSelectElement).value,
        ).toBe('studio');
        expect(
          (screen.getByRole('textbox', { name: /Study-text voice ID/i }) as HTMLInputElement).value,
        ).toBe('');

        await user.click(screen.getByRole('button', { name: /Queue custom rerun/i }));

        await waitFor(() => {
          expect(api.rerunJob).toHaveBeenLastCalledWith(
            'job-b',
            expect.objectContaining({
              regenerateStudyTextAudio: true,
              studyTextTtsProvider: 'google',
              studyTextGoogleTtsModel: 'studio',
            }),
          );
        });
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'disables publish model selection in auto mode and filters elevenlabs models by strategy',
      async () => {
        await renderPublishedAssignment();

        openPublishingSettings();
        const strategySelect = screen.getByRole('combobox', { name: /Reading style/i });
        const modelSelect = screen.getByRole('combobox', { name: /Voice model/i });

        expect((strategySelect as HTMLSelectElement).value).toBe('auto');
        expect((modelSelect as HTMLSelectElement).disabled).toBe(true);
        expect(
          screen.getByText(
            /Auto follows the assignment at runtime\. Choose Dialogue or TTS to lock a model\./i,
          ),
        ).toBeTruthy();

        fireEvent.change(strategySelect, { target: { value: 'dialogue' } });
        await waitFor(() => {
          expect((modelSelect as HTMLSelectElement).value).toBe('eleven_v3');
        });
        expect(
          within(modelSelect)
            .getAllByRole('option')
            .map((option) => option.textContent),
        ).toEqual(['eleven_v3']);

        fireEvent.change(strategySelect, { target: { value: 'tts' } });
        await waitFor(() => {
          expect((modelSelect as HTMLSelectElement).disabled).toBe(false);
        });
        expect(within(modelSelect).queryByRole('option', { name: 'eleven_v3' })).toBeNull();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'falls back to eleven_multilingual_v2 for tts strategy when only eleven_v3 is configured',
      async () => {
        vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
          presets: ['b1-default', 'b2-default'],
          cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
          cefrDefault: 'B1',
          generation: {
            providers: ['openai'],
            defaultProvider: 'openai',
            modelOptions: [
              {
                provider: 'openai',
                id: 'gpt-5.2',
                tier: 'primary',
                fallbackRank: 0,
                defaultSelected: true,
                enabled: true,
              },
            ],
            defaultModelByProvider: {
              openai: 'gpt-5.2',
            },
            quota: {
              source: 'hybrid',
              lastUpdatedAt: '2026-02-18T00:00:00.000Z',
              requestsPerMinute: 5,
              tokensPerMinute: 250000,
              requestsPerDay: 20,
            },
          },
          voiceAccents: ['american'],
          voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
          notionDatabases: [{ id: 'db-1', name: 'DB One' }],
          sttProviders: ['deepgram', 'elevenlabs', 'google'],
          defaultSttProvider: 'deepgram',
          sttModelOptionsByProvider: {
            deepgram: ['nova-3'],
            elevenlabs: ['scribe_v2'],
            google: ['latest_long'],
          },
          defaultSttModelByProvider: {
            deepgram: 'nova-3',
            elevenlabs: 'scribe_v2',
            google: 'latest_long',
          },
          ttsStrategies: ['auto', 'dialogue', 'tts'],
          ttsProviders: ['elevenlabs', 'google'],
          ttsModelOptionsByProvider: {
            elevenlabs: ['eleven_v3'],
            google: ['chirp3_hd'],
          },
          defaultTtsProvider: 'elevenlabs',
          defaultTtsModelByProvider: {
            elevenlabs: 'eleven_v3',
            google: 'chirp3_hd',
          },
          supportedActions: [
            {
              type: 'rerun',
              label: 'Rerun',
              description: 'Republish current draft or selectively regenerate audio families',
              implemented: true,
            },
            {
              type: 'cancel',
              label: 'Cancel',
              description: 'Cancel active job',
              implemented: true,
            },
          ],
        });

        await renderPublishedAssignment();

        openPublishingSettings();
        const strategySelect = screen.getByRole('combobox', { name: /Reading style/i });
        const modelSelect = screen.getByRole('combobox', { name: /Voice model/i });

        fireEvent.change(strategySelect, { target: { value: 'tts' } });

        await waitFor(() => {
          expect((modelSelect as HTMLSelectElement).value).toBe('eleven_multilingual_v2');
        });
        expect(
          within(modelSelect)
            .getAllByRole('option')
            .map((option) => option.textContent),
        ).toEqual(['eleven_multilingual_v2']);
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'prefers eleven_multilingual_v2 for tts strategy when no elevenlabs default is configured',
      async () => {
        vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
          presets: ['b1-default', 'b2-default'],
          cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
          cefrDefault: 'B1',
          generation: {
            providers: ['openai'],
            defaultProvider: 'openai',
            modelOptions: [
              {
                provider: 'openai',
                id: 'gpt-5.2',
                tier: 'primary',
                fallbackRank: 0,
                defaultSelected: true,
                enabled: true,
              },
            ],
            defaultModelByProvider: {
              openai: 'gpt-5.2',
            },
            quota: {
              source: 'hybrid',
              lastUpdatedAt: '2026-02-18T00:00:00.000Z',
              requestsPerMinute: 5,
              tokensPerMinute: 250000,
              requestsPerDay: 20,
            },
          },
          voiceAccents: ['american'],
          voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
          notionDatabases: [{ id: 'db-1', name: 'DB One' }],
          sttProviders: ['deepgram', 'elevenlabs', 'google'],
          defaultSttProvider: 'deepgram',
          sttModelOptionsByProvider: {
            deepgram: ['nova-3'],
            elevenlabs: ['scribe_v2'],
            google: ['latest_long'],
          },
          defaultSttModelByProvider: {
            deepgram: 'nova-3',
            elevenlabs: 'scribe_v2',
            google: 'latest_long',
          },
          ttsStrategies: ['auto', 'dialogue', 'tts'],
          ttsProviders: ['elevenlabs', 'google'],
          ttsModelOptionsByProvider: {
            elevenlabs: ['eleven_flash_v2_5', 'eleven_multilingual_v2'],
            google: ['chirp3_hd'],
          },
          defaultTtsProvider: 'elevenlabs',
          defaultTtsModelByProvider: {
            google: 'chirp3_hd',
          },
          supportedActions: [
            {
              type: 'rerun',
              label: 'Rerun',
              description: 'Republish current draft or selectively regenerate audio families',
              implemented: true,
            },
            {
              type: 'cancel',
              label: 'Cancel',
              description: 'Cancel active job',
              implemented: true,
            },
          ],
        });

        await renderPublishedAssignment();

        openPublishingSettings();
        const strategySelect = screen.getByRole('combobox', { name: /Reading style/i });
        const modelSelect = screen.getByRole('combobox', { name: /Voice model/i });

        fireEvent.change(strategySelect, { target: { value: 'tts' } });

        await waitFor(() => {
          expect((modelSelect as HTMLSelectElement).value).toBe('eleven_multilingual_v2');
        });
        expect(
          within(modelSelect)
            .getAllByRole('option')
            .map((option) => option.textContent),
        ).toEqual(['eleven_flash_v2_5', 'eleven_multilingual_v2']);
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'publishes explicit dialogue strategy with eleven_v3 and google strategy with google model',
      async () => {
        const { user } = await renderPreviewReadyAssignment();

        openPublishingSettings();
        fireEvent.change(screen.getByRole('combobox', { name: /Reading style/i }), {
          target: { value: 'dialogue' },
        });
        await waitFor(() => {
          expect(
            (screen.getByRole('combobox', { name: /Voice model/i }) as HTMLSelectElement).value,
          ).toBe('eleven_v3');
        });
        await user.click(screen.getByRole('button', { name: /Share assignment/i }));

        await waitFor(() => {
          expect(api.materializeDraft).toHaveBeenCalled();
        });
        expect(vi.mocked(api.materializeDraft).mock.calls.at(-1)?.[1]?.jobOverrides).toEqual(
          expect.objectContaining({
            publishTarget: 'html',
            withTts: true,
            ttsProvider: 'elevenlabs',
            ttsStrategy: 'dialogue',
            studyTextElevenlabsModel: 'eleven_v3',
          }),
        );

        vi.mocked(api.materializeDraft).mockClear();
        fireEvent.change(screen.getByRole('combobox', { name: /Voice engine/i }), {
          target: { value: 'google' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: /Voice model/i }), {
          target: { value: 'studio' },
        });
        await user.click(screen.getByRole('button', { name: /Share assignment/i }));

        await waitFor(() => {
          expect(api.materializeDraft).toHaveBeenCalled();
        });
        expect(vi.mocked(api.materializeDraft).mock.calls.at(-1)?.[1]?.jobOverrides).toEqual(
          expect.objectContaining({
            publishTarget: 'html',
            withTts: true,
            ttsProvider: 'google',
            ttsStrategy: 'dialogue',
            googleTtsModel: 'studio',
          }),
        );
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'limits publish study-text strategies to the advertised job options',
      async () => {
        const defaultOptions = await api.fetchJobOptions();
        vi.mocked(api.fetchJobOptions).mockReset();
        vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
          ...defaultOptions,
          ttsStrategies: ['auto'],
        });

        await renderPreviewReadyAssignment();

        openPublishingSettings();
        const strategySelect = screen.getByRole('combobox', { name: /Reading style/i });
        expect(
          within(strategySelect)
            .getAllByRole('option')
            .map((option) => option.textContent),
        ).toEqual(['Auto from draft']);
        expect((strategySelect as HTMLSelectElement).value).toBe('auto');
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

        await user.click(screen.getByRole('button', { name: /Republish current draft/i }));

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

        await user.click(screen.getByRole('button', { name: /Republish current draft/i }));

        await waitFor(() => {
          expect(api.rerunJob).toHaveBeenCalledWith('job-1', { republishOnly: true });
          expect(screen.getByText('Republish queued for follow-up job')).toBeTruthy();
          expect(screen.getByRole('button', { name: /Hide advanced actions/i })).toBeTruthy();
          expect(screen.getByRole('button', { name: /Refresh actions/i })).toBeTruthy();
          expect(screen.getAllByText(/Job ID: job-2/i).length).toBeGreaterThan(0);
        });
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

        openAdvancedActions();
        const reasonInput = screen.getByPlaceholderText('reason for cancellation');
        fireEvent.change(reasonInput, { target: { value: 'duplicate run' } });
        const actionsHeading = screen.getByRole('heading', { name: /Advanced actions/i });
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
        openAdvancedActions();

        const actionsHeading = screen.getByRole('heading', { name: /Advanced actions/i });
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
