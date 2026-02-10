import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../utils/api';
import { MinimalAssignment } from './MinimalAssignment';

vi.mock('../../utils/api', () => ({
  approveJob: vi.fn(),
  cancelJob: vi.fn(),
  createDraft: vi.fn(),
  createPromptPackage: vi.fn(),
  fetchDraft: vi.fn(),
  fetchJobProvenance: vi.fn(),
  fetchJobOptions: vi.fn(),
  fetchPromptPackage: vi.fn(),
  fetchPromptOptions: vi.fn(),
  fetchStudentOptions: vi.fn(),
  fetchRecordingTranscript: vi.fn(),
  getProfileContent: vi.fn(),
  getJobStatus: vi.fn(),
  getRecording: vi.fn(),
  listUserJobs: vi.fn(),
  listProfileContents: vi.fn(),
  listProfileRevisions: vi.fn(),
  materializeDraft: vi.fn(),
  restoreProfileRevision: vi.fn(),
  retryRecordingTranscription: vi.fn(),
  rerunAudioJob: vi.fn(),
  rerunPublishJob: vi.fn(),
  upsertProfileContent: vi.fn(),
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

  const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
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
    globalThis.history.replaceState(null, '', '/');

    vi.mocked(api.fetchPromptOptions).mockResolvedValue({
      templates: [{ id: 'tpl-default', label: 'Default Template' }],
      profiles: [{ id: 'profile-default', label: 'Default Profile' }],
      defaults: {
        templateId: 'tpl-default',
        profileId: 'profile-default',
      },
    });
    vi.mocked(api.fetchJobOptions).mockResolvedValue({
      presets: ['b1-default', 'b2-default'],
      cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
      cefrDefault: 'B1',
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
        {
          type: 'rerun_publish',
          label: 'Rerun publish',
          description: 'Rerun publish stage',
          implemented: true,
        },
      ],
    });
    vi.mocked(api.fetchStudentOptions).mockResolvedValue({
      students: [
        { id: 'student-default', name: 'Default', profileId: 'profile-default.md' },
        { id: 'student-alex', name: 'Alex', profileId: 'profiles/alex.md' },
      ],
    });
    vi.mocked(api.listUserJobs).mockResolvedValue({
      jobs: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    vi.mocked(api.listProfileContents).mockResolvedValue({
      profiles: [{ id: 'profile-default.md', label: 'Default Profile' }],
    });
    vi.mocked(api.getProfileContent).mockResolvedValue({
      id: 'profile-default.md',
      label: 'Default Profile',
      content: 'PROFILE CONTENT',
      currentRevisionId: 'revision-1',
      updatedAt: now,
    });
    vi.mocked(api.listProfileRevisions).mockResolvedValue({
      items: [
        {
          id: 'revision-1',
          profileId: 'profile-default.md',
          contentHash: 'hash-1',
          source: 'create',
          createdAt: now,
          createdBy: null,
          restoredFromRevisionId: null,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      order: 'desc',
    });
    vi.mocked(api.upsertProfileContent).mockResolvedValue({
      id: 'profile-default.md',
      label: 'Default Profile',
      content: 'PROFILE CONTENT',
      currentRevisionId: 'revision-1',
      updatedAt: now,
    });
    vi.mocked(api.restoreProfileRevision).mockResolvedValue({
      id: 'profile-default.md',
      label: 'Default Profile',
      content: 'PROFILE CONTENT',
      currentRevisionId: 'revision-1',
      updatedAt: now,
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
    vi.mocked(api.fetchPromptPackage).mockResolvedValue({
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
    vi.mocked(api.fetchDraft).mockResolvedValue({
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
    vi.mocked(api.fetchJobProvenance).mockResolvedValue({
      job: {
        id: 'job-1',
        state: 'succeeded',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
        sourceJobId: null,
        manifestPath: null,
        notionUrl: 'https://www.notion.so/published-assignment',
        anytypeUrl: null,
        error: null,
      },
      sourceJob: null,
      recording: null,
      transcript: null,
      promptPackage: null,
      draft: null,
      lineage: null,
      actions: [],
    });
    vi.mocked(api.rerunAudioJob).mockResolvedValue({
      success: true,
      message: 'Audio rerun queued',
      actionType: 'rerun_audio',
      jobId: 'job-1',
    });
    vi.mocked(api.rerunPublishJob).mockResolvedValue({
      success: true,
      message: 'Publish rerun queued',
      actionType: 'rerun_publish',
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
    expect(api.listProfileContents).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('heading', { name: /1\. Upload recording/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /6\. Publish/i })).toBeTruthy();
  });

  it('rehydrates workflow state from server job context in query params', async () => {
    const user = userEvent.setup();
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
          notionDatabase: null,
          publishTarget: 'anytype',
          ttsStrategy: 'auto',
          autoPublish: false,
          notionUrl: null,
          anytypeUrl: null,
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
      notionDatabase: null,
      publishTarget: 'anytype',
      ttsStrategy: 'auto',
      autoPublish: false,
      notionUrl: null,
      anytypeUrl: null,
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
    render(<MinimalAssignment />);

    await waitFor(() => {
      expect(api.getJobStatus).toHaveBeenCalledWith('job-resume');
    });

    const resumeSelect = screen.getByRole('combobox', { name: /Recent jobs/i });
    expect(within(resumeSelect).getByRole('option', { name: /Alex/i })).toBeTruthy();
    expect(within(resumeSelect).queryByRole('option', { name: /No saved jobs yet/i })).toBeNull();

    expect(await screen.findByDisplayValue('Recovered transcript')).toBeTruthy();
    expect(await screen.findByDisplayValue('Recovered prompt')).toBeTruthy();
    expect(await screen.findByDisplayValue('# Recovered draft')).toBeTruthy();
    expect((await screen.findByRole('combobox', { name: /Preset/i }) as HTMLSelectElement).value).toBe(
      'b2-default',
    );
    resolveProfileOptions({ profiles: [{ id: 'profile-default.md', label: 'Default Profile' }] });
    expect(screen.getAllByText(/Anytype server unreachable/i).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /Generate prompt/i }));
    await waitFor(() => {
      expect(api.createPromptPackage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
        }),
      );
    });

    globalThis.history.replaceState(null, '', '/');
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

  it('shows a cache-hit notice when transcript reuse is available', async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadRecording).mockResolvedValueOnce(
      makeRecording({
        cacheHit: true,
        cacheReason: 'transcript_reused',
      }),
    );
    render(<MinimalAssignment />);

    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(screen.getByText(/Reused an existing transcript/i)).toBeTruthy();
    });
  });

  it('saves profile edits and refreshes revisions', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    const profileEditor = await screen.findByRole('textbox', { name: /Profile content/i });
    await waitFor(() => {
      expect((profileEditor as HTMLTextAreaElement).disabled).toBe(false);
    });
    await user.clear(profileEditor);
    await user.type(profileEditor, 'Updated profile content');
    await user.click(screen.getByRole('button', { name: /Save profile/i }));

    await waitFor(() => {
      expect(api.upsertProfileContent).toHaveBeenCalledWith(
        'profile-default.md',
        expect.stringContaining('Updated profile content'),
      );
    });
    expect(api.listProfileRevisions).toHaveBeenCalledWith('profile-default.md', {
      limit: 20,
      offset: 0,
      order: 'desc',
    });
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
        profileId: 'profile-default.md',
      });
    });
    expect(screen.getByDisplayValue('Prompt package output')).toBeTruthy();
  });

  it('syncs profile to selected student binding before prompt generation', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    const studentSelect = await screen.findByRole('combobox', { name: /Student \(optional\)/i });
    await user.selectOptions(studentSelect, 'student-alex');
    await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Generate prompt/i }));

    await waitFor(() => {
      expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
        templateId: 'tpl-default',
        profileId: 'profiles/alex.md',
      });
    });
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

    const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
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

    const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
    expect(draftTextarea).toBeTruthy();
    if (!draftTextarea) {
      throw new Error('Expected draft textarea to be rendered');
    }
    await user.type(draftTextarea, '# Final draft');
    await user.selectOptions(screen.getByRole('combobox', { name: /Preset/i }), 'b2-default');

    await user.click(screen.getByRole('button', { name: /Publish assignment/i }));

    await waitFor(() => {
      expect(api.createDraft).toHaveBeenCalledWith('pkg-1', '# Final draft');
    });
    expect(api.materializeDraft).toHaveBeenCalledWith('draft-1', {
      jobOverrides: {
        preset: 'b2-default',
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

  it('queues a publish-only rerun action for the current job', async () => {
    const user = userEvent.setup();
    render(<MinimalAssignment />);

    await publishAssignmentFlow(user);

    await user.click(screen.getAllByRole('button', { name: /Rerun publish/i })[0]!);

    await waitFor(() => {
      expect(api.rerunPublishJob).toHaveBeenCalledWith('job-1');
    });
    expect(screen.getByText('Publish rerun queued')).toBeTruthy();
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
    const actionsHeading = screen.getByRole('heading', { name: /7\. Job actions/i });
    const actionsSection = actionsHeading.closest('section');
    if (!actionsSection) {
      throw new Error('Expected job actions section to be rendered');
    }
    await user.click(within(actionsSection).getByRole('button', { name: /Cancel job/i }));

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
