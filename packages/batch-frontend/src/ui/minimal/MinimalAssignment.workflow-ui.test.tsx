// @vitest-environment jsdom
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it } from 'vitest';

import {
  testAct as act,
  testApi as api,
  createMinimalUser,
  testExpect as expect,
  INTEGRATION_TEST_TIMEOUT_MS,
  makeAssignmentSession,
  makeJobStatus,
  makeRecording,
  makeTranscript,
  openAdvancedActions,
  preparePromptReady,
  previewCurrentDraft,
  renderMinimalAssignment,
  renderMinimalAssignmentWithNavigationGuard,
  renderPreviewReadyAssignment,
  renderPublishedAssignment,
  renderResumedAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testVi as vi,
  testWaitFor as waitFor,
  testWithin as within,
} from './MinimalAssignment.test-harness';
import { getTranscriptUnexpectedCharacterWarnings } from './MinimalAssignment.transcript-warnings';

describe('MinimalAssignment - staged workflow UI', () => {
  beforeEach(() => {
    setupMinimalAssignmentTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps inactive workflow steps mounted but removes them from the accessibility tree', () => {
    renderMinimalAssignment();

    const studentMount = document.querySelector<HTMLElement>(
      '.assignment-workflow__step-mount[data-active="true"]',
    );
    const sourceMount = document.querySelector<HTMLElement>(
      '.assignment-workflow__step-mount[data-active="false"]',
    );

    expect(studentMount?.hasAttribute('hidden')).toBe(false);
    expect(studentMount?.hasAttribute('inert')).toBe(false);
    expect(sourceMount?.hasAttribute('hidden')).toBe(true);
    expect(sourceMount?.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('heading', { name: /Add lesson source/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Start new assignment/i })).toBeTruthy();
  });

  it('keeps Step 1 unselected until New Continue explicitly commits a current learner', async () => {
    const user = createMinimalUser();
    renderMinimalAssignment();

    expect(screen.getByRole('button', { name: 'Resume recent work' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start new assignment' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirm and continue/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Start new assignment' }));
    await screen.findByRole('option', { name: 'Alex' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Choose learner/i }),
      'student-alex',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: /Add lesson source/i })).toBeTruthy();
    expect(screen.getByText('Student selected. Recording needed.')).toBeTruthy();
  });

  it('flags Spanish-looking accent characters in transcript text', () => {
    expect(getTranscriptUnexpectedCharacterWarnings('Student: Ajá, I understand.')).toEqual(['á']);
    expect(getTranscriptUnexpectedCharacterWarnings('Teacher: Ага, good.')).toEqual([]);
  });

  it('rebases one non-overlapping recovery conflict without losing local notes', async () => {
    const { user } = await renderResumedAssignment({}, { waitFor: 'none' });
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));

    const latest = makeAssignmentSession({
      id: 'session-resumed',
      studentId: 'student-alex',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      confirmedStep: 'context',
      selectedTtsModel: 'remote-model',
      revision: 2,
    });
    const saved = makeAssignmentSession({
      ...latest,
      teacherNotes: 'Keep the tutor note.',
      revision: 3,
    });
    vi.mocked(api.updateAssignmentSessionRecovery)
      .mockRejectedValueOnce(new api.AssignmentSessionConflictApiError(latest))
      .mockResolvedValueOnce(saved);

    vi.useFakeTimers();
    fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
      target: { value: 'Keep the tutor note.' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    vi.useRealTimers();

    expect(api.updateAssignmentSessionRecovery).toHaveBeenNthCalledWith(
      1,
      'session-resumed',
      expect.objectContaining({ expectedRevision: 1 }),
    );
    expect(api.updateAssignmentSessionRecovery).toHaveBeenNthCalledWith(
      2,
      'session-resumed',
      expect.objectContaining({
        expectedRevision: 2,
        patch: expect.objectContaining({ teacherNotes: 'Keep the tutor note.' }),
      }),
    );
    expect(
      (screen.getByRole('textbox', { name: /Teacher notes/i }) as HTMLTextAreaElement).value,
    ).toBe('Keep the tutor note.');
  });

  it('adopts the winning transcript CAS base without discarding the losing local text', async () => {
    const { user } = await renderResumedAssignment({}, { waitFor: 'none' });
    await user.click(screen.getByRole('button', { name: /Lesson source/i }));
    const editor = screen.getByRole('textbox', { name: /Transcript text/i });
    const latest = {
      ...makeRecording({ recordingId: 'rec-1' }),
      ...{
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        text: 'Remote winning transcript',
        summaryJson: null,
        sttProvider: 'deepgram' as const,
        model: 'nova-3',
        language: 'en',
        mode: 'timeline' as const,
        workingVersion: 2,
        contentHash: 'f'.repeat(64),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    vi.mocked(api.updateRecordingTranscript).mockRejectedValueOnce(
      new api.ArtifactWorkingConflictApiError({
        workingVersion: 2,
        contentHash: latest.contentHash,
      }),
    );
    vi.mocked(api.fetchRecordingTranscript).mockResolvedValueOnce(latest);

    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: 'My local transcript' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    vi.useRealTimers();

    await waitFor(() => expect(api.fetchRecordingTranscript).toHaveBeenCalledWith('rec-1'));
    expect((editor as HTMLTextAreaElement).value).toBe('My local transcript');
    expect(screen.getByText(/Newer saved artifact content was found/i)).toBeTruthy();
  });

  it('adopts the winning draft CAS base without discarding the losing local text', async () => {
    const { user } = await renderPreviewReadyAssignment();
    await user.click(screen.getByRole('button', { name: /Create/i }));
    const editor = screen.getByRole('textbox', { name: /Draft markdown/i });
    const latest = {
      id: 'draft-1',
      promptPackageId: 'pkg-1',
      studentId: 'student-alex',
      storageUri: 'memory://drafts/draft-1/remote',
      createdBy: 'user-1',
      text: '# Remote winning draft',
      workingVersion: 2,
      contentHash: 'e'.repeat(64),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(api.updateDraft).mockRejectedValueOnce(
      new api.ArtifactWorkingConflictApiError({
        workingVersion: 2,
        contentHash: latest.contentHash,
      }),
    );
    vi.mocked(api.fetchDraft).mockResolvedValueOnce(latest);

    fireEvent.change(editor, { target: { value: '# My local draft' } });
    await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));

    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledWith('draft-1'));
    expect((editor as HTMLTextAreaElement).value).toBe('# My local draft');
    expect(screen.getByText(/Newer saved artifact content was found/i)).toBeTruthy();
  });

  it('sends one Context recovery PATCH for one edit across repeated debounce windows', async () => {
    const { user } = await renderResumedAssignment({}, { waitFor: 'none' });
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    vi.mocked(api.updateAssignmentSessionRecovery).mockClear();

    vi.useFakeTimers();
    fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
      target: { value: 'One local Context edit.' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500);
    });

    expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledTimes(1);
  });

  it('reuses the Student confirmation request ID after a lost-response retry', async () => {
    const user = createMinimalUser();
    vi.mocked(api.confirmStudentAssignmentSession)
      .mockRejectedValueOnce(new Error('response lost'))
      .mockImplementationOnce(async (request) =>
        makeAssignmentSession({
          studentId: request.studentId,
          lessonId: request.lessonId ?? null,
          confirmedStep: 'student',
        }),
      );
    renderMinimalAssignment();

    await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
    await screen.findByRole('option', { name: 'Alex' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Choose learner/i }),
      'student-alex',
    );
    await user.click(screen.getByRole('button', { name: /^Continue$/i }));
    await screen.findByText('Saving needs attention');

    const firstRequestId = vi.mocked(api.confirmStudentAssignmentSession).mock.calls[0]?.[0]
      .requestId;
    await user.click(screen.getByRole('button', { name: /^Continue$/i }));
    await waitFor(() => expect(api.confirmStudentAssignmentSession).toHaveBeenCalledTimes(2));
    const retriedRequestId = vi.mocked(api.confirmStudentAssignmentSession).mock.calls[1]?.[0]
      .requestId;

    expect(retriedRequestId).toBe(firstRequestId);
  });

  it('keeps exit safety pending until the final queued session mutation settles', async () => {
    type Session = ReturnType<typeof makeAssignmentSession>;
    let resolveFirst: (session: Session) => void = () => {};
    let resolveSecond: (session: Session) => void = () => {};
    const firstResponse = new Promise<Session>((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = new Promise<Session>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(api.updateAssignmentSessionRecovery)
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => secondResponse);

    const { user } = await renderResumedAssignment({}, { waitFor: 'none' });
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    vi.useFakeTimers();

    const notes = screen.getByRole('textbox', { name: /Teacher notes/i });
    fireEvent.change(notes, { target: { value: 'First queued edit.' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledTimes(1);

    fireEvent.change(notes, { target: { value: 'Second queued edit.' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    const beforeFirstSettles = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(beforeFirstSettles);
    expect(beforeFirstSettles.defaultPrevented).toBe(true);

    await act(async () => {
      resolveFirst(
        makeAssignmentSession({
          id: 'session-resumed',
          studentId: 'student-alex',
          teacherNotes: 'First queued edit.',
          revision: 2,
        }),
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledTimes(2));

    const whileSecondPending = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(whileSecondPending);

    await act(async () => {
      resolveSecond(
        makeAssignmentSession({
          id: 'session-resumed',
          studentId: 'student-alex',
          teacherNotes: 'Second queued edit.',
          revision: 3,
        }),
      );
      await Promise.resolve();
    });
    await screen.findByText('All changes saved');
    const afterSecondSettles = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(afterSecondSettles);

    expect(whileSecondPending.defaultPrevented).toBe(true);
    expect(afterSecondSettles.defaultPrevented).toBe(false);
  });

  it('recognizes a successful confirmation after its response is lost', async () => {
    const { user } = await renderResumedAssignment({}, { waitFor: 'none' });
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    vi.mocked(api.confirmAssignmentSessionStep).mockRejectedValueOnce(new Error('response lost'));
    vi.mocked(api.fetchAssignmentSession).mockImplementationOnce(async () => {
      const request = vi.mocked(api.confirmAssignmentSessionStep).mock.calls.at(-1)?.[1];
      if (!request || request.step !== 'context') {
        throw new Error('Expected the Context confirmation request before reconciliation.');
      }
      return makeAssignmentSession({
        id: 'session-resumed',
        studentId: 'student-alex',
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        confirmedStep: 'context',
        teacherNotes: request.teacherNotes,
        selectedProfileId: request.profileId,
        selectedProfileRevisionId: request.profileRevisionId,
        selectedProfileRevisionHash: request.profileRevisionHash,
        revision: request.expectedRevision + 1,
      });
    });

    await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Create/i }).getAttribute('aria-current')).toBe(
        'step',
      ),
    );
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('guards browser exit when a confirmation response cannot be reconciled', async () => {
    const { user } = await renderResumedAssignment({}, { waitFor: 'none' });
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    vi.mocked(api.confirmAssignmentSessionStep).mockRejectedValueOnce(new Error('response lost'));
    vi.mocked(api.fetchAssignmentSession).mockRejectedValueOnce(new Error('offline'));

    await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
    await screen.findByText('Checking whether the change completed');

    const event = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('recovers completed Share from the linked session and job after response loss', async () => {
    const { user } = await renderPreviewReadyAssignment();
    const completed = makeAssignmentSession({
      id: 'session-resumed',
      studentId: 'student-alex',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      promptPackageId: 'pkg-1',
      draftId: 'draft-1',
      confirmedStep: 'share',
      shareJobId: 'job-share',
      revision: 4,
    });
    const linkedJob = makeJobStatus({ jobId: 'job-share', state: 'queued' });
    vi.mocked(api.shareAssignmentSession).mockRejectedValueOnce(new Error('response lost'));
    vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(completed);
    vi.mocked(api.getJobStatus).mockResolvedValueOnce(linkedJob);

    await user.click(screen.getByRole('button', { name: /Share assignment/i }));

    await waitFor(() => expect(api.getJobStatus).toHaveBeenCalledWith('job-share'));
    expect(screen.getAllByText(/Job ID: job-share/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Share assignment/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Lesson source/i }));
    expect(screen.queryByRole('textbox', { name: /Transcript text/i })).toBeNull();
  });

  it('resumes a reserved Share with the same stable request after response loss', async () => {
    const { user } = await renderPreviewReadyAssignment();
    const reserved = makeAssignmentSession({
      id: 'session-resumed',
      studentId: 'student-alex',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      promptPackageId: 'pkg-1',
      draftId: 'draft-1',
      confirmedStep: 'create',
      shareJobId: 'job-share',
      revision: 4,
    });
    const completed = makeAssignmentSession({ ...reserved, confirmedStep: 'share', revision: 5 });
    const linkedJob = makeJobStatus({ jobId: 'job-share', state: 'queued' });
    vi.mocked(api.shareAssignmentSession)
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ session: completed, job: linkedJob });
    vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(reserved);

    await user.click(screen.getByRole('button', { name: /Share assignment/i }));

    await waitFor(() => expect(api.shareAssignmentSession).toHaveBeenCalledTimes(2));
    const firstRequest = vi.mocked(api.shareAssignmentSession).mock.calls[0]?.[1];
    const secondRequest = vi.mocked(api.shareAssignmentSession).mock.calls[1]?.[1];
    expect(secondRequest?.requestId).toBe(firstRequest?.requestId);
    expect(screen.getAllByText(/Job ID: job-share/i).length).toBeGreaterThan(0);
  });

  it('resumes an already reserved Share with its stable job ID after remount', async () => {
    const reserved = makeAssignmentSession({
      id: 'session-reserved',
      studentId: 'student-alex',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      promptPackageId: 'pkg-1',
      draftId: 'draft-1',
      confirmedStep: 'create',
      shareJobId: 'job-share',
      revision: 4,
    });
    const completed = makeAssignmentSession({ ...reserved, confirmedStep: 'share', revision: 5 });
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(reserved);
    vi.mocked(api.fetchDraft).mockResolvedValue({
      id: 'draft-1',
      promptPackageId: 'pkg-1',
      studentId: 'student-alex',
      lessonId: null,
      storageUri: 'memory://drafts/confirmed',
      createdBy: 'user-1',
      text: '# Draft markdown',
      workingVersion: 1,
      contentHash: 'b'.repeat(64),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    globalThis.history.replaceState(null, '', '/?sessionId=session-reserved');

    vi.mocked(api.shareAssignmentSession).mockRejectedValue(new Error('offline'));
    const firstMount = renderMinimalAssignment();
    await waitFor(() => expect(api.shareAssignmentSession).toHaveBeenCalled());
    firstMount.unmount();
    const callsBeforeRemount = vi.mocked(api.shareAssignmentSession).mock.calls.length;

    vi.mocked(api.shareAssignmentSession)
      .mockReset()
      .mockResolvedValue({
        session: completed,
        job: makeJobStatus({ jobId: 'job-share', state: 'queued' }),
      });
    renderMinimalAssignment();

    await waitFor(() => expect(api.shareAssignmentSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.shareAssignmentSession).mock.calls[0]?.[1]).toMatchObject({
      requestId: 'job-share',
    });
    expect(callsBeforeRemount).toBeGreaterThan(0);
    expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalledWith(
      'session-reserved',
      expect.anything(),
    );
  });

  it('retries linked-job loading after a completed Share response is lost', async () => {
    const { user } = await renderPreviewReadyAssignment();
    const completed = makeAssignmentSession({
      id: 'session-resumed',
      studentId: 'student-alex',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      promptPackageId: 'pkg-1',
      draftId: 'draft-1',
      confirmedStep: 'share',
      shareJobId: 'job-share',
      revision: 4,
    });
    const linkedJob = makeJobStatus({ jobId: 'job-share', state: 'queued' });
    vi.mocked(api.shareAssignmentSession).mockRejectedValueOnce(new Error('response lost'));
    vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(completed);
    vi.mocked(api.getJobStatus)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(linkedJob);

    await user.click(screen.getByRole('button', { name: /Share assignment/i }));

    await waitFor(() => expect(api.getJobStatus).toHaveBeenCalledTimes(3));
    expect(screen.getAllByText(/Job ID: job-share/i).length).toBeGreaterThan(0);
  });

  it('routes a direct completed-session URL to its linked historical job', async () => {
    const completed = makeAssignmentSession({
      id: 'session-completed',
      studentId: 'student-alex',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      promptPackageId: 'pkg-1',
      draftId: 'draft-1',
      confirmedStep: 'share',
      shareJobId: 'job-share',
      revision: 4,
    });
    vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(completed);
    vi.mocked(api.getJobStatus).mockResolvedValueOnce(
      makeJobStatus({ jobId: 'job-share', state: 'succeeded' }),
    );
    globalThis.history.replaceState(null, '', '/?sessionId=session-completed');

    renderMinimalAssignment();

    await waitFor(() => expect(api.getJobStatus).toHaveBeenCalledWith('job-share'));
    expect(screen.getAllByText(/Job ID: job-share/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox', { name: /Transcript text/i })).toBeNull();
  });

  it('refreshes the active aggregate once on focus without overwriting local notes', async () => {
    const { user } = await renderPreviewReadyAssignment();
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    const notes = screen.getByRole('textbox', { name: /Teacher notes/i });
    fireEvent.change(notes, { target: { value: 'Unsaved local focus note' } });
    const sessionCalls = vi.mocked(api.fetchAssignmentSession).mock.calls.length;
    const transcriptCalls = vi.mocked(api.fetchRecordingTranscript).mock.calls.length;
    const draftCalls = vi.mocked(api.fetchDraft).mock.calls.length;
    const profileCalls = vi.mocked(api.getProfileContent).mock.calls.length;

    await act(async () => {
      globalThis.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(api.fetchAssignmentSession).toHaveBeenCalledTimes(sessionCalls + 1));
    await waitFor(() =>
      expect(api.fetchRecordingTranscript).toHaveBeenCalledTimes(transcriptCalls + 1),
    );
    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledTimes(draftCalls + 1));
    await waitFor(() => expect(api.getProfileContent).toHaveBeenCalledTimes(profileCalls + 1));
    expect((notes as HTMLTextAreaElement).value).toBe('Unsaved local focus note');
  });

  it('does not overwrite overlapping cross-tab Context work after focus refresh', async () => {
    const { user } = await renderPreviewReadyAssignment();
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
      target: { value: 'Local unsaved note' },
    });
    const recoveryCalls = vi.mocked(api.updateAssignmentSessionRecovery).mock.calls.length;
    vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(
      makeAssignmentSession({
        id: 'session-1',
        studentId: 'student-alex',
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        promptPackageId: 'pkg-1',
        draftId: 'draft-1',
        confirmedStep: 'create',
        teacherNotes: 'Remote saved note',
        revision: 20,
      }),
    );

    vi.useFakeTimers();
    await act(async () => {
      globalThis.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(2_000);
    });
    vi.useRealTimers();

    expect(
      (screen.getByRole('textbox', { name: /Teacher notes/i }) as HTMLTextAreaElement).value,
    ).toBe('Local unsaved note');
    expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledTimes(recoveryCalls);
  });

  it('blocks navigation flush after an artifact conflict without issuing a second PUT', async () => {
    let navigationGuard: (() => Promise<boolean>) | null = null;
    const user = createMinimalUser();
    renderMinimalAssignmentWithNavigationGuard((guard) => {
      navigationGuard = guard;
    });
    await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
    await user.selectOptions(
      await screen.findByRole('combobox', { name: /Choose learner/i }),
      'student-alex',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    const transcript = await screen.findByRole('textbox', { name: /Transcript text/i });
    vi.mocked(api.updateRecordingTranscript).mockRejectedValueOnce(
      new api.ArtifactWorkingConflictApiError({
        workingVersion: 2,
        contentHash: 'c'.repeat(64),
      }),
    );
    vi.mocked(api.fetchRecordingTranscript).mockResolvedValueOnce(
      makeTranscript({
        text: 'Remote winning transcript',
        workingVersion: 2,
        contentHash: 'c'.repeat(64),
      }),
    );

    vi.useFakeTimers();
    fireEvent.change(transcript, { target: { value: 'Local conflicting transcript' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(api.updateRecordingTranscript).toHaveBeenCalledTimes(1);
    expect(navigationGuard).not.toBeNull();
    const guard = navigationGuard as unknown as () => Promise<boolean>;
    await expect(guard()).resolves.toBe(false);
    expect(api.updateRecordingTranscript).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('flushes a pending Context debounce before allowing navigation', async () => {
    let navigationGuard: (() => Promise<boolean>) | null = null;
    const user = createMinimalUser();
    renderMinimalAssignmentWithNavigationGuard((guard) => {
      navigationGuard = guard;
    });
    await preparePromptReady(user);
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    const recoveryCalls = vi.mocked(api.updateAssignmentSessionRecovery).mock.calls.length;
    fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
      target: { value: 'Flush this note before leaving' },
    });
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    const guard = navigationGuard as unknown as () => Promise<boolean>;
    await expect(guard()).resolves.toBe(true);

    expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledTimes(recoveryCalls + 1);
    expect(api.updateAssignmentSessionRecovery).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        patch: expect.objectContaining({ teacherNotes: 'Flush this note before leaving' }),
      }),
    );
  });

  it(
    'guides a new assignment through staged teacher-facing workflow copy',
    async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      expect(screen.getByRole('navigation', { name: /Assignment progress/i })).toBeTruthy();
      expect(screen.queryByRole('group', { name: /Recent assignments/i })).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Transcript engine/i })).toBeNull();
      expect(screen.queryByText(/STT provider/i)).toBeNull();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Choose learner/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      expect(screen.getByRole('heading', { name: /Add lesson source/i })).toBeTruthy();
      expect(screen.getByRole('combobox', { name: /Transcript engine/i })).toBeTruthy();
      expect(screen.getByText('Next step: upload the lesson recording.')).toBeTruthy();
      expect(screen.queryByText(/Choose a student and upload a recording\./i)).toBeNull();
      expect(
        screen.queryByText(/Choose a student, upload a recording, and let the transcript/i),
      ).toBeNull();
      expect(screen.queryByText(/Select a student before uploading a recording\./i)).toBeNull();
      expect(screen.queryByText(/Drag a recording here or click to browse/i)).toBeNull();
      expect(screen.queryByText(/Learning profile context/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /^Generate assignment$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Preview assignment/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Share assignment/i })).toBeNull();
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
      expect(screen.getByRole('heading', { name: /Learner context/i })).toBeTruthy();

      fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
        target: { value: 'Focus on past tense corrections and follow-up questions.' },
      });
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));
      await screen.findByDisplayValue('# Generated assignment draft');
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
      expect(screen.getByRole('heading', { name: /Review and share/i })).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /Step 4Create/i }));
      fireEvent.change(screen.getByRole('textbox', { name: /Draft markdown/i }), {
        target: { value: '# Final lesson assignment' },
      });
      await user.click(screen.getByRole('button', { name: /Step 5Review & share/i }));

      await previewCurrentDraft(user);
      await user.click(screen.getByRole('button', { name: /Share assignment/i }));

      await screen.findAllByText(/Job ID:/i);
      expect(screen.getAllByText(/Support details/i).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: /Show advanced actions/i })).toBeNull();
      const advancedActions = screen
        .getByRole('heading', { name: /Advanced actions/i })
        .closest('section')!;
      expect(within(advancedActions).getByRole('region', { name: /Quick reruns/i })).toBeTruthy();
      const support = screen.getByText(/^Support details$/i).closest('details')!;
      expect(within(support).queryByRole('region', { name: /Quick reruns/i })).toBeNull();
      expect(within(support).queryByRole('button', { name: /^Custom rerun$/i })).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'keeps provider, template, quota, and audio model controls out of the normal tutor flow',
    async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Choose learner/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');

      expect(screen.queryByRole('combobox', { name: /Prompt template/i })).toBeNull();
      expect(screen.queryByText(/Prompt text/i)).toBeNull();
      expect(screen.queryByText(/Generation settings/i)).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Generation provider/i })).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Generation model/i })).toBeNull();
      expect(screen.queryByText(/Generation limits/i)).toBeNull();
      expect(screen.queryByText(/\bRPM\b/i)).toBeNull();
      expect(screen.queryByText(/\bTPM\b/i)).toBeNull();
      expect(screen.queryByText(/\bRPD\b/i)).toBeNull();
      expect(screen.queryByText(/Assignments publish as HTML pages/i)).toBeNull();
      expect(screen.queryByText(/Audio and publishing settings/i)).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Voice engine/i })).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Reading style/i })).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Voice model/i })).toBeNull();

      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
      const generateAssignmentButton = screen.getByRole('button', {
        name: /^Generate assignment$/i,
      });
      await waitFor(() => {
        expect((generateAssignmentButton as HTMLButtonElement).disabled).toBe(false);
      });
      await user.click(generateAssignmentButton);

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            templateId: 'tpl-default',
          }),
        );
        expect(api.generateDraft).toHaveBeenCalledWith({
          promptPackageId: 'pkg-1',
          provider: 'openai',
          model: 'gpt-5.2',
        });
      });
      expect(await screen.findByDisplayValue('# Generated assignment draft')).toBeTruthy();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'confirms Source and starts first-profile lesson memory without a separate tutor action',
    async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValue({
        students: [{ id: 'student-cora', name: 'Cora', profileId: null as never }],
      });
      vi.mocked(api.uploadRecording).mockResolvedValue(
        makeRecording({ studentId: 'student-cora', status: 'transcribed', transcriptId: 'tx-1' }),
      );
      vi.mocked(api.getRecording).mockResolvedValue(
        makeRecording({ studentId: 'student-cora', status: 'transcribed', transcriptId: 'tx-1' }),
      );

      renderMinimalAssignment();
      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Cora' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Choose learner/i }),
        'student-cora',
      );
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');

      expect(screen.queryByRole('button', { name: /Use this transcript/i })).toBeNull();
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
      await waitFor(() =>
        expect(api.confirmAssignmentSessionStep).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({ step: 'source', transcriptId: 'tx-1' }),
        ),
      );
      expect(await screen.findByText(/Building lesson memory/i)).toBeTruthy();
      await waitFor(() => {
        expect(api.getStudentMemoryHealth).toHaveBeenCalledWith('student-cora');
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it('lands resumed work in a later stage with progress markers', async () => {
    await renderResumedAssignment(
      {
        draftText: '# Draft markdown',
      },
      { waitFor: 'none' },
    );

    const progress = screen.getByRole('navigation', { name: /Assignment progress/i });
    const progressList = within(progress).getByRole('list');
    expect(within(progressList).getByText('Review & share')).toBeTruthy();
    expect(within(progressList).queryByText('Advanced actions')).toBeNull();
    expect(within(progressList).getByText('Create')).toBeTruthy();
  });

  it('keeps resumed navigation on the teacher-selected step while readiness updates', async () => {
    const user = createMinimalUser();
    vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
      sessions: [
        makeAssignmentSession({
          id: 'session-resume',
          studentId: 'student-alex',
          recordingId: 'rec-1',
          transcriptId: 'tx-1',
          promptPackageId: 'pkg-1',
          confirmedStep: 'context',
        }),
      ],
      total: 1,
      limit: 20,
    });
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(
      makeAssignmentSession({
        id: 'session-teacher-notes',
        studentId: 'student-alex',
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        promptPackageId: 'pkg-1',
        draftId: 'draft-1',
        confirmedStep: 'context',
      }),
    );
    globalThis.history.replaceState(null, '', '/?sessionId=session-resume');

    renderMinimalAssignment();

    await screen.findByRole('button', { name: /^Generate assignment$/i });
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    expect(screen.getByRole('heading', { name: /Learner context/i })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
    ).toBe('step');
    await waitFor(() => expect(api.listAssignmentSessions).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
      target: { value: 'Keep the assignment grounded in the learner context.' },
    });
    expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /Learner context/i })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
    ).toBe('step');
  });

  it('does not confirm dirty teacher notes when a locked forward step is clicked', async () => {
    const user = createMinimalUser();
    const session = makeAssignmentSession({
      id: 'session-teacher-notes',
      studentId: 'student-alex',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      promptPackageId: 'pkg-1',
      draftId: 'draft-1',
      confirmedStep: 'context',
    });
    vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
      sessions: [session],
      total: 1,
      limit: 20,
    });
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
    globalThis.history.replaceState(null, '', '/?sessionId=session-teacher-notes');
    renderMinimalAssignment();
    await screen.findByRole('button', { name: /^Generate assignment$/i });
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
      ).toBe('step'),
    );
    await user.type(screen.getByRole('textbox', { name: /Teacher notes/i }), 'Focus on articles.');

    await user.click(screen.getByRole('button', { name: /Create/i }));

    expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ step: 'context' }),
    );
    expect(screen.getByRole('heading', { name: /Learner context/i })).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: /Teacher notes/i }) as HTMLTextAreaElement).value,
    ).toBe('Focus on articles.');
  });

  it('keeps dirty teacher notes on Context until its primary confirmation action succeeds', async () => {
    const user = createMinimalUser();
    const session = makeAssignmentSession({
      id: 'session-teacher-notes-review',
      studentId: 'student-alex',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      promptPackageId: 'pkg-1',
      draftId: 'draft-1',
      confirmedStep: 'create',
    });
    vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
      sessions: [session],
      total: 1,
      limit: 20,
    });
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
    globalThis.history.replaceState(null, '', '/?sessionId=session-teacher-notes-review');
    renderMinimalAssignment();
    await user.click(screen.getByRole('button', { name: /Create/i }));
    await screen.findByRole('button', { name: /^Generate assignment$/i });
    await user.click(screen.getByRole('button', { name: /Teaching context/i }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
      ).toBe('step'),
    );
    await user.type(screen.getByRole('textbox', { name: /Teacher notes/i }), 'Focus on articles.');

    await user.click(screen.getByRole('button', { name: /Review & share/i }));

    expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ step: 'context' }),
    );
    expect(
      screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
    ).toBe('step');
  });

  it('does not move or scroll the new-assignment workflow after upload completes', async () => {
    const user = createMinimalUser();
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    renderMinimalAssignment();

    await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
    await screen.findByRole('option', { name: 'Alex' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Choose learner/i }),
      'student-alex',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: /Add lesson source/i })).toBeTruthy();
    scrollIntoView.mockClear();

    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await screen.findByDisplayValue('Student transcript text');

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /Add lesson source/i })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Lesson source/i }).getAttribute('aria-current'),
    ).toBe('step');
  });

  it('keeps the assignment overview header to title, focus, and compact progress', async () => {
    await renderPublishedAssignment(
      {
        draftText: '# Draft markdown',
        status: {
          studentId: 'student-alex',
        },
      },
      { user: createMinimalUser() },
    );

    const overview = document.querySelector('.assignment-workflow') as HTMLElement;
    expect(overview).toBeTruthy();
    expect(overview.getAttribute('aria-label')).toBe('Assignment builder');
    const progress = within(overview).getByRole('navigation', { name: /Assignment progress/i });
    const progressList = within(progress).getByRole('list');
    expect(within(progressList).getByText('Student')).toBeTruthy();
    expect(within(progressList).getByText('Lesson source')).toBeTruthy();
    expect(within(progressList).getByText('Teaching context')).toBeTruthy();
    expect(within(progressList).getByText('Create')).toBeTruthy();
    expect(within(progressList).getByText('Review & share')).toBeTruthy();
    expect(within(progressList).queryByText('Advanced actions')).toBeNull();
  });

  it(
    'keeps a historical completed job readable without reopening legacy editor steps',
    async () => {
      const user = createMinimalUser();
      await renderPublishedAssignment(
        {
          draftText: '# Draft markdown',
          status: {
            studentId: 'student-alex',
          },
        },
        { user },
      );

      expect(screen.getByRole('heading', { name: /Review and share/i })).toBeTruthy();
      expect(screen.getByRole('heading', { name: /Advanced actions/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Refresh actions/i })).toBeNull();
      expect(screen.getByRole('button', { name: /Lesson source/i }).hasAttribute('disabled')).toBe(
        true,
      );
      expect(screen.getByRole('button', { name: /Create/i }).hasAttribute('disabled')).toBe(true);
      expect(
        screen.getByRole('button', { name: /Teaching context/i }).hasAttribute('disabled'),
      ).toBe(true);

      expect(screen.queryByRole('button', { name: /Drop audio file/i })).toBeNull();
      expect(screen.queryByText(/Recording ID:/i)).toBeNull();
      expect(screen.queryByText(/Selected:/i)).toBeNull();
      expect(screen.queryByText(/Review the transcript here/i)).toBeNull();
      expect(screen.queryByText(/Review the durable learner context/i)).toBeNull();
      expect(screen.queryByText(/This gets woven into the assignment/i)).toBeNull();
      expect(screen.queryByText(/Generate a first draft from the lesson source/i)).toBeNull();
      expect(screen.queryByText(/Preview locks the current version/i)).toBeNull();
      expect(screen.queryByText(/Assignments publish as an Assignment Handout/i)).toBeNull();
      expect(screen.queryByText(/Anything you leave unchecked stays as-is/i)).toBeNull();
      expect(screen.queryByText(/Pronunciation chunks default to Google/i)).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'starts a fresh workflow from the published completion action',
    async () => {
      const user = createMinimalUser();
      await renderPublishedAssignment(
        {
          draftText: '# Draft markdown',
          status: {
            studentId: 'student-alex',
            htmlUrl: '/assignments/job-1',
          },
        },
        { user },
      );

      await user.click(screen.getByRole('button', { name: /Review & share/i }));
      expect(
        screen.getAllByRole('link', { name: /Open Assignment Handout/i }).length,
      ).toBeGreaterThan(0);
      await user.click(screen.getByRole('button', { name: /Start another assignment/i }));

      expect(screen.getByRole('button', { name: 'Start new assignment' })).toBeTruthy();
      expect(screen.queryAllByRole('link', { name: /Open Assignment Handout/i })).toHaveLength(0);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'collapses resolved Step 1 choices and restores them through explicit Change actions',
    async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));

      expect(screen.queryByRole('button', { name: /Resume recent work/i })).toBeNull();

      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Choose learner/i }),
        'student-alex',
      );
      expect(screen.getByRole('heading', { name: 'Alex' })).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /Change choice/i }));
      expect(screen.getByRole('button', { name: /Resume recent work/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Start new assignment/i })).toBeTruthy();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'distills resume/start and rerun surfaces while keeping support details available',
    async () => {
      const user = createMinimalUser();

      await renderPublishedAssignment(
        {
          draftText: '# Draft markdown',
          status: {
            studentId: 'student-alex',
            htmlUrl: '/assignments/job-1',
          },
        },
        { user },
      );

      expect(screen.getByRole('heading', { name: /Review and share/i })).toBeTruthy();
      expect(screen.queryByText(/Move from recording to published lesson/i)).toBeNull();
      expect(screen.queryByText(/Learning profile ready/i)).toBeNull();
      expect(screen.queryByText(/Transcript is ready for review and editing/i)).toBeNull();
      expect(screen.queryByText(/You can still edit wording before moving on/i)).toBeNull();
      expect(screen.queryByText(/Preview before publishing/i)).toBeNull();
      expect(screen.queryByText(/Choose how you want to continue/i)).toBeNull();
      expect(screen.queryByText(/Pick a lane once/i)).toBeNull();
      expect(screen.queryByText(/Reopen an existing assignment/i)).toBeNull();
      expect(screen.queryByText(/Begin clean and move straight/i)).toBeNull();

      expect(
        screen.getAllByRole('link', { name: /Open Assignment Handout/i }).length,
      ).toBeGreaterThan(0);
      expect(screen.getByRole('heading', { name: /Advanced actions/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Refresh actions/i })).toBeNull();
      const quickReruns = screen.getByRole('region', { name: /Quick reruns/i });
      expect(quickReruns).toBeTruthy();
      expect(quickReruns.className).not.toContain('minimal-rerun-quick');
      expect(quickReruns.querySelector('.minimal-rerun-action-card')).toBeNull();
      expect(within(quickReruns).getAllByRole('button')).toHaveLength(4);
      expect(screen.queryByText(/Each action changes only what it says/i)).toBeNull();
      expect(screen.queryByText(/Replace study-text, main pronunciation/i)).toBeNull();

      await user.click(screen.getByRole('button', { name: /^Custom rerun$/i }));

      expect(screen.getByRole('region', { name: /Custom rerun/i })).toBeTruthy();
      await user.click(screen.getByRole('checkbox', { name: /Study-text audio/i }));
      await user.click(screen.getByRole('checkbox', { name: /Main pronunciation audio/i }));
      await user.click(screen.getByRole('checkbox', { name: /Pronunciation chunk audio/i }));
      expect(screen.queryByText(/Select individual audio families and overrides/i)).toBeNull();
      expect(screen.queryByText(/Rebuild the lesson narration/i)).toBeNull();
      expect(screen.queryByText(/Replace the primary pronunciation clip/i)).toBeNull();
      expect(screen.queryByText(/Refresh word and chunk clips/i)).toBeNull();
      expect(screen.queryByText(/eleven_v3.*dialogue-only/i)).toBeNull();
      expect(screen.getByText(/^Study-text settings$/i)).toBeTruthy();
      expect(screen.getByText(/^Main pronunciation settings$/i)).toBeTruthy();
      expect(screen.getByText(/^Pronunciation chunk settings$/i)).toBeTruthy();
      expect(screen.queryByText(/^Study-text provider$/i)).toBeNull();
      expect(screen.queryByText(/^Main pronunciation provider$/i)).toBeNull();
      expect(screen.queryByText(/^Pronunciation chunk provider$/i)).toBeNull();
      expect(screen.getAllByText(/^Provider$/i)).toHaveLength(3);
      expect(screen.getAllByText(/^Model$/i)).toHaveLength(3);
      expect(screen.getAllByText(/^Voice ID$/i)).toHaveLength(3);
      expect(screen.getAllByText(/^Accent$/i)).toHaveLength(3);
      expect(screen.getAllByText(/^Strategy$/i)).toHaveLength(1);

      const previewButton = screen.getByRole('button', { name: /Preview assignment/i });
      expect(previewButton.className).toContain('minimal-preview-attention');
      expect(screen.queryByText(/Preview required before sharing/i)).toBeNull();
      expect(screen.queryByRole('heading', { name: /Job controls/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Cancel job$/i })).toBeNull();
      expect(screen.queryByText(/Cancel is only available/i)).toBeNull();
      expect(screen.getAllByText(/^Support details$/i).length).toBeGreaterThan(0);

      await user.click(screen.getByRole('button', { name: /Start another assignment/i }));
      expect(screen.getByRole('button', { name: /Start new assignment/i })).toBeTruthy();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    'does not expose legacy learner-context editing from a historical completed job',
    async () => {
      await renderPublishedAssignment(
        {
          draftText: '# Draft markdown',
          status: {
            studentId: 'student-alex',
          },
        },
        { user: createMinimalUser() },
      );

      expect(screen.getByRole('heading', { name: /Review and share/i })).toBeTruthy();
      expect(
        screen.getByRole('button', { name: /Teaching context/i }).hasAttribute('disabled'),
      ).toBe(true);
      expect(screen.queryByRole('heading', { name: /Learner context/i })).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it('keeps advanced actions tucked away until a shared assignment exists', async () => {
    const user = createMinimalUser();
    renderMinimalAssignment();

    await waitFor(() => {
      expect(api.fetchPromptOptions).toHaveBeenCalledTimes(1);
      expect(api.fetchJobOptions).toHaveBeenCalledTimes(1);
      expect(api.fetchStudentOptions).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('combobox', { name: /Choose learner/i })).toBeNull();
    expect(screen.queryByText(/Share the assignment once to unlock updates/i)).toBeNull();
    expect(screen.queryByText(/Available after sharing\./i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
    await screen.findByRole('option', { name: 'Alex' });

    expect(screen.queryByText(/Share the assignment once to unlock updates/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Show advanced actions/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh actions/i })).toBeNull();
  });

  it('keeps one recording SSE subscription alive across status refreshes', async () => {
    const user = createMinimalUser();
    const closeSse = vi.fn();
    vi.mocked(api.subscribeToJobEvents).mockReturnValue({ close: closeSse } as never);
    vi.mocked(api.uploadRecording).mockResolvedValueOnce(
      makeRecording({
        status: 'transcribing',
        transcriptId: null,
      }),
    );
    vi.mocked(api.getRecording).mockResolvedValue(
      makeRecording({
        status: 'transcribing',
        transcriptId: null,
        updatedAt: '2026-02-05T00:00:01.000Z',
      }),
    );

    renderMinimalAssignment();
    await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
    await screen.findByRole('option', { name: 'Alex' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Choose learner/i }),
      'student-alex',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(api.getRecording).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.subscribeToJobEvents).toHaveBeenCalledTimes(1);
    expect(closeSse).not.toHaveBeenCalled();
  });

  it('shows advanced controls only on Review and share after a shared assignment exists', async () => {
    const user = createMinimalUser();
    await renderPublishedAssignment(
      {
        draftText: '# Draft markdown',
        status: {
          studentId: 'student-alex',
        },
      },
      { user },
    );

    expect(screen.queryByRole('button', { name: /Show advanced actions/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh actions/i })).toBeNull();
    const advancedActions = screen
      .getByRole('heading', { name: /Advanced actions/i })
      .closest('section')!;
    const advancedButtons = within(advancedActions).getAllByRole('button');
    expect(advancedButtons).not.toHaveLength(0);
    for (const button of advancedButtons) {
      expect(button.className).not.toContain('minimal-primary');
      expect(button.className).not.toContain('minimal-secondary');
      expect(button.className).toContain('product-button');
    }
    expect(
      within(advancedActions).getByRole('button', { name: /Republish current draft/i }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Step 1Student$/i }));

    expect(screen.getByRole('heading', { name: /Advanced actions/i })).toBeTruthy();
    expect(screen.getAllByText(/^Support details$/i).length).toBeGreaterThan(0);
  });

  it('marks the active advanced operation busy and keeps every rerun disabled', async () => {
    const user = createMinimalUser();
    let resolveRerun!: (value: Awaited<ReturnType<typeof api.rerunJob>>) => void;
    vi.mocked(api.rerunJob).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRerun = resolve;
      }),
    );
    await renderPublishedAssignment();
    openAdvancedActions();

    await user.click(screen.getByRole('button', { name: /Republish current draft/i }));

    const busyButtons = screen.getAllByRole('button', { name: /Queuing rerun/i });
    expect(busyButtons).not.toHaveLength(0);
    for (const button of busyButtons) {
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }

    resolveRerun({ success: true, message: 'Rerun queued', jobId: 'job-1', actionType: 'rerun' });
    await screen.findByText('Rerun queued');
  });

  it('shows support-facing audio notices in advanced support details', async () => {
    vi.mocked(api.fetchJobProvenance).mockResolvedValueOnce({
      job: {
        id: 'job-1',
        state: 'succeeded',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:01:00.000Z',
        startedAt: '2024-01-01T00:00:10.000Z',
        finishedAt: '2024-01-01T00:01:00.000Z',
        sourceJobId: 'job-0',
        manifestPath: '/tmp/manifest.json',
        htmlUrl: null,
        error: null,
      },
      sourceJob: null,
      recording: null,
      transcript: null,
      promptPackage: null,
      draft: null,
      tts: null,
      pronunciationWarnings: [
        {
          code: 'rerun_pronunciation_chunk_unknown_previous_provider',
          message:
            'Pronunciation chunk rerun could not confirm the previous clip provider; using provider-scoped fallback resolution instead.',
        },
      ],
      lineage: null,
      actions: [],
    });

    await renderPublishedAssignment();
    openAdvancedActions();

    expect(await screen.findByText(/Audio notices/i)).toBeTruthy();
    expect(screen.getByText(/using provider-scoped fallback resolution instead/i)).toBeTruthy();
  });
});
