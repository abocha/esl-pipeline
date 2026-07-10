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
  activateProfileRevision: vi.fn(),
  approveJob: vi.fn(),
  archiveAssignmentSession: vi.fn(),
  cancelJob: vi.fn(),
  createAssignmentSession: vi.fn(),
  createDraft: vi.fn(),
  createManualTranscriptSource: vi.fn(),
  createPromptPackage: vi.fn(),
  fetchDraft: vi.fn(),
  fetchAssignmentSession: vi.fn(),
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
  getStudentMemoryHealth: vi.fn(),
  getStudentScheduleBillingSurface: vi.fn(),
  listUserJobs: vi.fn(),
  listAssignmentSessions: vi.fn(),
  listProfileContents: vi.fn(),
  listProfileRevisions: vi.fn(),
  materializeDraft: vi.fn(),
  populateFirstProfileFromLesson: vi.fn(),
  requestLessonMemoryFromTranscript: vi.fn(),
  restoreProfileRevision: vi.fn(),
  retryRecordingTranscription: vi.fn(),
  rerunJob: vi.fn(),
  renderHtmlPreview: vi
    .fn()
    .mockResolvedValue({ html: '<html><body><h1>Preview</h1></body></html>' }),
  subscribeToJobEvents: vi.fn().mockReturnValue({ close: vi.fn() }),
  upsertProfileContent: vi.fn(),
  updateAssignmentSession: vi.fn(),
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
    lessonId: null,
    preset: 'b1-default',
    learningPresetId: null,
    withTts: true,
    voiceId: null,
    upload: 's3',
    voiceAccent: null,
    forceTts: false,
    publishTarget: 'html',
    ttsStrategy: 'auto',
    ttsProvider: 'elevenlabs',
    ttsModel: null,
    autoPublish: false,
    htmlUrl: null,
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

export function makeAssignmentSession(
  overrides: Partial<api.AssignmentSession> = {},
): api.AssignmentSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    studentId: null,
    lessonId: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    currentStage: 'source',
    publishTarget: 'html',
    selectedTtsProvider: 'elevenlabs',
    selectedTtsStrategy: 'auto',
    selectedTtsModel: null,
    selectedPreset: 'b1-default',
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
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

export function makeScheduleBillingSurface(
  overrides: Partial<api.StudentScheduleBillingSurface> = {},
): api.StudentScheduleBillingSurface {
  return {
    studentId: 'student-alex',
    workspaceId: null,
    lessonPlan: {
      studentId: 'student-alex',
      workspaceId: null,
      timezone: 'UTC',
      defaultDurationMinutes: 60,
      cadence: null,
      preferredTimes: null,
      schedulingNotes: null,
      updatedAt: now,
    },
    recurrenceRule: null,
    nextLesson: null,
    lessons: [],
    creditSummary: {
      purchased: 0,
      consumed: 0,
      adjustments: 0,
      remaining: 0,
      lowBalanceThreshold: 2,
      isLow: false,
      isNegative: false,
    },
    creditEvents: [],
    payments: [],
    reminders: [],
    latestHiddenReminder: null,
    ...overrides,
  };
}

export function makeStudentLesson(
  overrides: Partial<api.StudentScheduleBillingSurface['lessons'][number]> = {},
): api.StudentScheduleBillingSurface['lessons'][number] {
  return {
    id: 'lesson-1',
    studentId: 'student-alex',
    workspaceId: null,
    startsAt: '2026-02-04T10:00:00.000Z',
    timezone: 'UTC',
    durationMinutes: 60,
    status: 'completed',
    consumesCredit: true,
    title: 'Negotiation practice',
    notes: null,
    creditEventId: null,
    recurrenceRuleId: null,
    recurrenceSlotId: null,
    recurrenceOccurrenceKey: null,
    recurrenceOrigin: 'manual',
    recurrenceOverrideKind: null,
    homework: {
      status: 'not_started',
      assignmentSessionId: null,
      promptPackageId: null,
      draftId: null,
      jobId: null,
      homeworkMemoryEntryId: null,
      htmlUrl: null,
      updatedAt: null,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export async function previewCurrentDraft(_user: ReturnType<typeof userEvent.setup>) {
  const reviewStep = screen.queryByRole('button', { name: /Review & share/i });
  if (reviewStep && !(reviewStep as HTMLButtonElement).disabled) {
    fireEvent.click(reviewStep);
  }
  fireEvent.click(screen.getByRole('button', { name: /Preview assignment/i }));
  await screen.findByTitle('Draft preview', {}, { timeout: UI_WAIT_TIMEOUT_MS });
}

export async function preparePromptReady(_user: ReturnType<typeof userEvent.setup>) {
  fireEvent.click(screen.getByRole('button', { name: /Start new assignment/i }));
  await screen.findByRole('option', { name: 'Alex' }, { timeout: UI_WAIT_TIMEOUT_MS });
  fireEvent.change(screen.getByRole('combobox', { name: /^Student$/i }), {
    target: { value: 'student-alex' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Confirm and continue/i }));
  fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
  await screen.findByDisplayValue('Student transcript text', {}, { timeout: UI_WAIT_TIMEOUT_MS });

  fireEvent.click(screen.getByRole('button', { name: /Confirm and continue/i }));
  fireEvent.click(screen.getByRole('button', { name: /Confirm and continue/i }));

  fireEvent.click(screen.getByRole('button', { name: /^Generate assignment$/i }));
  await screen.findByDisplayValue(
    '# Generated assignment draft',
    {},
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
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
    lessonId: status.lessonId ?? null,
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
      lessonId: status.lessonId ?? null,
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

async function waitForResumedPromptReady(_text = 'Prompt package output') {
  const createStep = await screen.findByRole(
    'button',
    { name: /Create/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  if (!(createStep as HTMLButtonElement).disabled) {
    fireEvent.click(createStep);
  }
  await screen.findByRole(
    'button',
    { name: /^Generate assignment$/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  await screen.findByRole('textbox', { name: /Draft markdown/i }, { timeout: UI_WAIT_TIMEOUT_MS });
}

async function waitForJobActionsReady(jobId = 'job-1') {
  const supportSummary = await screen.findByText(
    /Support details/i,
    {},
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  const supportDisclosure = supportSummary.closest('details');
  if (supportDisclosure && !supportDisclosure.open) {
    fireEvent.click(supportSummary.closest('summary') ?? supportSummary);
  }
  await screen.findByRole(
    'heading',
    { name: /Advanced actions/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  const trigger = await screen.findByRole(
    'button',
    { name: /(Show|Hide) advanced actions/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  if (/show advanced actions/i.test(trigger.textContent ?? '')) {
    fireEvent.click(trigger);
  }
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
  const trigger =
    screen.queryByRole('button', { name: /Show advanced actions/i }) ??
    screen.queryByRole('button', { name: /Hide advanced actions/i });
  if (trigger && /show advanced actions/i.test(trigger.textContent ?? '')) {
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
    ttsProviders: ['inworld', 'elevenlabs', 'google'],
    ttsModelOptionsByProvider: {
      inworld: ['inworld-tts-2', 'inworld-tts-1.5-mini'],
      elevenlabs: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2'],
      google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
    },
    defaultTtsProvider: 'inworld',
    defaultTtsModelByProvider: {
      inworld: 'inworld-tts-2',
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
  vi.mocked(api.getStudentScheduleBillingSurface).mockResolvedValue(makeScheduleBillingSurface());
  vi.mocked(api.listUserJobs).mockResolvedValue({
    jobs: [],
    total: 0,
    limit: 20,
    offset: 0,
  });
  vi.mocked(api.listAssignmentSessions).mockResolvedValue({
    sessions: [],
    total: 0,
    limit: 20,
  });
  vi.mocked(api.createAssignmentSession).mockResolvedValue(makeAssignmentSession());
  vi.mocked(api.createManualTranscriptSource).mockResolvedValue(
    makeRecording({
      recordingId: 'rec-manual',
      transcriptId: 'tx-manual',
      source: 'manual_transcript',
      status: 'transcribed',
      studentId: 'student-alex',
      displayName: 'Pasted lesson transcript',
    }),
  );
  vi.mocked(api.updateAssignmentSession).mockResolvedValue(makeAssignmentSession());
  vi.mocked(api.fetchAssignmentSession).mockResolvedValue(makeAssignmentSession());
  vi.mocked(api.archiveAssignmentSession).mockResolvedValue(
    makeAssignmentSession({ archivedAt: now }),
  );
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
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Lead project updates clearly.'],
      communicationContexts: ['Weekly team syncs.'],
      interestsAndUsefulThemes: ['Travel and films.'],
      stableStrengths: ['Strong listening comprehension.'],
      persistentChallenges: ['Needs more confident spoken transitions.'],
      studyPreferences: ['Prefers concise, practical homework.'],
      durableConstraints: [],
      teacherNotes: 'Keep examples grounded in real workplace situations.',
    },
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
  vi.mocked(api.getStudentMemoryHealth).mockResolvedValue({
    studentId: 'student-alex',
    latestSnapshot: null,
    memoryCounts: {
      lesson: {
        ready: { count: 0, capped: false, limit: 20 },
        pending: { count: 1, capped: false, limit: 20 },
        failed: { count: 0, capped: false, limit: 20 },
      },
      homework: {
        ready: { count: 0, capped: false, limit: 20 },
        pending: { count: 0, capped: false, limit: 20 },
        failed: { count: 0, capped: false, limit: 20 },
      },
    },
    latestFailedReason: null,
    profileCandidateCounts: {
      pending: 0,
      approved: 0,
      rejected: 0,
      deferred: 0,
    },
  });
  vi.mocked(api.populateFirstProfileFromLesson).mockResolvedValue({
    draftRevisionId: 'revision-draft-1',
    profileId: 'profiles/alex.md',
    snapshotId: 'snapshot-1',
    lessonMemoryIds: ['lesson-memory-1'],
    homeworkMemoryIds: [],
    draftRevision: {
      id: 'revision-draft-1',
      profileId: 'profiles/alex.md',
      contentHash: 'hash-draft-1',
      source: 'lesson_population',
      status: 'draft',
      versionNumber: 2,
      activatedAt: null,
      deprecatedAt: null,
      createdAt: now,
      createdBy: null,
      restoredFromRevisionId: null,
      content: 'PROFILE CONTENT',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: 'B1',
        primaryGoals: ['Lead project updates clearly.'],
        communicationContexts: ['Weekly team syncs.'],
        interestsAndUsefulThemes: ['Travel and films.'],
        stableStrengths: ['Strong listening comprehension.'],
        persistentChallenges: ['Needs more confident spoken transitions.'],
        studyPreferences: ['Prefers concise, practical homework.'],
        durableConstraints: [],
        teacherNotes: 'Keep examples grounded in real workplace situations.',
      },
    },
  });
  vi.mocked(api.requestLessonMemoryFromTranscript).mockResolvedValue({
    outcome: 'created',
    lessonMemoryEntryId: 'lesson-memory-1',
    lessonTitle: null,
  });
  vi.mocked(api.activateProfileRevision).mockResolvedValue({
    id: 'revision-draft-1',
    profileId: 'profiles/alex.md',
    contentHash: 'hash-draft-1',
    source: 'lesson_population',
    status: 'active',
    versionNumber: 2,
    versionLabel: 'v2',
    activatedAt: now,
    deprecatedAt: null,
    createdAt: now,
    createdBy: null,
    restoredFromRevisionId: null,
    content: 'PROFILE CONTENT',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Lead project updates clearly.'],
      communicationContexts: ['Weekly team syncs.'],
      interestsAndUsefulThemes: ['Travel and films.'],
      stableStrengths: ['Strong listening comprehension.'],
      persistentChallenges: ['Needs more confident spoken transitions.'],
      studyPreferences: ['Prefers concise, practical homework.'],
      durableConstraints: [],
      teacherNotes: 'Keep examples grounded in real workplace situations.',
    },
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
    lessonId: null,
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
    lessonId: null,
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

  vi.mocked(api.createDraft).mockImplementation(async (promptPackageId, text) => ({
    id: 'draft-1',
    promptPackageId,
    studentId: null,
    lessonId: null,
    storageUri: 'memory://drafts/draft-1',
    createdBy: 'user-1',
    text,
    createdAt: now,
    updatedAt: now,
  }));
  vi.mocked(api.fetchDraft).mockResolvedValue({
    id: 'draft-1',
    promptPackageId: 'pkg-1',
    studentId: null,
    lessonId: null,
    storageUri: 'memory://drafts/draft-1',
    createdBy: 'user-1',
    text: '# Draft markdown',
    createdAt: now,
    updatedAt: now,
  });

  vi.mocked(api.updateDraft).mockImplementation(async (id, text) => ({
    id,
    promptPackageId: 'pkg-1',
    studentId: null,
    lessonId: null,
    storageUri: 'memory://drafts/draft-1',
    createdBy: 'user-1',
    text,
    createdAt: now,
    updatedAt: now,
  }));

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
    publishTarget: 'html',
    htmlUrl: 'https://example.com/published-assignment.html',
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
      htmlUrl: 'https://example.com/published-assignment.html',
      error: null,
    },
    sourceJob: null,
    recording: null,
    transcript: null,
    promptPackage: null,
    draft: null,
    tts: null,
    pronunciationWarnings: [],
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
  vi.mocked(api.subscribeToJobEvents).mockReturnValue({ close: vi.fn() } as never);
}

export const testAct = act;
export const testScreen: typeof screen = screen;
export const testWaitFor = waitFor;
export const testWithin = within;
export const testExpect = expect;
export const testVi = vi;
export const testApi = api;

export { INTEGRATION_TEST_TIMEOUT_MS, now, UI_WAIT_TIMEOUT_MS };
