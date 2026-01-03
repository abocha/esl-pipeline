import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TranscriptionWorkspace } from './TranscriptionWorkspace';
import { useJobMonitor, type JobEntry, type RecordingEntry } from '../../context/JobMonitorContext';
import {
  approveJob,
  createDraft,
  createPromptPackage,
  fetchPromptOptions,
  fetchStudentOptions,
  materializeDraft,
} from '../../utils/api';

vi.mock('../../context/JobMonitorContext', () => ({
  useJobMonitor: vi.fn(),
}));

vi.mock('../../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../utils/api')>('../../utils/api');
  return {
    ...actual,
    approveJob: vi.fn(),
    createDraft: vi.fn(),
    createPromptPackage: vi.fn(),
    fetchPromptOptions: vi.fn(),
    fetchPromptPackage: vi.fn(),
    fetchRecordingTranscript: vi.fn(),
    fetchStudentOptions: vi.fn(),
    materializeDraft: vi.fn(),
    retryRecordingTranscription: vi.fn(),
    syncRecordings: vi.fn(),
    updateRecordingTranscript: vi.fn(),
    uploadRecording: vi.fn(),
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

const createRecording = (overrides: Partial<RecordingEntry>): RecordingEntry => ({
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

describe('TranscriptionWorkspace filters and approval flow', () => {
  const mockUseJobMonitor = vi.mocked(useJobMonitor);
  const mockFetchStudentOptions = vi.mocked(fetchStudentOptions);
  const mockFetchPromptOptions = vi.mocked(fetchPromptOptions);
  let trackJobMock: ReturnType<typeof vi.fn<(jobId: string) => Promise<JobEntry | undefined>>>;

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    trackJobMock = vi
      .fn<(jobId: string) => Promise<JobEntry | undefined>>()
      .mockResolvedValue(void 0);

    mockUseJobMonitor.mockReturnValue({
      jobs: [],
      jobMap: {},
      recordings: [
        createRecording({
          recordingId: 'rec-1',
          displayName: 'Anna lesson.opus',
          status: 'transcribed',
          source: 'upload',
          studentId: 'student-1',
        }),
        createRecording({
          recordingId: 'rec-2',
          displayName: 'Bob session.opus',
          status: 'failed',
          source: 'scan',
          studentId: 'student-2',
        }),
        createRecording({
          recordingId: 'rec-3',
          displayName: 'Anna followup.opus',
          status: 'queued',
          source: 'upload',
          studentId: 'student-1',
        }),
      ],
      recordingMap: {},
      registerJob: vi.fn(),
      registerRecording: vi.fn(),
      refreshRecordings: vi.fn().mockResolvedValue(void 0),
      trackJob: trackJobMock,
      connectionState: 'connected',
      isPolling: false,
      lastError: null,
      liveUpdatesPaused: false,
      pauseLiveUpdates: vi.fn(),
      resumeLiveUpdates: vi.fn(),
    });

    mockFetchStudentOptions.mockResolvedValue({
      students: [
        { id: 'student-1', name: 'Anna' },
        { id: 'student-2', name: 'Bob' },
      ],
    });

    mockFetchPromptOptions.mockResolvedValue({
      templates: [{ id: 'template-1', label: 'Template' }],
      profiles: [{ id: 'profile-1', label: 'Profile' }],
      defaults: { templateId: 'template-1', profileId: 'profile-1' },
    });
  });

  it('filters recordings by search query', async () => {
    render(<TranscriptionWorkspace />);

    await waitFor(() => {
      expect(mockFetchStudentOptions).toHaveBeenCalled();
    });

    expect(screen.getAllByText('Anna lesson.opus').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bob session.opus').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: 'bob' },
    });

    expect(screen.queryAllByText('Anna lesson.opus')).toHaveLength(0);
    expect(screen.getAllByText('Bob session.opus').length).toBeGreaterThan(0);
  });

  it('filters recordings by student, status, and source', async () => {
    render(<TranscriptionWorkspace />);

    await waitFor(() => {
      expect(mockFetchStudentOptions).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Student'), {
      target: { value: 'student-1' },
    });
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'transcribed' },
    });
    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'upload' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('Anna lesson.opus').length).toBeGreaterThan(0);
      expect(screen.queryAllByText('Bob session.opus')).toHaveLength(0);
      expect(screen.queryAllByText('Anna followup.opus')).toHaveLength(0);
    });
  });

  it('approves a draft without a manual job ID', async () => {
    const mockCreatePromptPackage = vi.mocked(createPromptPackage);
    const mockCreateDraft = vi.mocked(createDraft);
    const mockMaterializeDraft = vi.mocked(materializeDraft);
    const mockApproveJob = vi.mocked(approveJob);

    mockCreatePromptPackage.mockResolvedValue({
      id: 'prompt-1',
      recordingId: 'rec-1',
      transcriptId: 'transcript-1',
      studentId: 'student-1',
      profilePath: 'profile-1',
      templateVersion: 'template-1',
      notes: null,
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:01:00.000Z',
    });

    mockCreateDraft.mockResolvedValue({
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-1',
      storageUri: 'local://drafts/draft-1.md',
      createdBy: 'test-user',
      text: 'DRAFT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:02:00.000Z',
    });

    mockMaterializeDraft.mockResolvedValue({
      draftId: 'draft-1',
      jobId: 'job-1',
      mdPath: '/uploads/drafts/draft-1.md',
    });

    mockApproveJob.mockResolvedValue({
      jobId: 'job-1',
      md: '/uploads/drafts/draft-1.md',
      recordingId: 'rec-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      preset: null,
      withTts: null,
      upload: null,
      voiceId: null,
      voiceAccent: null,
      forceTts: null,
      notionDatabase: null,
      ttsStrategy: null,
      notionUrl: null,
      state: 'queued',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    render(<TranscriptionWorkspace />);

    await waitFor(() => {
      expect(mockFetchPromptOptions).toHaveBeenCalled();
    });

    const [annaRecording] = screen.getAllByText('Anna lesson.opus');
    if (!annaRecording) {
      throw new Error('Expected recording entry for Anna lesson.opus');
    }
    fireEvent.click(annaRecording);

    const [buildPromptButton] = screen.getAllByRole('button', { name: /build prompt package/i });
    if (!buildPromptButton) {
      throw new Error('Expected Build prompt package action');
    }
    fireEvent.click(buildPromptButton);

    await waitFor(() => {
      expect(mockCreatePromptPackage).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({
          profileId: 'profile-1',
          templateId: 'template-1',
        }),
      );
    });

    fireEvent.change(screen.getByPlaceholderText('Paste LLM draft markdown'), {
      target: { value: 'DRAFT TEXT' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(mockCreateDraft).toHaveBeenCalledWith('prompt-1', 'DRAFT TEXT');
    });

    fireEvent.click(screen.getByRole('button', { name: /materialize & approve/i }));

    await waitFor(() => {
      expect(mockMaterializeDraft).toHaveBeenCalledWith('draft-1');
      expect(mockApproveJob).toHaveBeenCalledWith('job-1', '/uploads/drafts/draft-1.md');
      expect(trackJobMock).toHaveBeenCalledWith('job-1');
    });
  });
});
