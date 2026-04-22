import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, it } from 'vitest';

import {
  testApi as api,
  createMinimalUser,
  createTimerAwareMinimalUser,
  testExpect as expect,
  makeRecording,
  now,
  openRecordingSettings,
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

        await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
        const studentSelect = await screen.findByRole('combobox', { name: /^Student$/i });
        await screen.findByRole('option', { name: 'Alex' });
        await user.selectOptions(studentSelect, 'student-alex');
        await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

        await waitFor(() => {
          expect(api.uploadRecording).toHaveBeenCalledTimes(1);
        });
        expect(api.uploadRecording).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({ studentId: 'student-alex', sttProvider: 'deepgram' }),
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

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      openRecordingSettings();
      const sttProviderSelect = await screen.findByRole('combobox', { name: /Transcript engine/i });
      await waitFor(() => {
        expect((sttProviderSelect as HTMLSelectElement).value).toBe('google');
      });
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
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

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(screen.getByText(/Reused an existing transcript/i)).toBeTruthy();
      });
    });

    it('shows a read-only learner profile preview and deep link instead of inline editing', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await screen.findByRole('heading', { name: /Current learner profile/i });

      expect(screen.queryByRole('textbox', { name: /Profile content/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Save profile/i })).toBeNull();
      expect(screen.getByText(/Lead project updates clearly\./i)).toBeTruthy();
      expect(screen.getByText(/Strong listening comprehension\./i)).toBeTruthy();
      expect(
        screen.getByRole('link', { name: /Open Learning page/i }).getAttribute('href'),
      ).toBe('/students/student-alex/learning');
    });

    it('shows a useful empty state when the selected student has no bound learner profile', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValueOnce({
        students: [
          { id: 'student-alex', name: 'Alex', profileId: null },
          { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
        ],
      });

      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );

      await screen.findByText(/No learner profile is bound to this student yet\./i);
      expect(screen.queryByText(/Lead project updates clearly\./i)).toBeNull();
    });

    it('generates a prompt after transcript is ready', async () => {
      await renderPromptReadyAssignment();

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
        });
      });
      expect(screen.getByDisplayValue('Prompt package output')).toBeTruthy();
    });

    it('sends teacher notes into prompt package generation', async () => {
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

      const teacherNotesInput = screen.getByRole('textbox', { name: /Teacher notes/i });
      fireEvent.change(teacherNotesInput, {
        target: { value: ' Focus on article usage and stress patterns. ' },
      });
      await user.click(screen.getByRole('button', { name: /Generate instructions/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          notes: 'Focus on article usage and stress patterns.',
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
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

    it('requires explicit student selection before upload', async () => {
      renderMinimalAssignment();

      const studentSelect = await screen.findByRole('combobox', { name: /^Student$/i });
      expect((studentSelect as HTMLSelectElement).value).toBe('');
      expect(
        (screen.getByRole('button', { name: /Drop audio file/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(api.uploadRecording).not.toHaveBeenCalled();
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
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: false,
            htmlUrl: null,
            state: 'succeeded',
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: now,
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
        expect(screen.queryByRole('listbox', { name: /Recent assignments/i })).toBeNull();
      });
      fireEvent.click(screen.getByRole('button', { name: /Resume recent work/i }));

      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Audio refresh/i })).toBeTruthy();
      });
    });

    it('syncs profile to selected student binding before prompt generation', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      const studentSelect = await screen.findByRole('combobox', { name: /^Student$/i });
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(studentSelect, 'student-alex');
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });

      await user.click(screen.getByRole('button', { name: /Generate instructions/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
        });
      });
    });
  });
}
