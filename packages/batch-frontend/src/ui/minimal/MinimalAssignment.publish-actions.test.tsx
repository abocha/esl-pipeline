import { afterEach, beforeEach, describe, it } from 'vitest';
import { fireEvent } from '@testing-library/react';

import {
  INTEGRATION_TEST_TIMEOUT_MS,
  testMinimalAssignment as MinimalAssignment,
  testApi as api,
  testExpect as expect,
  hydrateResumedAssignment,
  makeLearningPreset,
  preparePromptReady,
  previewCurrentDraft,
  testRender as render,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testUserEvent as userEvent,
  testVi as vi,
  testWaitFor as waitFor,
  waitForJobActionsReady,
  waitForResumedPromptReady,
  testWithin as within,
} from './MinimalAssignment.test-harness';

describe('MinimalAssignment - publish and job actions', () => {
  beforeEach(() => {
    setupMinimalAssignmentTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderWithResumedPromptReady = async () => {
    hydrateResumedAssignment();
    render(<MinimalAssignment />);
    await waitForResumedPromptReady();
  };

  it('shows upload errors when upload fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadRecording).mockRejectedValueOnce(new Error('Upload failed at gateway'));

    render(<MinimalAssignment />);

    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await screen.findByText('Upload failed at gateway');
  });

  it(
    'prevents draft save when markdown validation fails',
    async () => {
      const user = userEvent.setup();
      vi.mocked(api.validateMarkdown).mockResolvedValueOnce({
        ok: false,
        errors: ['Missing study text block'],
        warnings: [],
      });

      await renderWithResumedPromptReady();

      const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
      expect(draftTextarea).toBeTruthy();
      if (!draftTextarea) {
        throw new Error('Expected draft textarea to be rendered');
      }
      await user.type(draftTextarea, '# Broken draft');

      await user.click(screen.getByRole('button', { name: /Save draft/i }));

      await screen.findByText('Fix validation errors before saving.');
      expect(api.createDraft).not.toHaveBeenCalled();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'publishes a valid draft and displays the resulting job link',
    async () => {
      const user = userEvent.setup();
      render(<MinimalAssignment />);
      await preparePromptReady(user);

      const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
      expect(draftTextarea).toBeTruthy();
      if (!draftTextarea) {
        throw new Error('Expected draft textarea to be rendered');
      }
      await user.type(draftTextarea, '# Final draft');
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
      expect(api.materializeDraft).toHaveBeenCalledWith('draft-1', {
        jobOverrides: {
          publishTarget: 'html',
          withTts: true,
          ttsProvider: 'elevenlabs',
        },
      });
      expect(api.approveJob).toHaveBeenCalledWith('job-1', {
        md: '/tmp/assignment.md',
        mdStorageUri: 's3://esl/drafts/draft-1.md',
      });

      await screen.findAllByText(/Job ID: job-1/i);
      const link = screen.getByRole('link', { name: /Open in Notion/i });
      expect(link.getAttribute('href')).toBe('https://www.notion.so/published-assignment');
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'publishes canonical learningPresetId when learning preset metadata is available',
    async () => {
      const user = userEvent.setup();
      vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
        presets: ['b1-default', 'b2-default'],
        learningPresets: [
          makeLearningPreset(),
          makeLearningPreset({
            id: 'general-english-intensive',
            title: 'General English Intensive',
          }),
        ],
        cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
        cefrDefault: 'B1',
        voiceAccents: ['american'],
        voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
        notionDatabases: [{ id: 'db-1', name: 'DB One' }],
        ttsStrategies: ['auto', 'dialogue', 'tts'],
        ttsProviders: ['elevenlabs', 'google'],
        ttsModelOptionsByProvider: {
          elevenlabs: ['eleven_multilingual_v2'],
          google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
        },
        defaultTtsProvider: 'elevenlabs',
        defaultTtsModelByProvider: {
          elevenlabs: 'eleven_multilingual_v2',
          google: 'chirp3_hd',
        },
        supportedActions: [],
      });
      await renderWithResumedPromptReady();

      const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
      expect(draftTextarea).toBeTruthy();
      if (!draftTextarea) {
        throw new Error('Expected draft textarea to be rendered');
      }
      await user.type(draftTextarea, '# Final draft');
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Preset/i }),
        'general-english-intensive',
      );

      await previewCurrentDraft(user);
      await user.click(screen.getByRole('button', { name: /Publish assignment/i }));

      await waitFor(() => {
        expect(api.createDraft).toHaveBeenCalledWith('pkg-1', '# Final draft');
      });
      expect(vi.mocked(api.validateMarkdown)).toHaveBeenLastCalledWith('# Final draft', true, {
        learningPresetId: 'general-english-intensive',
      });
      expect(api.materializeDraft).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({
          jobOverrides: expect.objectContaining({
            learningPresetId: 'general-english-intensive',
            publishTarget: 'html',
            withTts: true,
            ttsProvider: 'elevenlabs',
          }),
        }),
      );
      const call = vi.mocked(api.materializeDraft).mock.calls.at(-1)?.[1];
      expect(call?.jobOverrides).not.toHaveProperty('preset');
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'requires preview before publish and requires re-preview after draft edits',
    async () => {
      const user = userEvent.setup();
      await renderWithResumedPromptReady();

      const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
      await user.type(draftTextarea, '# Preview gated draft');

      const publishButton = screen.getByRole('button', { name: /Publish assignment/i });
      expect((publishButton as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('Preview required before publish.')).toBeTruthy();
      expect(api.materializeDraft).not.toHaveBeenCalled();

      await previewCurrentDraft(user);
      expect((publishButton as HTMLButtonElement).disabled).toBe(false);

      await user.type(draftTextarea, '\nOne more line');
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
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      hydrateResumedAssignment();
      render(<MinimalAssignment />);
      await waitForJobActionsReady();

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
    'uses selected google provider/model for publish and custom rerun payloads',
    async () => {
      const user = userEvent.setup();
      render(<MinimalAssignment />);

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });

      await user.click(screen.getByRole('button', { name: /Generate prompt/i }));

      await waitFor(() => {
        expect(screen.getByDisplayValue('Prompt package output')).toBeTruthy();
      });

      const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
      await user.type(draftTextarea, '# Google TTS draft');
      await user.selectOptions(screen.getByRole('combobox', { name: /^TTS provider$/i }), 'google');
      await user.selectOptions(screen.getByRole('combobox', { name: /^TTS model$/i }), 'studio');

      await previewCurrentDraft(user);
      await user.click(screen.getByRole('button', { name: /Publish assignment/i }));

      await waitFor(() => {
        expect(api.materializeDraft).toHaveBeenCalled();
      });
      expect(api.materializeDraft).toHaveBeenCalledWith('draft-1', {
        jobOverrides: expect.objectContaining({
          publishTarget: 'html',
          withTts: true,
          ttsProvider: 'google',
          googleTtsModel: 'studio',
        }),
      });

      await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
      await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
      await user.selectOptions(screen.getByRole('combobox', { name: /Study-text provider/i }), 'google');
      await user.selectOptions(screen.getByRole('combobox', { name: /Study-text model/i }), 'studio');
      await user.click(screen.getByRole('button', { name: /Queue custom rerun/i }));

      await waitFor(() => {
        expect(api.rerunJob).toHaveBeenCalledWith(
          'job-1',
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
    'submits custom rerun payload values',
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      hydrateResumedAssignment();
      render(<MinimalAssignment />);
      await waitForJobActionsReady();

      await user.click(screen.getByRole('button', { name: /Custom rerun/i }));
      await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
      await user.type(screen.getByRole('textbox', { name: /Study-text voice ID/i }), 'voice-new');
      await user.type(screen.getByRole('textbox', { name: /Study-text accent/i }), 'british');
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Study-text strategy/i }),
        'dialogue',
      );
      await user.type(screen.getByPlaceholderText('e.g. es'), 'es');
      await user.type(screen.getByPlaceholderText('0.42'), '0.42');
      await user.type(screen.getByPlaceholderText('7'), '7');

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
      const user = userEvent.setup();
      hydrateResumedAssignment({ draftText: connectedSpeechDraft });
      render(<MinimalAssignment />);
      await waitForJobActionsReady();
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
        (screen.getByRole('combobox', {
          name: /Pronunciation chunk provider/i,
        }) as HTMLSelectElement).value,
      ).toBe('elevenlabs');
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'limits elevenlabs rerun model choices to valid paths',
    async () => {
      const user = userEvent.setup();
      hydrateResumedAssignment();
      render(<MinimalAssignment />);
      await waitForJobActionsReady();

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

      await user.selectOptions(screen.getByRole('combobox', { name: /Study-text strategy/i }), 'dialogue');
      expect(within(studyModel).getByRole('option', { name: 'eleven_v3' })).toBeTruthy();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'queues a republish-only rerun action for the current job',
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      hydrateResumedAssignment();
      render(<MinimalAssignment />);
      await waitForJobActionsReady();

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
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const runningStatus = hydrateResumedAssignment({
        status: {
          state: 'running',
          publishTarget: 'notion',
          notionUrl: null,
        },
      });
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

      render(<MinimalAssignment />);
      await waitForJobActionsReady();

      const reasonInput = screen.getByPlaceholderText('reason for cancellation');
      await user.type(reasonInput, 'duplicate run');
      const actionsHeading = screen.getByRole('heading', { name: /7\. Job actions/i });
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
      hydrateResumedAssignment({ status: { state: 'succeeded' } });
      render(<MinimalAssignment />);
      await waitForJobActionsReady();

      const cancelButton = screen.getByRole('button', { name: /Cancel job/i });
      expect(cancelButton.getAttribute('disabled')).not.toBeNull();
      expect(
        screen.getByText(/Cancel is only available for queued or running jobs\./i),
      ).toBeTruthy();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
