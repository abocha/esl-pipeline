/* eslint-disable react-refresh/only-export-components */
import {
  act,
  configure,
  fireEvent,
  type RenderResult,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vitest';

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
  generateDraft: vi.fn(),
  GenerationDraftApiError: class GenerationDraftApiError extends Error {
    code?: string;
    provider?: string;
    model?: string;
    requestId?: string;
    timestamp?: string;

    constructor(
      message: string,
      details: {
        code?: string;
        provider?: string;
        model?: string;
        requestId?: string;
        timestamp?: string;
      } = {},
    ) {
      super(message);
      this.name = 'GenerationDraftApiError';
      this.code = details.code;
      this.provider = details.provider;
      this.model = details.model;
      this.requestId = details.requestId;
      this.timestamp = details.timestamp;
    }
  },
  getProfileContent: vi.fn(),
  getJobStatus: vi.fn(),
  getRecording: vi.fn(),
  listUserJobs: vi.fn(),
  listProfileContents: vi.fn(),
  listProfileRevisions: vi.fn(),
  materializeDraft: vi.fn(),
  restoreProfileRevision: vi.fn(),
  retryRecordingTranscription: vi.fn(),
  rerunJob: vi.fn(),
  renderHtmlPreview: vi
    .fn()
    .mockResolvedValue({ html: '<html><body><h1>Preview</h1></body></html>' }),
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
const UI_WAIT_TIMEOUT_MS = 3_000;
const INTEGRATION_TEST_TIMEOUT_MS = 15_000;
const scrollIntoViewMock = vi.fn();
configure({ asyncUtilTimeout: UI_WAIT_TIMEOUT_MS });

export function makeJobStatus(overrides: Partial<api.JobStatus> = {}): api.JobStatus {
  return {
    jobId: 'job-1',
    studentId: null,
    md: '/tmp/assignment.md',
    mdStorageUri: null,
    pronunciationMode: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    preset: 'b1-default',
    learningPresetId: null,
    withTts: true,
    voiceId: null,
    upload: 's3',
    voiceAccent: null,
    forceTts: false,
    notionDatabase: null,
    publishTarget: 'html',
    ttsStrategy: 'auto',
    ttsProvider: 'elevenlabs',
    studyTextElevenlabsModel: null,
    googleTtsModel: null,
    autoPublish: false,
    notionUrl: null,
    anytypeUrl: null,
    state: 'queued',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
    ...overrides,
  };
}

export function makeRecording(
  overrides: Partial<api.RecordingListItem> = {},
): api.RecordingListItem {
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

export function makeTranscript(
  overrides: Partial<api.RecordingTranscriptResponse> = {},
): api.RecordingTranscriptResponse {
  return {
    recordingId: 'rec-1',
    transcriptId: 'tx-1',
    text: 'Student transcript text',
    summaryJson: null,
    sttProvider: 'deepgram',
    model: 'mock-model',
    language: 'en',
    mode: 'timeline',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeLearningPreset(
  overrides: Partial<api.LearningPresetOption> = {},
): api.LearningPresetOption {
  return {
    id: 'general-english',
    version: 'v1',
    alias: 'current',
    title: 'General English',
    track: 'general-english',
    status: 'active',
    promptSnapshotVersion: 'hw_prompt_v4-2_clean',
    ...overrides,
  };
}

export async function previewCurrentDraft(_user: ReturnType<typeof userEvent.setup>) {
  fireEvent.click(screen.getByRole('button', { name: /Preview assignment/i }));
  await screen.findByText(
    'Preview ready for current assignment.',
    {},
    {
      timeout: UI_WAIT_TIMEOUT_MS,
    },
  );
}

export async function preparePromptReady(_user: ReturnType<typeof userEvent.setup>) {
  fireEvent.click(screen.getByRole('button', { name: /Start new assignment/i }));
  await screen.findByRole('option', { name: 'Alex' }, { timeout: UI_WAIT_TIMEOUT_MS });
  fireEvent.change(screen.getByRole('combobox', { name: /^Student$/i }), {
    target: { value: 'student-alex' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
  await screen.findByDisplayValue('Student transcript text', {}, { timeout: UI_WAIT_TIMEOUT_MS });

  fireEvent.click(screen.getByRole('button', { name: /Generate instructions/i }));
  await screen.findByDisplayValue('Prompt package output', {}, { timeout: UI_WAIT_TIMEOUT_MS });
}

function hydrateResumedAssignment(
  overrides: {
    status?: Partial<api.JobStatus>;
    jobs?: api.JobStatus[];
    promptText?: string;
    draftText?: string;
  } = {},
) {
  const status = makeJobStatus({
    state: 'succeeded',
    recordingId: 'rec-1',
    transcriptId: 'tx-1',
    promptPackageId: 'pkg-1',
    ...(overrides.draftText ? { draftId: 'draft-1' } : {}),
    ...overrides.status,
  });
  const jobs = overrides.jobs ?? [status];

  vi.mocked(api.listUserJobs).mockResolvedValue({
    jobs,
    total: jobs.length,
    limit: 20,
    offset: 0,
  });
  vi.mocked(api.getJobStatus).mockResolvedValue(status as never);
  vi.mocked(api.fetchPromptPackage).mockResolvedValue({
    id: status.promptPackageId ?? 'pkg-1',
    recordingId: status.recordingId ?? 'rec-1',
    transcriptId: status.transcriptId ?? 'tx-1',
    studentId: status.studentId ?? null,
    profilePath: null,
    templateVersion: 'v1',
    notes: null,
    storageUri: 'memory://prompt/pkg-1',
    text: overrides.promptText ?? 'Prompt package output',
    createdAt: now,
    updatedAt: now,
  });
  if (overrides.draftText) {
    vi.mocked(api.fetchDraft).mockResolvedValue({
      id: status.draftId ?? 'draft-1',
      promptPackageId: status.promptPackageId ?? 'pkg-1',
      studentId: status.studentId ?? null,
      storageUri: 'memory://drafts/draft-1',
      createdBy: 'user-1',
      text: overrides.draftText,
      createdAt: now,
      updatedAt: now,
    });
  }

  globalThis.history.replaceState(null, '', `/?jobId=${status.jobId}`);
  return status;
}

async function waitForResumedPromptReady(text = 'Prompt package output') {
  await screen.findByDisplayValue(text, {}, { timeout: UI_WAIT_TIMEOUT_MS });
}

async function waitForJobActionsReady(jobId = 'job-1') {
  await screen.findByRole(
    'heading',
    { name: /Advanced actions/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  fireEvent.click(screen.getByRole('button', { name: /Show advanced actions/i }));
  await waitFor(
    () => {
      expect(screen.getAllByText(new RegExp(`Job ID: ${jobId}`, 'i')).length).toBeGreaterThan(0);
    },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
}

export function openRecordingSettings() {
  const trigger = screen.queryByText(/Recording settings/i);
  if (trigger && !(trigger.closest('details') as HTMLDetailsElement | null)?.open) {
    fireEvent.click(trigger);
  }
}

export function openGenerationSettings() {
  const trigger = screen.queryByText(/Generation settings/i);
  if (trigger && !(trigger.closest('details') as HTMLDetailsElement | null)?.open) {
    fireEvent.click(trigger);
  }
}

export function openGenerationLimits() {
  const trigger = screen.queryByText(/Generation limits and provider notes/i);
  if (trigger && !(trigger.closest('details') as HTMLDetailsElement | null)?.open) {
    fireEvent.click(trigger);
  }
}

export function openPublishingSettings() {
  const trigger = screen.queryByText(/Audio and publishing settings/i);
  if (trigger && !(trigger.closest('details') as HTMLDetailsElement | null)?.open) {
    fireEvent.click(trigger);
  }
}

export function openAdvancedActions() {
  const trigger = screen.queryByRole('button', { name: /Show advanced actions/i });
  if (trigger) {
    fireEvent.click(trigger);
  }
}

export function createMinimalUser(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup();
}

export function createTimerAwareMinimalUser(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

export function renderMinimalAssignment(): RenderResult {
  return render(<MinimalAssignment />);
}

export async function renderPromptReadyAssignment(
  options: { user?: ReturnType<typeof userEvent.setup> } = {},
): Promise<RenderResult & { user: ReturnType<typeof userEvent.setup> }> {
  const user = options.user ?? createMinimalUser();
  const result = renderMinimalAssignment();
  await preparePromptReady(user);
  return { ...result, user };
}

export async function renderDraftReadyAssignment(
  overrides: Parameters<typeof hydrateResumedAssignment>[0] = {},
  options: {
    user?: ReturnType<typeof userEvent.setup>;
    waitFor?: 'promptReady' | 'jobActions' | 'none';
  } = {},
): Promise<
  RenderResult & {
    user: ReturnType<typeof userEvent.setup>;
    status: ReturnType<typeof hydrateResumedAssignment>;
  }
> {
  return renderResumedAssignment(
    {
      ...overrides,
      draftText: overrides.draftText ?? '# Draft markdown',
    },
    options,
  );
}

export async function renderPreviewReadyAssignment(
  overrides: Parameters<typeof hydrateResumedAssignment>[0] = {},
): Promise<
  RenderResult & {
    user: ReturnType<typeof userEvent.setup>;
    status: ReturnType<typeof hydrateResumedAssignment>;
  }
> {
  const rendered = await renderDraftReadyAssignment(overrides, { waitFor: 'promptReady' });
  await previewCurrentDraft(rendered.user);
  return rendered;
}

export async function renderPublishedActionsAssignment(
  overrides: Parameters<typeof hydrateResumedAssignment>[0] = {},
): Promise<
  RenderResult & {
    user: ReturnType<typeof userEvent.setup>;
    status: ReturnType<typeof hydrateResumedAssignment>;
  }
> {
  return renderPublishedAssignment(overrides, { user: createMinimalUser() });
}

export async function renderGenerationReadyAssignment(
  overrides: Parameters<typeof hydrateResumedAssignment>[0] = {},
): Promise<
  RenderResult & {
    user: ReturnType<typeof userEvent.setup>;
    status: ReturnType<typeof hydrateResumedAssignment>;
  }
> {
  return renderResumedAssignment(
    {
      ...overrides,
      draftText: overrides.draftText ?? '# Draft markdown',
    },
    { user: createMinimalUser(), waitFor: 'promptReady' },
  );
}

export async function renderResumedAssignment(
  overrides: Parameters<typeof hydrateResumedAssignment>[0] = {},
  options: {
    user?: ReturnType<typeof userEvent.setup>;
    waitFor?: 'promptReady' | 'jobActions' | 'none';
  } = {},
): Promise<
  RenderResult & {
    user: ReturnType<typeof userEvent.setup>;
    status: ReturnType<typeof hydrateResumedAssignment>;
  }
> {
  const status = hydrateResumedAssignment(overrides);
  const user = options.user ?? createMinimalUser();
  const result = renderMinimalAssignment();
  const readyState = options.waitFor ?? 'promptReady';
  if (readyState === 'promptReady') {
    await waitForResumedPromptReady(overrides.promptText ?? 'Prompt package output');
  } else if (readyState === 'jobActions') {
    await waitForJobActionsReady(status.jobId);
  }
  return { ...result, user, status };
}

export async function renderPublishedAssignment(
  overrides: Parameters<typeof hydrateResumedAssignment>[0] = {},
  options: {
    user?: ReturnType<typeof userEvent.setup>;
  } = {},
): Promise<
  RenderResult & {
    user: ReturnType<typeof userEvent.setup>;
    status: ReturnType<typeof hydrateResumedAssignment>;
  }
> {
  return renderResumedAssignment(
    {
      ...overrides,
      status: {
        state: 'succeeded',
        ...overrides.status,
      },
    },
    { ...options, waitFor: 'jobActions' },
  );
}

export function setupMinimalAssignmentTest() {
  vi.useRealTimers();
  vi.resetAllMocks();
  globalThis.history.replaceState(null, '', '/');
  scrollIntoViewMock.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock,
  });

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
    generation: {
      providers: ['openai', 'google_ai_studio', 'openrouter'],
      defaultProvider: 'openai',
      modelOptions: [
        {
          provider: 'openai',
          id: 'gpt-5.2',
          tier: 'primary',
          fallbackRank: 0,
          defaultSelected: true,
          enabled: true,
        },
      ],
      defaultModelByProvider: {
        openai: 'gpt-5.2',
      },
      quota: {
        source: 'hybrid',
        lastUpdatedAt: '2026-02-18T00:00:00.000Z',
        requestsPerMinute: 5,
        tokensPerMinute: 250000,
        requestsPerDay: 20,
      },
    },
    voiceAccents: ['american'],
    voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
    notionDatabases: [{ id: 'db-1', name: 'DB One' }],
    sttProviders: ['deepgram', 'elevenlabs', 'google'],
    defaultSttProvider: 'deepgram',
    sttModelOptionsByProvider: {
      deepgram: ['nova-3'],
      elevenlabs: ['scribe_v2'],
      google: ['latest_long'],
    },
    defaultSttModelByProvider: {
      deepgram: 'nova-3',
      elevenlabs: 'scribe_v2',
      google: 'latest_long',
    },
    ttsStrategies: ['auto', 'dialogue', 'tts'],
    ttsProviders: ['elevenlabs', 'google'],
    ttsModelOptionsByProvider: {
      elevenlabs: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2'],
      google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
    },
    defaultTtsProvider: 'elevenlabs',
    defaultTtsModelByProvider: {
      elevenlabs: 'eleven_multilingual_v2',
      google: 'chirp3_hd',
    },
    supportedActions: [
      {
        type: 'rerun',
        label: 'Rerun',
        description: 'Republish current draft or selectively regenerate audio families',
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
      { id: 'student-alex', name: 'Alex', profileId: 'profiles/alex.md' },
      { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
    ],
  });
  vi.mocked(api.listUserJobs).mockResolvedValue({
    jobs: [],
    total: 0,
    limit: 20,
    offset: 0,
  });
  vi.mocked(api.listProfileContents).mockResolvedValue({
    profiles: [
      { id: 'profiles/alex.md', label: 'Alex Profile' },
      { id: 'profiles/bella.md', label: 'Bella Profile' },
    ],
  });
  vi.mocked(api.getProfileContent).mockResolvedValue({
    id: 'profiles/alex.md',
    label: 'Alex Profile',
    content: 'PROFILE CONTENT',
    currentRevisionId: 'revision-1',
    updatedAt: now,
  });
  vi.mocked(api.listProfileRevisions).mockResolvedValue({
    items: [
      {
        id: 'revision-1',
        profileId: 'profiles/alex.md',
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
    id: 'profiles/alex.md',
    label: 'Alex Profile',
    content: 'PROFILE CONTENT',
    currentRevisionId: 'revision-1',
    updatedAt: now,
  });
  vi.mocked(api.restoreProfileRevision).mockResolvedValue({
    id: 'profiles/alex.md',
    label: 'Alex Profile',
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
  vi.mocked(api.generateDraft).mockResolvedValue({
    text: '# Generated assignment draft',
    provider: 'openai',
    model: 'gpt-5.2',
    quota: {
      source: 'hybrid',
      lastUpdatedAt: now,
    },
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
    tts: null,
    lineage: null,
    actions: [],
  });
  vi.mocked(api.rerunJob).mockResolvedValue({
    success: true,
    message: 'Rerun queued',
    jobId: 'job-1',
    actionType: 'rerun',
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
  vi.mocked(api.renderHtmlPreview).mockResolvedValue({
    html: '<html><body><h1>Preview</h1></body></html>',
  });
}

export const testAct = act;
export const testScreen: typeof screen = screen;
export const testWaitFor = waitFor;
export const testWithin = within;
export const testExpect = expect;
export const testVi = vi;
export const testApi = api;

export { INTEGRATION_TEST_TIMEOUT_MS, now, UI_WAIT_TIMEOUT_MS };
