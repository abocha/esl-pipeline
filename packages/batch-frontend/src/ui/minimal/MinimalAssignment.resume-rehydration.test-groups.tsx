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
  renderMinimalAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testVi as vi,
  testWaitFor as waitFor,
  testWithin as within,
} from './MinimalAssignment.test-harness';
import {
  assignmentArtifact,
  makeAssignmentText,
  requestEnvelope,
  typedDraftFields,
} from './MinimalAssignment.typed-test-fixtures';

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
      expect(within(resumeList).getAllByRole('radio')).toHaveLength(4);
      expect(within(resumeList).getAllByRole('radio', { name: /Alex/i })).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: /2 versions/i }));
      expect(within(resumeList).getAllByRole('radio')).toHaveLength(5);
      expect(
        within(resumeList).getByRole('radio', { name: /Original.*Ready to share/i }),
      ).toBeTruthy();
      expect(screen.queryByText(/Audio refresh/i)).toBeNull();
      expect(screen.getAllByText(/Needs attention/i).length).toBeGreaterThan(0);
      expect(screen.queryByText(/job-reru/i)).toBeNull();
      expect(screen.queryByText(/gateway timeout/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /Show older assignments/i })).toBeNull();
    });

    it('requests another bounded page only after the first four lineages are revealed', async () => {
      const user = createMinimalUser();
      const initialJobs = Array.from({ length: 4 }, (_, index) =>
        makeJobStatus({
          jobId: `job-page-${index + 1}`,
          studentId: index === 0 ? 'student-alex' : 'student-default',
          state: 'succeeded',
          finishedAt: new Date(Date.parse(now) - index * 60_000).toISOString(),
        }),
      );
      vi.mocked(api.listUserJobs)
        .mockResolvedValueOnce({ jobs: initialJobs, total: 6, limit: 20, offset: 0 })
        .mockResolvedValueOnce({
          jobs: [
            makeJobStatus({
              jobId: 'job-page-5',
              studentId: 'student-default',
              state: 'succeeded',
              finishedAt: new Date(Date.parse(now) - 5 * 60_000).toISOString(),
            }),
          ],
          total: 6,
          limit: 20,
          offset: 4,
        });

      renderMinimalAssignment();
      const resumeList = await openResumeRoute(user);
      expect(within(resumeList).getAllByRole('radio')).toHaveLength(4);

      await user.click(screen.getByRole('button', { name: /Show older assignments/i }));
      await waitFor(() =>
        expect(api.listUserJobs).toHaveBeenLastCalledWith({ limit: 20, offset: 4 }),
      );
      await waitFor(() => expect(within(resumeList).getAllByRole('radio')).toHaveLength(5));
      expect(screen.getByRole('button', { name: /Load more/i })).toBeTruthy();
    });

    it('preserves loaded lineages and offers a retry when older loading fails', async () => {
      const user = createMinimalUser();
      const initialJobs = Array.from({ length: 4 }, (_, index) =>
        makeJobStatus({
          jobId: `job-retry-${index + 1}`,
          state: 'succeeded',
          finishedAt: new Date(Date.parse(now) - index * 60_000).toISOString(),
        }),
      );
      vi.mocked(api.listUserJobs)
        .mockResolvedValueOnce({ jobs: initialJobs, total: 5, limit: 20, offset: 0 })
        .mockRejectedValueOnce(new Error('Older assignments are temporarily unavailable'));

      renderMinimalAssignment();
      const resumeList = await openResumeRoute(user);
      await user.click(screen.getByRole('button', { name: /Show older assignments/i }));

      expect(within(resumeList).getAllByRole('radio')).toHaveLength(4);
      expect(await screen.findByText('Older assignments are temporarily unavailable')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });

    it('shows unfinished assignment sessions beside publish jobs', async () => {
      const user = createMinimalUser();
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [
          makeAssignmentSession({
            id: 'session-draft',
            studentId: 'student-alex',
            confirmedStep: 'context',
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
      expect(screen.getByText(/Step 4 · Create/i)).toBeTruthy();
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
            confirmedStep: 'create',
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
      expect(api.confirmStudentAssignmentSession).not.toHaveBeenCalled();
      expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
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
            confirmedStep: 'create',
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
        requestEnvelope,
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
        ...typedDraftFields(makeAssignmentText('# Session draft')),
        id: 'draft-session',
        promptPackageId: 'pkg-session',
        studentId: 'student-alex',
        storageUri: 'memory://drafts/draft-session',
        createdBy: 'user-1',
        text: makeAssignmentText('# Session draft'),
        workingVersion: 1,
        contentHash: 'a'.repeat(64),
        createdAt: now,
        updatedAt: now,
      });

      const user = createMinimalUser();
      globalThis.history.replaceState(null, '', '/?sessionId=session-resume');
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Lesson source/i }));
      expect(await screen.findByDisplayValue('Session transcript')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /Create/i }));
      expect(await screen.findByText('Session draft')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      expect(((await screen.findByLabelText(/Teacher notes/i)) as HTMLTextAreaElement).value).toBe(
        'Remember the travel vocab.',
      );
      expect(screen.queryByRole('combobox', { name: /Learning preset/i })).toBeNull();
      vi.useFakeTimers();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(api.confirmStudentAssignmentSession).not.toHaveBeenCalled();
      expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
      vi.useRealTimers();

      vi.useFakeTimers();
      const teacherNotesInput = screen.getByRole('textbox', { name: /Teacher notes/i });
      fireEvent.change(teacherNotesInput, {
        target: { value: 'Remember the travel vocab. Add pronunciation contrast.' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledWith(
        'session-resume',
        expect.objectContaining({
          patch: expect.objectContaining({
            teacherNotes: 'Remember the travel vocab. Add pronunciation contrast.',
          }),
        }),
      );
      vi.useRealTimers();
      expect(api.getJobStatus).not.toHaveBeenCalled();
    });

    it('offers replacement after a failed upload resumes and keeps passive hydration write-free', async () => {
      const session = makeAssignmentSession({
        id: 'session-failed-upload',
        studentId: 'student-alex',
        recordingId: 'rec-failed',
        confirmedStep: 'student',
      });
      vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
      const failed = makeRecording({
        recordingId: 'rec-failed',
        studentId: 'student-alex',
        displayName: 'failed.mp3',
        status: 'failed',
      });
      const replacement = makeRecording({
        recordingId: 'rec-replacement',
        studentId: 'student-alex',
        displayName: 'replacement.mp3',
        status: 'transcribed',
        transcriptId: 'tx-replacement',
      });
      vi.mocked(api.uploadRecording).mockResolvedValue(replacement);
      vi.mocked(api.getRecording).mockImplementation(async (id) =>
        id === replacement.recordingId ? replacement : failed,
      );
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(
        makeTranscript({ recordingId: replacement.recordingId, transcriptId: 'tx-replacement' }),
      );

      const user = createMinimalUser();
      globalThis.history.replaceState(null, '', '/?sessionId=session-failed-upload');
      renderMinimalAssignment();

      expect(await screen.findByText(/Recording: failed\.mp3/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Replace audio/i })).toBeTruthy();
      vi.useFakeTimers();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
      expect(api.attachAssignmentSource).not.toHaveBeenCalled();
      vi.useRealTimers();

      await user.click(screen.getByRole('button', { name: /Replace audio/i }));
      expect(screen.getByRole('button', { name: /Drop replacement audio/i })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Drop replacement audio/i }));
      await waitFor(() =>
        expect(api.attachAssignmentSource).toHaveBeenCalledWith(
          'session-failed-upload',
          expect.objectContaining({
            recordingId: 'rec-replacement',
            transcriptId: 'tx-replacement',
          }),
        ),
      );
    });

    it('does not offer replacement after Share reserves an unfinished session', async () => {
      vi.mocked(api.fetchAssignmentSession).mockResolvedValue(
        makeAssignmentSession({
          id: 'session-sharing',
          studentId: 'student-alex',
          recordingId: 'rec-failed',
          confirmedStep: 'student',
          shareJobId: 'job-sharing',
        }),
      );
      vi.mocked(api.getRecording).mockResolvedValue(
        makeRecording({
          recordingId: 'rec-failed',
          studentId: 'student-alex',
          status: 'failed',
        }),
      );

      globalThis.history.replaceState(null, '', '/?sessionId=session-sharing');
      renderMinimalAssignment();

      expect(await screen.findByText(/Recording: lesson\.mp3/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Replace audio/i })).toBeNull();
    });

    it('rehydrates trusted split topology and the persisted Deepgram transcript engine', async () => {
      const session = makeAssignmentSession({
        id: 'session-trusted-source',
        studentId: 'student-alex',
        recordingId: 'rec-trusted',
        transcriptId: 'tx-trusted',
        confirmedStep: 'context',
      });
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [session],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
      vi.mocked(api.getRecording).mockResolvedValue(
        makeRecording({
          recordingId: 'rec-trusted',
          transcriptId: 'tx-trusted',
          studentId: 'student-alex',
          status: 'transcribed',
          audioTopology: 'trusted_split_channels',
        }),
      );
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(
        makeTranscript({
          recordingId: 'rec-trusted',
          transcriptId: 'tx-trusted',
          sttProvider: 'deepgram',
        }),
      );

      globalThis.history.replaceState(null, '', '/?sessionId=session-trusted-source');
      renderMinimalAssignment();

      await waitFor(() => expect(api.getRecording).toHaveBeenCalledWith('rec-trusted'));
      await (await createMinimalUser()).click(
        screen.getByRole('button', { name: /Lesson source/i }),
      );
      expect(await screen.findByText('Audio source: Trusted OBS split')).toBeTruthy();
      expect(screen.getByText('Transcript engine: Deepgram')).toBeTruthy();
    });

    it('rehydrates ordinary mixed topology and the persisted ElevenLabs transcript engine', async () => {
      const session = makeAssignmentSession({
        id: 'session-mixed-source',
        studentId: 'student-alex',
        recordingId: 'rec-mixed',
        transcriptId: 'tx-mixed',
        confirmedStep: 'context',
      });
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [session],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
      vi.mocked(api.getRecording).mockResolvedValue(
        makeRecording({
          recordingId: 'rec-mixed',
          transcriptId: 'tx-mixed',
          studentId: 'student-alex',
          status: 'transcribed',
          audioTopology: 'mixed_recording',
        }),
      );
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(
        makeTranscript({
          recordingId: 'rec-mixed',
          transcriptId: 'tx-mixed',
          sttProvider: 'elevenlabs',
        }),
      );

      globalThis.history.replaceState(null, '', '/?sessionId=session-mixed-source');
      renderMinimalAssignment();

      await waitFor(() => expect(api.getRecording).toHaveBeenCalledWith('rec-mixed'));
      await (await createMinimalUser()).click(
        screen.getByRole('button', { name: /Lesson source/i }),
      );
      expect(await screen.findByText('Audio source: Ordinary recording')).toBeTruthy();
      expect(screen.getByText('Transcript engine: ElevenLabs')).toBeTruthy();
    });

    it('follows the backend canonical session when a partial duplicate is resumed', async () => {
      const duplicateSession = makeAssignmentSession({
        id: 'session-duplicate',
        studentId: 'student-alex',
        transcriptId: 'tx-session',
        confirmedStep: 'student',
      });
      const canonicalSession = makeAssignmentSession({
        id: 'session-canonical',
        studentId: 'student-alex',
        recordingId: 'rec-session',
        transcriptId: 'tx-session',
        confirmedStep: 'source',
      });
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [duplicateSession],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(canonicalSession);
      vi.mocked(api.getRecording).mockResolvedValue(
        makeRecording({
          recordingId: 'rec-session',
          transcriptId: 'tx-session',
          studentId: 'student-alex',
          status: 'transcribed',
        }),
      );
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(
        makeTranscript({
          recordingId: 'rec-session',
          transcriptId: 'tx-session',
          text: 'Canonical transcript',
        }),
      );

      globalThis.history.replaceState(null, '', '/?sessionId=session-duplicate');
      renderMinimalAssignment();

      await waitFor(() =>
        expect(new URL(globalThis.location.href).searchParams.get('sessionId')).toBe(
          'session-canonical',
        ),
      );
      expect(api.fetchAssignmentSession).toHaveBeenCalledWith('session-duplicate');
      expect(await screen.findByRole('heading', { name: /Add teaching context/i })).toBeTruthy();
    });

    it('replaces a resumed draft whose prompt lineage is stale before Create confirmation', async () => {
      const mismatchedSession = makeAssignmentSession({
        id: 'session-mismatched-draft',
        studentId: 'student-alex',
        recordingId: 'rec-session',
        transcriptId: 'tx-session',
        promptPackageId: 'pkg-current',
        draftId: 'draft-stale',
        confirmedStep: 'context',
      });
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [mismatchedSession],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.fetchPromptPackage).mockResolvedValueOnce({
        requestEnvelope,
        id: 'pkg-current',
        recordingId: 'rec-session',
        transcriptId: 'tx-session',
        studentId: 'student-alex',
        profilePath: null,
        templateVersion: 'v1',
        notes: null,
        storageUri: 'memory://prompt/pkg-current',
        text: 'Current prompt',
        createdAt: now,
        updatedAt: now,
      });
      vi.mocked(api.fetchDraft).mockResolvedValueOnce({
        ...typedDraftFields(makeAssignmentText('# Stale draft')),
        id: 'draft-stale',
        promptPackageId: 'pkg-old',
        studentId: 'student-alex',
        storageUri: 'memory://drafts/draft-stale',
        createdBy: 'user-1',
        text: makeAssignmentText('# Stale draft'),
        workingVersion: 1,
        contentHash: 'a'.repeat(64),
        createdAt: now,
        updatedAt: now,
      });

      globalThis.history.replaceState(null, '', '/?sessionId=session-mismatched-draft');
      const user = createMinimalUser();
      renderMinimalAssignment();

      await screen.findByText('Stale draft');
      vi.mocked(api.createDraft).mockClear();
      vi.mocked(api.updateDraft).mockClear();
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));

      await waitFor(() =>
        expect(api.createDraft).toHaveBeenCalledWith(
          'pkg-current',
          makeAssignmentText('# Stale draft'),
        ),
      );
      expect(api.updateDraft).not.toHaveBeenCalled();
    });

    it('uses backend profile lineage when a resumed Context has partial local lineage', async () => {
      const user = createMinimalUser();
      const partialSession = makeAssignmentSession({
        id: 'session-partial-profile',
        studentId: 'student-alex',
        recordingId: 'rec-session',
        transcriptId: 'tx-session',
        confirmedStep: 'source',
        selectedProfileId: 'profiles/alex.md',
        selectedProfileRevisionId: null,
        selectedProfileRevisionHash: null,
      });
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [partialSession],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.fetchAssignmentSession).mockResolvedValue(partialSession);
      vi.mocked(api.getRecording).mockResolvedValue(
        makeRecording({
          recordingId: 'rec-session',
          status: 'transcribed',
          transcriptId: 'tx-session',
          studentId: 'student-alex',
        }),
      );
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(
        makeTranscript({
          recordingId: 'rec-session',
          transcriptId: 'tx-session',
          text: 'Session transcript',
        }),
      );
      let resolveLearnerContext!: (value: ApiTypes.AssignmentLearnerContext) => void;
      vi.mocked(api.fetchAssignmentLearnerContext).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLearnerContext = resolve;
          }),
      );

      globalThis.history.replaceState(null, '', '/?sessionId=session-partial-profile');
      renderMinimalAssignment();

      await screen.findByRole('heading', { name: /Add teaching context/i });
      const continueButton = screen.getByRole('button', { name: /Confirm and continue/i });
      await waitFor(() => expect((continueButton as HTMLButtonElement).disabled).toBe(true));
      vi.mocked(api.updateAssignmentSessionRecovery).mockClear();

      vi.useFakeTimers();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
      vi.useRealTimers();

      await act(async () => {
        resolveLearnerContext({
          assignmentSessionId: partialSession.id,
          studentId: partialSession.studentId,
          source: {
            recordingId: partialSession.confirmed.source!.recordingId,
            transcriptId: partialSession.confirmed.source!.transcriptId,
            transcriptHash: partialSession.confirmed.source!.transcriptHash,
          },
          eligibility: 'already_enriched',
          state: 'not_applicable',
          operationState: null,
          profile: {
            studentId: 'student-alex',
            revisionId: 'revision-active',
            revisionHash: 'b'.repeat(64),
            content: 'PROFILE CONTENT',
            structuredContent: null,
            updatedAt: now,
          },
          pinned: null,
          confirmationAvailable: true,
          warning: null,
        });
      });
      expect((continueButton as HTMLButtonElement).disabled).toBe(false);
      expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
      await user.click(continueButton);
      expect(api.confirmAssignmentSessionStep).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          step: 'context',
          profileRevisionId: 'revision-active',
          profileRevisionHash: 'b'.repeat(64),
        }),
      );
    });

    it('keeps confirmed profile lineage authoritative while student options load', async () => {
      const confirmedProfile = {
        profileId: 'profiles/alex.md',
        profileRevisionId: 'revision-confirmed',
        profileRevisionHash: 'c'.repeat(64),
      };
      const resumedSession = makeAssignmentSession({
        id: 'session-confirmed-profile-refresh',
        studentId: 'student-alex',
        recordingId: 'rec-session',
        transcriptId: 'tx-session',
        confirmedStep: 'context',
        teacherNotes: 'Keep the examples practical.',
        selectedProfileId: null,
        selectedProfileRevisionId: null,
        selectedProfileRevisionHash: null,
      });
      resumedSession.confirmed.context = {
        teacherNotes: 'Keep the examples practical.',
        ...confirmedProfile,
      };
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [resumedSession],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.fetchAssignmentSession).mockResolvedValue(resumedSession);
      vi.mocked(api.fetchStudentOptions).mockImplementation(() => new Promise(() => {}));
      vi.mocked(api.getRecording).mockResolvedValue(
        makeRecording({
          recordingId: 'rec-session',
          status: 'transcribed',
          transcriptId: 'tx-session',
          studentId: 'student-alex',
        }),
      );
      vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(
        makeTranscript({
          recordingId: 'rec-session',
          transcriptId: 'tx-session',
          text: 'Session transcript',
        }),
      );
      vi.mocked(api.getProfileContent).mockResolvedValueOnce({
        studentId: resumedSession.studentId,
        content: 'PROFILE CONTENT',
        structuredContent: {
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B1',
          primaryGoals: ['Lead project updates clearly.'],
          communicationContexts: ['Weekly team syncs.'],
          interestsAndUsefulThemes: [],
          stableStrengths: [],
          persistentChallenges: [],
          studyPreferences: [],
          durableConstraints: [],
          teacherNotes: null,
        },
        currentRevisionId: confirmedProfile.profileRevisionId,
        updatedAt: now,
      });

      globalThis.history.replaceState(null, '', '/?sessionId=session-confirmed-profile-refresh');
      renderMinimalAssignment();

      await screen.findByRole('heading', { name: /Add teaching context/i });
      await waitFor(() =>
        expect(api.getProfileContent).toHaveBeenCalledWith(resumedSession.studentId),
      );
      expect(
        screen.queryByRole('button', { name: /Populate first profile from lesson/i }),
      ).toBeNull();
      expect(screen.queryByText(/^First profile setup$/i)).toBeNull();
      expect(
        (screen.getByRole('button', { name: /Confirm and continue/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);

      vi.mocked(api.updateAssignmentSessionRecovery).mockClear();
      vi.useFakeTimers();
      fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
        target: { value: 'Keep the examples practical and add a pronunciation contrast.' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledWith(
        'session-confirmed-profile-refresh',
        expect.objectContaining({
          patch: {
            teacherNotes: 'Keep the examples practical and add a pronunciation contrast.',
            selectedProfileRevisionId: confirmedProfile.profileRevisionId,
            selectedProfileRevisionHash: confirmedProfile.profileRevisionHash,
          },
        }),
      );
      vi.useRealTimers();
    });

    it('persists a pasted transcript as a user edit after session hydration', async () => {
      const user = createMinimalUser();
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [
          makeAssignmentSession({
            id: 'session-resume',
            studentId: 'student-alex',
            confirmedStep: 'student',
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
      vi.mocked(api.updateAssignmentSessionRecovery).mockImplementation(async (id, patch) =>
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
      await user.click(screen.getByRole('button', { name: /Use transcript/i }));

      await waitFor(() => {
        expect(api.createManualTranscriptSource).toHaveBeenCalledWith({
          studentId: 'student-alex',
          text: 'Tutor supplied transcript',
          displayName: 'Pasted lesson transcript',
        });
      });
      await waitFor(() => {
        expect(api.attachAssignmentSource).toHaveBeenCalledWith(
          'session-resume',
          expect.objectContaining({ recordingId: 'rec-manual', transcriptId: 'tx-manual' }),
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
            confirmedStep: 'create',
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
        requestEnvelope,
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

      const _user = createMinimalUser();
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
          ...typedDraftFields(makeAssignmentText('# Stale draft')),
          id: 'draft-stale',
          promptPackageId: 'pkg-stale',
          studentId: 'student-alex',
          storageUri: 'memory://drafts/draft-stale',
          createdBy: 'user-1',
          text: makeAssignmentText('# Stale draft'),
          workingVersion: 1,
          contentHash: 'b'.repeat(64),
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
              confirmedStep: 'create',
            }),
          ],
          total: 1,
          limit: 20,
        });
        vi.mocked(api.fetchDraft).mockImplementation(async (draftId) => {
          if (draftId === 'draft-next') {
            return {
              ...typedDraftFields(makeAssignmentText('# Next session draft')),
              id: 'draft-next',
              promptPackageId: 'pkg-next',
              studentId: 'student-bella',
              storageUri: 'memory://drafts/draft-next',
              createdBy: 'user-1',
              text: makeAssignmentText('# Next session draft'),
              workingVersion: 1,
              contentHash: 'c'.repeat(64),
              createdAt: now,
              updatedAt: now,
            };
          }
          return {
            ...typedDraftFields(makeAssignmentText('# Original draft')),
            id: 'draft-1',
            promptPackageId: 'pkg-1',
            studentId: 'student-alex',
            storageUri: 'memory://drafts/draft-1',
            createdBy: 'user-1',
            text: makeAssignmentText('# Original draft'),
            workingVersion: 1,
            contentHash: 'd'.repeat(64),
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
          requestEnvelope,
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
        vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(
          makeAssignmentSession({
            id: 'session-original',
            studentId: 'student-alex',
            recordingId: 'rec-1',
            transcriptId: 'tx-1',
            promptPackageId: 'pkg-1',
            draftId: 'draft-1',
            confirmedStep: 'create',
          }),
        );

        const user = createMinimalUser();
        globalThis.history.replaceState(null, '', '/?sessionId=session-original');
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

        const draftTitle = await screen.findByText('Original draft');
        vi.useFakeTimers();
        draftTitle.textContent = 'Older autosave';
        fireEvent.input(draftTitle);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });
        expect(api.updateDraft).toHaveBeenCalledWith('draft-1', expect.any(String), 1);
        expect(JSON.parse(vi.mocked(api.updateDraft).mock.calls[0]![1]).metadata.title).toBe(
          'Older autosave',
        );
        vi.useRealTimers();

        await user.click(screen.getByRole('button', { name: /Student/i }));
        await user.click(screen.getByRole('button', { name: /Change assignment/i }));
        const resumeList = await openResumeRoute(user);
        await user.click(within(resumeList).getByRole('radio', { name: /Bella/i }));
        await user.click(screen.getByRole('button', { name: /Continue assignment/i }));

        const nextDraftTitle = await screen.findByText('Next session draft');

        await act(async () => {
          resolveOlderAutosave({
            ...typedDraftFields(makeAssignmentText('# Older autosave')),
            id: 'draft-1',
            promptPackageId: 'pkg-1',
            studentId: 'student-alex',
            storageUri: 'memory://drafts/draft-1',
            createdBy: 'user-1',
            text: makeAssignmentText('# Older autosave'),
            workingVersion: 2,
            contentHash: 'e'.repeat(64),
            createdAt: now,
            updatedAt: now,
          });
          await Promise.resolve();
        });

        expect(nextDraftTitle.textContent).toBe('Next session draft');
        expect(screen.queryByText('Older autosave')).toBeNull();
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

    it('opens server job context as immutable historical output', async () => {
      const _user = createMinimalUser();
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          {
            assignmentArtifact,
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
        assignmentArtifact,
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
        requestEnvelope,
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
        ...typedDraftFields(makeAssignmentText('# Recovered draft')),
        id: 'draft-resume',
        promptPackageId: 'pkg-resume',
        studentId: null,
        storageUri: 'memory://drafts/draft-resume',
        createdBy: 'user-1',
        text: makeAssignmentText('# Recovered draft'),
        workingVersion: 1,
        contentHash: 'f'.repeat(64),
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

      expect(
        (screen.getByRole('button', { name: /Lesson source/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect((screen.getByRole('button', { name: /Create/i }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(api.confirmStudentAssignmentSession).not.toHaveBeenCalled();
      expect(screen.queryByRole('combobox', { name: /Learning preset/i })).toBeNull();
      expect(screen.getAllByText(/fetch failed/i).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: /^Generate assignment$/i })).toBeNull();
      expect(api.generateDraft).not.toHaveBeenCalled();

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
        expect(api.confirmStudentAssignmentSession).not.toHaveBeenCalled();
      });
      expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /Change choice/i }));
      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      expect(screen.getByText(/Selected for this assignment/i)).toBeTruthy();
      expect(api.confirmStudentAssignmentSession).not.toHaveBeenCalled();
      expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
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
            assignmentArtifact,
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
        assignmentArtifact,
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

    it('keeps completed output immutable when its preset catalog is empty', async () => {
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
            assignmentArtifact,
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
        assignmentArtifact,
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
      expect(screen.queryByRole('button', { name: /Share assignment/i })).toBeNull();
      expect(api.materializeDraft).not.toHaveBeenCalled();
    });

    it(
      'keeps completed output immutable while preset options load',
      async () => {
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
              assignmentArtifact,
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
          assignmentArtifact,
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
        expect(
          (screen.getByRole('button', { name: /Create/i }) as HTMLButtonElement).disabled,
        ).toBe(true);
        expect(screen.queryByRole('button', { name: /Share assignment/i })).toBeNull();
        expect(api.materializeDraft).not.toHaveBeenCalled();

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
        expect(screen.queryByRole('button', { name: /Share assignment/i })).toBeNull();
        expect(api.materializeDraft).not.toHaveBeenCalled();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it('does not reopen completed output after learning preset normalization', async () => {
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
            assignmentArtifact,
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
        assignmentArtifact,
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
      expect(screen.queryByRole('button', { name: /Share assignment/i })).toBeNull();
      expect(api.materializeDraft).not.toHaveBeenCalled();
    });
  });
}
