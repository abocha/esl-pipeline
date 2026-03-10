import { afterEach, beforeEach, describe, it } from 'vitest';

import {
  INTEGRATION_TEST_TIMEOUT_MS,
  hydrateResumedAssignment,
  makeLearningPreset,
  previewCurrentDraft,
  preparePromptReady,
  setupMinimalAssignmentTest,
  testExpect as expect,
  testApi as api,
  testMinimalAssignment as MinimalAssignment,
  testRender as render,
  testScreen as screen,
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
    'queues a default rerun audio action for the current job',
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      hydrateResumedAssignment();
      render(<MinimalAssignment />);
      await waitForJobActionsReady();

      await user.click(screen.getByRole('button', { name: /Rerun audio/i }));

      await waitFor(() => {
        expect(api.rerunAudioJob).toHaveBeenCalledWith('job-1', {
          forceTts: false,
          ttsStrategy: 'auto',
          ttsProvider: 'elevenlabs',
        });
      });
      expect(screen.getByText(/Audio rerun queued/i)).toBeTruthy();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'uses selected google provider/model for publish and rerun payloads',
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

      await user.click(screen.getByRole('button', { name: /Rerun audio/i }));

      await waitFor(() => {
        expect(api.rerunAudioJob).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({
            ttsProvider: 'google',
            googleTtsModel: 'studio',
          }),
        );
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'submits advanced rerun payload values',
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      hydrateResumedAssignment();
      render(<MinimalAssignment />);
      await waitForJobActionsReady();

      await user.click(screen.getByRole('button', { name: /Show advanced rerun/i }));
      await user.type(screen.getByPlaceholderText('voice id override'), 'voice-new');
      await user.type(screen.getByPlaceholderText('accent override'), 'british');
      await user.selectOptions(screen.getByRole('combobox', { name: /TTS strategy/i }), 'dialogue');
      await user.type(screen.getByPlaceholderText('e.g. es'), 'es');
      await user.type(screen.getByPlaceholderText('0.42'), '0.42');
      await user.type(screen.getByPlaceholderText('7'), '7');

      await user.click(screen.getByRole('button', { name: /Rerun audio/i }));

      await waitFor(() => {
        expect(api.rerunAudioJob).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({
            forceTts: false,
            voiceId: 'voice-new',
            voiceAccent: 'british',
            ttsStrategy: 'dialogue',
            ttsProvider: 'elevenlabs',
            dialogueLanguage: 'es',
            dialogueStability: 0.42,
            dialogueSeed: 7,
          }),
        );
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'queues a publish-only rerun action for the current job',
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      hydrateResumedAssignment();
      render(<MinimalAssignment />);
      await waitForJobActionsReady();

      await user.click(screen.getAllByRole('button', { name: /Rerun publish/i })[0]!);

      await waitFor(() => {
        expect(api.rerunPublishJob).toHaveBeenCalledWith('job-1');
      });
      expect(screen.getByText('Publish rerun queued')).toBeTruthy();
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
