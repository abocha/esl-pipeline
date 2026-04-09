import { beforeEach, describe, it } from 'vitest';

import type * as ApiTypes from '../../utils/api';
import {
  testApi as api,
  createMinimalUser,
  testExpect as expect,
  INTEGRATION_TEST_TIMEOUT_MS,
  makeJobStatus,
  makeLearningPreset,
  makeRecording,
  makeTranscript,
  now,
  openPublishingSettings,
  previewCurrentDraft,
  renderMinimalAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testVi as vi,
  testWaitFor as waitFor,
  testWithin as within,
} from './MinimalAssignment.test-harness';

export function registerResumeBasicTests() {
  describe('MinimalAssignment - basic resume and rehydration', {
    timeout: INTEGRATION_TEST_TIMEOUT_MS,
  }, () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    it('loads prompt options on mount', async () => {
      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.fetchPromptOptions).toHaveBeenCalledTimes(1);
      });
      expect(api.fetchJobOptions).toHaveBeenCalledTimes(1);
      expect(api.fetchStudentOptions).toHaveBeenCalledTimes(1);
      expect(api.listProfileContents).toHaveBeenCalledTimes(1);

      expect(screen.getByRole('heading', { name: /Add lesson source/i })).toBeTruthy();
      expect(screen.getByRole('heading', { name: /Review and share/i })).toBeTruthy();
      expect(
        (screen.getByRole('combobox', { name: /Share to/i }) as HTMLSelectElement).value,
      ).toBe('html');
    });

    it('auto-resumes queued/running jobs and skips terminal jobs on initial load', async () => {
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          makeJobStatus({
            jobId: 'job-finished',
            state: 'succeeded',
            startedAt: now,
            finishedAt: now,
          }),
          makeJobStatus({
            jobId: 'job-running',
            state: 'running',
            startedAt: now,
            finishedAt: null,
          }),
        ],
        total: 2,
        limit: 20,
        offset: 0,
      });
      vi.mocked(api.getJobStatus).mockResolvedValueOnce(
        makeJobStatus({
          jobId: 'job-running',
          state: 'running',
          startedAt: now,
          finishedAt: null,
        }),
      );

      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.getJobStatus).toHaveBeenCalledWith('job-running');
      });
      expect(api.getJobStatus).toHaveBeenCalledTimes(1);
    });

    it('does not auto-resume terminal jobs when no queued/running job exists', async () => {
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          makeJobStatus({
            jobId: 'job-succeeded',
            state: 'succeeded',
            startedAt: now,
            finishedAt: now,
          }),
          makeJobStatus({
            jobId: 'job-failed',
            state: 'failed',
            startedAt: now,
            finishedAt: now,
            error: 'failed for test',
          }),
        ],
        total: 2,
        limit: 20,
        offset: 0,
      });

      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.listUserJobs).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(api.getJobStatus).not.toHaveBeenCalled();
      });
      expect(screen.queryByText(/Current assignment/i)).toBeNull();
    });

    it('rehydrates workflow state from server job context in query params', async () => {
      const user = createMinimalUser();
      let resolveProfileOptions: (value: { profiles: { id: string; label: string }[] }) => void =
        () => {};
      vi.mocked(api.listProfileContents).mockImplementationOnce(
        () =>
          new Promise<{ profiles: { id: string; label: string }[] }>((resolve) => {
            resolveProfileOptions = (value) => resolve(value);
          }),
      );
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          {
            jobId: 'job-resume',
            studentId: 'student-alex',
            md: '/tmp/resume.md',
            mdStorageUri: 's3://bucket/resume.md',
            recordingId: 'rec-resume',
            transcriptId: 'tx-resume',
            promptPackageId: 'pkg-resume',
            draftId: 'draft-resume',
            preset: 'b2-default',
            withTts: true,
            voiceId: null,
            upload: 's3',
            voiceAccent: null,
            forceTts: false,
            notionDatabase: null,
            publishTarget: 'anytype',
            ttsStrategy: 'auto',
            autoPublish: false,
            notionUrl: null,
            anytypeUrl: null,
            state: 'failed',
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: now,
            error: 'fetch failed',
            manifestPath: null,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });

      vi.mocked(api.getJobStatus).mockResolvedValueOnce({
        jobId: 'job-resume',
        md: '/tmp/resume.md',
        mdStorageUri: 's3://bucket/resume.md',
        recordingId: 'rec-resume',
        transcriptId: 'tx-resume',
        promptPackageId: 'pkg-resume',
        draftId: 'draft-resume',
        preset: 'b2-default',
        withTts: true,
        voiceId: null,
        upload: 's3',
        voiceAccent: null,
        forceTts: false,
        notionDatabase: null,
        publishTarget: 'anytype',
        ttsStrategy: 'auto',
        autoPublish: false,
        notionUrl: null,
        anytypeUrl: null,
        state: 'failed',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
        error: 'fetch failed',
        manifestPath: null,
      });
      vi.mocked(api.getRecording).mockResolvedValueOnce(
        makeRecording({
          recordingId: 'rec-resume',
          status: 'transcribed',
          transcriptId: 'tx-resume',
          studentId: null,
          displayName: 'resume.mp3',
        }),
      );
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValueOnce(
        makeTranscript({
          recordingId: 'rec-resume',
          transcriptId: 'tx-resume',
          text: 'Recovered transcript',
        }),
      );
      vi.mocked(api.fetchPromptPackage).mockResolvedValueOnce({
        id: 'pkg-resume',
        recordingId: 'rec-resume',
        transcriptId: 'tx-resume',
        studentId: null,
        profilePath: null,
        templateVersion: 'v1',
        notes: null,
        storageUri: 'memory://prompt/pkg-resume',
        text: 'Recovered prompt',
        createdAt: now,
        updatedAt: now,
      });
      vi.mocked(api.fetchDraft).mockResolvedValueOnce({
        id: 'draft-resume',
        promptPackageId: 'pkg-resume',
        studentId: null,
        storageUri: 'memory://drafts/draft-resume',
        createdBy: 'user-1',
        text: '# Recovered draft',
        createdAt: now,
        updatedAt: now,
      });

      globalThis.history.replaceState(null, '', '/?jobId=job-resume');
      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.getJobStatus).toHaveBeenCalledWith('job-resume');
      });
      await waitFor(() => {
        expect(api.fetchJobProvenance).toHaveBeenCalledTimes(1);
      });
      expect(api.fetchJobProvenance).toHaveBeenLastCalledWith('job-resume');

      const resumeSelect = screen.getByRole('combobox', { name: /Recent assignments/i });
      expect(within(resumeSelect).getByRole('option', { name: /Alex/i })).toBeTruthy();
      expect(within(resumeSelect).queryByRole('option', { name: /No saved jobs yet/i })).toBeNull();

      expect(await screen.findByDisplayValue('Recovered transcript')).toBeTruthy();
      expect(await screen.findByDisplayValue('Recovered prompt')).toBeTruthy();
      expect(await screen.findByDisplayValue('# Recovered draft')).toBeTruthy();
      openPublishingSettings();
      expect(
        (
          (await screen.findByRole('combobox', { name: /Learning preset/i })) as HTMLSelectElement
        ).value,
      ).toBe('b2-default');
      resolveProfileOptions({ profiles: [{ id: 'profile-default.md', label: 'Default Profile' }] });
      expect(screen.getAllByText(/Anytype server unreachable/i).length).toBeGreaterThan(0);
      await user.click(screen.getByRole('button', { name: /Refresh instructions/i }));
      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            templateId: 'tpl-default',
            profileId: 'profiles/alex.md',
          }),
        );
      });

      globalThis.history.replaceState(null, '', '/');
    });
  });
}

export function registerResumePresetRaceTests() {
  describe('MinimalAssignment - resumed preset normalization races', {
    timeout: INTEGRATION_TEST_TIMEOUT_MS,
  }, () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    it('normalizes resumed preset when stored preset is no longer in current options', async () => {
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          {
            jobId: 'job-stale-preset',
            studentId: 'student-alex',
            md: '/tmp/stale.md',
            mdStorageUri: 's3://bucket/stale.md',
            recordingId: null,
            transcriptId: null,
            promptPackageId: null,
            draftId: null,
            preset: 'legacy-removed-preset',
            withTts: true,
            voiceId: null,
            upload: 's3',
            voiceAccent: null,
            forceTts: false,
            notionDatabase: null,
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: false,
            notionUrl: null,
            anytypeUrl: null,
            state: 'succeeded',
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: now,
            error: null,
            manifestPath: null,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });

      vi.mocked(api.getJobStatus).mockResolvedValueOnce({
        jobId: 'job-stale-preset',
        md: '/tmp/stale.md',
        mdStorageUri: 's3://bucket/stale.md',
        recordingId: null,
        transcriptId: null,
        promptPackageId: null,
        draftId: null,
        preset: 'legacy-removed-preset',
        withTts: true,
        voiceId: null,
        upload: 's3',
        voiceAccent: null,
        forceTts: false,
        notionDatabase: null,
        publishTarget: 'html',
        ttsStrategy: 'auto',
        autoPublish: false,
        notionUrl: null,
        anytypeUrl: null,
        state: 'succeeded',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
        error: null,
        manifestPath: null,
      });

      globalThis.history.replaceState(null, '', '/?jobId=job-stale-preset');
      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.getJobStatus).toHaveBeenCalledWith('job-stale-preset');
      });

      openPublishingSettings();
      const presetSelect = await screen.findByRole('combobox', { name: /Learning preset/i });
      expect((presetSelect as HTMLSelectElement).value).toBe('b1-default');
    });

    it('clears resumed stale preset when preset catalog is empty and omits preset on publish', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
        presets: [],
        cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
        cefrDefault: 'B1',
        voiceAccents: ['american'],
        voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
        notionDatabases: [{ id: 'db-1', name: 'DB One' }],
        ttsStrategies: ['auto', 'dialogue', 'tts'],
        supportedActions: [],
      });
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          {
            jobId: 'job-empty-presets',
            studentId: 'student-alex',
            md: '/tmp/stale.md',
            mdStorageUri: 's3://bucket/stale.md',
            recordingId: null,
            transcriptId: null,
            promptPackageId: 'pkg-1',
            draftId: 'draft-1',
            preset: 'legacy-removed-preset',
            withTts: true,
            voiceId: null,
            upload: 's3',
            voiceAccent: null,
            forceTts: false,
            notionDatabase: null,
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: false,
            notionUrl: null,
            anytypeUrl: null,
            state: 'succeeded',
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: now,
            error: null,
            manifestPath: null,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });

      vi.mocked(api.getJobStatus).mockResolvedValueOnce({
        jobId: 'job-empty-presets',
        md: '/tmp/stale.md',
        mdStorageUri: 's3://bucket/stale.md',
        recordingId: null,
        transcriptId: null,
        promptPackageId: 'pkg-1',
        draftId: 'draft-1',
        preset: 'legacy-removed-preset',
        withTts: true,
        voiceId: null,
        upload: 's3',
        voiceAccent: null,
        forceTts: false,
        notionDatabase: null,
        publishTarget: 'html',
        ttsStrategy: 'auto',
        autoPublish: false,
        notionUrl: null,
        anytypeUrl: null,
        state: 'succeeded',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
        error: null,
        manifestPath: null,
      });

      globalThis.history.replaceState(null, '', '/?jobId=job-empty-presets');
      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.getJobStatus).toHaveBeenCalledWith('job-empty-presets');
      });

      openPublishingSettings();
      const presetSelect = await screen.findByRole('combobox', { name: /Learning preset/i });
      expect((presetSelect as HTMLSelectElement).value).toBe('');

      await previewCurrentDraft(user);
      await user.click(screen.getByRole('button', { name: /Share assignment/i }));

      await waitFor(() => {
        expect(api.materializeDraft).toHaveBeenCalled();
      });
      const publishCall = vi.mocked(api.materializeDraft).mock.calls.at(-1)?.[1];
      expect(publishCall?.jobOverrides?.publishTarget).toBe('html');
      expect(publishCall?.jobOverrides).not.toHaveProperty('preset');
    });

    it(
      'omits stale preset when resumed before options load, then restores valid preset after options resolve',
      async () => {
        const user = createMinimalUser();
        let resolveJobOptions: (value: ApiTypes.JobOptionsResponse) => void = () => {};
        vi.mocked(api.fetchJobOptions).mockImplementationOnce(
          () =>
            new Promise<ApiTypes.JobOptionsResponse>((resolve) => {
              resolveJobOptions = (value) => resolve(value);
            }),
        );
        vi.mocked(api.listUserJobs).mockResolvedValueOnce({
          jobs: [
            {
              jobId: 'job-race-preset',
              studentId: 'student-alex',
              md: '/tmp/stale.md',
              mdStorageUri: 's3://bucket/stale.md',
              recordingId: null,
              transcriptId: null,
              promptPackageId: 'pkg-1',
              draftId: 'draft-1',
              preset: 'legacy-removed-preset',
              withTts: true,
              voiceId: null,
              upload: 's3',
              voiceAccent: null,
              forceTts: false,
              notionDatabase: null,
              publishTarget: 'html',
              ttsStrategy: 'auto',
              autoPublish: false,
              notionUrl: null,
              anytypeUrl: null,
              state: 'succeeded',
              createdAt: now,
              updatedAt: now,
              startedAt: now,
              finishedAt: now,
              error: null,
              manifestPath: null,
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        });
        vi.mocked(api.getJobStatus).mockResolvedValueOnce({
          jobId: 'job-race-preset',
          md: '/tmp/stale.md',
          mdStorageUri: 's3://bucket/stale.md',
          recordingId: null,
          transcriptId: null,
          promptPackageId: 'pkg-1',
          draftId: 'draft-1',
          preset: 'legacy-removed-preset',
          withTts: true,
          voiceId: null,
          upload: 's3',
          voiceAccent: null,
          forceTts: false,
          notionDatabase: null,
          publishTarget: 'html',
          ttsStrategy: 'auto',
          autoPublish: false,
          notionUrl: null,
          anytypeUrl: null,
          state: 'succeeded',
          createdAt: now,
          updatedAt: now,
          startedAt: now,
          finishedAt: now,
          error: null,
          manifestPath: null,
        });

        globalThis.history.replaceState(null, '', '/?jobId=job-race-preset');
        renderMinimalAssignment();

        await waitFor(() => {
          expect(api.getJobStatus).toHaveBeenCalledWith('job-race-preset');
        });
        expect(await screen.findByDisplayValue('# Draft markdown')).toBeTruthy();
        expect(await screen.findByDisplayValue('Prompt package output')).toBeTruthy();

        openPublishingSettings();
        await previewCurrentDraft(user);
        await user.click(screen.getByRole('button', { name: /Share assignment/i }));

        await waitFor(() => {
          expect(api.materializeDraft).toHaveBeenCalledTimes(1);
        });
        const firstPublishCall = vi.mocked(api.materializeDraft).mock.calls[0]?.[1];
        expect(firstPublishCall?.jobOverrides?.publishTarget).toBe('html');
        expect(firstPublishCall?.jobOverrides).not.toHaveProperty('preset');

        resolveJobOptions({
          presets: ['b2-default'],
          cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
          cefrDefault: 'B1',
          voiceAccents: ['american'],
          voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
          notionDatabases: [{ id: 'db-1', name: 'DB One' }],
          ttsStrategies: ['auto', 'dialogue', 'tts'],
          supportedActions: [],
        });

        const presetSelect = await screen.findByRole('combobox', { name: /Learning preset/i });
        await waitFor(() => {
          expect((presetSelect as HTMLSelectElement).value).toBe('b2-default');
        });

        await previewCurrentDraft(user);
        await user.click(screen.getByRole('button', { name: /Share assignment/i }));
        await waitFor(() => {
          expect(api.materializeDraft).toHaveBeenCalledTimes(2);
        });
        const secondPublishCall = vi.mocked(api.materializeDraft).mock.calls[1]?.[1];
        expect(secondPublishCall?.jobOverrides).toEqual({
          publishTarget: 'html',
          withTts: true,
          ttsProvider: 'elevenlabs',
          ttsStrategy: 'auto',
        });
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it('re-normalizes resumed legacy preset against loaded learning preset catalog before publish', async () => {
      const user = createMinimalUser();
      let resolveJobStatus: (value: ApiTypes.JobStatus) => void = () => {};

      vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
        presets: ['b1-default', 'b2-default'],
        learningPresets: [makeLearningPreset()],
        cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
        cefrDefault: 'B1',
        voiceAccents: ['american'],
        voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
        notionDatabases: [{ id: 'db-1', name: 'DB One' }],
        ttsStrategies: ['auto', 'dialogue', 'tts'],
        supportedActions: [],
      });
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          {
            jobId: 'job-learning-race',
            studentId: 'student-alex',
            md: '/tmp/stale.md',
            mdStorageUri: 's3://bucket/stale.md',
            recordingId: null,
            transcriptId: null,
            promptPackageId: 'pkg-1',
            draftId: 'draft-1',
            preset: 'b2-default',
            withTts: true,
            voiceId: null,
            upload: 's3',
            voiceAccent: null,
            forceTts: false,
            notionDatabase: null,
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: false,
            notionUrl: null,
            anytypeUrl: null,
            state: 'succeeded',
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: now,
            error: null,
            manifestPath: null,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });
      vi.mocked(api.getJobStatus).mockImplementationOnce(
        () =>
          new Promise<ApiTypes.JobStatus>((resolve) => {
            resolveJobStatus = resolve;
          }),
      );

      globalThis.history.replaceState(null, '', '/?jobId=job-learning-race');
      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.fetchJobOptions).toHaveBeenCalledTimes(1);
      });
      resolveJobStatus({
        jobId: 'job-learning-race',
        md: '/tmp/stale.md',
        mdStorageUri: 's3://bucket/stale.md',
        recordingId: null,
        transcriptId: null,
        promptPackageId: 'pkg-1',
        draftId: 'draft-1',
        preset: 'b2-default',
        withTts: true,
        voiceId: null,
        upload: 's3',
        voiceAccent: null,
        forceTts: false,
        notionDatabase: null,
        publishTarget: 'html',
        ttsStrategy: 'auto',
        autoPublish: false,
        notionUrl: null,
        anytypeUrl: null,
        state: 'succeeded',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
        error: null,
        manifestPath: null,
      });

      await waitFor(() => {
        expect(api.getJobStatus).toHaveBeenCalledWith('job-learning-race');
      });
      openPublishingSettings();
      const presetSelect = await screen.findByRole('combobox', { name: /Learning preset/i });
      await waitFor(() => {
        expect((presetSelect as HTMLSelectElement).value).toBe('general-english');
      });

      await previewCurrentDraft(user);
      await user.click(screen.getByRole('button', { name: /Share assignment/i }));

      await waitFor(() => {
        expect(api.materializeDraft).toHaveBeenCalled();
      });
      const publishCall = vi.mocked(api.materializeDraft).mock.calls.at(-1)?.[1];
      expect(publishCall?.jobOverrides).toEqual({
        publishTarget: 'html',
        learningPresetId: 'general-english',
        withTts: true,
        ttsProvider: 'elevenlabs',
        ttsStrategy: 'auto',
      });
      expect(publishCall?.jobOverrides).not.toHaveProperty('preset');
    });

    it('rehydrates explicit publish strategy and elevenlabs model from resumed job status', async () => {
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          makeJobStatus({
            jobId: 'job-dialogue-1',
            draftId: 'draft-1',
            state: 'succeeded',
          }),
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });
      vi.mocked(api.getJobStatus).mockResolvedValueOnce(
        makeJobStatus({
          jobId: 'job-dialogue-1',
          draftId: 'draft-1',
          state: 'succeeded',
          ttsProvider: 'elevenlabs',
          ttsStrategy: 'dialogue',
          studyTextElevenlabsModel: 'eleven_v3',
        }),
      );

      globalThis.history.replaceState(null, '', '/?jobId=job-dialogue-1');
      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.getJobStatus).toHaveBeenCalledWith('job-dialogue-1');
      });
      openPublishingSettings();
      expect(
        (
          (await screen.findByRole('combobox', {
            name: /Reading style/i,
          })) as HTMLSelectElement
        ).value,
      ).toBe('dialogue');
      expect(
        (screen.getByRole('combobox', { name: /Voice model/i }) as HTMLSelectElement).value,
      ).toBe('eleven_v3');
    });

    it(
      'preserves resumed publish strategy until delayed job options finish loading',
      async () => {
        let resolveJobOptions: (value: Awaited<ReturnType<typeof api.fetchJobOptions>>) => void =
          () => {};

        vi.mocked(api.fetchJobOptions).mockReset();
        vi.mocked(api.fetchJobOptions).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveJobOptions = resolve;
            }),
        );
        vi.mocked(api.listUserJobs).mockResolvedValueOnce({
          jobs: [
            makeJobStatus({
              jobId: 'job-dialogue-race',
              draftId: 'draft-1',
              state: 'succeeded',
            }),
          ],
          total: 1,
          limit: 20,
          offset: 0,
        });
        vi.mocked(api.getJobStatus).mockResolvedValueOnce(
          makeJobStatus({
            jobId: 'job-dialogue-race',
            draftId: 'draft-1',
            state: 'succeeded',
            ttsProvider: 'elevenlabs',
            ttsStrategy: 'dialogue',
            studyTextElevenlabsModel: 'eleven_v3',
          }),
        );

        globalThis.history.replaceState(null, '', '/?jobId=job-dialogue-race');
        renderMinimalAssignment();

        await waitFor(() => {
          expect(api.getJobStatus).toHaveBeenCalledWith('job-dialogue-race');
        });
        openPublishingSettings();
        const strategySelect = (await screen.findByRole('combobox', {
          name: /Reading style/i,
        })) as HTMLSelectElement;
        const modelSelect = screen.getByRole('combobox', {
          name: /Voice model/i,
        }) as HTMLSelectElement;

        expect(strategySelect.value).toBe('dialogue');
        expect(modelSelect.value).toBe('eleven_v3');

        resolveJobOptions({
          presets: ['b2-default'],
          cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
          cefrDefault: 'B1',
          voiceAccents: ['american'],
          voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
          notionDatabases: [{ id: 'db-1', name: 'DB One' }],
          ttsStrategies: ['auto', 'dialogue', 'tts'],
          supportedActions: [],
        });

        await waitFor(() => {
          expect(strategySelect.value).toBe('dialogue');
        });
        expect(modelSelect.value).toBe('eleven_v3');
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );
  });
}
