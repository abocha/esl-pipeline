import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { NotificationLedger } from './NotificationLedger';
import { useJobMonitor, type LedgerEntry } from '../../context/JobMonitorContext';

vi.mock('../../context/JobMonitorContext', () => ({
  useJobMonitor: vi.fn(),
}));

describe('NotificationLedger', () => {
  const mockUseJobMonitor = vi.mocked(useJobMonitor);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters ledger entries by severity', () => {
    const entries: LedgerEntry[] = [
      {
        id: '1',
        type: 'job_state_changed',
        severity: 'success',
        objectType: 'job',
        objectId: 'job-1',
        timestamp: Date.now(),
        message: 'Job job-1 succeeded.',
        source: 'sse',
      },
      {
        id: '2',
        type: 'job_state_changed',
        severity: 'error',
        objectType: 'job',
        objectId: 'job-2',
        timestamp: Date.now(),
        message: 'Job job-2 failed.',
        source: 'sse',
      },
    ];

    mockUseJobMonitor.mockReturnValue({
      jobs: [],
      jobMap: {},
      recordings: [],
      recordingMap: {},
      eventLog: entries,
      lastUpdateAt: Date.now(),
      registerJob: vi.fn(),
      registerRecording: vi.fn(),
      refreshRecordings: vi.fn(),
      trackJob: vi.fn(),
      connectionState: 'connected',
      isPolling: false,
      lastError: null,
      liveUpdatesPaused: false,
      pauseLiveUpdates: vi.fn(),
      resumeLiveUpdates: vi.fn(),
    });

    render(<NotificationLedger />);

    expect(screen.getByText('Job job-1 succeeded.')).not.toBeNull();
    expect(screen.getByText('Job job-2 failed.')).not.toBeNull();

    const successFilter = screen.getByRole('button', { name: /Success/ });
    fireEvent.click(successFilter);

    expect(screen.queryByText('Job job-1 succeeded.')).toBeNull();
    expect(screen.getByText('Job job-2 failed.')).not.toBeNull();
  });

  it('shows stale indicator when polling without recent updates', () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-31T12:00:00Z');
    vi.setSystemTime(now);

    mockUseJobMonitor.mockReturnValue({
      jobs: [],
      jobMap: {},
      recordings: [],
      recordingMap: {},
      eventLog: [],
      lastUpdateAt: now.getTime() - 20000,
      registerJob: vi.fn(),
      registerRecording: vi.fn(),
      refreshRecordings: vi.fn(),
      trackJob: vi.fn(),
      connectionState: 'error',
      isPolling: true,
      lastError: 'Disconnected',
      liveUpdatesPaused: false,
      pauseLiveUpdates: vi.fn(),
      resumeLiveUpdates: vi.fn(),
    });

    render(<NotificationLedger />);

    expect(screen.getByText(/Polling • Stale/)).not.toBeNull();
  });
});
