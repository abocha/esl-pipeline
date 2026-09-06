import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  testApi as api,
  createMinimalUser,
  makeAssignmentSession,
  makeRecording,
  renderMinimalAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  startNewAssignmentForLearner,
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';
import { useMinimalAssignmentSourceController } from './MinimalAssignment.source';

describe('MinimalAssignment upload operation ownership', () => {
  const pendingOperationStorageKey = 'esl-pipeline.pending-recording-upload.v1';
  const workflowStorageKey = 'esl-pipeline.recording-upload-workflow.v1';

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    globalThis.history.replaceState(null, '', '/');
  });

  it('reconciles an uncertain upload before retrying the same browser-owned operation UUID', async () => {
    setupMinimalAssignmentTest();
    const user = createMinimalUser();
    vi.mocked(api.uploadRecording)
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({
        recordingId: 'recording-1',
        status: 'queued',
        transcriptId: null,
        error: null,
        source: 'upload',
        studentId: 'student-alex',
        displayName: 'lesson.mp3',
        durationSec: null,
        channels: null,
        audioTopology: 'mixed_recording',
        bytes: 5,
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      });

    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await screen.findByText(/Network Error/i);
    fireEvent.click(screen.getByRole('button', { name: /Retry upload/i }));

    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(2));
    const firstOperationId = vi.mocked(api.uploadRecording).mock.calls[0]?.[1]?.uploadOperationId;
    const secondOperationId = vi.mocked(api.uploadRecording).mock.calls[1]?.[1]?.uploadOperationId;
    expect(firstOperationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondOperationId).toBe(firstOperationId);
    expect(api.getRecordingUploadOperation).toHaveBeenCalledWith(firstOperationId);
  });

  it('treats a new file-selection event as a fresh logical upload after an ambiguous failure', async () => {
    setupMinimalAssignmentTest();
    const user = createMinimalUser();
    vi.mocked(api.uploadRecording)
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({
        recordingId: 'recording-2',
        status: 'queued',
        transcriptId: null,
        error: null,
        source: 'upload',
        studentId: 'student-alex',
        displayName: 'replacement.mp3',
        durationSec: null,
        channels: null,
        audioTopology: 'mixed_recording',
        bytes: 5,
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      });

    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await screen.findByText(/Network Error/i);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(2));
    const firstOperationId = vi.mocked(api.uploadRecording).mock.calls[0]?.[1]?.uploadOperationId;
    const secondOperationId = vi.mocked(api.uploadRecording).mock.calls[1]?.[1]?.uploadOperationId;
    expect(secondOperationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondOperationId).not.toBe(firstOperationId);
    expect(api.getRecordingUploadOperation).not.toHaveBeenCalledWith(firstOperationId);
  });

  it('uses a fresh operation for an explicit replacement action', async () => {
    setupMinimalAssignmentTest();
    const user = createMinimalUser();
    vi.mocked(api.uploadRecording)
      .mockResolvedValueOnce({
        recordingId: 'recording-original',
        status: 'queued',
        transcriptId: null,
        error: null,
        source: 'upload',
        studentId: 'student-alex',
        displayName: 'original.mp3',
        durationSec: null,
        channels: null,
        audioTopology: 'mixed_recording',
        bytes: 5,
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        recordingId: 'recording-replacement',
        status: 'queued',
        transcriptId: null,
        error: null,
        source: 'upload',
        studentId: 'student-alex',
        displayName: 'replacement.mp3',
        durationSec: null,
        channels: null,
        audioTopology: 'mixed_recording',
        bytes: 5,
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      });

    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await screen.findByText(/Recording: original\.mp3/i);
    fireEvent.click(screen.getByRole('button', { name: /Replace audio/i }));
    fireEvent.click(screen.getByRole('button', { name: /Drop replacement audio/i }));

    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.uploadRecording).mock.calls[1]?.[1]?.uploadOperationId).not.toBe(
      vi.mocked(api.uploadRecording).mock.calls[0]?.[1]?.uploadOperationId,
    );
  });

  it('keeps an explicitly canceled in-flight request retryable because dispatch may have occurred', async () => {
    setupMinimalAssignmentTest();
    const user = createMinimalUser();
    vi.mocked(api.uploadRecording)
      .mockImplementationOnce(
        async (_file, options) =>
          await new Promise<never>((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Canceled', 'AbortError')),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce({
        recordingId: 'recording-after-cancel',
        status: 'queued',
        transcriptId: null,
        error: null,
        source: 'upload',
        studentId: 'student-alex',
        displayName: 'lesson.mp3',
        durationSec: null,
        channels: null,
        audioTopology: 'mixed_recording',
        bytes: 5,
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      });

    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await screen.findByRole('button', { name: /Cancel upload/i });
    fireEvent.click(screen.getByRole('button', { name: /Cancel upload/i }));
    await screen.findByText(/Upload canceled/i);
    fireEvent.click(screen.getByRole('button', { name: /Retry upload/i }));

    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.uploadRecording).mock.calls[1]?.[1]?.uploadOperationId).toBe(
      vi.mocked(api.uploadRecording).mock.calls[0]?.[1]?.uploadOperationId,
    );
  });

  it('does not create pending upload state while client preconditions keep source selection locked', async () => {
    setupMinimalAssignmentTest();
    const user = createMinimalUser();
    renderMinimalAssignment();

    await screen.findByRole('button', { name: /Start new assignment/i });
    expect(screen.queryByRole('button', { name: /Drop audio file/i })).toBeNull();
    expect(api.uploadRecording).not.toHaveBeenCalled();

    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.uploadRecording).mock.calls[0]?.[1]?.uploadOperationId).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
  });

  it('retires a locally rejected upload operation so the next genuine upload gets a fresh UUID', async () => {
    setupMinimalAssignmentTest();
    const user = createMinimalUser();
    vi.mocked(api.uploadRecording)
      .mockRejectedValueOnce(
        new api.RecordingUploadPreDispatchError('Recording exceeds the 2 GiB upload limit.'),
      )
      .mockResolvedValueOnce({
        recordingId: 'recording-after-local-rejection',
        status: 'queued',
        transcriptId: null,
        error: null,
        source: 'upload',
        studentId: 'student-alex',
        displayName: 'lesson.mp3',
        durationSec: null,
        channels: null,
        audioTopology: 'mixed_recording',
        bytes: 5,
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      });

    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await screen.findByText(/Recording exceeds the 2 GiB upload limit/i);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.uploadRecording).mock.calls[1]?.[1]?.uploadOperationId).not.toBe(
      vi.mocked(api.uploadRecording).mock.calls[0]?.[1]?.uploadOperationId,
    );
    expect(api.getRecordingUploadOperation).not.toHaveBeenCalled();
  });

  it('reconciles persisted metadata only when the restored assignment context matches', async () => {
    setupMinimalAssignmentTest();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(workflowStorageKey, 'workflow-current');
    localStorage.setItem(
      pendingOperationStorageKey,
      JSON.stringify({
        id: '33333333-3333-4333-8333-333333333333',
        workflowId: 'workflow-current',
        studentId: 'student-alex',
        sttProvider: null,
        audioTopology: 'mixed_recording',
      }),
    );
    globalThis.history.replaceState(null, '', '/?studentId=student-alex');
    vi.mocked(api.getRecordingUploadOperation).mockResolvedValue({
      recordingId: 'restored-recording',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: 'student-alex',
      displayName: 'restored.mp3',
      durationSec: null,
      channels: null,
      audioTopology: 'mixed_recording',
      bytes: 5,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    });

    renderMinimalAssignment();

    await waitFor(() =>
      expect(api.getRecordingUploadOperation).toHaveBeenCalledWith(
        '33333333-3333-4333-8333-333333333333',
      ),
    );
  });

  it('discards a completed reconciliation after a new assignment, student, and pending operation replace its owner', async () => {
    setupMinimalAssignmentTest();
    const user = createMinimalUser();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(workflowStorageKey, 'workflow-old');
    localStorage.setItem(
      pendingOperationStorageKey,
      JSON.stringify({
        id: '55555555-5555-4555-8555-555555555555',
        workflowId: 'workflow-old',
        studentId: 'student-alex',
        sttProvider: null,
        audioTopology: 'mixed_recording',
      }),
    );
    globalThis.history.replaceState(null, '', '/?studentId=student-alex');

    let resolveOldReconciliation:
      | ((value: Awaited<ReturnType<typeof api.getRecordingUploadOperation>>) => void)
      | undefined;
    vi.mocked(api.getRecordingUploadOperation).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldReconciliation = resolve;
        }),
    );
    vi.mocked(api.uploadRecording).mockImplementationOnce(
      async () =>
        await new Promise(() => {
          // Keep the replacement operation current while the old lookup resolves.
        }),
    );

    function ReconciliationRaceHarness() {
      const source = useMinimalAssignmentSourceController({
        configuredSttProviders: ['deepgram'],
        defaultSttProvider: 'deepgram',
        initialSelectedStudentId: 'student-alex',
        onBeforeUploadReset: () => undefined,
      });
      return (
        <div>
          <button
            type="button"
            onClick={() => source.resetSourceFlow({ nextStudentId: 'student-bella' })}
          >
            Start replacement workflow
          </button>
          <button
            type="button"
            onClick={() => source.handleFiles([new File(['audio'], 'replacement.mp3')])}
          >
            Select replacement audio
          </button>
          <span>{source.recording?.displayName ?? 'no recording'}</span>
        </div>
      );
    }

    render(<ReconciliationRaceHarness />);
    await waitFor(() =>
      expect(api.getRecordingUploadOperation).toHaveBeenCalledWith(
        '55555555-5555-4555-8555-555555555555',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Start replacement workflow/i }));
    fireEvent.click(screen.getByRole('button', { name: /Select replacement audio/i }));
    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(1));

    resolveOldReconciliation?.({
      recordingId: 'stale-recording',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: 'student-alex',
      displayName: 'stale.mp3',
      durationSec: null,
      channels: null,
      audioTopology: 'mixed_recording',
      bytes: 5,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    });

    await waitFor(() => expect(screen.queryByText('stale.mp3')).toBeNull());
    expect(vi.mocked(api.uploadRecording).mock.calls[0]?.[1]?.uploadOperationId).not.toBe(
      '55555555-5555-4555-8555-555555555555',
    );
  });

  it('discards a delayed reconciliation when resuming another assignment for the same student', async () => {
    setupMinimalAssignmentTest();
    const user = createMinimalUser();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(workflowStorageKey, 'workflow-assignment-a');
    localStorage.setItem(
      pendingOperationStorageKey,
      JSON.stringify({
        id: '66666666-6666-4666-8666-666666666666',
        workflowId: 'workflow-assignment-a',
        studentId: 'student-alex',
        sttProvider: null,
        audioTopology: 'mixed_recording',
      }),
    );
    globalThis.history.replaceState(null, '', '/?studentId=student-alex');

    let resolveOldReconciliation:
      | ((value: Awaited<ReturnType<typeof api.getRecordingUploadOperation>>) => void)
      | undefined;
    vi.mocked(api.getRecordingUploadOperation).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldReconciliation = resolve;
        }),
    );
    vi.mocked(api.listAssignmentSessions).mockResolvedValue({
      sessions: [
        makeAssignmentSession({
          id: 'session-b',
          studentId: 'student-alex',
          recordingId: 'recording-b',
          confirmedStep: 'source',
        }),
      ],
      total: 1,
      limit: 20,
    });
    vi.mocked(api.getRecording).mockResolvedValue(
      makeRecording({
        recordingId: 'recording-b',
        studentId: 'student-alex',
        displayName: 'assignment-b.mp3',
        status: 'queued',
      }),
    );

    renderMinimalAssignment();
    await waitFor(() =>
      expect(api.getRecordingUploadOperation).toHaveBeenCalledWith(
        '66666666-6666-4666-8666-666666666666',
      ),
    );

    await user.click(await screen.findByRole('button', { name: /Resume recent work/i }));
    await user.click((await screen.findAllByRole('radio'))[0]!);
    await user.click(screen.getByRole('button', { name: /Continue assignment/i }));
    await screen.findByText(/Recording: assignment-b\.mp3/i);

    expect(sessionStorage.getItem(workflowStorageKey)).not.toBe('workflow-assignment-a');
    expect(localStorage.getItem(pendingOperationStorageKey)).toBeNull();

    resolveOldReconciliation?.({
      recordingId: 'stale-recording-a',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: 'student-alex',
      displayName: 'assignment-a-stale.mp3',
      durationSec: null,
      channels: null,
      audioTopology: 'mixed_recording',
      bytes: 5,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    });

    await waitFor(() => expect(screen.queryByText(/assignment-a-stale\.mp3/i)).toBeNull());
    expect(screen.getByText(/Recording: assignment-b\.mp3/i)).toBeTruthy();
  });

  it('does not hydrate an operation persisted for a different workflow', async () => {
    setupMinimalAssignmentTest();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(workflowStorageKey, 'workflow-current');
    localStorage.setItem(
      pendingOperationStorageKey,
      JSON.stringify({
        id: '44444444-4444-4444-8444-444444444444',
        workflowId: 'workflow-stale',
        studentId: 'student-alex',
        sttProvider: null,
        audioTopology: 'mixed_recording',
      }),
    );
    globalThis.history.replaceState(null, '', '/?studentId=student-alex');

    renderMinimalAssignment();

    await waitFor(() => expect(localStorage.getItem(pendingOperationStorageKey)).toBeNull());
    expect(api.getRecordingUploadOperation).not.toHaveBeenCalled();
  });
});
