import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import {
  JobMonitorProvider,
  useJobMonitor,
} from './JobMonitorContext';
import {
  listRecordings,
  subscribeToJobEvents,
  type JobEvent,
  type RecordingListItem,
} from '../utils/api';

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../utils/api')>('../utils/api');
  return {
    ...actual,
    listRecordings: vi.fn(),
    subscribeToJobEvents: vi.fn(),
    getJobStatus: vi.fn().mockResolvedValue(null),
  };
});

const RecordingList = () => {
  const { recordings } = useJobMonitor();
  return (
    <ul>
      {recordings.map((recording) => (
        <li key={recording.recordingId}>
          {recording.recordingId}:{recording.status}:{recording.studentId ?? 'none'}
        </li>
      ))}
    </ul>
  );
};

const createRecording = (overrides: Partial<RecordingListItem>): RecordingListItem => ({
  recordingId: 'recording-1',
  status: 'queued',
  transcriptId: null,
  error: null,
  source: 'scan',
  studentId: null,
  displayName: 'recording-1.opus',
  durationSec: null,
  channels: null,
  bytes: 1024,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:05:00.000Z',
  ...overrides,
});

describe('JobMonitorContext recordings hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates recordings list on mount', async () => {
    const listRecordingsMock = vi.mocked(listRecordings);
    listRecordingsMock.mockResolvedValue({
      items: [createRecording({ status: 'transcribed' })],
      limit: 50,
      offset: 0,
      total: 1,
      order: 'desc',
    });

    const subscribeMock = vi.mocked(subscribeToJobEvents);
    subscribeMock.mockImplementation((_handler, options = {}) => {
      options.onOpen?.(new Event('open'));
      return {
        addEventListener: vi.fn(),
        close: vi.fn(),
      } as unknown as EventSource;
    });

    render(
      <JobMonitorProvider>
        <RecordingList />
      </JobMonitorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('recording-1:transcribed:none')).not.toBeNull();
    });
  });

  it('merges SSE updates into recordings list', async () => {
    const listRecordingsMock = vi.mocked(listRecordings);
    listRecordingsMock.mockResolvedValue({
      items: [createRecording({ recordingId: 'recording-1', status: 'queued' })],
      limit: 50,
      offset: 0,
      total: 1,
      order: 'desc',
    });

    const subscribeMock = vi.mocked(subscribeToJobEvents);
    let eventHandler: ((event: JobEvent) => void) | null = null;
    subscribeMock.mockImplementation((handler, options = {}) => {
      eventHandler = handler;
      options.onOpen?.(new Event('open'));
      return {
        addEventListener: vi.fn(),
        close: vi.fn(),
      } as unknown as EventSource;
    });

    render(
      <JobMonitorProvider>
        <RecordingList />
      </JobMonitorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('recording-1:queued:none')).not.toBeNull();
    });

    const handler = eventHandler as ((event: JobEvent) => void) | null;
    handler?.({
      type: 'recording_state_changed',
      recordingId: 'recording-2',
      status: 'transcribing',
      transcriptId: null,
      error: null,
      studentId: 'student-2',
    });

    await waitFor(() => {
      expect(screen.getByText('recording-2:transcribing:student-2')).not.toBeNull();
    });
  });
});
