import { fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, it } from 'vitest';

import {
  testApi as api,
  createMinimalUser,
  createTimerAwareMinimalUser,
  testExpect as expect,
  makeAssignmentSession,
  makeRecording,
  makeScheduleBillingSurface,
  makeStudentLesson,
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
      const sttProviderSelect = await screen.findByRole('combobox', {
        name: /Transcript engine/i,
      });
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
      expect(screen.getByRole('link', { name: /Open Learning page/i }).getAttribute('href')).toBe(
        '/students/student-alex/learning',
      );
    });

    it('shows a useful empty state when the selected student has no learner profile', async () => {
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

      await screen.findByText(/No learner profile is selected for this student yet\./i);
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

    it('lets the operator choose a prompt template for the current assignment session', async () => {
      vi.mocked(api.fetchPromptOptions).mockResolvedValueOnce({
        templates: [
          { id: 'tpl-default', label: 'Default Template' },
          { id: 'tpl-focused', label: 'Focused Follow-up' },
        ],
        profiles: [{ id: 'profiles/alex.md', label: 'Alex active profile' }],
        defaults: {
          templateId: 'tpl-default',
          profileId: null,
        },
      });
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

      const templateSelect = await screen.findByRole('combobox', { name: /Prompt template/i });
      await user.selectOptions(templateSelect, 'tpl-focused');
      expect(screen.getByText(/Uses Focused Follow-up with Alex active profile\./i)).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /Generate instructions/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-focused',
          profileId: 'profiles/alex.md',
        });
      });
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

    it('preserves schedule lesson context when generating the prompt package', async () => {
      globalThis.history.replaceState(
        null,
        '',
        '/?studentId=student-alex&lessonId=lesson-followup-1',
      );
      vi.mocked(api.getStudentScheduleBillingSurface).mockResolvedValueOnce(
        makeScheduleBillingSurface({
          lessons: [
            makeStudentLesson({
              id: 'lesson-followup-1',
              startsAt: '2026-02-04T10:00:00.000Z',
              title: 'Pitch follow-up',
            }),
          ],
        }),
      );
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      const studentSelect = await screen.findByRole('combobox', { name: /^Student$/i });
      await screen.findByRole('option', { name: 'Alex' });
      expect((studentSelect as HTMLSelectElement).value).toBe('student-alex');
      expect((studentSelect as HTMLSelectElement).disabled).toBe(true);
      await screen.findByText(/Lesson context: .*Pitch follow-up.*lesson-followup-1/i);

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });
      await user.click(screen.getByRole('button', { name: /Generate instructions/i }));

      await waitFor(() => {
        expect(api.createAssignmentSession).toHaveBeenCalledWith(
          expect.objectContaining({
            studentId: 'student-alex',
            recordingId: 'rec-1',
            lessonId: 'lesson-followup-1',
          }),
        );
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
          lessonId: 'lesson-followup-1',
        });
      });
    });

    it('preserves resumed lesson context when generating the prompt package', async () => {
      vi.mocked(api.getStudentScheduleBillingSurface).mockResolvedValueOnce(
        makeScheduleBillingSurface({
          lessons: [
            makeStudentLesson({
              id: 'lesson-resume-1',
              startsAt: '2026-02-03T09:30:00.000Z',
              title: 'Resume review',
            }),
          ],
        }),
      );
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [
          makeAssignmentSession({
            id: 'session-linked',
            studentId: 'student-alex',
            lessonId: 'lesson-resume-1',
            currentStage: 'source',
          }),
        ],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(
        makeAssignmentSession({
          id: 'session-linked',
          studentId: 'student-alex',
          lessonId: 'lesson-resume-1',
          currentStage: 'source',
        }),
      );
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Resume recent work/i }));
      const resumeList = await screen.findByRole('listbox', { name: /Recent assignments/i });
      await user.click(within(resumeList).getByRole('option', { name: /Alex/i }));
      await user.click(screen.getByRole('button', { name: /Resume selected assignment/i }));

      await waitFor(() => {
        expect(screen.getByText(/Lesson context: .*Resume review.*lesson-resume-1/i)).toBeTruthy();
      });

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });
      await user.click(screen.getByRole('button', { name: /Generate instructions/i }));

      await waitFor(() => {
        expect(api.updateAssignmentSession).toHaveBeenCalledWith(
          'session-linked',
          expect.objectContaining({
            recordingId: 'rec-1',
            lessonId: 'lesson-resume-1',
          }),
        );
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
          lessonId: 'lesson-resume-1',
        });
      });
    });

    it('suggests recent passed lessons without homework and links the selected lesson', async () => {
      const recentStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      vi.mocked(api.getStudentScheduleBillingSurface).mockResolvedValueOnce(
        makeScheduleBillingSurface({
          lessons: [
            makeStudentLesson({
              id: 'lesson-recent-no-homework',
              startsAt: recentStart,
              title: 'Client update practice',
            }),
            makeStudentLesson({
              id: 'lesson-has-homework',
              startsAt: recentStart,
              title: 'Already assigned',
              homework: {
                ...makeStudentLesson().homework,
                status: 'published',
                htmlUrl: 'https://example.test/homework',
              },
            }),
          ],
        }),
      );
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );

      await screen.findByText(/Recent lessons without homework/i);
      await user.click(screen.getByRole('button', { name: /Client update practice/i }));
      await screen.findByText(
        /Lesson context: .*Client update practice.*lesson-recent-no-homework/i,
      );

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await user.click(screen.getByRole('button', { name: /Generate instructions/i }));

      await waitFor(() => {
        expect(api.createAssignmentSession).toHaveBeenCalledWith(
          expect.objectContaining({
            studentId: 'student-alex',
            lessonId: 'lesson-recent-no-homework',
          }),
        );
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
          lessonId: 'lesson-recent-no-homework',
        });
      });
      expect(screen.queryByText(/Already assigned/i)).toBeNull();
    });
  });
}
