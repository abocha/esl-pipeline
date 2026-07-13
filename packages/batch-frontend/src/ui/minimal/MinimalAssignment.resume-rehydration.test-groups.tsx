import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, it } from 'vitest';

import type * as ApiTypes from '../../utils/api';
import {
  testAct as act,
  testApi as api,
  createMinimalUser,
  testExpect as expect,
  INTEGRATION_TEST_TIMEOUT_MS,
  makeAssignmentSession,
  makeJobStatus,
  makeLearningPreset,
  makeRecording,
  makeTranscript,
  now,
  previewCurrentDraft,
  renderMinimalAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testVi as vi,
  testWaitFor as waitFor,
  testWithin as within,
} from './MinimalAssignment.test-harness';

async function openResumeRoute(user: ReturnType<typeof createMinimalUser>) {
  const resumeButton = await screen.findByRole('button', { name: /Resume recent work/i });
  await waitFor(() => expect((resumeButton as HTMLButtonElement).disabled).toBe(false));
  await user.click(resumeButton);
  return screen.findByRole('group', { name: /Recent assignments/i });
}

async function openNewRoute(user: ReturnType<typeof createMinimalUser>) {
  const newButton = await screen.findByRole('button', { name: /Start new assignment/i });
  await waitFor(() => expect((newButton as HTMLButtonElement).disabled).toBe(false));
  await user.click(newButton);
  await waitFor(() =>
    expect(
      screen.queryByRole('combobox', { name: /Choose learner/i }) ??
        screen.queryByRole('button', { name: /Change student/i }),
    ).toBeTruthy(),
  );
  const changeStudentButton = screen.queryByRole('button', { name: /Change student/i });
  if (changeStudentButton) await user.click(changeStudentButton);
  return screen.findByRole('combobox', { name: /Choose learner/i });
}

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
      expect(api.listProfileContents).not.toHaveBeenCalled();

      expect(screen.queryByRole('heading', { name: /Add lesson source/i })).toBeNull();
      expect(screen.queryByRole('heading', { name: /Review and share/i })).toBeNull();
      expect(screen.getByRole('button', { name: /Start new assignment/i })).toBeTruthy();
      expect(screen.queryByRole('combobox', { name: /Share to/i })).toBeNull();
      expect(screen.queryByText(/Assignments publish as an Assignment Handout/i)).toBeNull();
    });

    it('does not auto-resume queued or running jobs on a naked initial load', async () => {
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

      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.listUserJobs).toHaveBeenCalledTimes(1);
      });
      expect(api.getJobStatus).not.toHaveBeenCalled();
      expect(screen.queryByRole('listbox', { name: /Recent assignments/i })).toBeNull();
      expect(new URL(globalThis.location.href).searchParams.get('jobId')).toBeNull();
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
      expect(screen.queryByText(/^Current assignment$/i)).toBeNull();
    });

    it('renders recent work as selectable rows with friendly labels and progressive disclosure', async () => {
      const user = createMinimalUser();
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          makeJobStatus({
            jobId: 'job-ready-1',
            studentId: 'student-alex',
            state: 'succeeded',
            finishedAt: now,
          }),
          makeJobStatus({
            jobId: 'job-rerun-2',
            studentId: 'student-alex',
            state: 'failed',
            sourceJobId: 'job-ready-1',
            error: 'gateway timeout',
            finishedAt: now,
          }),
          makeJobStatus({
            jobId: 'job-ready-3',
            studentId: 'student-default',
            state: 'succeeded',
            finishedAt: now,
          }),
          makeJobStatus({
            jobId: 'job-ready-4',
            studentId: 'student-default',
            state: 'failed',
            finishedAt: now,
            error: 'publish failed',
          }),
          makeJobStatus({
            jobId: 'job-ready-5',
            studentId: 'student-default',
            state: 'succeeded',
            finishedAt: now,
          }),
        ],
        total: 5,
        limit: 20,
        offset: 0,
      });

      renderMinimalAssignment();

      expect(screen.queryByRole('listbox', { name: /Recent assignments/i })).toBeNull();
      const resumeList = await openResumeRoute(user);
      expect(within(resumeList).getAllByRole('radio')).toHaveLength(5);
      expect(within(resumeList).getAllByRole('radio', { name: /Alex/i })).toHaveLength(2);
      expect(screen.queryByText(/Audio refresh/i)).toBeNull();
      expect(screen.getAllByText(/Needs attention/i).length).toBeGreaterThan(0);
      expect(screen.queryByText(/job-reru/i)).toBeNull();
      expect(screen.queryByText(/gateway timeout/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /Show more assignments/i })).toBeNull();
    });

    it('shows unfinished assignment sessions beside publish jobs', async () => {
      const user = createMinimalUser();
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [
          makeAssignmentSession({
            id: 'session-draft',
            studentId: 'student-alex',
            currentStage: 'assignment',
            updatedAt: '2026-05-13T10:10:00.000Z',
          }),
        ],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          makeJobStatus({
            jobId: 'job-ready',
            studentId: 'student-bella',
            state: 'succeeded',
            finishedAt: '2026-05-13T10:00:00.000Z',
          }),
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });

      renderMinimalAssignment();

      const resumeList = await openResumeRoute(user);
      expect(within(resumeList).getByRole('radio', { name: /Alex/i })).toBeTruthy();
      expect(screen.getByText(/Draft in progress/i)).toBeTruthy();
      expect(screen.queryByText(/session-draft/i)).toBeNull();
      expect(within(resumeList).getByRole('radio', { name: /Bella/i })).toBeTruthy();
    });

    it('does not auto-rehydrate unfinished sessions on a naked initial load', async () => {
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [
          makeAssignmentSession({
            id: 'session-draft',
            studentId: 'student-alex',
            recordingId: 'rec-session',
            transcriptId: 'tx-session',
            promptPackageId: 'pkg-session',
            draftId: 'draft-session',
            currentStage: 'review',
            updatedAt: '2026-05-13T10:10:00.000Z',
          }),
        ],
        total: 1,
        limit: 20,
      });

      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.listAssignmentSessions).toHaveBeenCalledTimes(1);
      });
      expect(api.fetchAssignmentSession).not.toHaveBeenCalled();
      expect(api.getRecording).not.toHaveBeenCalled();
      expect(api.fetchDraft).not.toHaveBeenCalled();
      expect(api.createAssignmentSession).not.toHaveBeenCalled();
      expect(api.updateAssignmentSession).not.toHaveBeenCalled();
      expect(screen.queryByRole('listbox', { name: /Recent assignments/i })).toBeNull();
      expect(new URL(globalThis.location.href).searchParams.get('sessionId')).toBeNull();
    });

    it('rehydrates an unfinished session from query params', async () => {
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [
          makeAssignmentSession({
            id: 'session-resume',
            studentId: 'student-alex',
            recordingId: 'rec-session',
            transcriptId: 'tx-session',
            promptPackageId: 'pkg-session',
            draftId: 'draft-session',
            currentStage: 'review',
            teacherNotes: 'Remember the travel vocab.',
            selectedGenerationProvider: 'openai',
            selectedGenerationModel: 'gpt-5.2',
            selectedPreset: 'legacy-removed-preset',
          }),
        ],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.getRecording).mockResolvedValue(
        makeRecording({
          recordingId: 'rec-session',
          status: 'transcribed',
          transcriptId: 'tx-session',
          studentId: 'student-alex',
          displayName: 'session.mp3',
        }),
      );
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(
        makeTranscript({
          recordingId: 'rec-session',
          transcriptId: 'tx-session',
          text: 'Session transcript',
        }),
      );
      vi.mocked(api.fetchPromptPackage).mockResolvedValue({
        id: 'pkg-session',
        recordingId: 'rec-session',
        transcriptId: 'tx-session',
        studentId: 'student-alex',
        profilePath: null,
        templateVersion: 'v1',
        notes: 'Remember the travel vocab.',
        storageUri: 'memory://prompt/pkg-session',
        text: 'Session prompt',
        createdAt: now,
        updatedAt: now,
      });
      vi.mocked(api.fetchDraft).mockResolvedValue({
        id: 'draft-session',
        promptPackageId: 'pkg-session',
        studentId: 'student-alex',
        storageUri: 'memory://drafts/draft-session',
        createdBy: 'user-1',
        text: '# Session draft',
        createdAt: now,
        updatedAt: now,
      });

      const user = createMinimalUser();
      globalThis.history.replaceState(null, '', '/?sessionId=session-resume');
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Lesson source/i }));
      expect(await screen.findByDisplayValue('Session transcript')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /Create/i }));
      expect(await screen.findByDisplayValue('# Session draft')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      expect(((await screen.findByLabelText(/Teacher notes/i)) as HTMLTextAreaElement).value).toBe(
        'Remember the travel vocab.',
      );
      expect(screen.queryByRole('combobox', { name: /Learning preset/i })).toBeNull();
      vi.useFakeTimers();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(api.createAssignmentSession).not.toHaveBeenCalled();
      expect(api.updateAssignmentSession).not.toHaveBeenCalled();
      vi.useRealTimers();

      vi.useFakeTimers();
      const teacherNotesInput = screen.getByRole('textbox', { name: /Teacher notes/i });
      fireEvent.change(teacherNotesInput, {
        target: { value: 'Remember the travel vocab. Add pronunciation contrast.' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(api.updateAssignmentSession).not.toHaveBeenCalled();
      vi.useRealTimers();
      expect(api.getJobStatus).not.toHaveBeenCalled();
    });

    it('persists a pasted transcript as a user edit after session hydration', async () => {
      const user = createMinimalUser();
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [
          makeAssignmentSession({
            id: 'session-resume',
            studentId: 'student-alex',
            currentStage: 'source',
          }),
        ],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValueOnce(
        makeTranscript({
          recordingId: 'rec-manual',
          transcriptId: 'tx-manual',
          text: 'Tutor supplied transcript',
          sttProvider: 'manual',
        }),
      );
      vi.mocked(api.updateAssignmentSession).mockImplementation(async (id, patch) =>
        makeAssignmentSession({
          id,
          studentId: 'student-alex',
          ...patch,
        }),
      );

      globalThis.history.replaceState(null, '', '/?sessionId=session-resume');
      renderMinimalAssignment();

      await screen.findByRole('heading', { name: /Add lesson source/i });
      await user.click(screen.getByRole('button', { name: /Use an existing transcript/i }));
      await user.type(
        screen.getByRole('textbox', { name: /Existing lesson transcript/i }),
        'Tutor supplied transcript',
      );
      await user.click(screen.getByRole('button', { name: /Save existing transcript/i }));

      await waitFor(() => {
        expect(api.createManualTranscriptSource).toHaveBeenCalledWith({
          studentId: 'student-alex',
          text: 'Tutor supplied transcript',
          displayName: 'Pasted lesson transcript',
        });
      });
      await waitFor(() => {
        expect(api.updateAssignmentSession).toHaveBeenCalledWith(
          'session-resume',
          expect.objectContaining({
            recordingId: 'rec-manual',
          }),
        );
        expect(api.updateAssignmentSession).toHaveBeenCalledWith(
          'session-resume',
          expect.objectContaining({
            transcriptId: 'tx-manual',
          }),
        );
      });
    });

    it('waits for initial session hydration before changing the workflow step', async () => {
      let resolveStaleDraft: (value: ApiTypes.DraftResponse) => void = () => {};
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [
          makeAssignmentSession({
            id: 'session-stale',
            studentId: 'student-alex',
            recordingId: 'rec-stale',
            transcriptId: 'tx-stale',
            promptPackageId: 'pkg-stale',
            draftId: 'draft-stale',
            currentStage: 'review',
          }),
        ],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.getRecording).mockResolvedValueOnce(
        makeRecording({
          recordingId: 'rec-stale',
          status: 'transcribed',
          transcriptId: 'tx-stale',
          studentId: 'student-alex',
          displayName: 'stale.mp3',
        }),
      );
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValueOnce(
        makeTranscript({
          recordingId: 'rec-stale',
          transcriptId: 'tx-stale',
          text: 'Stale transcript',
        }),
      );
      vi.mocked(api.fetchPromptPackage).mockResolvedValueOnce({
        id: 'pkg-stale',
        recordingId: 'rec-stale',
        transcriptId: 'tx-stale',
        studentId: 'student-alex',
        profilePath: null,
        templateVersion: 'v1',
        notes: null,
        storageUri: 'memory://prompt/pkg-stale',
        text: 'Stale prompt',
        createdAt: now,
        updatedAt: now,
      });
      vi.mocked(api.fetchDraft).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleDraft = resolve;
          }),
      );

      const user = createMinimalUser();
      globalThis.history.replaceState(null, '', '/?sessionId=session-stale');
      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.fetchDraft).toHaveBeenCalledWith('draft-stale');
      });
      expect(
        (screen.getByRole('button', { name: /Start new assignment/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(screen.getByRole('button', { name: /Student/i }).getAttribute('aria-current')).toBe(
        'step',
      );

      await act(async () => {
        resolveStaleDraft({
          id: 'draft-stale',
          promptPackageId: 'pkg-stale',
          studentId: 'student-alex',
          storageUri: 'memory://drafts/draft-stale',
          createdBy: 'user-1',
          text: '# Stale draft',
          createdAt: now,
          updatedAt: now,
        });
        await Promise.resolve();
      });

      expect(await screen.findByDisplayValue('Stale transcript')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: /Review & share/i }).getAttribute('aria-current'),
      ).toBe('step');
      expect(new URL(globalThis.location.href).searchParams.get('sessionId')).toBe('session-stale');
    });

    it(
      'ignores an older draft autosave response after hydrating another assignment session',
      async () => {
        let resolveOlderAutosave: (value: ApiTypes.DraftResponse) => void = () => {};
        vi.mocked(api.listAssignmentSessions).mockResolvedValue({
          sessions: [
            makeAssignmentSession({
              id: 'session-next',
              studentId: 'student-bella',
              recordingId: 'rec-next',
              transcriptId: 'tx-next',
              promptPackageId: 'pkg-next',
              draftId: 'draft-next',
              currentStage: 'review',
            }),
          ],
          total: 1,
          limit: 20,
        });
        vi.mocked(api.fetchDraft).mockImplementation(async (draftId) => {
          if (draftId === 'draft-next') {
            return {
              id: 'draft-next',
              promptPackageId: 'pkg-next',
              studentId: 'student-bella',
              storageUri: 'memory://drafts/draft-next',
              createdBy: 'user-1',
              text: '# Next session draft',
              createdAt: now,
              updatedAt: now,
            };
          }
          return {
            id: 'draft-1',
            promptPackageId: 'pkg-1',
            studentId: 'student-alex',
            storageUri: 'memory://drafts/draft-1',
            createdBy: 'user-1',
            text: '# Original draft',
            createdAt: now,
            updatedAt: now,
          };
        });
        vi.mocked(api.updateDraft).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOlderAutosave = resolve;
            }),
        );
        vi.mocked(api.getRecording).mockImplementation(async (recordingId) =>
          makeRecording({
            recordingId,
            status: 'transcribed',
            transcriptId: recordingId === 'rec-next' ? 'tx-next' : 'tx-1',
            studentId: recordingId === 'rec-next' ? 'student-bella' : 'student-alex',
            displayName: `${recordingId}.mp3`,
          }),
        );
        vi.mocked(api.fetchRecordingTranscript).mockImplementation(async (recordingId) =>
          makeTranscript({
            recordingId,
            transcriptId: recordingId === 'rec-next' ? 'tx-next' : 'tx-1',
            text: recordingId === 'rec-next' ? 'Next session transcript' : 'Original transcript',
          }),
        );
        vi.mocked(api.fetchPromptPackage).mockImplementation(async (promptPackageId) => ({
          id: promptPackageId,
          recordingId: promptPackageId === 'pkg-next' ? 'rec-next' : 'rec-1',
          transcriptId: promptPackageId === 'pkg-next' ? 'tx-next' : 'tx-1',
          studentId: promptPackageId === 'pkg-next' ? 'student-bella' : 'student-alex',
          profilePath: null,
          templateVersion: 'v1',
          notes: null,
          storageUri: `memory://prompt/${promptPackageId}`,
          text: promptPackageId === 'pkg-next' ? 'Next session prompt' : 'Original prompt',
          createdAt: now,
          updatedAt: now,
        }));

        const user = createMinimalUser();
        globalThis.history.replaceState(null, '', '/?jobId=job-original');
        vi.mocked(api.listUserJobs).mockResolvedValue({
          jobs: [
            makeJobStatus({
              jobId: 'job-original',
              studentId: 'student-alex',
              recordingId: 'rec-1',
              transcriptId: 'tx-1',
              promptPackageId: 'pkg-1',
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
            jobId: 'job-original',
            studentId: 'student-alex',
            recordingId: 'rec-1',
            transcriptId: 'tx-1',
            promptPackageId: 'pkg-1',
            draftId: 'draft-1',
            state: 'succeeded',
          }),
        );
        renderMinimalAssignment();

        const draftTextarea = (await screen.findByDisplayValue(
          '# Original draft',
        )) as HTMLTextAreaElement;
        vi.useFakeTimers();
        fireEvent.change(draftTextarea, { target: { value: '# Older autosave' } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });
        expect(api.updateDraft).toHaveBeenCalledWith('draft-1', '# Older autosave');
        vi.useRealTimers();

        await user.click(screen.getByRole('button', { name: /Student/i }));
        await user.click(screen.getByRole('button', { name: /Change assignment/i }));
        const resumeList = await openResumeRoute(user);
        await user.click(within(resumeList).getByRole('radio', { name: /Bella/i }));
        await user.click(screen.getByRole('button', { name: /Continue assignment/i }));

        const nextDraftTextarea = (await screen.findByDisplayValue(
          '# Next session draft',
        )) as HTMLTextAreaElement;

        await act(async () => {
          resolveOlderAutosave({
            id: 'draft-1',
            promptPackageId: 'pkg-1',
            studentId: 'student-alex',
            storageUri: 'memory://drafts/draft-1',
            createdBy: 'user-1',
            text: '# Older autosave',
            createdAt: now,
            updatedAt: now,
          });
          await Promise.resolve();
        });

        expect(nextDraftTextarea.value).toBe('# Next session draft');
        expect(screen.queryByDisplayValue('# Older autosave')).toBeNull();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it('requires an explicit job selection before opening Review & share', async () => {
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          makeJobStatus({
            jobId: 'job-running',
            state: 'running',
            startedAt: now,
            finishedAt: null,
          }),
        ],
        total: 1,
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

      const user = createMinimalUser();
      renderMinimalAssignment();

      await waitFor(() => {
        expect(api.listUserJobs).toHaveBeenCalledTimes(1);
      });

      const resumeList = await openResumeRoute(user);
      expect(screen.queryByRole('button', { name: /Refresh recent work/i })).toBeNull();
      expect(
        (screen.getByRole('button', { name: /Continue assignment/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      await user.click(within(resumeList).getByRole('radio', { name: /Saved assignment/i }));
      await user.click(screen.getByRole('button', { name: /Review progress/i }));

      await waitFor(() => {
        expect(api.getJobStatus).toHaveBeenCalledWith('job-running');
      });
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
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: false,
            htmlUrl: null,
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
        publishTarget: 'html',
        ttsStrategy: 'auto',
        autoPublish: false,
        htmlUrl: null,
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
      expect(api.fetchJobProvenance).toHaveBeenCalledWith('job-resume');
      expect(screen.queryByRole('listbox', { name: /Recent assignments/i })).toBeNull();

      await user.click(screen.getByRole('button', { name: /Lesson source/i }));
      expect(await screen.findByDisplayValue('Recovered transcript')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /Create/i }));
      expect(await screen.findByDisplayValue('# Recovered draft')).toBeTruthy();
      vi.useFakeTimers();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(api.createAssignmentSession).not.toHaveBeenCalled();
      vi.useRealTimers();
      expect(screen.queryByRole('combobox', { name: /Learning preset/i })).toBeNull();
      resolveProfileOptions({ profiles: [{ id: 'profile-default.md', label: 'Default Profile' }] });
      expect(screen.getAllByText(/fetch failed/i).length).toBeGreaterThan(0);
      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));
      await waitFor(() => {
        expect(api.generateDraft).toHaveBeenCalledWith({
          promptPackageId: 'pkg-resume',
          provider: 'openai',
          model: 'gpt-5.2',
        });
      });

      globalThis.history.replaceState(null, '', '/');
    });

    it('clears stale session query params when starting a fresh assignment', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();
      const studentSelect = await openNewRoute(user);
      globalThis.history.replaceState(null, '', '/?sessionId=session-stale');
      await user.selectOptions(studentSelect, 'student-alex');
      await user.click(screen.getByRole('button', { name: /^Continue$/i }));

      expect(new URL(globalThis.location.href).searchParams.get('sessionId')).toBeNull();
      globalThis.history.replaceState(null, '', '/');
    });

    it('does not create a resumable session for learner selection alone', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      const studentSelect = (await openNewRoute(user)) as HTMLSelectElement;

      fireEvent.change(studentSelect, { target: { value: 'student-alex' } });
      expect(studentSelect.value).toBe('student-alex');
      await waitFor(() => {
        expect(api.createAssignmentSession).not.toHaveBeenCalled();
      });
      expect(api.updateAssignmentSession).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /Change choice/i }));
      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      expect(screen.getByText(/Selected for this assignment/i)).toBeTruthy();
      expect(api.createAssignmentSession).not.toHaveBeenCalled();
      expect(api.updateAssignmentSession).not.toHaveBeenCalled();
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
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: false,
            htmlUrl: null,
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
        publishTarget: 'html',
        ttsStrategy: 'auto',
        autoPublish: false,
        htmlUrl: null,
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

      expect(screen.queryByRole('combobox', { name: /Learning preset/i })).toBeNull();
    });

    it('clears resumed stale preset when preset catalog is empty and omits preset on publish', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
        presets: [],
        cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
        cefrDefault: 'B1',
        voiceAccents: ['american'],
        voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
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
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: false,
            htmlUrl: null,
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
        publishTarget: 'html',
        ttsStrategy: 'auto',
        autoPublish: false,
        htmlUrl: null,
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

      expect(screen.queryByRole('combobox', { name: /Learning preset/i })).toBeNull();

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
              publishTarget: 'html',
              ttsStrategy: 'auto',
              autoPublish: false,
              htmlUrl: null,
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
          publishTarget: 'html',
          ttsStrategy: 'auto',
          autoPublish: false,
          htmlUrl: null,
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
        expect(screen.getByRole('button', { name: /^Generate assignment$/i })).toBeTruthy();

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
          ttsStrategies: ['auto', 'dialogue', 'tts'],
          supportedActions: [],
        });

        await waitFor(() => {
          expect(api.fetchJobOptions).toHaveBeenCalled();
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
          ttsProvider: 'inworld',
          ttsStrategy: 'auto',
          ttsModel: 'inworld-tts-2',
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
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: false,
            htmlUrl: null,
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
        publishTarget: 'html',
        ttsStrategy: 'auto',
        autoPublish: false,
        htmlUrl: null,
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
      expect(screen.queryByRole('combobox', { name: /Learning preset/i })).toBeNull();

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
        ttsProvider: 'inworld',
        ttsStrategy: 'auto',
        ttsModel: 'inworld-tts-2',
      });
      expect(publishCall?.jobOverrides).not.toHaveProperty('preset');
    });
  });
}
