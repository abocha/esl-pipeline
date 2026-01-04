import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentWorkspace } from './StudentWorkspace';
import { StudentSelectionProvider } from '../../context/StudentSelectionContext';
import { useJobMonitor } from '../../context/JobMonitorContext';
import {
  getStudentProfile,
  getStudentTimeline,
  listProfileContents,
  listStudents,
  updateStudentProfile,
} from '../../utils/api';

vi.mock('../../context/JobMonitorContext', () => ({
  useJobMonitor: vi.fn(),
}));

vi.mock('../../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../utils/api')>('../../utils/api');
  return {
    ...actual,
    listStudents: vi.fn(),
    getStudentProfile: vi.fn(),
    createStudentProfile: vi.fn(),
    updateStudentProfile: vi.fn(),
    listProfileContents: vi.fn(),
    getProfileContent: vi.fn(),
    upsertProfileContent: vi.fn(),
    deleteProfileContent: vi.fn(),
    getStudentTimeline: vi.fn(),
    fetchDraft: vi.fn(),
  };
});

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('copy-to-clipboard', () => ({
  __esModule: true,
  default: vi.fn(),
}));

describe('StudentWorkspace', () => {
  const mockUseJobMonitor = vi.mocked(useJobMonitor);
  const mockListStudents = vi.mocked(listStudents);
  const mockGetStudentProfile = vi.mocked(getStudentProfile);
  const mockUpdateStudentProfile = vi.mocked(updateStudentProfile);
  const mockListProfileContents = vi.mocked(listProfileContents);
  const mockGetStudentTimeline = vi.mocked(getStudentTimeline);

  beforeEach(() => {
    vi.clearAllMocks();
    const jobMonitorValue = {
      jobs: [],
      jobMap: {},
      recordings: [],
      recordingMap: {},
      registerJob: vi.fn(),
      registerRecording: vi.fn(),
      refreshRecordings: vi.fn().mockResolvedValue(void 0),
      trackJob: vi.fn().mockResolvedValue(void 0),
      connectionState: 'idle',
      isPolling: false,
      lastError: null,
      liveUpdatesPaused: false,
      pauseLiveUpdates: vi.fn(),
      resumeLiveUpdates: vi.fn(),
    } satisfies ReturnType<typeof useJobMonitor>;
    mockUseJobMonitor.mockReturnValue(jobMonitorValue);

    mockListStudents.mockResolvedValue({
      items: [
        {
          id: 'student-1',
          student: 'Anna',
          dbId: null,
          pageParentId: null,
          colorPreset: null,
          accentPreference: null,
          voices: {},
          manifestPreset: null,
          profileId: null,
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
      order: 'asc',
    });

    mockGetStudentProfile.mockResolvedValue({
      id: 'student-1',
      student: 'Anna',
      dbId: null,
      pageParentId: null,
      colorPreset: null,
      accentPreference: null,
      voices: {},
      manifestPreset: null,
      profileId: null,
    });

    mockListProfileContents.mockResolvedValue({
      profiles: [{ id: 'profile.md', label: 'Profile' }],
    });

    mockGetStudentTimeline.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
      order: 'desc',
    });
  });

  afterEach(() => {
    cleanup();
  });

  const renderWorkspace = () =>
    render(
      <StudentSelectionProvider>
        <StudentWorkspace />
      </StudentSelectionProvider>,
    );

  it('loads students and selects a profile', async () => {
    renderWorkspace();

    await waitFor(() => {
      expect(mockListStudents).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('Anna'));

    await waitFor(() => {
      expect(mockGetStudentProfile).toHaveBeenCalledWith('student-1');
    });

    expect(await screen.findByDisplayValue('Anna')).toBeTruthy();
  });

  it('saves student updates', async () => {
    mockUpdateStudentProfile.mockResolvedValue({
      id: 'student-1',
      student: 'Anna',
      dbId: null,
      pageParentId: null,
      colorPreset: 'b1-default',
      accentPreference: null,
      voices: {},
      manifestPreset: null,
      profileId: null,
    });

    renderWorkspace();
    await waitFor(() => expect(mockListStudents).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Anna'));

    await waitFor(() => expect(mockGetStudentProfile).toHaveBeenCalled());

    await screen.findByDisplayValue('Anna');

    fireEvent.change(screen.getByLabelText('Color preset'), {
      target: { value: 'b1-default' },
    });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => {
      expect(mockUpdateStudentProfile).toHaveBeenCalledWith('student-1', expect.objectContaining({
        colorPreset: 'b1-default',
      }));
    });
  });

  it('refreshes timeline when filters change', async () => {
    renderWorkspace();

    await waitFor(() => {
      expect(mockListStudents).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('Anna'));
    await waitFor(() => expect(mockGetStudentProfile).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'draft_saved' },
    });

    await waitFor(() => {
      expect(mockGetStudentTimeline).toHaveBeenCalledWith('student-1', expect.objectContaining({
        type: 'draft_saved',
      }));
    });
  });
});
