import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../utils/api';
import { MinimalAssignment } from './MinimalAssignment';

vi.mock('../../utils/api', () => ({
  approveJob: vi.fn(),
  cancelJob: vi.fn(),
  createDraft: vi.fn(),
  createPromptPackage: vi.fn(),
  fetchJobOptions: vi.fn(),
  fetchPromptOptions: vi.fn(),
  fetchStudentOptions: vi.fn(),
  fetchRecordingTranscript: vi.fn(),
  getJobStatus: vi.fn(),
  getRecording: vi.fn(),
  materializeDraft: vi.fn(),
  retryRecordingTranscription: vi.fn(),
  rerunAudioJob: vi.fn(),
  updateDraft: vi.fn(),
  updateRecordingTranscript: vi.fn(),
  uploadRecording: vi.fn(),
  validateMarkdown: vi.fn(),
}));

vi.mock('../shared/DropZone', () => ({
  DropZone: ({
    title,
    disabled,
    onFiles,
  }: {
    title: string;
    disabled?: boolean;
    onFiles: (files: File[]) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onFiles([new File(['audio'], 'lesson.mp3', { type: 'audio/mpeg' })]);
      }}
    >
      {title}
    </button>
  ),
}));

vi.mock('../shared/UploadProgress', () => ({
  UploadProgress: ({ progress }: { progress: number }) => <div>Upload progress: {progress}%</div>,
}));

const now = '2026-02-05T00:00:00.000Z';

function makeRecording(overrides: Partial<api.RecordingListItem> = {}): api.RecordingListItem {
  return {
    recordingId: 'rec-1',
    status: 'ingested',
    transcriptId: null,
    error: null,
    source: 'upload',
    studentId: null,
    displayName: 'lesson.mp3',
    durationSec: null,
    channels: null,
    bytes: 1024,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTranscript(
  overrides: Partial<api.RecordingTranscriptResponse> = {},
): api.RecordingTranscriptResponse {
  return {
    recordingId: 'rec-1',
    transcriptId: 'tx-1',
    text: 'Student transcript text',
    summaryJson: null,
    model: 'mock-model',
    language: 'en',
    mode: 'timeline',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function publishAssignmentFlow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

  await waitFor(() => {
    expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
  });

  await user.click(screen.getByRole('button', { name: /Generate prompt/i }));

  await waitFor(() => {
    expect(screen.getByDisplayValue('Prompt package output')).toBeTruthy();
  });

  const draftTextarea = screen.getAllByRole('textbox').at(-1);
  expect(draftTextarea).toBeTruthy();
  if (!draftTextarea) {
    throw new Error('Expected draft textarea to be rendered');
  }
  await user.type(draftTextarea, '# Final draft');

  await user.click(screen.getByRole('button', { name: /Publish assignment/i }));

  await waitFor(() => {
    expect(screen.getAllByText(/Job ID: job-1/i).length).toBeGreaterThan(0);
  });
}

describe('MinimalAssignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(api.fetchPromptOptions).mockResolvedValue({
      templates: [{ id: 'tpl-default', label: 'Default Template' }],
      profiles: [{ id: 'profile-default', label: 'Default Profile' }],
      defaults: {
        templateId: 'tpl-default',
        profileId: 'profile-default',
      },
    });
    vi.mocked(api.fetchJobOptions).mockResolvedValue({
      presets: ['b1-default'],
      voiceAccents: ['american'],
      voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
      notionDatabases: [{ id: 'db-1', name: 'DB One' }],
      ttsStrategies: ['auto', 'dialogue', 'tts'],
      supportedActions: [
        {
          type: 'rerun_audio',
          label: 'Rerun audio',
          description: 'Regenerate audio',
          implemented: true,
        },
        {
          type: 'cancel',
          label: 'Cancel',
          description: 'Cancel active job',
          implemented: true,
        },
      ],
    });
    vi.mocked(api.fetchStudentOptions).mockResolvedValue({
      students: [
        { id: 'student-default', name: 'Default', profileId: 'profiles/default.md' },
        { id: 'student-alex', name: 'Alex', profileId: 'profiles/alex.md' },
      ],
    });

    vi.mocked(api.uploadRecording).mockResolvedValue(makeRecording());
    vi.mocked(api.getRecording).mockResolvedValue(
      makeRecording({
        status: 'transcribed',
        transcriptId: 'tx-1',
      }),
    );
    vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(makeTranscript());

    vi.mocked(api.createPromptPackage).mockResolvedValue({
      id: 'pkg-1',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      studentId: null,
      profilePath: null,
      templateVersion: 'v1',
      notes: null,
      storageUri: 'memory://prompt/pkg-1',
      text: 'Prompt package output',
      createdAt: now,
      updatedAt: now,
    });

    vi.mocked(api.validateMarkdown).mockResolvedValue({
      ok: true,
      errors: [],
      warnings: [],
    });

    vi.mocked(api.createDraft).mockResolvedValue({
      id: 'draft-1',
      promptPackageId: 'pkg-1',
      studentId: null,
      storageUri: 'memory://drafts/draft-1',
      createdBy: 'user-1',
      text: '# Draft markdown',
      createdAt: now,
      updatedAt: now,
    });

    vi.mocked(api.updateDraft).mockResolvedValue({
      id: 'draft-1',
      promptPackageId: 'pkg-1',
      studentId: null,
      storageUri: 'memory://drafts/draft-1',
      createdBy: 'user-1',
      text: '# Draft markdown',
      createdAt: now,
      updatedAt: now,
    });

    vi.mocked(api.materializeDraft).mockResolvedValue({
      draftId: 'draft-1',
      jobId: 'job-1',
      mdPath: '/tmp/assignment.md',
      mdStorageUri: 's3://esl/drafts/draft-1.md',
    });

    vi.mocked(api.approveJob).mockResolvedValue({ jobId: 'job-1' } as never);
    vi.mocked(api.getJobStatus).mockResolvedValue({
      jobId: 'job-1',
      state: 'succeeded',
      publishTarget: 'notion',
      notionUrl: 'https://www.notion.so/published-assignment',
    } as never);
    vi.mocked(api.rerunAudioJob).mockResolvedValue({
      success: true,
      message: 'Audio rerun queued',
      actionType: 'rerun_audio',
      jobId: 'job-1',
    });
    vi.mocked(api.cancelJob).mockResolvedValue({
      success: true,
      message: 'Job cancelled',
      actionType: 'cancel',
      jobId: 'job-1',
    });
    vi.mocked(api.retryRecordingTranscription).mockResolvedValue(
      makeRecording({
        status: 'transcribing',
      }),
    );
    vi.mocked(api.updateRecordingTranscript).mockResolvedValue(
      makeTranscript({
        text: 'Saved transcript text',
      }),
    );
  });

  it('loads prompt options on mount', async () => {
    render(<MinimalAssignment />);

    await waitFor(() => {
      expect(api.fetchPromptOptions).toHaveBeenCalledTimes(1);
    });
    expect(api.fetchJobOptions).toHaveBeenCalledTimes(1);
    expect(api.fetchStudentOptions).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('heading', { name: /1\. Upload recording/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /5\. Publish/i })).toBeTruthy();
  });

  it('uploads a recording and shows recording metadata', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(api.uploadRecording).toHaveBeenCalledTimes(1);
    });
    expect(api.uploadRecording).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ studentId: 'student-default' }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Recording ID: rec-1/i)).toBeTruthy();
    });
    expect(screen.getByText(/Status: transcribed/i)).toBeTruthy();
  });

  it('allows clearing explicit student selection before upload', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    const studentSelect = await screen.findByRole('combobox', { name: /Student \(optional\)/i });
    await user.selectOptions(studentSelect, '');
    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(api.uploadRecording).toHaveBeenCalledTimes(1);
    });
    expect(api.uploadRecording).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ studentId: undefined }),
    );
  });

  it('generates a prompt after transcript is ready', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Generate prompt/i }));

    await waitFor(() => {
      expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
        templateId: 'tpl-default',
      });
    });
    expect(screen.getByDisplayValue('Prompt package output')).toBeTruthy();
  });

  it('shows upload errors when upload fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadRecording).mockRejectedValueOnce(new Error('Upload failed at gateway'));

    render(<MinimalAssignment />);

    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(screen.getByText('Upload failed at gateway')).toBeTruthy();
    });
  });

  it('prevents draft save when markdown validation fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.validateMarkdown).mockResolvedValueOnce({
      ok: false,
      errors: ['Missing study text block'],
      warnings: [],
    });

    render(<MinimalAssignment />);

    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Generate prompt/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Prompt package output')).toBeTruthy();
    });

    const draftTextarea = screen.getAllByRole('textbox').at(-1);
    expect(draftTextarea).toBeTruthy();
    if (!draftTextarea) {
      throw new Error('Expected draft textarea to be rendered');
    }
    await user.type(draftTextarea, '# Broken draft');

    await user.click(screen.getByRole('button', { name: /Save draft/i }));

    await waitFor(() => {
      expect(screen.getByText('Fix validation errors before saving.')).toBeTruthy();
    });
    expect(api.createDraft).not.toHaveBeenCalled();
  });

  it('publishes a valid draft and displays the resulting job link', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Generate prompt/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Prompt package output')).toBeTruthy();
    });

    const draftTextarea = screen.getAllByRole('textbox').at(-1);
    expect(draftTextarea).toBeTruthy();
    if (!draftTextarea) {
      throw new Error('Expected draft textarea to be rendered');
    }
    await user.type(draftTextarea, '# Final draft');

    await user.click(screen.getByRole('button', { name: /Publish assignment/i }));

    await waitFor(() => {
      expect(api.createDraft).toHaveBeenCalledWith('pkg-1', '# Final draft');
    });
    expect(api.materializeDraft).toHaveBeenCalledWith('draft-1', {
      jobOverrides: {
        publishTarget: 'notion',
      },
    });
    expect(api.approveJob).toHaveBeenCalledWith('job-1', {
      md: '/tmp/assignment.md',
      mdStorageUri: 's3://esl/drafts/draft-1.md',
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Job ID: job-1/i).length).toBeGreaterThan(0);
    });
    const link = screen.getByRole('link', { name: /Open in Notion/i });
    expect(link.getAttribute('href')).toBe('https://www.notion.so/published-assignment');
  });

  it('queues a default rerun audio action for the current job', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    await publishAssignmentFlow(user);

    await user.click(screen.getByRole('button', { name: /Rerun audio/i }));

    await waitFor(() => {
      expect(api.rerunAudioJob).toHaveBeenCalledWith('job-1', {
        forceTts: true,
        ttsStrategy: 'auto',
      });
    });
    expect(screen.getByText('Audio rerun queued')).toBeTruthy();
  });

  it('submits advanced rerun payload values', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    await publishAssignmentFlow(user);

    await user.click(screen.getByRole('button', { name: /Show advanced rerun/i }));
    await user.type(screen.getByPlaceholderText('voice id override'), 'voice-new');
    await user.type(screen.getByPlaceholderText('accent override'), 'british');
    await user.selectOptions(screen.getByRole('combobox', { name: /TTS strategy/i }), 'dialogue');
    await user.type(screen.getByPlaceholderText('e.g. es'), 'es');
    await user.type(screen.getByPlaceholderText('0.42'), '0.42');
    await user.type(screen.getByPlaceholderText('7'), '7');

    await user.click(screen.getByRole('button', { name: /Rerun audio/i }));

    await waitFor(() => {
      expect(api.rerunAudioJob).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          forceTts: true,
          voiceId: 'voice-new',
          voiceAccent: 'british',
          ttsStrategy: 'dialogue',
          dialogueLanguage: 'es',
          dialogueStability: 0.42,
          dialogueSeed: 7,
        }),
      );
    });
  });

  it('submits cancel action with an optional reason when job is running', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getJobStatus)
      .mockResolvedValueOnce({
        jobId: 'job-1',
        state: 'running',
        publishTarget: 'notion',
        notionUrl: null,
      } as never)
      .mockResolvedValueOnce({
        jobId: 'job-1',
        state: 'failed',
        publishTarget: 'notion',
        notionUrl: null,
        error: 'cancelled: duplicate run',
      } as never);

    render(<MinimalAssignment />);
    await publishAssignmentFlow(user);

    const reasonInput = screen.getByPlaceholderText('reason for cancellation');
    await user.type(reasonInput, 'duplicate run');
    await user.click(screen.getByRole('button', { name: /Cancel job/i }));

    await waitFor(() => {
      expect(api.cancelJob).toHaveBeenCalledWith('job-1', { reason: 'duplicate run' });
    });
    expect(screen.getByText(/Job cancelled/i)).toBeTruthy();
  });

  it('keeps cancel disabled for terminal jobs', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    await publishAssignmentFlow(user);

    const cancelButton = screen.getByRole('button', { name: /Cancel job/i });
    expect(cancelButton.getAttribute('disabled')).not.toBeNull();
    expect(screen.getByText(/Cancel is only available for queued or running jobs\./i)).toBeTruthy();
  });
});
