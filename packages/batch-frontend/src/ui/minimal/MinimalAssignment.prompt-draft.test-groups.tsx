import { beforeEach, describe, it } from 'vitest';

import {
  testApi as api,
  createMinimalUser,
  createTimerAwareMinimalUser,
  testExpect as expect,
  makeRecording,
  now,
  renderMinimalAssignment,
  renderPromptReadyAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';

const PROMPT_DRAFT_TEST_TIMEOUT_MS = 15_000;

export function registerPromptEditorTests() {
  describe('MinimalAssignment - prompt editor flows', {
    timeout: PROMPT_DRAFT_TEST_TIMEOUT_MS,
  }, () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    it('uploads a recording and shows recording metadata', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const user = createTimerAwareMinimalUser();
        renderMinimalAssignment();

        const studentSelect = await screen.findByRole('combobox', {
          name: /Student \(optional\)/i,
        });
        await waitFor(() => {
          expect((studentSelect as HTMLSelectElement).value).toBe('student-default');
        });
        await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

        await waitFor(() => {
          expect(api.uploadRecording).toHaveBeenCalledTimes(1);
        });
        expect(api.uploadRecording).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({ studentId: 'student-default', sttProvider: 'deepgram' }),
        );

        await waitFor(() => {
          expect(screen.getByText(/Recording ID: rec-1/i)).toBeTruthy();
        });
        expect(screen.getByText(/Status: transcribed/i)).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses metadata-driven STT default provider for upload payloads', async () => {
      const defaultOptions = await api.fetchJobOptions();
      vi.mocked(api.fetchJobOptions).mockReset();
      vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
        ...defaultOptions,
        sttProviders: ['google', 'deepgram'],
        defaultSttProvider: 'google',
      });

      const user = createMinimalUser();
      renderMinimalAssignment();

      const sttProviderSelect = await screen.findByRole('combobox', { name: /STT provider/i });
      await waitFor(() => {
        expect((sttProviderSelect as HTMLSelectElement).value).toBe('google');
      });
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(api.uploadRecording).toHaveBeenCalledTimes(1);
      });
      expect(api.uploadRecording).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ sttProvider: 'google' }),
      );
    });

    it('shows a cache-hit notice when transcript reuse is available', async () => {
      const user = createMinimalUser();
      vi.mocked(api.uploadRecording).mockResolvedValueOnce(
        makeRecording({
          cacheHit: true,
          cacheReason: 'transcript_reused',
        }),
      );
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(screen.getByText(/Reused an existing transcript/i)).toBeTruthy();
      });
    });

    it('saves profile edits and refreshes revisions', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      const profileEditor = await screen.findByRole('textbox', { name: /Profile content/i });
      await waitFor(() => {
        expect((profileEditor as HTMLTextAreaElement).disabled).toBe(false);
      });
      await user.clear(profileEditor);
      await user.type(profileEditor, 'Updated profile content');
      await user.click(screen.getByRole('button', { name: /Save profile/i }));

      await waitFor(() => {
        expect(api.upsertProfileContent).toHaveBeenCalledWith(
          'profile-default.md',
          expect.stringContaining('Updated profile content'),
        );
      });
      expect(api.listProfileRevisions).toHaveBeenCalledWith('profile-default.md', {
        limit: 20,
        offset: 0,
        order: 'desc',
      });
    });

    it('generates a prompt after transcript is ready', async () => {
      await renderPromptReadyAssignment();

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profile-default.md',
        });
      });
      expect(screen.getByDisplayValue('Prompt package output')).toBeTruthy();
    });

    it('sends teacher notes into prompt package generation', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');

      const teacherNotesInput = screen.getByRole('textbox', { name: /Teacher notes/i });
      await user.type(teacherNotesInput, ' Focus on article usage and stress patterns. ');
      await user.click(screen.getByRole('button', { name: /Generate prompt/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          notes: 'Focus on article usage and stress patterns.',
          templateId: 'tpl-default',
          profileId: 'profile-default.md',
        });
      });
    });
  });
}

export function registerPromptStudentSelectionTests() {
  describe('MinimalAssignment - student selection flows', {
    timeout: PROMPT_DRAFT_TEST_TIMEOUT_MS,
  }, () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    it('uses Default student selection for upload on fresh load', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await screen.findByRole('combobox', { name: /Student \(optional\)/i });
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(api.uploadRecording).toHaveBeenCalledTimes(1);
      });
      expect(api.uploadRecording).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ studentId: 'student-default', sttProvider: 'deepgram' }),
      );
    });

    it('labels audio rerun jobs as audio regeneration in recent jobs', async () => {
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          {
            jobId: 'job-rerun-1',
            md: '/tmp/rerun.md',
            recordingId: null,
            transcriptId: null,
            promptPackageId: null,
            draftId: null,
            preset: null,
            withTts: true,
            voiceId: null,
            upload: 's3',
            voiceAccent: null,
            forceTts: false,
            notionDatabase: null,
            publishTarget: 'notion',
            ttsStrategy: 'auto',
            autoPublish: false,
            notionUrl: null,
            anytypeUrl: null,
            state: 'queued',
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            finishedAt: null,
            sourceJobId: 'job-source-1',
            error: null,
            manifestPath: null,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });

      renderMinimalAssignment();

      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Audio regeneration/i })).toBeTruthy();
      });
    });

    it('syncs profile to selected student binding before prompt generation', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      const studentSelect = await screen.findByRole('combobox', { name: /Student \(optional\)/i });
      await user.selectOptions(studentSelect, 'student-alex');
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });

      await user.click(screen.getByRole('button', { name: /Generate prompt/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
        });
      });
    });
  });
}
