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
import {
  AssignmentNavigationGuardContext,
  type NavigationGuard,
} from '../shell/assignment-navigation-guard';
import { MinimalAssignment } from './MinimalAssignment';
import {
  assignmentArtifact,
  makeAssignmentText,
  requestEnvelope,
  typedDraftFields,
} from './MinimalAssignment.typed-test-fixtures';

vi.mock('../../utils/api', () => ({
  activateProfileRevision: vi.fn(),
  attachAssignmentSource: vi.fn(),
  AssignmentSessionConflictApiError: class AssignmentSessionConflictApiError extends Error {
    constructor(public readonly latestSession: api.AssignmentSession) {
      super('Newer saved assignment work was found. Review it before confirming again.');
      this.name = 'AssignmentSessionConflictApiError';
    }
  },
  AssignmentSourceOwnershipApiError: class AssignmentSourceOwnershipApiError extends Error {
    constructor(public readonly canonicalSession: api.AssignmentSession) {
      super('This lesson already has an assignment. Reopening the saved assignment.');
      this.name = 'AssignmentSourceOwnershipApiError';
    }
  },
  ArtifactWorkingConflictApiError: class ArtifactWorkingConflictApiError extends Error {
    constructor(public readonly latestArtifact: { workingVersion: number; contentHash: string }) {
      super('Newer saved artifact content was found. Review it before confirming again.');
      this.name = 'ArtifactWorkingConflictApiError';
    }
  },
  AssignmentSpeakerRoleMappingRequiredApiError: class AssignmentSpeakerRoleMappingRequiredApiError extends Error {
    constructor() {
      super('Speaker roles are required. Assign every speaker before confirming this source.');
      this.name = 'AssignmentSpeakerRoleMappingRequiredApiError';
    }
  },
  RecordingUploadPreDispatchError: class RecordingUploadPreDispatchError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'RecordingUploadPreDispatchError';
    }
  },
  approveJob: vi.fn(),
  cancelJob: vi.fn(),
  confirmAssignmentSessionStep: vi.fn(),
  confirmStudentAssignmentSession: vi.fn(),
  createDraft: vi.fn(),
  createManualTranscriptSource: vi.fn(),
  createPromptPackage: vi.fn(),
  fetchDraft: vi.fn(),
  fetchAssignmentSession: vi.fn(),
  fetchAssignmentLearnerContext: vi.fn(),
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
  getProfileRevision: vi.fn(),
  getJobStatus: vi.fn(),
  getRecording: vi.fn(),
  getRecordingUploadOperation: vi.fn(),
  getStudentMemoryHealth: vi.fn(),
  getStudentScheduleBillingSurface: vi.fn(),
  listUserJobs: vi.fn(),
  listAssignmentSessions: vi.fn(),
  listProfileRevisions: vi.fn(),
  materializeDraft: vi.fn(),
  publishAssignmentCorrection: vi.fn(),
  restoreProfileRevision: vi.fn(),
  shareAssignmentSession: vi.fn(),
  retryRecordingTranscription: vi.fn(),
  rerunJob: vi.fn(),
  renderHtmlPreview: vi
    .fn()
    .mockResolvedValue({ html: '<html><body><h1>Preview</h1></body></html>' }),
  subscribeToJobEvents: vi.fn().mockReturnValue({ close: vi.fn() }),
  upsertProfileContent: vi.fn(),
  updateAssignmentSessionRecovery: vi.fn(),
  updateDraft: vi.fn(),
  updateRecordingTranscript: vi.fn(),
  uploadRecording: vi.fn(),
}));

vi.mock('../shared/DropZone', () => ({
  DropZone: ({
    title,
    accept,
    disabled,
    onFiles,
  }: {
    title: string;
    accept?: Record<string, string[]>;
    disabled?: boolean;
    onFiles: (files: File[]) => void;
  }) => (
    <button
      type="button"
      data-accept={Object.entries(accept ?? {})
        .flatMap(([mime, extensions]) => [mime, ...extensions])
        .join(',')}
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
  UploadProgress: ({ progress, onCancel }: { progress: number; onCancel: () => void }) => (
    <div>
      Upload progress: {progress}%
      <button type="button" onClick={onCancel}>
        Cancel upload
      </button>
    </div>
  ),
}));

const now = '2026-02-05T00:00:00.000Z';
const UI_WAIT_TIMEOUT_MS = 3_000;
const INTEGRATION_TEST_TIMEOUT_MS = 15_000;
const scrollIntoViewMock = vi.fn();
configure({ asyncUtilTimeout: UI_WAIT_TIMEOUT_MS });

export function makeJobStatus(overrides: Partial<api.JobStatus> = {}): api.JobStatus {
  return {
    assignmentArtifact,
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
  overrides: Omit<Partial<api.AssignmentSession>, 'studentId'> & {
    studentId?: string | null;
  } = {},
): api.AssignmentSession {
  const { studentId: requestedStudentId, ...sessionOverrides } = overrides;
  const studentId = requestedStudentId ?? 'student-1';
  const confirmedStep = sessionOverrides.confirmedStep ?? 'student';
  const recordingId = sessionOverrides.recordingId ?? null;
  const transcriptId = sessionOverrides.transcriptId ?? null;
  const promptPackageId = sessionOverrides.promptPackageId ?? null;
  const draftId = sessionOverrides.draftId ?? null;
  return {
    id: 'session-1',
    userId: 'user-1',
    studentId,
    lessonId: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    revision: 1,
    confirmedStep,
    confirmed: {
      student: { studentId },
      source:
        confirmedStep !== 'student' && recordingId && transcriptId
          ? {
              lessonId: sessionOverrides.lessonId ?? null,
              recordingId,
              transcriptId,
              transcriptWorkingVersion: 1,
              transcriptStorageUri: 'memory://transcripts/confirmed',
              transcriptHash: 'a'.repeat(64),
            }
          : null,
      context:
        confirmedStep === 'context' || confirmedStep === 'create' || confirmedStep === 'share'
          ? {
              teacherNotes: sessionOverrides.teacherNotes ?? null,
              profileId: sessionOverrides.selectedProfileId ?? null,
              profileRevisionId: sessionOverrides.selectedProfileRevisionId ?? null,
              profileRevisionHash: sessionOverrides.selectedProfileRevisionHash ?? null,
            }
          : null,
      create:
        (confirmedStep === 'create' || confirmedStep === 'share') && promptPackageId && draftId
          ? {
              promptPackageId,
              draftId,
              artifact: assignmentArtifact,
              draftWorkingVersion: 1,
              draftStorageUri: 'memory://drafts/confirmed',
              draftHash: 'b'.repeat(64),
            }
          : null,
    },
    publishTarget: 'html',
    selectedTtsProvider: 'elevenlabs',
    selectedTtsStrategy: 'auto',
    selectedTtsModel: null,
    selectedPreset: 'b1-default',
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: null,
    selectedProfileId: null,
    selectedProfileRevisionId: null,
    selectedProfileRevisionHash: null,
    shareJobId: null,
    createdAt: now,
    updatedAt: now,
    ...sessionOverrides,
  };
}

export function makeRecording(
  overrides: Partial<api.RecordingListItem> = {},
): api.RecordingListItem {
  const status = overrides.status ?? 'ingested';
  const productState =
    overrides.productState ??
    (
      {
        ingested: 'checking',
        queued: 'waiting',
        transcribing: 'transcribing',
        transcribed: 'ready',
        failed: 'attention',
      } as const
    )[status];
  const runState = Object.hasOwn(overrides, 'runState')
    ? (overrides.runState ?? null)
    : (
        {
          ingested: null,
          queued: 'queued',
          transcribing: 'submitting',
          transcribed: 'succeeded',
          failed: 'failed',
        } as const
      )[status];
  return {
    recordingId: 'rec-1',
    status,
    productState,
    runState,
    transcriptId: null,
    error: null,
    errorCode: null,
    source: 'upload',
    studentId: null,
    displayName: 'lesson.mp3',
    durationSec: null,
    channels: null,
    audioTopology: null,
    audioLifecycle: 'retained',
    audioAvailable: true,
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
    workingVersion: 1,
    contentHash: 'a'.repeat(64),
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

export async function previewCurrentDraft(user: ReturnType<typeof userEvent.setup>) {
  const reviewStep = screen.queryByRole('button', { name: /Review & share/i });
  if (reviewStep) {
    if ((reviewStep as HTMLButtonElement).disabled) {
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
    } else {
      await user.click(reviewStep);
    }
    await screen.findByRole(
      'heading',
      { name: /Review and share/i },
      { timeout: UI_WAIT_TIMEOUT_MS },
    );
  }
  await user.click(screen.getByRole('button', { name: /Preview assignment/i }));
  await screen.findByTitle('Draft preview', {}, { timeout: UI_WAIT_TIMEOUT_MS });
}

export async function startNewAssignmentForLearner(
  user: ReturnType<typeof userEvent.setup>,
  learnerId = 'student-alex',
) {
  const startButton = await screen.findByRole(
    'button',
    { name: /Start new assignment/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  await waitFor(() => expect((startButton as HTMLButtonElement).disabled).toBe(false), {
    timeout: UI_WAIT_TIMEOUT_MS,
  });
  await user.click(startButton);
  const learnerSelect = await screen.findByRole(
    'combobox',
    { name: /Choose learner/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  await user.selectOptions(learnerSelect, learnerId);
  await waitFor(
    () =>
      expect(
        (screen.getByRole('button', { name: /^Continue$/i }) as HTMLButtonElement).disabled,
      ).toBe(false),
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  await user.click(screen.getByRole('button', { name: /^Continue$/i }));
}

export async function advanceSourceToTeachingContext(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
  await screen.findByRole('heading', { name: /Learner context/i }, { timeout: UI_WAIT_TIMEOUT_MS });
}

export async function advanceSourceToCreate(user: ReturnType<typeof userEvent.setup>) {
  await advanceSourceToTeachingContext(user);
  const continueButton = screen.getByRole('button', { name: /Confirm and continue/i });
  await waitFor(() => expect((continueButton as HTMLButtonElement).disabled).toBe(false), {
    timeout: UI_WAIT_TIMEOUT_MS,
  });
  await user.click(continueButton);
  await screen.findByRole(
    'button',
    { name: /^(Generate assignment|Regenerate)$/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
}

export async function preparePromptReady(user: ReturnType<typeof userEvent.setup>) {
  await startNewAssignmentForLearner(user);
  fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
  await screen.findByDisplayValue('Student transcript text', {}, { timeout: UI_WAIT_TIMEOUT_MS });

  await advanceSourceToCreate(user);

  fireEvent.click(screen.getByRole('button', { name: /^Generate assignment$/i }));
  await screen.findByDisplayValue(
    makeAssignmentText('# Generated assignment draft'),
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
    historicalOutput?: boolean;
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

  if (!overrides.historicalOutput) {
    const session = makeAssignmentSession({
      id: 'session-resumed',
      studentId: status.studentId ?? 'student-alex',
      recordingId: status.recordingId ?? 'rec-1',
      transcriptId: status.transcriptId ?? 'tx-1',
      promptPackageId: status.promptPackageId ?? 'pkg-1',
      draftId: overrides.draftText ? (status.draftId ?? 'draft-1') : null,
      confirmedStep: overrides.draftText ? 'create' : 'context',
    });
    vi.mocked(api.listAssignmentSessions).mockResolvedValue({
      sessions: [session],
      total: 1,
      limit: 20,
    });
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
  }

  vi.mocked(api.listUserJobs).mockResolvedValue({
    jobs,
    total: jobs.length,
    limit: 20,
    offset: 0,
  });
  vi.mocked(api.getJobStatus).mockResolvedValue(status as never);
  vi.mocked(api.fetchPromptPackage).mockResolvedValue({
    requestEnvelope,
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
      ...typedDraftFields(overrides.draftText),
      id: status.draftId ?? 'draft-1',
      promptPackageId: status.promptPackageId ?? 'pkg-1',
      studentId: status.studentId ?? null,
      lessonId: status.lessonId ?? null,
      storageUri: 'memory://drafts/draft-1',
      createdBy: 'user-1',
      text: overrides.draftText,
      workingVersion: 1,
      contentHash: 'b'.repeat(64),
      createdAt: now,
      updatedAt: now,
    });
  }

  return status;
}

async function openResumedJobAssignment(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole(
      'button',
      { name: /Resume recent work/i },
      { timeout: UI_WAIT_TIMEOUT_MS },
    ),
  );
  await user.click((await screen.findAllByRole('radio', {}, { timeout: UI_WAIT_TIMEOUT_MS }))[0]!);
  await user.click(
    screen.getByRole('button', {
      name: /Review progress|Review assignment|Open assignment|Review issue|Continue assignment/i,
    }),
  );
}

async function waitForResumedPromptReady(user: ReturnType<typeof userEvent.setup>) {
  const createStep = await screen.findByRole(
    'button',
    { name: /Create/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  if ((createStep as HTMLButtonElement).disabled) {
    await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
  } else {
    await user.click(createStep);
  }
  await screen.findByRole(
    'button',
    { name: /^(Generate assignment|Regenerate)$/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  await screen.findByRole('textbox', { name: /Assignment JSON/i }, { timeout: UI_WAIT_TIMEOUT_MS });
}

async function waitForJobActionsReady(jobId = 'job-1', hasPublishedHandout = true) {
  const supportSummary = await screen.findByText(
    /Support details/i,
    {},
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  const supportDisclosure = supportSummary.closest('details');
  if (supportDisclosure && !supportDisclosure.open) {
    fireEvent.click(supportSummary.closest('summary') ?? supportSummary);
  }
  const reviewStep = await screen.findByRole(
    'button',
    { name: /Review & share/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  await waitFor(() => expect((reviewStep as HTMLButtonElement).disabled).toBe(false), {
    timeout: UI_WAIT_TIMEOUT_MS,
  });
  fireEvent.click(reviewStep);
  if (!hasPublishedHandout) return;
  const advancedSummary = await screen.findByText(
    'Advanced actions',
    {},
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  if (!(advancedSummary.closest('details') as HTMLDetailsElement | null)?.open) {
    fireEvent.click(advancedSummary);
  }
  await screen.findByRole(
    'heading',
    { name: /Republish and recovery/i },
    { timeout: UI_WAIT_TIMEOUT_MS },
  );
  await screen.findByRole('region', { name: /Quick reruns/i }, { timeout: UI_WAIT_TIMEOUT_MS });
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
  const trigger = screen.queryByText('Advanced actions');
  if (trigger && !(trigger.closest('details') as HTMLDetailsElement | null)?.open) {
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

export function renderMinimalAssignmentWithNavigationGuard(
  register: (guard: NavigationGuard | null) => void,
): RenderResult {
  return render(
    <AssignmentNavigationGuardContext.Provider value={register}>
      <MinimalAssignment />
    </AssignmentNavigationGuardContext.Provider>,
  );
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
      draftText: overrides.draftText ?? makeAssignmentText('# Draft markdown'),
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
      draftText: overrides.draftText ?? makeAssignmentText('# Draft markdown'),
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
  await openResumedJobAssignment(user);
  const readyState = options.waitFor ?? 'promptReady';
  if (readyState === 'promptReady') {
    await waitForResumedPromptReady(user);
  } else if (readyState === 'jobActions') {
    await waitForJobActionsReady(
      status.jobId,
      status.state === 'succeeded' && Boolean(status.htmlUrl),
    );
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
      draftText: overrides.draftText ?? makeAssignmentText('# Draft markdown'),
      historicalOutput: true,
      status: {
        state: 'succeeded',
        studentId: 'student-alex',
        htmlUrl: 'https://example.com/published-assignment.html',
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
  let currentSession = makeAssignmentSession();

  const findListedSession = async (sessionId: string): Promise<api.AssignmentSession | null> => {
    const listSessionsMock = vi.mocked(api.listAssignmentSessions);
    for (let index = listSessionsMock.mock.results.length - 1; index >= 0; index -= 1) {
      const result = listSessionsMock.mock.results[index];
      if (result?.type !== 'return') continue;

      try {
        const listed = await result.value;
        const session = listed.sessions.find((candidate) => candidate.id === sessionId);
        if (session) return session;
      } catch {
        // An unsuccessful earlier list response does not replace active server state.
      }
    }
    return null;
  };

  const findFetchedSession = async (sessionId: string): Promise<api.AssignmentSession | null> => {
    const fetchSessionMock = vi.mocked(api.fetchAssignmentSession);
    for (let index = fetchSessionMock.mock.results.length - 1; index >= 0; index -= 1) {
      if (fetchSessionMock.mock.calls[index]?.[0] !== sessionId) continue;
      const result = fetchSessionMock.mock.results[index];
      if (result?.type !== 'return') continue;

      try {
        const session = await result.value;
        if (session.id === sessionId) return session;
      } catch {
        // A failed fetch does not replace active server state.
      }
    }
    return null;
  };

  const synchronizeCurrentSession = async (sessionId: string) => {
    if (currentSession.id === sessionId) return;

    const fetchedSession = await findFetchedSession(sessionId);
    if (fetchedSession) {
      currentSession = fetchedSession;
      return;
    }

    const listedSession = await findListedSession(sessionId);
    if (listedSession) currentSession = listedSession;
  };

  vi.mocked(api.fetchPromptOptions).mockResolvedValue({
    templates: [{ id: 'tpl-default', label: 'Default Template' }],
    defaults: {
      templateId: 'tpl-default',
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
        description: 'Republish published version or selectively regenerate audio families',
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
      { id: 'student-alex', name: 'Alex' },
      { id: 'student-bella', name: 'Bella' },
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
  vi.mocked(api.confirmStudentAssignmentSession).mockImplementation(async (request) => {
    currentSession = makeAssignmentSession({
      studentId: request.studentId,
      lessonId: request.lessonId ?? null,
      confirmedStep: 'student',
    });
    return currentSession;
  });
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
  vi.mocked(api.updateAssignmentSessionRecovery).mockImplementation(async (id, request) => {
    const recoveryFields = Object.entries(request.patch).filter(([, value]) => value !== undefined);
    const touchesSource = recoveryFields.some(
      ([field]) => field === 'recordingId' || field === 'transcriptId',
    );
    if (
      touchesSource &&
      recoveryFields.some(([field]) => field !== 'recordingId' && field !== 'transcriptId')
    ) {
      throw new Error('HTTP 409: assignment_recovery_lineage_invalid');
    }
    await synchronizeCurrentSession(id);
    currentSession = makeAssignmentSession({
      ...currentSession,
      id,
      ...request.patch,
      revision: request.expectedRevision + 1,
    });
    return currentSession;
  });
  vi.mocked(api.attachAssignmentSource).mockImplementation(async (id, request) => {
    await synchronizeCurrentSession(id);
    currentSession = makeAssignmentSession({
      ...currentSession,
      id,
      recordingId: request.recordingId,
      transcriptId: request.transcriptId,
      revision: request.expectedRevision + 1,
    });
    return { outcome: 'source_attached', session: currentSession };
  });
  vi.mocked(api.confirmAssignmentSessionStep).mockImplementation(async (id, request) => {
    await synchronizeCurrentSession(id);
    const base = currentSession;
    if (request.step === 'source') {
      if (base.recordingId !== request.recordingId || base.transcriptId !== request.transcriptId) {
        throw new Error('HTTP 400: assignment_step_source_not_attached');
      }
      currentSession = makeAssignmentSession({
        ...base,
        revision: request.expectedRevision + 1,
        lessonId: request.lessonId,
        recordingId: request.recordingId,
        transcriptId: request.transcriptId,
        confirmedStep: 'source',
        confirmed: {
          ...base.confirmed,
          source: {
            lessonId: request.lessonId,
            recordingId: request.recordingId,
            transcriptId: request.transcriptId,
            transcriptWorkingVersion: request.transcriptWorkingVersion,
            transcriptStorageUri: 'memory://transcripts/confirmed',
            transcriptHash: request.transcriptId === 'tx-b' ? 'b'.repeat(64) : 'a'.repeat(64),
          },
        },
      });
      return { session: currentSession, invalidated: [] };
    }
    if (request.step === 'context') {
      currentSession = makeAssignmentSession({
        ...base,
        revision: request.expectedRevision + 1,
        confirmedStep: 'context',
        teacherNotes: request.teacherNotes,
        selectedProfileId: base.studentId,
        selectedProfileRevisionId: request.profileRevisionId,
        selectedProfileRevisionHash: request.profileRevisionHash,
        confirmed: {
          ...base.confirmed,
          context: {
            teacherNotes: request.teacherNotes,
            profileRevisionId: request.profileRevisionId,
            profileRevisionHash: request.profileRevisionHash,
          },
        },
      });
      return { session: currentSession, invalidated: [] };
    }
    currentSession = makeAssignmentSession({
      ...base,
      revision: request.expectedRevision + 1,
      promptPackageId: request.promptPackageId,
      draftId: request.draftId,
      confirmedStep: 'create',
      confirmed: {
        ...base.confirmed,
        create: {
          promptPackageId: request.promptPackageId,
          draftId: request.draftId,
          artifact: { ...assignmentArtifact, workingVersion: request.draftWorkingVersion },
          draftWorkingVersion: request.draftWorkingVersion,
          draftStorageUri: 'memory://drafts/confirmed',
          draftHash: 'b'.repeat(64),
        },
      },
    });
    return { session: currentSession, invalidated: [] };
  });
  vi.mocked(api.shareAssignmentSession).mockImplementation(async (id, request) => {
    await synchronizeCurrentSession(id);
    currentSession = makeAssignmentSession({
      ...currentSession,
      id,
      confirmedStep: 'share',
      shareJobId: request.requestId,
      revision: request.expectedRevision + 2,
    });
    return {
      session: currentSession,
      job: makeJobStatus({ jobId: request.requestId, state: 'queued' }),
    };
  });
  vi.mocked(api.fetchAssignmentSession).mockImplementation(async (id) => {
    if (currentSession.id !== id) {
      const listedSession = await findListedSession(id);
      if (listedSession) currentSession = listedSession;
    }
    return currentSession;
  });
  vi.mocked(api.fetchAssignmentLearnerContext).mockImplementation(async (id) => {
    const projectionSession =
      currentSession.id === id ? currentSession : ((await findListedSession(id)) ?? currentSession);
    const source = projectionSession.confirmed.source;
    const profileId = projectionSession.studentId;
    const revisionId =
      projectionSession.selectedProfileRevisionId ??
      projectionSession.confirmed.context?.profileRevisionId;
    const revisionHash =
      projectionSession.selectedProfileRevisionHash ??
      projectionSession.confirmed.context?.profileRevisionHash;
    return {
      assignmentSessionId: id,
      studentId: projectionSession.studentId,
      source: source
        ? {
            recordingId: source.recordingId,
            transcriptId: source.transcriptId,
            transcriptHash: source.transcriptHash,
          }
        : null,
      eligibility: 'unknown_provenance',
      state: 'not_applicable',
      operationState: null,
      profile:
        profileId && revisionId && revisionHash
          ? {
              studentId: projectionSession.studentId,
              revisionId,
              revisionHash,
              content: 'PROFILE CONTENT',
              structuredContent: null,
              updatedAt: now,
            }
          : null,
      pinned: projectionSession.confirmed.context
        ? {
            profileId: projectionSession.confirmed.context.profileId ?? null,
            revisionId: projectionSession.confirmed.context.profileRevisionId,
            revisionHash: projectionSession.confirmed.context.profileRevisionHash,
          }
        : null,
      confirmationAvailable: Boolean(source),
      warning: null,
    };
  });
  vi.mocked(api.getProfileContent).mockResolvedValue({
    studentId: 'student-alex',
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
  vi.mocked(api.getProfileRevision).mockResolvedValue({
    id: 'revision-1',
    studentId: 'student-alex',
    contentHash: 'a'.repeat(64),
    source: 'create',
    createdAt: now,
    createdBy: null,
    restoredFromRevisionId: null,
    content: 'PROFILE CONTENT',
  });
  vi.mocked(api.listProfileRevisions).mockResolvedValue({
    items: [
      {
        id: 'revision-1',
        studentId: 'student-alex',
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
    studentId: 'student-alex',
    content: 'PROFILE CONTENT',
    currentRevisionId: 'revision-1',
    updatedAt: now,
  });
  vi.mocked(api.restoreProfileRevision).mockResolvedValue({
    studentId: 'student-alex',
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
  vi.mocked(api.activateProfileRevision).mockResolvedValue({
    id: 'revision-draft-1',
    studentId: 'student-alex',
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
  vi.mocked(api.getRecordingUploadOperation).mockResolvedValue(null);
  vi.mocked(api.getRecording).mockResolvedValue(
    makeRecording({
      status: 'transcribed',
      transcriptId: 'tx-1',
    }),
  );
  vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(makeTranscript());

  vi.mocked(api.createPromptPackage).mockResolvedValue({
    requestEnvelope,
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
    requestEnvelope,
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
    ...typedDraftFields(makeAssignmentText('# Generated assignment draft')),
    text: makeAssignmentText('# Generated assignment draft'),
    provider: 'openai',
    model: 'gpt-5.2',
    quota: {
      source: 'hybrid',
      lastUpdatedAt: now,
    },
  });

  vi.mocked(api.createDraft).mockImplementation(async (promptPackageId, text) => ({
    ...typedDraftFields(text),
    id: 'draft-1',
    promptPackageId,
    studentId: null,
    lessonId: null,
    storageUri: 'memory://drafts/draft-1',
    createdBy: 'user-1',
    text,
    workingVersion: 1,
    contentHash: 'a'.repeat(64),
    createdAt: now,
    updatedAt: now,
  }));
  vi.mocked(api.fetchDraft).mockResolvedValue({
    ...typedDraftFields(makeAssignmentText('# Draft markdown')),
    id: 'draft-1',
    promptPackageId: 'pkg-1',
    studentId: null,
    lessonId: null,
    storageUri: 'memory://drafts/draft-1',
    createdBy: 'user-1',
    text: makeAssignmentText('# Draft markdown'),
    workingVersion: 1,
    contentHash: 'a'.repeat(64),
    createdAt: now,
    updatedAt: now,
  });

  vi.mocked(api.updateDraft).mockImplementation(async (id, text) => ({
    ...typedDraftFields(text),
    id,
    promptPackageId: 'pkg-1',
    studentId: null,
    lessonId: null,
    storageUri: 'memory://drafts/draft-1',
    createdBy: 'user-1',
    text,
    workingVersion: 2,
    contentHash: 'b'.repeat(64),
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
    assignmentArtifact,
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
