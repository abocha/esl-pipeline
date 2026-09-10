// @vitest-environment jsdom
// biome-ignore-all assist/source/organizeImports: the test harness must register API mocks before the controller module loads.
import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it } from 'vitest';

import type { JobEvent, RecordingListItem } from '../../utils/api';
import {
  testAct as act,
  testApi as api,
  createMinimalUser,
  testExpect as expect,
  makeRecording,
  makeTranscript,
  renderMinimalAssignment,
  renderResumedAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  startNewAssignmentForLearner,
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';
import { useMinimalAssignmentSourceController } from './MinimalAssignment.source';

describe('MinimalAssignment recording projection', () => {
  beforeEach(() => {
    setupMinimalAssignmentTest();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('shows upload transport and server-side checking as distinct normal-user states', async () => {
    const checking = makeRecording({
      status: 'ingested',
      productState: 'checking',
      runState: null,
    });
    let resolveUpload: ((recording: RecordingListItem) => void) | undefined;
    vi.mocked(api.uploadRecording).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    vi.mocked(api.getRecording).mockResolvedValue(checking);

    const user = createMinimalUser();
    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));

    expect(await screen.findByText('Uploading recording')).toBeTruthy();
    await act(async () => {
      resolveUpload?.(checking);
    });
    expect(await screen.findAllByText('Checking recording')).not.toHaveLength(0);
  });

  it.each([
    ['queued', 'waiting', 'queued', 'Waiting to transcribe'],
    ['transcribing', 'transcribing', 'submitting', 'Transcribing'],
    ['transcribing', 'retrying', 'retry_wait', 'Trying again automatically'],
    ['transcribed', 'ready', 'succeeded', 'Ready for review'],
  ] as const)(
    'renders canonical %s/%s state from upload and polling',
    async (status, productState, runState, label) => {
      const projected = makeRecording({
        status,
        productState,
        runState,
        transcriptId: status === 'transcribed' ? 'tx-1' : null,
      });
      vi.mocked(api.uploadRecording).mockResolvedValue(projected);
      vi.mocked(api.getRecording).mockResolvedValue(projected);

      const user = createMinimalUser();
      renderMinimalAssignment();
      await startNewAssignmentForLearner(user);
      fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));

      expect(await screen.findAllByText(label)).not.toHaveLength(0);
      expect(screen.queryByRole('button', { name: /Retry transcript/i })).toBeNull();
    },
  );

  it('keeps retry_wait nonterminal across a fresh session resume', async () => {
    vi.mocked(api.getRecording).mockResolvedValue(
      makeRecording({
        status: 'transcribing',
        productState: 'retrying',
        runState: 'retry_wait',
        transcriptId: null,
      }),
    );

    await renderResumedAssignment(
      { status: { state: 'running', transcriptId: null, promptPackageId: null } },
      { waitFor: 'none' },
    );

    expect(screen.getAllByText('Trying again automatically')).not.toHaveLength(0);
    expect(screen.queryByText('Recording needs attention')).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry transcript/i })).toBeNull();
  });

  it('shows an actionable terminal state without exposing manual STT retry', async () => {
    const failed = makeRecording({
      status: 'failed',
      productState: 'attention',
      runState: 'failed',
      error: 'transcription_unavailable_after_retries',
      errorCode: 'transcription_unavailable_after_retries',
    });
    vi.mocked(api.uploadRecording).mockResolvedValue(failed);
    vi.mocked(api.getRecording).mockResolvedValue(failed);

    const user = createMinimalUser();
    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));

    expect(await screen.findAllByText('Recording needs attention')).not.toHaveLength(0);
    expect(screen.getAllByText(/Upload the recording again later/i)).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Retry transcript/i })).toBeNull();
  });

  it('keeps a cache-hit recording ready with no synthesized run or audio control', async () => {
    const cacheHit = makeRecording({
      status: 'transcribed',
      productState: 'ready',
      runState: null,
      transcriptId: 'tx-1',
      audioLifecycle: 'not_retained',
      audioAvailable: false,
      cacheHit: true,
    });
    vi.mocked(api.uploadRecording).mockResolvedValue(cacheHit);
    vi.mocked(api.getRecording).mockResolvedValue(cacheHit);

    const user = createMinimalUser();
    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));

    expect(await screen.findAllByText('Ready for review')).not.toHaveLength(0);
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.queryByRole('link', { name: /download audio/i })).toBeNull();
  });

  it('preserves cache-hit ready/no-audio truth on fresh resume', async () => {
    vi.mocked(api.getRecording).mockResolvedValue(
      makeRecording({
        status: 'transcribed',
        productState: 'ready',
        runState: null,
        transcriptId: 'tx-1',
        audioLifecycle: 'not_retained',
        audioAvailable: false,
      }),
    );

    await renderResumedAssignment({ status: { state: 'succeeded' } }, { waitFor: 'none' });

    expect(screen.getAllByText('Ready for review')).not.toHaveLength(0);
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.queryByRole('link', { name: /download audio/i })).toBeNull();
  });

  it('renders required speaker-role pickers from a live mixed-recording SSE event', async () => {
    let receiveEvent: ((event: JobEvent) => void) | null = null;
    vi.mocked(api.subscribeToJobEvents).mockImplementation((onEvent) => {
      receiveEvent = onEvent;
      return { close: vi.fn() } as never;
    });
    const transcribing = makeRecording({
      status: 'transcribing',
      productState: 'transcribing',
      runState: 'submitting',
      transcriptId: null,
      audioTopology: null,
      updatedAt: '2026-09-10T10:00:00.000Z',
    });
    vi.mocked(api.uploadRecording).mockResolvedValue(transcribing);
    vi.mocked(api.getRecording).mockResolvedValue(transcribing);
    vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(
      makeTranscript({
        summaryJson: {
          audioTopology: 'mixed_recording',
          speakerTracks: { speakers: [{ speaker: 0 }, { speaker: 1 }] },
        },
      }),
    );

    const user = createMinimalUser();
    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await waitFor(() => expect(receiveEvent).not.toBeNull());

    await act(async () => {
      receiveEvent?.({
        type: 'recording_state_changed',
        ...makeRecording({
          status: 'transcribed',
          productState: 'ready',
          runState: 'succeeded',
          transcriptId: 'tx-1',
          audioTopology: 'mixed_recording',
          updatedAt: '2026-09-10T10:00:01.000Z',
        }),
      });
    });

    expect(await screen.findByRole('combobox', { name: /Speaker 1/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Speaker 2/i })).toBeTruthy();
    expect(api.fetchRecordingTranscript).toHaveBeenCalledWith('rec-1');
    expect(api.getRecording).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale SSE update after newer polling truth has hydrated', async () => {
    let receiveEvent: ((event: JobEvent) => void) | null = null;
    vi.mocked(api.subscribeToJobEvents).mockImplementation((onEvent) => {
      receiveEvent = onEvent;
      return { close: vi.fn() } as never;
    });
    vi.mocked(api.uploadRecording).mockResolvedValue(
      makeRecording({ status: 'queued', updatedAt: '2026-09-07T10:00:00.000Z' }),
    );
    vi.mocked(api.getRecording).mockResolvedValue(
      makeRecording({
        status: 'transcribing',
        productState: 'retrying',
        runState: 'retry_wait',
        updatedAt: '2026-09-07T10:00:02.000Z',
      }),
    );

    const user = createMinimalUser();
    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await waitFor(() => expect(api.getRecording).toHaveBeenCalled());
    expect(await screen.findAllByText('Trying again automatically')).not.toHaveLength(0);

    await act(async () => {
      receiveEvent?.({
        type: 'recording_state_changed',
        ...makeRecording({
          status: 'transcribing',
          productState: 'transcribing',
          runState: 'submitting',
          updatedAt: '2026-09-07T10:00:01.000Z',
        }),
      });
    });

    expect(screen.getAllByText('Trying again automatically')).not.toHaveLength(0);
    expect(screen.queryByText(/^Transcribing$/)).toBeNull();
  });

  it('rejects delayed poll and SSE updates from a replaced recording', async () => {
    const oldRecording = makeRecording({
      recordingId: 'recording-old',
      displayName: 'old.mp3',
      status: 'queued',
      updatedAt: '2026-09-07T10:00:00.000Z',
    });
    const newRecording = makeRecording({
      recordingId: 'recording-new',
      displayName: 'new.mp3',
      status: 'queued',
      updatedAt: '2026-09-07T10:00:01.000Z',
    });
    vi.mocked(api.uploadRecording)
      .mockResolvedValueOnce(oldRecording)
      .mockResolvedValueOnce(newRecording);
    let resolveOldPoll: ((recording: RecordingListItem) => void) | undefined;
    vi.mocked(api.getRecording).mockImplementation((recordingId) =>
      recordingId === oldRecording.recordingId
        ? new Promise((resolve) => {
            resolveOldPoll = resolve;
          })
        : Promise.resolve(newRecording),
    );
    const eventHandlers: Array<(event: JobEvent) => void> = [];
    vi.mocked(api.subscribeToJobEvents).mockImplementation((onEvent) => {
      eventHandlers.push(onEvent);
      return { close: vi.fn() } as never;
    });

    const user = createMinimalUser();
    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await screen.findByText(/Recording: old\.mp3/i);
    await waitFor(() => expect(api.getRecording).toHaveBeenCalledWith('recording-old'));
    fireEvent.click(screen.getByRole('button', { name: /Replace audio/i }));
    fireEvent.click(screen.getByRole('button', { name: /Drop replacement audio/i }));
    await screen.findByText(/Recording: new\.mp3/i);

    await act(async () => {
      resolveOldPoll?.(
        makeRecording({
          recordingId: 'recording-old',
          displayName: 'old-stale.mp3',
          status: 'transcribing',
          productState: 'retrying',
          runState: 'retry_wait',
          updatedAt: '2026-09-07T10:00:02.000Z',
        }),
      );
      eventHandlers[0]?.({
        type: 'recording_state_changed',
        ...makeRecording({
          recordingId: 'recording-old',
          displayName: 'old-stale.mp3',
          status: 'failed',
          productState: 'attention',
          runState: 'failed',
          updatedAt: '2026-09-07T10:00:03.000Z',
        }),
      });
    });

    expect(screen.getByText(/Recording: new\.mp3/i)).toBeTruthy();
    expect(screen.queryByText(/old-stale\.mp3/i)).toBeNull();
  });

  it('rejects a delayed transcript response from a replaced recording', async () => {
    const oldRecording = makeRecording({
      recordingId: 'recording-old',
      displayName: 'old.mp3',
      status: 'transcribed',
      productState: 'ready',
      runState: 'succeeded',
      transcriptId: 'transcript-old',
    });
    const newRecording = makeRecording({
      recordingId: 'recording-new',
      displayName: 'new.mp3',
      status: 'transcribed',
      productState: 'ready',
      runState: 'succeeded',
      transcriptId: 'transcript-new',
      updatedAt: '2026-09-07T10:00:01.000Z',
    });
    vi.mocked(api.uploadRecording)
      .mockResolvedValueOnce(oldRecording)
      .mockResolvedValueOnce(newRecording);
    vi.mocked(api.getRecording).mockImplementation((recordingId) =>
      Promise.resolve(recordingId === oldRecording.recordingId ? oldRecording : newRecording),
    );
    let resolveOldTranscript: ((transcript: ReturnType<typeof makeTranscript>) => void) | undefined;
    vi.mocked(api.fetchRecordingTranscript).mockImplementation((recordingId) =>
      recordingId === oldRecording.recordingId
        ? new Promise((resolve) => {
            resolveOldTranscript = resolve;
          })
        : Promise.resolve(
            makeTranscript({
              recordingId: newRecording.recordingId,
              transcriptId: 'transcript-new',
              text: 'New lesson transcript',
            }),
          ),
    );

    const user = createMinimalUser();
    renderMinimalAssignment();
    await startNewAssignmentForLearner(user);
    fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
    await waitFor(() => expect(api.fetchRecordingTranscript).toHaveBeenCalledWith('recording-old'));
    fireEvent.click(screen.getByRole('button', { name: /Replace audio/i }));
    fireEvent.click(screen.getByRole('button', { name: /Drop replacement audio/i }));
    await screen.findByDisplayValue('New lesson transcript');

    await act(async () => {
      resolveOldTranscript?.(
        makeTranscript({
          recordingId: oldRecording.recordingId,
          transcriptId: 'transcript-old',
          text: 'Stale old transcript',
        }),
      );
    });

    expect(screen.getByDisplayValue('New lesson transcript')).toBeTruthy();
    expect(screen.queryByDisplayValue('Stale old transcript')).toBeNull();
  });

  it('rejects a delayed refresh error from a replaced recording', async () => {
    let rejectOldRefresh: ((error: Error) => void) | undefined;
    vi.mocked(api.fetchRecordingTranscript).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectOldRefresh = reject;
        }),
    );
    const oldRecording = makeRecording({ recordingId: 'recording-old' });
    const newRecording = makeRecording({ recordingId: 'recording-new' });
    vi.mocked(api.getRecording).mockImplementation((recordingId) =>
      Promise.resolve(recordingId === oldRecording.recordingId ? oldRecording : newRecording),
    );

    function RefreshRaceHarness() {
      const source = useMinimalAssignmentSourceController({
        configuredSttProviders: ['deepgram'],
        defaultSttProvider: 'deepgram',
        initialSelectedStudentId: 'student-alex',
        onBeforeUploadReset: () => undefined,
      });
      const hydrate = (recording: RecordingListItem) =>
        source.applyHydratedSnapshot({
          recording,
          recordingStatus: recording.status,
          recordingError: null,
          selectedFileName: recording.displayName,
          transcript: makeTranscript({ recordingId: recording.recordingId }),
          transcriptText: 'Current transcript',
          transcriptStatus: 'ready',
          transcriptError: null,
          selectedStudentId: 'student-alex',
          uploadError: null,
          uploadCacheNotice: null,
        });
      return (
        <div>
          <button type="button" onClick={() => hydrate(oldRecording)}>
            Hydrate old
          </button>
          <button type="button" onClick={() => void source.refreshTranscriptPreservingLocal()}>
            Refresh old
          </button>
          <button type="button" onClick={() => hydrate(newRecording)}>
            Hydrate new
          </button>
          <span>{source.recording?.recordingId}</span>
          <span>{source.transcriptError ?? 'no transcript error'}</span>
        </div>
      );
    }

    render(<RefreshRaceHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Hydrate old' }));
    await screen.findByText('recording-old');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh old' }));
    await waitFor(() => expect(api.fetchRecordingTranscript).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Hydrate new' }));
    await screen.findByText('recording-new');
    await act(async () => rejectOldRefresh?.(new Error('stale refresh failed')));

    expect(screen.getByText('recording-new')).toBeTruthy();
    expect(screen.getByText('no transcript error')).toBeTruthy();
    expect(screen.queryByText('stale refresh failed')).toBeNull();
  });
});
