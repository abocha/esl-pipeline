import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Accept } from 'react-dropzone';

import type {
  AssignmentSession,
  ConfirmAssignmentSessionStepRequest,
  FoundationalProfile,
  GenerationProvider,
  JobEvent,
  JobOptionsResponse,
  JobStatus,
  PromptOptionsResponse,
  SttProvider,
  StudentScheduleBillingSurface,
  UpdateAssignmentSessionRecoveryRequest,
} from '../../utils/api';
import {
  ArtifactWorkingConflictApiError,
  AssignmentSessionConflictApiError,
  AssignmentSourceOwnershipApiError,
  AssignmentSpeakerRoleMappingRequiredApiError,
  activateProfileRevision,
  confirmAssignmentSessionStep,
  confirmStudentAssignmentSession,
  fetchAssignmentSession,
  fetchJobOptions,
  fetchPromptOptions,
  getJobStatus,
  getStudentMemoryHealth,
  getStudentScheduleBillingSurface,
  populateFirstProfileFromLesson,
  publishAssignmentCorrection,
  shareAssignmentSession,
  subscribeToJobEvents,
  updateAssignmentSessionRecovery,
} from '../../utils/api';
import { AssignmentSupport } from '../assignments/AssignmentSupport';
import { AssignmentWorkflow } from '../assignments/AssignmentWorkflow';
import {
  type AssignmentStepId,
  deriveAssignmentWorkflow,
  deriveHistoricalAssignmentOutputWorkflow,
} from '../assignments/assignment-workflow';
import {
  AssignmentEntryStep,
  type AssignmentEntrySummary,
} from '../assignments/steps/AssignmentEntryStep';
import { CreateAssignmentStep } from '../assignments/steps/CreateAssignmentStep';
import { LessonSourceStep } from '../assignments/steps/LessonSourceStep';
import { ReviewShareStep } from '../assignments/steps/ReviewShareStep';
import { TeachingContextStep } from '../assignments/steps/TeachingContextStep';
import { useAssignmentNavigationGuard } from '../shell/assignment-navigation-guard';
import {
  AdvancedActionsStage,
  AssignmentDiagnostics,
  useAdvancedActionsController,
} from './MinimalAssignment.advanced';
import { useMinimalAssignmentAuthoringController } from './MinimalAssignment.authoring';
import {
  canShareAssignment,
  findResumeStep,
  isAssignmentConfirmationApplied,
  shouldGuardAssignmentExit,
} from './MinimalAssignment.confirmation';
import { useMinimalAssignmentContextController } from './MinimalAssignment.context';
import {
  buildAssignmentCorrectionRequest,
  canRetryAssignmentPublication,
  hasSavedUnpublishedDraft,
  isCompletedAssignmentSession,
  isValidAssignmentPublicationParent,
} from './MinimalAssignment.correction';
import type { AssignmentEntryView } from './MinimalAssignment.entry-state';
import {
  getJobPollingDecision,
  getNextFallbackPollingDelay,
  INITIAL_FALLBACK_POLL_MS,
  isActivelyProcessingJobState,
  isFallbackPollingPaused,
  isTerminalJobState,
  SSE_STALE_TIMEOUT_MS,
} from './MinimalAssignment.polling';
import {
  type HydratedAssignmentSnapshot,
  type HydrationContext,
  type HydrationMode,
  type ResumeOpenSuccess,
  useMinimalAssignmentResume,
} from './MinimalAssignment.resume';
import {
  buildRecentAssignmentItems,
  buildRecentAssignmentLineages,
} from './MinimalAssignment.resume-presentation';
import { useMinimalAssignmentSourceController } from './MinimalAssignment.source';
import {
  AssignmentStageSection,
  ContextStageSection,
  ReviewStageSection,
  SourceStageSection,
  type WorkflowStage,
  type WorkflowStageStatus,
} from './MinimalAssignment.stages';
import './MinimalAssignment.css';

class AssignmentMutationAmbiguousError extends Error {}

function isUnsafeAssignmentSaveState(state: string): boolean {
  return state === 'ambiguous' || state === 'error' || state === 'conflict';
}

async function getJobStatusWithRecoveryRetry(jobId: string): Promise<JobStatus> {
  const delays = [250, 1_000] as const;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getJobStatus(jobId);
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined) throw error;
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delay));
    }
  }
}

const RECORDING_FILE_ACCEPT = {
  'audio/*': ['.aac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.webm'],
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
} satisfies Accept;
const FOCUSED_STEP_ORDER: AssignmentStepId[] = [
  'student',
  'source',
  'context',
  'assignment',
  'review',
];
const FALLBACK_TTS_PROVIDERS = ['elevenlabs', 'google', 'inworld'] as const;
type TeacherNotesCommitResult = 'unchanged' | 'committed' | 'invalidated' | null;
const FALLBACK_PRONUNCIATION_CHUNK_TTS_PROVIDERS = ['google', 'elevenlabs', 'inworld'] as const;
const FALLBACK_GOOGLE_TTS_MODELS = ['chirp3_hd', 'studio', 'neural2', 'wavenet'] as const;
const FALLBACK_INWORLD_TTS_MODELS = [
  'inworld-tts-2',
  'inworld-tts-1.5-max',
  'inworld-tts-1.5-mini',
] as const;
const FALLBACK_ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const FALLBACK_ELEVENLABS_MODELS = [
  'eleven_v3',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_flash_v2',
] as const;
const RECENT_LESSON_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const FIRST_PROFILE_HEALTH_POLL_MS = 10_000;

type UiTtsProvider = (typeof FALLBACK_TTS_PROVIDERS)[number];
type UiPronunciationChunkTtsProvider = (typeof FALLBACK_PRONUNCIATION_CHUNK_TTS_PROVIDERS)[number];
type UiPublishTtsStrategy = 'auto' | 'dialogue' | 'tts';
type PronunciationMode =
  | 'shadow_sentence'
  | 'connected_speech'
  | 'intonation'
  | 'rhythm_chunking'
  | 'sentence_stress'
  | 'minimal_pair';

function isUiTtsProvider(value: string | null | undefined): value is UiTtsProvider {
  return value === 'elevenlabs' || value === 'google' || value === 'inworld';
}

function isSttProvider(value: string | null | undefined): value is SttProvider {
  return value === 'deepgram' || value === 'elevenlabs' || value === 'google';
}

function formatSttProviderLabel(provider: SttProvider): string {
  if (provider === 'deepgram') return 'Deepgram';
  if (provider === 'elevenlabs') return 'ElevenLabs';
  return 'Google';
}

function isUiPublishTtsStrategy(value: string | null | undefined): value is UiPublishTtsStrategy {
  return value === 'auto' || value === 'dialogue' || value === 'tts';
}

function isGenerationProvider(value: string | null | undefined): value is GenerationProvider {
  return value === 'openai' || value === 'google_ai_studio' || value === 'openrouter';
}

function buildFirstProfileSourceAuthorityKey(
  session: AssignmentSession | null,
  recordingId: string | null | undefined,
  transcriptId: string | null | undefined,
): string | null {
  const confirmedSource = session?.confirmed.source;
  if (
    !confirmedSource ||
    confirmedSource.recordingId !== recordingId ||
    confirmedSource.transcriptId !== transcriptId
  ) {
    return null;
  }

  return JSON.stringify({
    sessionId: session.id,
    recordingId: confirmedSource.recordingId,
    transcriptId: confirmedSource.transcriptId,
    transcriptHash: confirmedSource.transcriptHash,
  });
}

function buildAssignmentSessionSettingsKey(settings: {
  teacherNotes: string | null;
  selectedGenerationProvider: GenerationProvider | null;
  selectedGenerationModel: string | null;
  publishTarget: string;
  selectedTtsProvider: string;
  selectedTtsStrategy: string;
  selectedTtsModel: string | null;
  selectedPreset: string | null;
}): string {
  return JSON.stringify(settings);
}

function clearAssignmentResumeQuery(): void {
  if (globalThis.window === undefined) return;
  const nextUrl = new URL(globalThis.location.href);
  nextUrl.searchParams.delete('jobId');
  nextUrl.searchParams.delete('sessionId');
  const suffix = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  globalThis.history.replaceState(null, '', suffix);
}

function describeJobFailureReason(job: Pick<JobStatus, 'publishTarget' | 'error'>): string {
  const reason = job.error?.trim();
  if (!reason) {
    return 'Publishing failed. Check service availability and retry.';
  }
  return reason;
}

function formatShortJobId(jobId: string | null | undefined): string {
  return jobId ? jobId.slice(0, 8) : '';
}

function getDefaultPronunciationChunkProviderForMode(
  _mode: PronunciationMode | null,
): UiPronunciationChunkTtsProvider {
  return 'google';
}

interface SelectablePresetOption {
  id: string;
  label: string;
  source: 'learning' | 'legacy';
}

type ScheduleLesson = StudentScheduleBillingSurface['lessons'][number];

interface AssignmentLessonSuggestion {
  id: string;
  label: string;
  detail: string;
}

function buildSelectablePresetOptions(
  options: Pick<JobOptionsResponse, 'learningPresets' | 'presets'> | null | undefined,
): SelectablePresetOption[] {
  const learningPresets = options?.learningPresets;
  if (learningPresets && learningPresets.length > 0) {
    return learningPresets.map((preset) => ({
      id: preset.id,
      label: preset.title ? `${preset.title} (${preset.id})` : preset.id,
      source: 'learning',
    }));
  }

  return (options?.presets ?? []).map((preset) => ({
    id: preset,
    label: preset,
    source: 'legacy',
  }));
}

const LESSON_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatLessonDateTime(value: string | null | undefined): string {
  if (!value) return 'date unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date unknown' : LESSON_DATE_TIME_FORMATTER.format(date);
}

function formatLessonContext(lesson: ScheduleLesson | null, lessonId: string): string {
  if (!lesson) return `Lesson context: ${lessonId}`;
  const topic = lesson.title?.trim() ? lesson.title.trim() : 'Untitled lesson';
  return `Lesson context: ${formatLessonDateTime(lesson.startsAt)} - ${topic} - ${lesson.id}`;
}

function isRecentPassedNoHomeworkLesson(lesson: ScheduleLesson, nowMs: number): boolean {
  if (lesson.homework.status !== 'not_started') return false;
  if (lesson.status === 'canceled') return false;
  const startsAtMs = new Date(lesson.startsAt).getTime();
  if (Number.isNaN(startsAtMs)) return false;
  const endsAtMs = startsAtMs + lesson.durationMinutes * 60 * 1000;
  if (endsAtMs > nowMs) return false;
  return endsAtMs >= nowMs - RECENT_LESSON_LOOKBACK_MS;
}

export const MinimalAssignment: React.FC = () => {
  const scheduleFollowupContext = useMemo(() => {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    return {
      studentId: params.get('studentId')?.trim() || '',
      lessonId: params.get('lessonId')?.trim() || '',
    };
  }, []);
  const [promptOptions, setPromptOptions] = useState<PromptOptionsResponse | null>(null);
  const [operatorSelectedTemplateId, setOperatorSelectedTemplateId] = useState('');
  const [linkedLessonId, setLinkedLessonId] = useState(scheduleFollowupContext.lessonId);
  const [scheduleSurface, setScheduleSurface] = useState<StudentScheduleBillingSurface | null>(
    null,
  );
  const [scheduleSurfaceError, setScheduleSurfaceError] = useState<string | null>(null);
  const [teacherNotes, setTeacherNotes] = useState('');
  const [jobStatus, setJobStatusState] = useState<JobStatus | null>(null);
  const [publicationParentJob, setPublicationParentJob] = useState<JobStatus | null>(null);
  const [jobOptions, setJobOptions] = useState<JobOptionsResponse | null>(null);
  const [jobOptionsError, setJobOptionsError] = useState<string | null>(null);
  const [entryView, setEntryView] = useState<AssignmentEntryView>('choice');
  const [entrySummary, setEntrySummary] = useState<AssignmentEntrySummary | null>(null);
  const [activeStep, setActiveStep] = useState<AssignmentStepId>('student');
  const [assignmentSaveState, setAssignmentSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'ambiguous'
  >('idle');
  const [assignmentDebouncedRecoveryPending, setAssignmentDebouncedRecoveryPending] =
    useState(false);
  const [assignmentConfirmationError, setAssignmentConfirmationError] = useState<string | null>(
    null,
  );
  const [assignmentRecoveryError, setAssignmentRecoveryError] = useState<string | null>(null);
  const [assignmentRecoveryNotice, setAssignmentRecoveryNotice] = useState<string | null>(null);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [correctionPublishing, setCorrectionPublishing] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const assignmentSaveStateRef = useRef(assignmentSaveState);
  assignmentSaveStateRef.current = assignmentSaveState;
  const [startingAssignment, setStartingAssignment] = useState(false);
  const [sharingAssignment, setSharingAssignment] = useState(false);
  const [assignmentShareError, setAssignmentShareError] = useState<string | null>(null);
  const [firstProfileLessonMemoryStatus, setFirstProfileLessonMemoryStatus] = useState<
    'checking' | 'building' | 'ready'
  >('checking');
  const [firstProfileLessonMemoryReadyCount, setFirstProfileLessonMemoryReadyCount] = useState(0);
  const [firstProfileDraft, setFirstProfileDraft] = useState<{
    profileId: string;
    draftRevisionId: string;
    structuredContent: FoundationalProfile | null;
    sourceAuthorityKey: string;
  } | null>(null);
  const [firstProfileAssistBusy, setFirstProfileAssistBusy] = useState<
    'drafting' | 'approving' | null
  >(null);
  const [firstProfileAssistApproved, setFirstProfileAssistApproved] = useState(false);
  const [firstProfileAssistError, setFirstProfileAssistError] = useState<string | null>(null);

  const [rerunTargetPronunciationMode, setRerunTargetPronunciationMode] =
    useState<PronunciationMode | null>(null);

  const sourceSectionRef = useRef<HTMLElement | null>(null);
  const sourceHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const sourceStudentSelectRef = useRef<HTMLSelectElement | null>(null);
  const contextSectionRef = useRef<HTMLElement | null>(null);
  const contextHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const assignmentSectionRef = useRef<HTMLElement | null>(null);
  const assignmentHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const assignmentGenerateDraftButtonRef = useRef<HTMLButtonElement | null>(null);
  const reviewSectionRef = useRef<HTMLElement | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const reviewPreviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const advancedSectionRef = useRef<HTMLElement | null>(null);
  const advancedHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const assignmentSessionMutationQueueRef = useRef<Promise<AssignmentSession | null>>(
    Promise.resolve(null),
  );
  const assignmentSessionMutationSequenceRef = useRef(0);
  const activeAssignmentSessionIdRef = useRef<string | null>(null);
  const activeAssignmentSessionRef = useRef<AssignmentSession | null>(null);
  const studentConfirmationRequestRef = useRef<{
    studentId: string;
    requestId: string;
  } | null>(null);
  const shareRequestRef = useRef<string | null>(null);
  const shareReconciliationInFlightRef = useRef(false);
  const correctionModeRef = useRef(false);
  const correctionRequestRef = useRef<string | null>(null);
  const correctionPayloadRef = useRef<ReturnType<typeof buildAssignmentCorrectionRequest>>(null);
  const correctionReconciliationRef = useRef(false);
  const autoResumedShareSessionRef = useRef<string | null>(null);
  const assignmentSessionSettingsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assignmentContextRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assignmentContextConflictKeyRef = useRef<string | null>(null);
  const pendingContextRecoveryRef = useRef<{
    key: string;
    patch: UpdateAssignmentSessionRecoveryRequest['patch'];
  } | null>(null);
  const pendingSettingsRecoveryRef = useRef<UpdateAssignmentSessionRecoveryRequest['patch'] | null>(
    null,
  );
  const pendingSessionRecoveryDrainRef = useRef<Promise<boolean> | null>(null);
  const assignmentSessionMilestoneRef = useRef({
    studentId: '',
    recordingId: '',
    transcriptId: '',
    promptPackageId: '',
    draftId: '',
    lessonId: linkedLessonId,
  });
  const assignmentSessionSettingsRef = useRef('');
  const hydrationIdRef = useRef(0);
  const assignmentSessionPersistenceSuppressedRef = useRef(false);
  const assignmentSessionUserEditedRef = useRef(false);
  const committedTeacherNotesRef = useRef('');
  const firstProfileSourceAuthorityKeyRef = useRef<string | null>(null);

  const generationOptions = jobOptions?.generation ?? null;
  const ttsProviders = useMemo<UiTtsProvider[]>(() => {
    const providers = (jobOptions?.ttsProviders ?? [])
      .map((provider) => (isUiTtsProvider(provider) ? provider : null))
      .filter((provider): provider is UiTtsProvider => provider !== null);
    if (providers.length > 0) {
      return [...new Set(providers)];
    }
    return [...FALLBACK_TTS_PROVIDERS];
  }, [jobOptions?.ttsProviders]);
  const ttsModelOptionsByProvider = useMemo(() => {
    const elevenlabsConfigured = jobOptions?.ttsModelOptionsByProvider?.elevenlabs ?? [];
    const googleConfigured = jobOptions?.ttsModelOptionsByProvider?.google ?? [];
    const inworldConfigured = jobOptions?.ttsModelOptionsByProvider?.inworld ?? [];
    const elevenlabsDefault =
      (jobOptions?.defaultTtsModelByProvider?.elevenlabs ?? '').trim() || FALLBACK_ELEVENLABS_MODEL;
    const elevenlabsOptions = [
      ...new Set([...elevenlabsConfigured, elevenlabsDefault].filter(Boolean)),
    ];
    const googleOptions = [
      ...new Set(googleConfigured.length > 0 ? googleConfigured : [...FALLBACK_GOOGLE_TTS_MODELS]),
    ];
    const inworldOptions = [
      ...new Set(
        inworldConfigured.length > 0 ? inworldConfigured : [...FALLBACK_INWORLD_TTS_MODELS],
      ),
    ];

    return {
      elevenlabs: elevenlabsOptions.length > 0 ? elevenlabsOptions : [FALLBACK_ELEVENLABS_MODEL],
      google: googleOptions.length > 0 ? googleOptions : [...FALLBACK_GOOGLE_TTS_MODELS],
      inworld: inworldOptions.length > 0 ? inworldOptions : [...FALLBACK_INWORLD_TTS_MODELS],
    };
  }, [jobOptions?.defaultTtsModelByProvider, jobOptions?.ttsModelOptionsByProvider]);
  const elevenlabsModelOptions = useMemo(
    () => ttsModelOptionsByProvider.elevenlabs ?? [...FALLBACK_ELEVENLABS_MODELS],
    [ttsModelOptionsByProvider],
  );
  const elevenlabsStandardModelOptions = useMemo(
    () =>
      elevenlabsModelOptions.filter(
        (model): model is Exclude<(typeof FALLBACK_ELEVENLABS_MODELS)[number], 'eleven_v3'> =>
          model !== 'eleven_v3',
      ),
    [elevenlabsModelOptions],
  );
  const defaultPronunciationChunkProvider = useMemo<UiPronunciationChunkTtsProvider>(
    () => getDefaultPronunciationChunkProviderForMode(rerunTargetPronunciationMode),
    [rerunTargetPronunciationMode],
  );

  const presetOptions = useMemo(() => buildSelectablePresetOptions(jobOptions), [jobOptions]);
  const presetOptionIds = useMemo(() => presetOptions.map((preset) => preset.id), [presetOptions]);
  const learningPresetCatalogEnabled = (jobOptions?.learningPresets?.length ?? 0) > 0;
  const fallbackTemplateId = useMemo(() => {
    if (!promptOptions) return '';
    return promptOptions.defaults.templateId ?? promptOptions.templates?.[0]?.id ?? '';
  }, [promptOptions]);
  const selectedTemplateId = useMemo(() => {
    if (!promptOptions) return '';
    const templateIds = new Set(promptOptions.templates.map((template) => template.id));
    if (operatorSelectedTemplateId && templateIds.has(operatorSelectedTemplateId)) {
      return operatorSelectedTemplateId;
    }
    return fallbackTemplateId;
  }, [fallbackTemplateId, operatorSelectedTemplateId, promptOptions]);

  useEffect(() => {
    if (!promptOptions) return;
    const templateIds = new Set(promptOptions.templates.map((template) => template.id));
    if (!operatorSelectedTemplateId || !templateIds.has(operatorSelectedTemplateId)) {
      setOperatorSelectedTemplateId(fallbackTemplateId);
    }
  }, [fallbackTemplateId, operatorSelectedTemplateId, promptOptions]);

  const resetJobShell = useCallback(() => {
    clearAssignmentResumeQuery();
    setTeacherNotes('');
    setJobStatusState(null);
    setRerunTargetPronunciationMode(null);
  }, []);

  const source = useMinimalAssignmentSourceController({
    configuredSttProviders: jobOptions?.sttProviders,
    defaultSttProvider: isSttProvider(jobOptions?.defaultSttProvider)
      ? jobOptions.defaultSttProvider
      : null,
    initialSelectedStudentId: scheduleFollowupContext.studentId,
    onBeforeUploadReset: resetJobShell,
  });
  const [mixedSpeakerRoleSelections, setMixedSpeakerRoleSelections] = useState<
    Record<number, 'teacher' | 'student' | ''>
  >({});
  useEffect(() => {
    setMixedSpeakerRoleSelections({});
  }, [source.transcript?.transcriptId]);
  const mixedSpeakerRoles = useMemo(() => {
    if (source.recording?.audioTopology !== 'mixed_recording') return [];
    const summary = source.transcript?.summaryJson;
    const mapping = summary?.speakerRoleMapping as
      | {
          provenance?: unknown;
          roles?: unknown;
          confirmedWorkingVersion?: unknown;
          confirmedContentHash?: unknown;
        }
      | undefined;
    const mappingIsCurrent =
      mapping?.provenance === 'tutor_confirmed' &&
      mapping.confirmedWorkingVersion === source.transcript?.workingVersion &&
      mapping.confirmedContentHash === source.transcript?.contentHash;
    if (mappingIsCurrent) return [];
    const priorRoles = new Map(
      Array.isArray(mapping?.roles)
        ? mapping.roles.flatMap((item) => {
            if (
              !item ||
              typeof item !== 'object' ||
              typeof (item as { speaker?: unknown }).speaker !== 'number' ||
              ((item as { role?: unknown }).role !== 'teacher' &&
                (item as { role?: unknown }).role !== 'student')
            ) {
              return [];
            }
            const typed = item as { speaker: number; role: 'teacher' | 'student' };
            return [[typed.speaker, typed.role] as const];
          })
        : [],
    );
    const speakers = (summary?.speakerTracks as { speakers?: unknown } | undefined)?.speakers;
    if (!Array.isArray(speakers)) return [];
    return speakers
      .map((item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as { speaker?: unknown }).speaker === 'number'
          ? (item as { speaker: number }).speaker
          : null,
      )
      .filter((speaker): speaker is number => speaker !== null)
      .map((speaker) => ({
        speaker,
        role: mixedSpeakerRoleSelections[speaker] ?? priorRoles.get(speaker) ?? '',
      }));
  }, [
    mixedSpeakerRoleSelections,
    source.recording?.audioTopology,
    source.transcript?.contentHash,
    source.transcript?.summaryJson,
    source.transcript?.workingVersion,
  ]);

  const context = useMinimalAssignmentContextController({
    selectedStudentId: source.selectedStudentId,
    resolveBoundProfileId: source.resolveBoundProfileId,
    boundProfileResolutionReady: source.studentOptionsResolved,
  });
  const durableProfileLineage = useMemo(
    () => ({
      selectedProfileId:
        context.selectedProfileRevisionId && context.selectedProfileRevisionHash
          ? context.selectedProfileId || null
          : null,
      selectedProfileRevisionId: context.selectedProfileRevisionId,
      selectedProfileRevisionHash: context.selectedProfileRevisionHash,
    }),
    [
      context.selectedProfileId,
      context.selectedProfileRevisionHash,
      context.selectedProfileRevisionId,
    ],
  );
  const {
    resetSourceFlow,
    applyHydratedSnapshot: applySourceHydration,
    loadStudentOptions,
    handleSelectedSttProviderChange,
    handleStudentSelectionChange,
    handleFiles,
    handleCancelUpload,
    setTranscriptText,
  } = source;
  const { applyHydratedSnapshot: applyContextHydration } = context;
  const getActiveAssignmentSessionId = useCallback(() => activeAssignmentSessionIdRef.current, []);

  const authoring = useMinimalAssignmentAuthoringController({
    recordingId: source.recording?.recordingId ?? null,
    getAssignmentSessionId: getActiveAssignmentSessionId,
    transcriptStatus: source.transcriptStatus,
    teacherNotes,
    selectedTemplateId,
    currentJobId: jobStatus?.jobId ?? null,
    learningPresetCatalogEnabled,
    presetOptionIds,
    generationOptions,
    ttsProviders,
    ttsModelOptionsByProvider,
    elevenlabsModelOptions,
    elevenlabsStandardModelOptions,
    defaultTtsProvider: isUiTtsProvider(jobOptions?.defaultTtsProvider)
      ? jobOptions.defaultTtsProvider
      : null,
    defaultTtsModelByProvider: jobOptions?.defaultTtsModelByProvider,
    configuredTtsStrategies: (jobOptions?.ttsStrategies ?? []).filter(isUiPublishTtsStrategy),
    onDraftPronunciationModeDetected: setRerunTargetPronunciationMode,
    onTeacherNotesResolved: setTeacherNotes,
  });
  const {
    invalidatePendingGeneration: invalidateAuthoringGeneration,
    resetAuthoring,
    setPromptError,
    applyHydrationSnapshot: applyAuthoringHydration,
    setPublishError: setAuthoringPublishError,
  } = authoring;
  const refreshTranscriptPreservingLocal = source.refreshTranscriptPreservingLocal;
  const reconcileRecordingAndTranscript = source.reconcileRecordingAndTranscript;
  const refreshDraftPreservingLocal = authoring.refreshDraftPreservingLocal;

  const markAssignmentUserEdit = useCallback(() => {
    if (correctionModeRef.current) return;
    assignmentSessionUserEditedRef.current = true;
    assignmentSessionPersistenceSuppressedRef.current = false;
  }, []);
  const createManualTranscript = source.createManualTranscript;

  const handleCreateManualTranscript = useCallback(
    async (text: string, displayName?: string) => {
      markAssignmentUserEdit();
      await createManualTranscript(text, displayName);
    },
    [createManualTranscript, markAssignmentUserEdit],
  );

  const resetPendingSessionRecovery = useCallback(() => {
    if (assignmentContextRecoveryTimeoutRef.current) {
      clearTimeout(assignmentContextRecoveryTimeoutRef.current);
      assignmentContextRecoveryTimeoutRef.current = null;
    }
    if (assignmentSessionSettingsTimeoutRef.current) {
      clearTimeout(assignmentSessionSettingsTimeoutRef.current);
      assignmentSessionSettingsTimeoutRef.current = null;
    }
    pendingContextRecoveryRef.current = null;
    pendingSettingsRecoveryRef.current = null;
    pendingSessionRecoveryDrainRef.current = null;
    setAssignmentDebouncedRecoveryPending(false);
  }, []);

  const beginHydration = useCallback(
    (mode: HydrationMode): HydrationContext => {
      if (mode !== 'new') {
        // A resumed assignment has its own source workflow even when it belongs
        // to the same student. Invalidate before any resume I/O can yield so an
        // older upload-status lookup cannot hydrate the resumed source state.
        resetSourceFlow({ preserveRecordingSettings: true });
      }
      hydrationIdRef.current += 1;
      assignmentSessionUserEditedRef.current = false;
      assignmentSessionPersistenceSuppressedRef.current = mode !== 'new';
      resetPendingSessionRecovery();
      return { id: hydrationIdRef.current, mode };
    },
    [resetPendingSessionRecovery, resetSourceFlow],
  );

  const isCurrentHydration = useCallback(
    (context: HydrationContext) => hydrationIdRef.current === context.id,
    [],
  );

  const resetFlow = useCallback(
    (nextStudentId?: string) => {
      beginHydration('new');
      committedTeacherNotesRef.current = '';
      invalidateAuthoringGeneration();
      resetAuthoring();
      resetSourceFlow(nextStudentId === undefined ? { resetStudent: true } : { nextStudentId });
      resetJobShell();
    },
    [beginHydration, invalidateAuthoringGeneration, resetAuthoring, resetJobShell, resetSourceFlow],
  );

  const loadPromptOptions = useCallback(async () => {
    try {
      const response = await fetchPromptOptions();
      setPromptOptions(response);
      setPromptError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load prompt options.';
      setPromptError(message);
    }
  }, [setPromptError]);

  const loadJobOptions = useCallback(async () => {
    try {
      const response = await fetchJobOptions();
      setJobOptions(response);
      setJobOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load job options.';
      setJobOptionsError(message);
    }
  }, []);

  const applyHydratedSnapshot = useCallback(
    (snapshot: HydratedAssignmentSnapshot) => {
      const snapshotLessonId = snapshot.lessonId ?? scheduleFollowupContext.lessonId;
      setLinkedLessonId(snapshotLessonId);
      assignmentSessionMilestoneRef.current = {
        studentId: snapshot.selectedStudentId,
        recordingId: snapshot.recording?.recordingId ?? '',
        transcriptId: snapshot.transcript?.transcriptId ?? '',
        promptPackageId: snapshot.authoring.promptPackage?.id ?? '',
        draftId: snapshot.authoring.draft?.id ?? '',
        lessonId: snapshotLessonId,
      };
      assignmentSessionSettingsRef.current = buildAssignmentSessionSettingsKey({
        teacherNotes: snapshot.teacherNotes.trim() || null,
        selectedGenerationProvider: isGenerationProvider(
          snapshot.authoring.selectedGenerationProvider,
        )
          ? snapshot.authoring.selectedGenerationProvider
          : null,
        selectedGenerationModel: snapshot.authoring.selectedGenerationModel || null,
        publishTarget: snapshot.authoring.publishTarget,
        selectedTtsProvider: snapshot.authoring.selectedTtsProvider,
        selectedTtsStrategy: snapshot.authoring.selectedTtsStrategy,
        selectedTtsModel: snapshot.authoring.selectedTtsModel || null,
        selectedPreset: snapshot.authoring.selectedPreset || null,
      });
      setJobStatusState(snapshot.jobStatus);
      applySourceHydration({
        recording: snapshot.recording,
        recordingStatus: snapshot.recordingStatus,
        recordingError: snapshot.recordingError,
        selectedFileName: snapshot.selectedFileName,
        transcript: snapshot.transcript,
        transcriptText: snapshot.transcriptText,
        transcriptStatus: snapshot.transcriptStatus,
        transcriptError: snapshot.transcriptError,
        selectedStudentId: snapshot.selectedStudentId,
        uploadError: snapshot.uploadError,
        uploadCacheNotice: snapshot.uploadCacheNotice,
      });
      setTeacherNotes(snapshot.teacherNotes);
      committedTeacherNotesRef.current = snapshot.teacherNotes.trim();
      setRerunTargetPronunciationMode(snapshot.rerunTargetPronunciationMode);
      applyContextHydration({
        selectedStudentId: snapshot.selectedStudentId,
        selectedProfileId: snapshot.selectedProfileId,
        profileSelectionMode: snapshot.profileSelectionMode,
        selectedProfileRevisionId: snapshot.selectedProfileRevisionId,
        selectedProfileRevisionHash: snapshot.selectedProfileRevisionHash,
        profileAuthorityResolved: snapshot.profileAuthorityResolved,
      });
      applyAuthoringHydration(snapshot.authoring);
    },
    [
      applyAuthoringHydration,
      applyContextHydration,
      applySourceHydration,
      scheduleFollowupContext.lessonId,
    ],
  );

  const applyCurrentJobStatus = useCallback((job: JobStatus | null) => {
    setJobStatusState(job);
  }, []);

  const handleInitialHydrationResolved = useCallback((result: ResumeOpenSuccess) => {
    setEntrySummary({
      learnerName: 'Saved learner',
      state: result.state,
      origin: 'resume',
    });
    setEntryView('summary');
    setActiveStep(result.destination);
  }, []);

  const resume = useMinimalAssignmentResume({
    applyHydratedSnapshot,
    applyCurrentJobStatus,
    invalidateDraftGenerationRequests: invalidateAuthoringGeneration,
    beginHydration,
    isCurrentHydration,
    jobOptions,
    presetOptionIds,
    resolveBoundProfileId: source.resolveBoundProfileId,
    currentPublishTarget: authoring.publishTarget,
    currentSelectedTtsProvider: authoring.selectedTtsProvider,
    currentSelectedTtsStrategy: authoring.selectedTtsStrategy,
    currentSelectedTtsModel: authoring.selectedTtsModel,
    currentSelectedPreset: authoring.selectedPreset,
    currentSelectedStudentId: source.selectedStudentId,
    currentSelectedProfileId: context.selectedProfileId,
    currentProfileSelectionMode: context.profileSelectionMode,
    onInitialHydrationResolved: handleInitialHydrationResolved,
  });
  const activeAssignmentSession = resume.activeAssignmentSession;
  const setActiveAssignmentSession = resume.setActiveAssignmentSession;
  const openAssignmentSession = resume.openAssignmentSession;
  activeAssignmentSessionIdRef.current = activeAssignmentSession?.id ?? null;
  activeAssignmentSessionRef.current = activeAssignmentSession;

  const assignmentSessionWritesAllowed = useCallback(() => {
    return (
      !assignmentSessionPersistenceSuppressedRef.current || assignmentSessionUserEditedRef.current
    );
  }, []);

  const saveAssignmentSessionProgress = useCallback(
    async (
      patch: UpdateAssignmentSessionRecoveryRequest['patch'],
    ): Promise<AssignmentSession | null> => {
      const cleaned = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as UpdateAssignmentSessionRecoveryRequest['patch'];
      if (Object.keys(cleaned).length === 0) {
        return activeAssignmentSession;
      }

      const mutationSequence = assignmentSessionMutationSequenceRef.current + 1;
      const mutationHydrationId = hydrationIdRef.current;
      assignmentSessionMutationSequenceRef.current = mutationSequence;
      setAssignmentSaveState('saving');
      const run = assignmentSessionMutationQueueRef.current
        .catch(() => null)
        .then(async (latest) => {
          if (hydrationIdRef.current !== mutationHydrationId) return null;
          const current = latest ?? activeAssignmentSessionRef.current;
          if (!current && jobStatus?.jobId) {
            return null;
          }
          if (!current) return null;
          let saved: AssignmentSession;
          try {
            saved = await updateAssignmentSessionRecovery(current.id, {
              expectedRevision: current.revision,
              patch: cleaned,
            });
          } catch (error) {
            if (hydrationIdRef.current !== mutationHydrationId) return null;
            if (!(error instanceof AssignmentSessionConflictApiError)) throw error;
            const latest = error.latestSession;
            activeAssignmentSessionRef.current = latest;
            setActiveAssignmentSession(latest);
            const overlapsRemote = Object.keys(cleaned).some(
              (key) =>
                latest[key as keyof AssignmentSession] !== current[key as keyof AssignmentSession],
            );
            if (overlapsRemote) throw error;
            saved = await updateAssignmentSessionRecovery(latest.id, {
              expectedRevision: latest.revision,
              patch: cleaned,
            });
          }
          if (hydrationIdRef.current !== mutationHydrationId) return null;
          activeAssignmentSessionRef.current = saved;
          setActiveAssignmentSession(saved);
          return saved;
        });
      assignmentSessionMutationQueueRef.current = run;
      try {
        const saved = await run;
        if (saved && assignmentSessionMutationSequenceRef.current === mutationSequence) {
          setAssignmentSaveState('saved');
          setAssignmentRecoveryError(null);
          setAssignmentRecoveryNotice(null);
        }
        return saved;
      } catch (error) {
        if (error instanceof AssignmentSourceOwnershipApiError) {
          const opened = await openAssignmentSession(error.canonicalSession.id);
          if (opened.ok) {
            setActiveStep(opened.destination);
            setAssignmentSaveState('saved');
            setAssignmentRecoveryError(null);
            setAssignmentRecoveryNotice(
              'This lesson already has an assignment. We reopened the saved assignment.',
            );
          } else {
            setAssignmentSaveState('error');
            setAssignmentRecoveryError(
              'This lesson already has an assignment, but it could not be reopened. Refresh and try again.',
            );
          }
          return null;
        }
        console.warn('Unable to save assignment session progress', error);
        if (assignmentSessionMutationSequenceRef.current === mutationSequence) {
          setAssignmentSaveState(
            error instanceof AssignmentSessionConflictApiError ? 'conflict' : 'error',
          );
          setAssignmentRecoveryError(
            error instanceof Error
              ? `Could not save this step: ${error.message}`
              : 'Could not save this step. Try again.',
          );
          setAssignmentRecoveryNotice(null);
        }
        return null;
      }
    },
    [activeAssignmentSession, jobStatus?.jobId, openAssignmentSession, setActiveAssignmentSession],
  );

  const refreshDebouncedRecoveryPendingState = useCallback(() => {
    setAssignmentDebouncedRecoveryPending(
      pendingContextRecoveryRef.current !== null || pendingSettingsRecoveryRef.current !== null,
    );
  }, []);

  const drainPendingSessionRecovery = useCallback(async (): Promise<boolean> => {
    const drainHydrationId = hydrationIdRef.current;
    for (;;) {
      if (hydrationIdRef.current !== drainHydrationId) return false;
      if (assignmentContextRecoveryTimeoutRef.current) {
        clearTimeout(assignmentContextRecoveryTimeoutRef.current);
        assignmentContextRecoveryTimeoutRef.current = null;
      }
      if (assignmentSessionSettingsTimeoutRef.current) {
        clearTimeout(assignmentSessionSettingsTimeoutRef.current);
        assignmentSessionSettingsTimeoutRef.current = null;
      }
      const contextPending = pendingContextRecoveryRef.current;
      const settingsPending = pendingSettingsRecoveryRef.current;
      if (!contextPending && !settingsPending) {
        setAssignmentDebouncedRecoveryPending(false);
        return true;
      }
      pendingContextRecoveryRef.current = null;
      pendingSettingsRecoveryRef.current = null;
      refreshDebouncedRecoveryPendingState();
      const saved = await saveAssignmentSessionProgress({
        ...(settingsPending ?? {}),
        ...(contextPending?.patch ?? {}),
      });
      if (hydrationIdRef.current !== drainHydrationId) return false;
      if (!saved) {
        refreshDebouncedRecoveryPendingState();
        return false;
      }
      if (contextPending && assignmentContextConflictKeyRef.current === contextPending.key) {
        assignmentContextConflictKeyRef.current = null;
      }
    }
  }, [refreshDebouncedRecoveryPendingState, saveAssignmentSessionProgress]);

  const flushPendingSessionRecovery = useCallback((): Promise<boolean> => {
    const existing = pendingSessionRecoveryDrainRef.current;
    if (existing) return existing;
    const drain = drainPendingSessionRecovery().finally(() => {
      if (pendingSessionRecoveryDrainRef.current === drain) {
        pendingSessionRecoveryDrainRef.current = null;
      }
    });
    pendingSessionRecoveryDrainRef.current = drain;
    return drain;
  }, [drainPendingSessionRecovery]);

  const confirmAssignmentStep = useCallback(
    async (
      buildRequest: (session: AssignmentSession) => ConfirmAssignmentSessionStepRequest,
    ): Promise<AssignmentSession | null> => {
      const mutationSequence = assignmentSessionMutationSequenceRef.current + 1;
      assignmentSessionMutationSequenceRef.current = mutationSequence;
      setAssignmentConfirmationError(null);
      setAssignmentSaveState('saving');
      const run = assignmentSessionMutationQueueRef.current
        .catch(() => null)
        .then(async (latest) => {
          const current = latest ?? activeAssignmentSessionRef.current;
          if (!current) return null;
          const request = buildRequest(current);
          let response;
          try {
            response = await confirmAssignmentSessionStep(current.id, request);
          } catch (error) {
            if (error instanceof AssignmentSpeakerRoleMappingRequiredApiError) {
              await reconcileRecordingAndTranscript();
              throw error;
            }
            if (error instanceof ArtifactWorkingConflictApiError) {
              if (request.step === 'source') {
                await refreshTranscriptPreservingLocal();
              } else if (request.step === 'create') {
                await refreshDraftPreservingLocal();
              }
              throw error;
            }
            const serverSession =
              error instanceof AssignmentSessionConflictApiError
                ? error.latestSession
                : await fetchAssignmentSession(current.id).catch(() => null);
            if (!serverSession) {
              throw new AssignmentMutationAmbiguousError(
                'The confirmation response was lost and its outcome could not be checked.',
              );
            }
            activeAssignmentSessionRef.current = serverSession;
            setActiveAssignmentSession(serverSession);
            if (!isAssignmentConfirmationApplied(serverSession, request)) throw error;
            response = { session: serverSession, invalidated: [] };
          }
          activeAssignmentSessionRef.current = response.session;
          setActiveAssignmentSession(response.session);
          if (response.invalidated.includes('prompt') || response.invalidated.includes('draft')) {
            invalidateAuthoringGeneration();
            resetAuthoring();
            setJobStatusState(null);
          }
          return response.session;
        });
      assignmentSessionMutationQueueRef.current = run;
      try {
        const confirmed = await run;
        if (confirmed && assignmentSessionMutationSequenceRef.current === mutationSequence) {
          setAssignmentConfirmationError(null);
          setAssignmentSaveState('saved');
        }
        return confirmed;
      } catch (error) {
        console.warn('Unable to confirm assignment step', error);
        if (assignmentSessionMutationSequenceRef.current === mutationSequence) {
          const message = error instanceof Error ? error.message : 'Please try again.';
          setAssignmentConfirmationError(`Could not confirm this step: ${message}`);
          setAssignmentSaveState(
            error instanceof AssignmentSessionConflictApiError
              ? 'conflict'
              : error instanceof ArtifactWorkingConflictApiError
                ? 'conflict'
                : error instanceof AssignmentMutationAmbiguousError
                  ? 'ambiguous'
                  : 'error',
          );
        }
        return null;
      }
    },
    [
      invalidateAuthoringGeneration,
      reconcileRecordingAndTranscript,
      refreshDraftPreservingLocal,
      refreshTranscriptPreservingLocal,
      resetAuthoring,
      setActiveAssignmentSession,
    ],
  );

  const handleLinkedLessonSelection = useCallback(
    (lessonId: string) => {
      setLinkedLessonId(lessonId);
      assignmentSessionMilestoneRef.current.lessonId = lessonId;
      markAssignmentUserEdit();
      if (!assignmentSessionWritesAllowed()) return;
      void saveAssignmentSessionProgress({
        lessonId,
      });
    },
    [assignmentSessionWritesAllowed, markAssignmentUserEdit, saveAssignmentSessionProgress],
  );

  const resetForNewAssignment = useCallback(
    (nextStudentId?: string) => {
      studentConfirmationRequestRef.current = null;
      shareRequestRef.current = null;
      shareReconciliationInFlightRef.current = false;
      correctionModeRef.current = false;
      correctionReconciliationRef.current = false;
      correctionRequestRef.current = null;
      correctionPayloadRef.current = null;
      setCorrectionMode(false);
      setCorrectionError(null);
      autoResumedShareSessionRef.current = null;
      assignmentContextConflictKeyRef.current = null;
      assignmentSessionMutationQueueRef.current = Promise.resolve(null);
      resetPendingSessionRecovery();
      setAssignmentConfirmationError(null);
      assignmentSessionMilestoneRef.current = {
        studentId: '',
        recordingId: '',
        transcriptId: '',
        promptPackageId: '',
        draftId: '',
        lessonId: scheduleFollowupContext.lessonId,
      };
      setLinkedLessonId(scheduleFollowupContext.lessonId);
      setOperatorSelectedTemplateId(fallbackTemplateId);
      assignmentSessionSettingsRef.current = '';
      setActiveAssignmentSession(null);
      resetFlow(nextStudentId);
    },
    [
      fallbackTemplateId,
      resetFlow,
      resetPendingSessionRecovery,
      scheduleFollowupContext.lessonId,
      setActiveAssignmentSession,
    ],
  );

  const handleStartNewAssignmentWithSessionReset = useCallback(() => {
    resetForNewAssignment();
    setEntrySummary(null);
    setEntryView('choice');
    setActiveStep('student');
  }, [resetForNewAssignment]);

  const commitNewAssignment = useCallback(
    async (studentId: string) => {
      const learner = source.studentOptions.find((student) => student.id === studentId);
      if (!learner) return;
      const previousAttempt = studentConfirmationRequestRef.current;
      const requestId =
        previousAttempt?.studentId === studentId
          ? previousAttempt.requestId
          : globalThis.crypto.randomUUID();
      resetForNewAssignment(studentId);
      studentConfirmationRequestRef.current = { studentId, requestId };
      setStartingAssignment(true);
      setAssignmentSaveState('saving');
      try {
        const created = await confirmStudentAssignmentSession({
          requestId,
          studentId,
          lessonId: linkedLessonId || null,
        });
        activeAssignmentSessionRef.current = created;
        setActiveAssignmentSession(created);
        clearAssignmentResumeQuery();
        setEntrySummary({ learnerName: learner.name, state: 'unfinished', origin: 'new' });
        setEntryView('summary');
        setActiveStep('source');
        setAssignmentSaveState('saved');
      } catch (error) {
        console.warn('Unable to start assignment', error);
        setAssignmentSaveState('error');
      } finally {
        setStartingAssignment(false);
      }
    },
    [linkedLessonId, resetForNewAssignment, setActiveAssignmentSession, source.studentOptions],
  );

  useEffect(() => {
    const studentId = source.selectedStudentId.trim();
    if (!studentId || assignmentSessionMilestoneRef.current.studentId === studentId) return;
    assignmentSessionMilestoneRef.current.studentId = studentId;
  }, [source.selectedStudentId]);

  useEffect(() => {
    const recordingId = source.recording?.recordingId ?? '';
    if (!recordingId || assignmentSessionMilestoneRef.current.recordingId === recordingId) return;
    assignmentSessionMilestoneRef.current.recordingId = recordingId;
    if (!assignmentSessionWritesAllowed()) return;
    void saveAssignmentSessionProgress({
      recordingId,
      ...(linkedLessonId ? { lessonId: linkedLessonId } : {}),
    });
  }, [
    saveAssignmentSessionProgress,
    source.recording?.recordingId,
    source.recording?.studentId,
    source.selectedStudentId,
    linkedLessonId,
    mixedSpeakerRoles,
    assignmentSessionWritesAllowed,
  ]);

  useEffect(() => {
    const session = activeAssignmentSessionRef.current;
    if (!session || session.confirmedStep === 'share') return;
    const repairingPartialProfileLineage = Boolean(
      session.selectedProfileId &&
        (!session.selectedProfileRevisionId || !session.selectedProfileRevisionHash) &&
        context.profileLineageReady &&
        durableProfileLineage.selectedProfileId === session.selectedProfileId,
    );
    if (!assignmentSessionWritesAllowed() && !repairingPartialProfileLineage) return;
    const recovery: UpdateAssignmentSessionRecoveryRequest['patch'] = {
      teacherNotes: teacherNotes.trim() || null,
      ...(context.profileLineageReady ? durableProfileLineage : {}),
    };
    const recoveryKey = JSON.stringify(recovery);
    if (assignmentContextConflictKeyRef.current === recoveryKey) {
      pendingContextRecoveryRef.current = null;
      refreshDebouncedRecoveryPendingState();
      return;
    }
    if (
      Object.entries(recovery).every(
        ([key, value]) => session[key as keyof AssignmentSession] === value,
      )
    ) {
      pendingContextRecoveryRef.current = null;
      refreshDebouncedRecoveryPendingState();
      return;
    }
    if (assignmentContextRecoveryTimeoutRef.current) {
      clearTimeout(assignmentContextRecoveryTimeoutRef.current);
    }
    pendingContextRecoveryRef.current = { key: recoveryKey, patch: recovery };
    refreshDebouncedRecoveryPendingState();
    assignmentContextRecoveryTimeoutRef.current = setTimeout(() => {
      void flushPendingSessionRecovery();
    }, 1500);
    return () => {
      if (assignmentContextRecoveryTimeoutRef.current) {
        clearTimeout(assignmentContextRecoveryTimeoutRef.current);
        assignmentContextRecoveryTimeoutRef.current = null;
      }
    };
  }, [
    assignmentSessionWritesAllowed,
    context.profileLineageReady,
    context.selectedProfileId,
    context.selectedProfileRevisionHash,
    context.selectedProfileRevisionId,
    durableProfileLineage,
    flushPendingSessionRecovery,
    refreshDebouncedRecoveryPendingState,
    teacherNotes,
  ]);

  useEffect(() => {
    const transcriptId = source.transcript?.transcriptId ?? '';
    if (
      source.transcriptStatus !== 'ready' ||
      !transcriptId ||
      assignmentSessionMilestoneRef.current.transcriptId === transcriptId
    ) {
      return;
    }
    assignmentSessionMilestoneRef.current.transcriptId = transcriptId;
    if (!assignmentSessionWritesAllowed()) return;
    void saveAssignmentSessionProgress({
      ...(source.recording?.recordingId ? { recordingId: source.recording.recordingId } : {}),
      transcriptId,
    });
  }, [
    assignmentSessionWritesAllowed,
    saveAssignmentSessionProgress,
    source.recording?.recordingId,
    source.transcript?.transcriptId,
    source.transcriptStatus,
  ]);

  useEffect(() => {
    const promptPackageId = authoring.promptPackage?.id ?? '';
    if (
      !promptPackageId ||
      assignmentSessionMilestoneRef.current.promptPackageId === promptPackageId
    ) {
      return;
    }
    assignmentSessionMilestoneRef.current.promptPackageId = promptPackageId;
    if (!assignmentSessionWritesAllowed()) return;
    void saveAssignmentSessionProgress({
      promptPackageId,
      draftId: authoring.draft?.promptPackageId === promptPackageId ? authoring.draft.id : null,
      ...(linkedLessonId ? { lessonId: linkedLessonId } : {}),
      teacherNotes: teacherNotes.trim() || null,
      selectedGenerationProvider: isGenerationProvider(authoring.selectedGenerationProvider)
        ? authoring.selectedGenerationProvider
        : null,
      selectedGenerationModel: authoring.selectedGenerationModel || null,
    });
  }, [
    authoring.draft?.id,
    authoring.draft?.promptPackageId,
    authoring.promptPackage?.id,
    authoring.selectedGenerationModel,
    authoring.selectedGenerationProvider,
    saveAssignmentSessionProgress,
    linkedLessonId,
    teacherNotes,
    assignmentSessionWritesAllowed,
  ]);

  useEffect(() => {
    const draftId = authoring.draft?.id ?? '';
    if (!draftId || assignmentSessionMilestoneRef.current.draftId === draftId) return;
    assignmentSessionMilestoneRef.current.draftId = draftId;
    if (!assignmentSessionWritesAllowed()) return;
    void saveAssignmentSessionProgress({
      draftId,
      ...(linkedLessonId ? { lessonId: linkedLessonId } : {}),
      publishTarget: authoring.publishTarget,
      selectedTtsProvider: authoring.selectedTtsProvider,
      selectedTtsStrategy: authoring.selectedTtsStrategy,
      selectedTtsModel: authoring.selectedTtsModel || null,
      selectedPreset: authoring.selectedPreset || null,
    });
  }, [
    authoring.draft?.id,
    authoring.publishTarget,
    authoring.selectedPreset,
    authoring.selectedTtsModel,
    authoring.selectedTtsProvider,
    authoring.selectedTtsStrategy,
    saveAssignmentSessionProgress,
    linkedLessonId,
    assignmentSessionWritesAllowed,
  ]);

  useEffect(() => {
    if (!authoring.promptPackage?.id && !authoring.draft?.id) {
      pendingSettingsRecoveryRef.current = null;
      refreshDebouncedRecoveryPendingState();
      return;
    }

    const selectedGenerationProvider = isGenerationProvider(authoring.selectedGenerationProvider)
      ? authoring.selectedGenerationProvider
      : null;
    const normalizedTeacherNotes = teacherNotes.trim();
    const teacherNotesForPersistence =
      normalizedTeacherNotes === committedTeacherNotesRef.current
        ? normalizedTeacherNotes
        : committedTeacherNotesRef.current;
    const settingsKey = buildAssignmentSessionSettingsKey({
      teacherNotes: teacherNotesForPersistence || null,
      selectedGenerationProvider,
      selectedGenerationModel: authoring.selectedGenerationModel || null,
      publishTarget: authoring.publishTarget,
      selectedTtsProvider: authoring.selectedTtsProvider,
      selectedTtsStrategy: authoring.selectedTtsStrategy,
      selectedTtsModel: authoring.selectedTtsModel || null,
      selectedPreset: authoring.selectedPreset || null,
    });
    if (assignmentSessionSettingsRef.current === settingsKey) {
      pendingSettingsRecoveryRef.current = null;
      refreshDebouncedRecoveryPendingState();
      return;
    }
    assignmentSessionSettingsRef.current = settingsKey;
    if (!assignmentSessionWritesAllowed()) {
      pendingSettingsRecoveryRef.current = null;
      refreshDebouncedRecoveryPendingState();
      return;
    }
    if (assignmentSessionSettingsTimeoutRef.current) {
      clearTimeout(assignmentSessionSettingsTimeoutRef.current);
    }
    pendingSettingsRecoveryRef.current = {
      teacherNotes: committedTeacherNotesRef.current || null,
      selectedGenerationProvider,
      selectedGenerationModel: authoring.selectedGenerationModel || null,
      publishTarget: authoring.publishTarget,
      selectedTtsProvider: authoring.selectedTtsProvider,
      selectedTtsStrategy: authoring.selectedTtsStrategy,
      selectedTtsModel: authoring.selectedTtsModel || null,
      selectedPreset: authoring.selectedPreset || null,
    };
    refreshDebouncedRecoveryPendingState();
    assignmentSessionSettingsTimeoutRef.current = setTimeout(() => {
      void flushPendingSessionRecovery();
    }, 1500);

    return () => {
      if (assignmentSessionSettingsTimeoutRef.current) {
        clearTimeout(assignmentSessionSettingsTimeoutRef.current);
        assignmentSessionSettingsTimeoutRef.current = null;
      }
    };
  }, [
    authoring.draft?.id,
    authoring.promptPackage?.id,
    authoring.publishTarget,
    authoring.selectedGenerationModel,
    authoring.selectedGenerationProvider,
    authoring.selectedPreset,
    authoring.selectedTtsModel,
    authoring.selectedTtsProvider,
    authoring.selectedTtsStrategy,
    flushPendingSessionRecovery,
    refreshDebouncedRecoveryPendingState,
    teacherNotes,
    assignmentSessionWritesAllowed,
  ]);

  const advancedActions = useAdvancedActionsController({
    jobStatus,
    jobOptions,
    selectedTtsProvider: authoring.selectedTtsProvider,
    ttsProviders,
    ttsModelOptionsByProvider,
    elevenlabsStandardModelOptions,
    defaultPronunciationChunkProvider,
    applyJobStatusTransition: resume.applyJobStatusTransition,
    refreshResumeJobs: resume.loadResumeJobs,
  });
  const resumeLoadResumeJobs = resume.loadResumeJobs;
  const resumeSelectedResumeJobId = resume.selectedResumeJobId;
  const resumeSetSelectedResumeJobId = resume.setSelectedResumeJobId;
  useEffect(() => {
    return () => {
      if (assignmentSessionSettingsTimeoutRef.current) {
        clearTimeout(assignmentSessionSettingsTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void loadPromptOptions();
    void loadJobOptions();
    void loadStudentOptions();
  }, [loadJobOptions, loadPromptOptions, loadStudentOptions]);

  useEffect(() => {
    const studentId = source.selectedStudentId.trim();
    if (!studentId) {
      setScheduleSurface(null);
      setScheduleSurfaceError(null);
      return;
    }

    let active = true;
    void getStudentScheduleBillingSurface(studentId)
      .then((surface) => {
        if (!active) return;
        setScheduleSurface(surface);
        setScheduleSurfaceError(null);
      })
      .catch((error) => {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : 'Unable to load recent lesson suggestions.';
        setScheduleSurface(null);
        setScheduleSurfaceError(message);
      });

    return () => {
      active = false;
    };
  }, [source.selectedStudentId]);

  useEffect(() => {
    if (!jobStatus?.jobId || !isActivelyProcessingJobState(jobStatus.state)) return;
    const jobId = jobStatus.jobId;
    let active = true;
    let fallbackDelay = INITIAL_FALLBACK_POLL_MS;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackStarted = false;
    let eventSource: EventSource | null = null;

    const clearFallbackTimer = () => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const clearStaleTimer = () => {
      if (staleTimer) {
        clearTimeout(staleTimer);
        staleTimer = null;
      }
    };

    const documentRef = globalThis.document;

    const stopMonitoring = () => {
      active = false;
      clearFallbackTimer();
      clearStaleTimer();
      eventSource?.close();
      documentRef?.removeEventListener('visibilitychange', handleVisibilityChange);
    };

    const applyStatusTransition = (refreshed: JobStatus) => {
      setJobStatusState(refreshed);
      const decision = getJobPollingDecision(refreshed.state);
      if (!decision.shouldContinuePolling) {
        if (decision.shouldRefreshResumeJobs) {
          void resumeLoadResumeJobs();
        }
        stopMonitoring();
        return false;
      }
      return true;
    };

    const scheduleFallbackPoll = (delayMs = fallbackDelay) => {
      if (!active) return;
      clearFallbackTimer();
      if (isFallbackPollingPaused()) return;
      fallbackTimer = setTimeout(() => {
        void pollFallback();
      }, delayMs);
    };

    const startFallbackPolling = () => {
      if (!active || fallbackStarted) return;
      fallbackStarted = true;
      clearStaleTimer();
      eventSource?.close();
      scheduleFallbackPoll(fallbackDelay);
    };

    const armSseStaleTimeout = () => {
      if (!active || fallbackStarted) return;
      clearStaleTimer();
      staleTimer = setTimeout(() => {
        startFallbackPolling();
      }, SSE_STALE_TIMEOUT_MS);
    };

    const pollFallback = async (scheduleNext = true) => {
      try {
        const refreshed = await getJobStatus(jobId);
        if (!active) return;
        const shouldContinue = applyStatusTransition(refreshed);
        if (shouldContinue && scheduleNext) {
          fallbackDelay = getNextFallbackPollingDelay(fallbackDelay);
          scheduleFallbackPoll(fallbackDelay);
        }
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Unable to refresh job status.';
        setAuthoringPublishError(message);
        if (scheduleNext) {
          fallbackDelay = getNextFallbackPollingDelay(fallbackDelay);
          scheduleFallbackPoll(fallbackDelay);
        }
      }
    };

    function handleVisibilityChange() {
      if (!active || !fallbackStarted) return;
      if (isFallbackPollingPaused()) {
        clearFallbackTimer();
        return;
      }
      scheduleFallbackPoll(0);
    }

    const applyJobEvent = (event: JobEvent) => {
      if (event.type !== 'job_created' && event.type !== 'job_state_changed') return;
      if (event.jobId !== jobId) return;
      if (!active) return;
      armSseStaleTimeout();
      setJobStatusState((current) => {
        if (!current || current.jobId !== event.jobId) return current;
        return {
          ...current,
          state: event.state,
          error: event.payload?.error ?? current.error,
          finishedAt: event.payload?.finishedAt ?? current.finishedAt,
          htmlUrl: event.payload?.htmlUrl ?? current.htmlUrl,
          manifestPath: event.payload?.manifestPath ?? current.manifestPath,
          md: event.payload?.md ?? current.md,
          mdStorageUri: event.payload?.mdStorageUri ?? current.mdStorageUri,
          publishTarget: event.payload?.publishTarget ?? current.publishTarget,
          recordingId: event.payload?.recordingId ?? current.recordingId,
          transcriptId: event.payload?.transcriptId ?? current.transcriptId,
          ttsStrategy: event.payload?.ttsStrategy ?? current.ttsStrategy,
        };
      });

      const decision = getJobPollingDecision(event.state);
      if (!decision.shouldContinuePolling) {
        if (decision.shouldRefreshResumeJobs) {
          void resumeLoadResumeJobs();
        }
        stopMonitoring();
      }
    };

    documentRef?.addEventListener('visibilitychange', handleVisibilityChange);

    try {
      eventSource = subscribeToJobEvents(applyJobEvent, {
        jobIds: [jobId],
        onOpen: armSseStaleTimeout,
        onError: startFallbackPolling,
      });
      armSseStaleTimeout();
    } catch {
      startFallbackPolling();
    }

    return () => {
      stopMonitoring();
      documentRef?.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [jobStatus?.jobId, jobStatus?.state, resumeLoadResumeJobs, setAuthoringPublishError]);

  useEffect(() => {
    if (!jobStatus) return;
    resumeSetSelectedResumeJobId((current) => current || jobStatus.jobId);
    if (isTerminalJobState(jobStatus.state)) {
      if (jobStatus.state === 'failed' && jobStatus.error) {
        setAuthoringPublishError(describeJobFailureReason(jobStatus));
      }
    }
  }, [jobStatus, resumeSetSelectedResumeJobId, setAuthoringPublishError]);

  const transcriptReady = source.transcriptReady;
  const firstProfileSourceAuthorityKey =
    source.replacingAudio || source.uploading
      ? null
      : buildFirstProfileSourceAuthorityKey(
          activeAssignmentSession,
          source.recording?.recordingId,
          source.transcript?.transcriptId,
        );
  firstProfileSourceAuthorityKeyRef.current = firstProfileSourceAuthorityKey;
  const firstProfileAssistVisible = Boolean(
    source.selectedStudentId &&
      context.profileAuthorityResolved &&
      transcriptReady &&
      !source.replacingAudio &&
      !source.uploading &&
      (context.profilePreviewStatus === 'none' || context.profilePreviewStatus === 'unstructured'),
  );
  const firstProfileLessonMemoryConfirmed = Boolean(
    activeAssignmentSession?.confirmed.source &&
      activeAssignmentSession.confirmed.source.recordingId === source.recording?.recordingId &&
      activeAssignmentSession.confirmed.source.transcriptId === source.transcript?.transcriptId &&
      activeAssignmentSession.confirmed.source.transcriptHash === source.transcript?.contentHash &&
      !source.transcriptDirty,
  );

  const refreshFirstProfileLessonMemory = useCallback(async () => {
    if (
      !source.selectedStudentId ||
      !transcriptReady ||
      context.profilePreviewStatus === 'ready' ||
      !firstProfileLessonMemoryConfirmed
    ) {
      return null;
    }

    setFirstProfileLessonMemoryStatus((current) => (current === 'ready' ? current : 'checking'));
    setFirstProfileAssistError(null);
    try {
      const health = await getStudentMemoryHealth(source.selectedStudentId);
      const readyCount = health.memoryCounts.lesson.ready.count;
      setFirstProfileLessonMemoryReadyCount(readyCount);
      setFirstProfileLessonMemoryStatus(readyCount > 0 ? 'ready' : 'building');
      if (
        readyCount === 0 &&
        health.memoryCounts.lesson.failed.count > 0 &&
        health.latestFailedReason?.source === 'lesson'
      ) {
        setFirstProfileAssistError(
          health.latestFailedReason.message ||
            'Lesson memory processing failed. Try refreshing after the transcript is available.',
        );
      }
      return readyCount;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to check lesson memory readiness.';
      setFirstProfileAssistError(message);
      setFirstProfileLessonMemoryStatus('building');
      return null;
    }
  }, [
    context.profilePreviewStatus,
    firstProfileLessonMemoryConfirmed,
    source.selectedStudentId,
    transcriptReady,
  ]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (
      !firstProfileAssistVisible ||
      !firstProfileLessonMemoryConfirmed ||
      firstProfileDraft ||
      firstProfileAssistApproved
    ) {
      setFirstProfileLessonMemoryReadyCount(0);
      setFirstProfileLessonMemoryStatus('checking');
      setFirstProfileAssistError(null);
      return;
    }

    const poll = async () => {
      const readyCount = await refreshFirstProfileLessonMemory();
      if (!active) return;
      if (readyCount === 0) {
        timer = setTimeout(() => void poll(), FIRST_PROFILE_HEALTH_POLL_MS);
      }
    };

    void poll();

    return () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    firstProfileAssistApproved,
    firstProfileAssistVisible,
    firstProfileLessonMemoryConfirmed,
    firstProfileDraft,
    refreshFirstProfileLessonMemory,
  ]);

  useEffect(() => {
    setFirstProfileDraft(null);
    setFirstProfileAssistApproved(false);
    setFirstProfileAssistBusy(null);
    setFirstProfileAssistError(null);
    setFirstProfileLessonMemoryReadyCount(0);
    setFirstProfileLessonMemoryStatus('checking');
  }, [source.selectedStudentId, source.recording?.recordingId]);

  const handlePopulateFirstProfile = useCallback(async () => {
    const sourceAuthorityKey = firstProfileSourceAuthorityKeyRef.current;
    if (!source.selectedStudentId || !sourceAuthorityKey) return;
    markAssignmentUserEdit();
    setFirstProfileAssistBusy('drafting');
    setFirstProfileAssistError(null);
    try {
      const response = await populateFirstProfileFromLesson(source.selectedStudentId);
      if (firstProfileSourceAuthorityKeyRef.current !== sourceAuthorityKey) return;
      setFirstProfileDraft({
        profileId: response.profileId,
        draftRevisionId: response.draftRevisionId,
        structuredContent: response.draftRevision.structuredContent ?? null,
        sourceAuthorityKey,
      });
      setFirstProfileLessonMemoryReadyCount(response.lessonMemoryIds.length);
      setFirstProfileLessonMemoryStatus('ready');
    } catch (error) {
      if (firstProfileSourceAuthorityKeyRef.current !== sourceAuthorityKey) return;
      const message =
        error instanceof Error ? error.message : 'Unable to populate the first profile draft.';
      setFirstProfileAssistError(message);
    } finally {
      setFirstProfileAssistBusy(null);
    }
  }, [markAssignmentUserEdit, source.selectedStudentId]);

  const handleApproveFirstProfileDraft = useCallback(async () => {
    if (!firstProfileDraft) return;
    if (firstProfileDraft.sourceAuthorityKey !== firstProfileSourceAuthorityKeyRef.current) {
      setFirstProfileDraft(null);
      return;
    }
    markAssignmentUserEdit();
    setFirstProfileAssistBusy('approving');
    setFirstProfileAssistError(null);
    try {
      const activatedRevision = await activateProfileRevision(
        firstProfileDraft.profileId,
        firstProfileDraft.draftRevisionId,
      );
      source.bindStudentProfile(source.selectedStudentId, firstProfileDraft.profileId);
      context.selectProfileId(firstProfileDraft.profileId, {
        id: activatedRevision.id,
        contentHash: activatedRevision.contentHash,
      });
      setFirstProfileAssistApproved(true);
      setFirstProfileDraft(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to approve the profile draft.';
      setFirstProfileAssistError(message);
    } finally {
      setFirstProfileAssistBusy(null);
    }
  }, [context, firstProfileDraft, markAssignmentUserEdit, source]);

  const jobReady = Boolean(jobStatus?.jobId);
  const completedReferenceMode = isCompletedAssignmentSession(activeAssignmentSession);
  const effectivePublicationParent = isValidAssignmentPublicationParent(
    activeAssignmentSession,
    jobStatus,
  )
    ? jobStatus
    : publicationParentJob;
  const validPublicationParent = isValidAssignmentPublicationParent(
    activeAssignmentSession,
    effectivePublicationParent,
  );
  const publicationRecoveryAvailable = canRetryAssignmentPublication(
    activeAssignmentSession,
    jobStatus,
  );
  useEffect(() => {
    let cancelled = false;
    if (!completedReferenceMode || !activeAssignmentSession) {
      setPublicationParentJob(null);
      return () => {
        cancelled = true;
      };
    }
    if (isValidAssignmentPublicationParent(activeAssignmentSession, jobStatus)) {
      setPublicationParentJob(jobStatus);
      return () => {
        cancelled = true;
      };
    }
    setPublicationParentJob(null);
    if (!jobStatus?.sourceJobId) {
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      let parentId: string | null | undefined = jobStatus.sourceJobId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = await getJobStatus(parentId).catch(() => null);
        if (!parent || cancelled) return;
        if (isValidAssignmentPublicationParent(activeAssignmentSession, parent)) {
          setPublicationParentJob(parent);
          return;
        }
        parentId = parent.sourceJobId;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAssignmentSession, completedReferenceMode, jobStatus]);
  const savedUnpublishedChanges = hasSavedUnpublishedDraft(
    activeAssignmentSession?.confirmed.create,
    authoring.draft,
    authoring.draftDirty,
  );
  correctionModeRef.current = correctionMode;
  const hasAssignmentContent = authoring.draftText.trim().length > 0;
  const hasStartedFlow =
    entryView === 'summary' ||
    source.recording !== null ||
    transcriptReady ||
    authoring.promptReady ||
    hasAssignmentContent ||
    jobReady;
  const studentNameById = useMemo(
    () => new Map(source.studentOptions.map((student) => [student.id, student.name])),
    [source.studentOptions],
  );
  const resolvedEntrySummary = useMemo(() => {
    if (!entrySummary || entrySummary.learnerName !== 'Saved learner') return entrySummary;
    const learnerName = studentNameById.get(source.selectedStudentId);
    return learnerName ? { ...entrySummary, learnerName } : entrySummary;
  }, [entrySummary, source.selectedStudentId, studentNameById]);
  const resumeJobItems = useMemo(() => {
    return buildRecentAssignmentItems(
      resume.assignmentSessions,
      resume.resumeJobs,
      resume.selectedResumeJobId,
      studentNameById,
    );
  }, [resume.assignmentSessions, resume.resumeJobs, resume.selectedResumeJobId, studentNameById]);
  const resumeLineages = useMemo(
    () => buildRecentAssignmentLineages(resumeJobItems),
    [resumeJobItems],
  );
  useEffect(() => {
    if (
      entryView === 'resume' &&
      !resume.resumeLoading &&
      !resume.resumeError &&
      resumeJobItems.length === 0
    ) {
      setEntryView('choice');
    }
  }, [entryView, resume.resumeError, resume.resumeLoading, resumeJobItems.length]);
  const handleOpenRecentAssignment = useCallback(async () => {
    const selectedItem = resumeJobItems.find((item) => item.id === resume.selectedResumeJobId);
    const result = await resume.handleResumeSelectedJob();
    if (!result.ok) return;
    setEntrySummary({
      learnerName: selectedItem?.learnerName ?? 'Saved learner',
      state: result.state,
      origin: 'resume',
    });
    setEntryView('summary');
    setActiveStep(result.destination);
  }, [resume, resumeJobItems]);
  const publishUrl = jobStatus?.htmlUrl;
  const publishLabel = 'Open Assignment Handout';
  const publishPending = 'HTML link pending...';
  const hasTeachingContext = Boolean(
    context.profilePreviewStatus === 'ready' || teacherNotes.trim() || authoring.promptReady,
  );
  const reviewReady =
    hasAssignmentContent &&
    (!authoring.draftPreviewGate.previewRequired || authoring.previewReadyForCurrentDraft);
  const assignmentWorkingArtifacts = useMemo(
    () => ({
      transcript: source.transcript
        ? {
            workingVersion: source.transcript.workingVersion,
            contentHash: source.transcript.contentHash,
          }
        : null,
      draft: authoring.draft
        ? {
            workingVersion: authoring.draft.workingVersion,
            contentHash: authoring.draft.contentHash,
          }
        : null,
    }),
    [authoring.draft, source.transcript],
  );
  const focusedWorkflowSteps = useMemo(() => {
    if (!activeAssignmentSession && jobReady) {
      return deriveHistoricalAssignmentOutputWorkflow();
    }
    return deriveAssignmentWorkflow(activeAssignmentSession, assignmentWorkingArtifacts);
  }, [activeAssignmentSession, assignmentWorkingArtifacts, jobReady]);
  const shareRecoveryReady = Boolean(
    activeAssignmentSession?.shareJobId ||
      (activeAssignmentSession &&
        canShareAssignment(activeAssignmentSession, assignmentWorkingArtifacts).allowed),
  );
  const activeStepIndex = FOCUSED_STEP_ORDER.indexOf(activeStep);
  const authoringOperationBusy = authoring.promptLoading || authoring.generatingDraft;
  const commitTeacherNotes = useCallback(async (): Promise<TeacherNotesCommitResult> => {
    if (!context.profileLineageReady) return null;
    const normalizedTeacherNotes = teacherNotes.trim();
    const committedRecovery = {
      teacherNotes: normalizedTeacherNotes || null,
      ...durableProfileLineage,
    };
    const committedRecoveryKey = JSON.stringify(committedRecovery);
    if (assignmentContextRecoveryTimeoutRef.current) {
      clearTimeout(assignmentContextRecoveryTimeoutRef.current);
      assignmentContextRecoveryTimeoutRef.current = null;
    }
    // Confirmation persists this exact Context snapshot through the mutation queue.
    // An older debounce entry must not replay after Create and make recovery dirty again.
    pendingContextRecoveryRef.current = null;
    refreshDebouncedRecoveryPendingState();

    const saved = await saveAssignmentSessionProgress(committedRecovery);
    if (!saved) return null;

    const hadDownstream = Boolean(saved.confirmed.create || saved.promptPackageId || saved.draftId);
    const confirmed = await confirmAssignmentStep((session) => ({
      step: 'context',
      expectedRevision: session.revision,
      teacherNotes: normalizedTeacherNotes || null,
      profileId: durableProfileLineage.selectedProfileId,
      profileRevisionId: durableProfileLineage.selectedProfileRevisionId,
      profileRevisionHash: durableProfileLineage.selectedProfileRevisionHash,
    }));
    if (!confirmed) return null;
    const pendingAfterConfirmation = pendingContextRecoveryRef.current as {
      key: string;
      patch: UpdateAssignmentSessionRecoveryRequest['patch'];
    } | null;
    if (pendingAfterConfirmation?.key === committedRecoveryKey) {
      pendingContextRecoveryRef.current = null;
      refreshDebouncedRecoveryPendingState();
    }
    committedTeacherNotesRef.current = normalizedTeacherNotes;
    return hadDownstream ? 'invalidated' : 'committed';
  }, [
    confirmAssignmentStep,
    context.profileLineageReady,
    durableProfileLineage,
    refreshDebouncedRecoveryPendingState,
    saveAssignmentSessionProgress,
    teacherNotes,
  ]);
  const handleGenerateAssignment = useCallback(async () => {
    if (completedReferenceMode) return;
    markAssignmentUserEdit();
    const commitResult = await commitTeacherNotes();
    if (!commitResult) return;
    await authoring.generateAssignment({ forceFreshPrompt: commitResult === 'invalidated' });
  }, [authoring, commitTeacherNotes, completedReferenceMode, markAssignmentUserEdit]);
  const handleFocusedStepRequest = useCallback(
    async (requestedStep: AssignmentStepId) => {
      if (authoringOperationBusy && requestedStep !== 'student') return;
      if (completedReferenceMode && !correctionMode) {
        setActiveStep(requestedStep);
        return;
      }
      const requested = focusedWorkflowSteps.find((step) => step.id === requestedStep);
      const confirmedContext = activeAssignmentSession?.confirmed.context;
      const activeStepHasLocalDirtyWork =
        (activeStep === 'source' && source.transcriptDirty) ||
        (activeStep === 'context' &&
          (!confirmedContext ||
            teacherNotes.trim() !== (confirmedContext.teacherNotes ?? '').trim() ||
            context.selectedProfileId !== (confirmedContext.profileId ?? '') ||
            context.selectedProfileRevisionId !== confirmedContext.profileRevisionId ||
            context.selectedProfileRevisionHash !== confirmedContext.profileRevisionHash)) ||
        (activeStep === 'assignment' && authoring.draftDirty && !correctionMode);
      if (
        FOCUSED_STEP_ORDER.indexOf(requestedStep) > activeStepIndex &&
        (requested?.status === 'locked' || activeStepHasLocalDirtyWork)
      ) {
        return;
      }
      setActiveStep(requestedStep);
    },
    [
      activeAssignmentSession,
      activeStep,
      activeStepIndex,
      authoring.draftDirty,
      authoringOperationBusy,
      context.selectedProfileId,
      context.selectedProfileRevisionHash,
      context.selectedProfileRevisionId,
      completedReferenceMode,
      correctionMode,
      focusedWorkflowSteps,
      source.transcriptDirty,
      teacherNotes,
    ],
  );
  const handleFocusedBack = useCallback(() => {
    if (authoringOperationBusy || (!activeAssignmentSession && jobReady)) return;
    setActiveStep(FOCUSED_STEP_ORDER[Math.max(0, activeStepIndex - 1)] ?? 'student');
  }, [activeAssignmentSession, activeStepIndex, authoringOperationBusy, jobReady]);
  const handleFocusedContinue = useCallback(async () => {
    if (authoringOperationBusy) return;
    if (completedReferenceMode) return;
    if (activeStep === 'source') {
      const recordingId = source.recording?.recordingId;
      const requiresSpeakerMapping = mixedSpeakerRoles.length > 0;
      if (requiresSpeakerMapping && mixedSpeakerRoles.some((item) => !item.role)) return;
      const speakerRoleMapping = requiresSpeakerMapping
        ? {
            roles: mixedSpeakerRoles.map((item) => ({
              speaker: item.speaker,
              role: item.role as 'teacher' | 'student',
            })),
          }
        : undefined;
      const transcript =
        source.transcriptDirty || speakerRoleMapping
          ? await source.handleSaveTranscript(speakerRoleMapping)
          : source.transcript;
      if (!recordingId || !transcript?.transcriptId || !transcript.workingVersion) return;
      const recovered = await saveAssignmentSessionProgress({
        lessonId: linkedLessonId || null,
        recordingId,
        transcriptId: transcript.transcriptId,
      });
      if (!recovered) return;
      const confirmed = await confirmAssignmentStep((session) => ({
        step: 'source',
        expectedRevision: session.revision,
        lessonId: linkedLessonId || null,
        recordingId,
        transcriptId: transcript.transcriptId,
        transcriptWorkingVersion: transcript.workingVersion,
      }));
      if (!confirmed) return;
      setFirstProfileLessonMemoryStatus('building');
      void refreshFirstProfileLessonMemory();
      setActiveStep('context');
      return;
    }
    if (activeStep === 'context') {
      if (!(await commitTeacherNotes())) return;
      setActiveStep('assignment');
      return;
    }
    if (activeStep === 'assignment') {
      const promptPackageId = authoring.promptPackage?.id;
      const draft = authoring.draftDirty ? await authoring.saveDraft() : authoring.draft;
      if (!promptPackageId || !draft?.id || !draft.workingVersion) return;
      const confirmedContext = activeAssignmentSessionRef.current?.confirmed.context;
      const recovered = await saveAssignmentSessionProgress({
        ...(confirmedContext
          ? {
              teacherNotes: confirmedContext.teacherNotes,
              selectedProfileId: confirmedContext.profileId,
              selectedProfileRevisionId: confirmedContext.profileRevisionId,
              selectedProfileRevisionHash: confirmedContext.profileRevisionHash,
            }
          : {}),
        promptPackageId,
        draftId: draft.id,
        publishTarget: authoring.publishTarget,
        selectedTtsProvider: authoring.selectedTtsProvider,
        selectedTtsStrategy: authoring.selectedTtsStrategy,
        selectedTtsModel: authoring.selectedTtsModel || null,
        selectedPreset: authoring.selectedPreset || null,
      });
      if (!recovered) return;
      const confirmed = await confirmAssignmentStep((session) => ({
        step: 'create',
        expectedRevision: session.revision,
        promptPackageId,
        draftId: draft.id,
        draftWorkingVersion: draft.workingVersion,
      }));
      if (!confirmed) return;
      setActiveStep('review');
      return;
    }
    setActiveStep(
      FOCUSED_STEP_ORDER[Math.min(FOCUSED_STEP_ORDER.length - 1, activeStepIndex + 1)] ?? 'review',
    );
  }, [
    activeStep,
    activeStepIndex,
    authoring,
    authoringOperationBusy,
    commitTeacherNotes,
    completedReferenceMode,
    confirmAssignmentStep,
    linkedLessonId,
    refreshFirstProfileLessonMemory,
    saveAssignmentSessionProgress,
    source,
    mixedSpeakerRoles,
  ]);

  const handleShareAssignment = useCallback(async () => {
    const initialSession = activeAssignmentSessionRef.current;
    if (!initialSession || initialSession.confirmedStep !== 'create') return;
    if (shareReconciliationInFlightRef.current) return;
    shareReconciliationInFlightRef.current = true;
    setSharingAssignment(true);
    setAssignmentShareError(null);
    setAssignmentSaveState('saving');
    const requestId =
      initialSession.shareJobId ?? shareRequestRef.current ?? globalThis.crypto.randomUUID();
    shareRequestRef.current = requestId;
    const returnToDirtyRecovery = (session: AssignmentSession): boolean => {
      const decision = canShareAssignment(session, assignmentWorkingArtifacts);
      if (decision.allowed) return false;
      const dirtyStep = findResumeStep(session, assignmentWorkingArtifacts);
      setAssignmentShareError(`Sharing paused. ${decision.reason}`);
      setAssignmentRecoveryNotice(
        `Review and confirm ${dirtyStep === 'source' ? 'Lesson source' : dirtyStep === 'context' ? 'Teaching context' : 'Create'} before sharing.`,
      );
      setAssignmentSaveState('saved');
      if (dirtyStep) setActiveStep(dirtyStep);
      return true;
    };
    const presentSharedJob = async (job: JobStatus) => {
      activeAssignmentSessionRef.current = null;
      setActiveAssignmentSession(null);
      setJobStatusState(job);
      resume.applyJobStatusTransition(job);
      setAssignmentSaveState('saved');
      await resume.loadResumeJobs();
    };
    try {
      if (!initialSession.shareJobId && !(await flushPendingSessionRecovery())) return;
      const current = activeAssignmentSessionRef.current;
      if (!current || current.confirmedStep !== 'create') return;
      if (!current.shareJobId && returnToDirtyRecovery(current)) return;
      const recovered = current.shareJobId
        ? current
        : await saveAssignmentSessionProgress({
            publishTarget: authoring.publishTarget,
            selectedTtsProvider: authoring.selectedTtsProvider,
            selectedTtsStrategy: authoring.selectedTtsStrategy,
            selectedTtsModel: authoring.selectedTtsModel || null,
            selectedPreset: authoring.selectedPreset || null,
          });
      if (!recovered) return;
      const response = await shareAssignmentSession(recovered.id, {
        expectedRevision: recovered.revision,
        requestId,
      });
      await presentSharedJob(response.job);
    } catch (error) {
      const latest =
        error instanceof AssignmentSessionConflictApiError
          ? error.latestSession
          : await fetchAssignmentSession(initialSession.id).catch(() => null);
      if (latest) {
        activeAssignmentSessionRef.current = latest;
        setActiveAssignmentSession(latest);
      }
      try {
        if (latest?.confirmedStep === 'share' && latest.shareJobId) {
          await presentSharedJob(await getJobStatusWithRecoveryRetry(latest.shareJobId));
          return;
        }
        if (latest?.shareJobId) {
          const resumed = await shareAssignmentSession(latest.id, {
            expectedRevision: latest.revision,
            requestId,
          });
          await presentSharedJob(resumed.job);
          return;
        }
        if (latest && returnToDirtyRecovery(latest)) return;
        const message = error instanceof Error ? error.message : 'Unable to share this assignment.';
        setAssignmentShareError(message);
        setAssignmentSaveState(
          error instanceof AssignmentSessionConflictApiError
            ? 'conflict'
            : latest
              ? 'error'
              : 'ambiguous',
        );
      } catch (reconciliationError) {
        const message =
          reconciliationError instanceof Error
            ? reconciliationError.message
            : 'Unable to confirm whether sharing completed.';
        setAssignmentShareError(message);
        setAssignmentSaveState('ambiguous');
      }
    } finally {
      shareReconciliationInFlightRef.current = false;
      setSharingAssignment(false);
    }
  }, [
    assignmentWorkingArtifacts,
    authoring,
    flushPendingSessionRecovery,
    resume,
    saveAssignmentSessionProgress,
    setActiveAssignmentSession,
  ]);

  useEffect(() => {
    if (
      activeAssignmentSession?.confirmedStep !== 'create' ||
      !activeAssignmentSession.shareJobId ||
      autoResumedShareSessionRef.current === activeAssignmentSession.id
    ) {
      return;
    }
    autoResumedShareSessionRef.current = activeAssignmentSession.id;
    shareRequestRef.current = activeAssignmentSession.shareJobId;
    void handleShareAssignment();
  }, [
    activeAssignmentSession?.confirmedStep,
    activeAssignmentSession?.id,
    activeAssignmentSession?.shareJobId,
    handleShareAssignment,
  ]);
  const continueDisabled =
    activeStep === 'student'
      ? !hasStartedFlow || !source.selectedStudentId
      : activeStep === 'source'
        ? !transcriptReady ||
          (mixedSpeakerRoles.length > 0 && mixedSpeakerRoles.some((item) => !item.role))
        : activeStep === 'context'
          ? !context.profileLineageReady || firstProfileAssistBusy === 'approving'
          : activeStep === 'assignment'
            ? !hasAssignmentContent || authoringOperationBusy
            : false;
  const guardAssignmentExit = shouldGuardAssignmentExit({
    recovery:
      source.transcriptDirty ||
      authoring.draftDirty ||
      source.transcriptRecoveryConflict ||
      authoring.draftRecoveryConflict ||
      assignmentDebouncedRecoveryPending ||
      assignmentSaveState === 'saving'
        ? 'pending'
        : assignmentSaveState === 'error'
          ? 'failed'
          : 'saved',
    mutation: assignmentSaveState === 'ambiguous' ? 'ambiguous' : 'settled',
  });
  const sourceTranscriptDirty = source.transcriptDirty;
  const saveTranscript = source.handleSaveTranscript;
  const draftDirty = authoring.draftDirty;
  const transcriptRecoveryConflict = source.transcriptRecoveryConflict;
  const draftRecoveryConflict = authoring.draftRecoveryConflict;
  const saveDraft = authoring.saveDraft;
  const refreshSelectedProfile = context.refreshSelectedProfile;
  const applyJobStatusTransition = resume.applyJobStatusTransition;

  const enterCorrectionMode = useCallback(() => {
    if (!completedReferenceMode || !validPublicationParent) return;
    correctionModeRef.current = true;
    setCorrectionMode(true);
    setCorrectionError(null);
    setActiveStep('assignment');
  }, [completedReferenceMode, validPublicationParent]);

  const handleRetryPublication = useCallback(async () => {
    const current = activeAssignmentSessionRef.current;
    if (
      !current ||
      !canRetryAssignmentPublication(current, jobStatus) ||
      shareReconciliationInFlightRef.current
    ) {
      return;
    }
    shareReconciliationInFlightRef.current = true;
    setSharingAssignment(true);
    setAssignmentShareError(null);
    setAssignmentSaveState('saving');
    shareRequestRef.current = current.shareJobId;
    try {
      const response = await shareAssignmentSession(current.id, {
        expectedRevision: current.revision,
        requestId: current.shareJobId!,
      });
      activeAssignmentSessionRef.current = response.session;
      setActiveAssignmentSession(response.session);
      setJobStatusState(response.job);
      resume.applyJobStatusTransition(response.job);
      setAssignmentSaveState('saved');
      await resume.loadResumeJobs();
    } catch (error) {
      const latest = await fetchAssignmentSession(current.id).catch(() => null);
      const latestJob = latest?.shareJobId
        ? await getJobStatusWithRecoveryRetry(latest.shareJobId).catch(() => null)
        : null;
      if (latest) {
        activeAssignmentSessionRef.current = latest;
        setActiveAssignmentSession(latest);
      }
      if (latestJob) {
        setJobStatusState(latestJob);
        resume.applyJobStatusTransition(latestJob);
      }
      setAssignmentShareError(
        latestJob && (latestJob.state === 'queued' || latestJob.state === 'running')
          ? null
          : error instanceof Error
            ? error.message
            : 'Unable to retry publication.',
      );
      setAssignmentSaveState(latestJob ? 'saved' : 'ambiguous');
    } finally {
      shareReconciliationInFlightRef.current = false;
      setSharingAssignment(false);
    }
  }, [jobStatus, resume, setActiveAssignmentSession]);

  const exitCorrectionMode = useCallback(() => {
    correctionModeRef.current = false;
    setCorrectionMode(false);
    setCorrectionError(null);
    setActiveStep('review');
  }, []);

  const handlePublishCorrection = useCallback(async () => {
    if (
      !completedReferenceMode ||
      !validPublicationParent ||
      !correctionMode ||
      !effectivePublicationParent?.jobId
    )
      return;
    if (correctionReconciliationRef.current) return;
    correctionReconciliationRef.current = true;
    setCorrectionPublishing(true);
    setCorrectionError(null);

    try {
      let payload = correctionPayloadRef.current;
      if (!payload) {
        if (authoring.draftRecoveryConflict) {
          throw new Error('Resolve the saved draft conflict before publishing the correction.');
        }
        const saved = await authoring.flushDraftAutosave();
        const draft = saved ?? authoring.draft;
        payload = buildAssignmentCorrectionRequest({
          requestId: correctionRequestRef.current ?? globalThis.crypto.randomUUID(),
          draft,
          confirmedCreate: activeAssignmentSession?.confirmed.create,
        });
        if (!payload) {
          throw new Error('Save the current draft before publishing the correction.');
        }
        correctionRequestRef.current = payload.requestId;
        correctionPayloadRef.current = payload;
      }

      const response = await publishAssignmentCorrection(effectivePublicationParent.jobId, payload);
      setJobStatusState(response.job);
      resume.applyJobStatusTransition(response.job);
      setCorrectionMode(false);
      correctionModeRef.current = false;
      correctionPayloadRef.current = null;
      correctionRequestRef.current = null;
      setCorrectionError(null);
      await resume.loadResumeJobs();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to publish the corrected version. Try again.';
      if (message.includes('assignment_correction_draft_conflict')) {
        correctionPayloadRef.current = null;
        correctionRequestRef.current = null;
        await authoring.refreshDraftPreservingLocal({ forcePreserveLocal: true });
      } else if (message.includes('assignment_correction_request_conflict')) {
        correctionPayloadRef.current = null;
        correctionRequestRef.current = null;
      }
      setCorrectionError(message);
    } finally {
      correctionReconciliationRef.current = false;
      setCorrectionPublishing(false);
    }
  }, [
    activeAssignmentSession?.confirmed.create,
    authoring,
    completedReferenceMode,
    correctionMode,
    effectivePublicationParent?.jobId,
    resume,
    validPublicationParent,
  ]);

  useEffect(() => {
    if (!guardAssignmentExit) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', handleBeforeUnload);
    return () => globalThis.removeEventListener('beforeunload', handleBeforeUnload);
  }, [guardAssignmentExit]);

  const flushAssignmentRecoveryForNavigation = useCallback(async (): Promise<boolean> => {
    if (isUnsafeAssignmentSaveState(assignmentSaveStateRef.current)) {
      return false;
    }
    if (transcriptRecoveryConflict || draftRecoveryConflict) return false;
    if (!(await flushPendingSessionRecovery())) return false;
    if (sourceTranscriptDirty && !(await saveTranscript())) return false;
    if (draftDirty && !(await saveDraft())) return false;
    const sessionQueueSettled = await assignmentSessionMutationQueueRef.current.then(
      () => true,
      () => false,
    );
    if (!sessionQueueSettled) return false;
    return !isUnsafeAssignmentSaveState(assignmentSaveStateRef.current);
  }, [
    draftDirty,
    draftRecoveryConflict,
    flushPendingSessionRecovery,
    saveDraft,
    saveTranscript,
    sourceTranscriptDirty,
    transcriptRecoveryConflict,
  ]);
  useAssignmentNavigationGuard(flushAssignmentRecoveryForNavigation);

  useEffect(() => {
    const handleFocus = () => {
      void resumeLoadResumeJobs();
      void loadStudentOptions();
      void (async () => {
        let preserveContextLineage = false;
        const current = activeAssignmentSessionRef.current;
        if (current) {
          try {
            const latest = await fetchAssignmentSession(current.id);
            if (latest.confirmedStep === 'share' && latest.shareJobId) {
              const historicalJobId = resumeSelectedResumeJobId.startsWith('session:')
                ? latest.shareJobId
                : resumeSelectedResumeJobId || latest.shareJobId;
              const linkedJob = await getJobStatusWithRecoveryRetry(historicalJobId);
              activeAssignmentSessionRef.current = latest;
              setActiveAssignmentSession(latest);
              setJobStatusState(linkedJob);
              applyJobStatusTransition(linkedJob);
            } else {
              const localContextKey = JSON.stringify({
                teacherNotes: teacherNotes.trim() || null,
                selectedProfileId: context.selectedProfileId || null,
                selectedProfileRevisionId: context.selectedProfileRevisionId,
                selectedProfileRevisionHash: context.selectedProfileRevisionHash,
              });
              const durableContextKey = JSON.stringify({
                teacherNotes: current.teacherNotes,
                selectedProfileId: current.selectedProfileId,
                selectedProfileRevisionId: current.selectedProfileRevisionId,
                selectedProfileRevisionHash: current.selectedProfileRevisionHash,
              });
              const remoteContextKey = JSON.stringify({
                teacherNotes: latest.teacherNotes,
                selectedProfileId: latest.selectedProfileId,
                selectedProfileRevisionId: latest.selectedProfileRevisionId,
                selectedProfileRevisionHash: latest.selectedProfileRevisionHash,
              });
              const localContextIsClean = localContextKey === durableContextKey;
              const remoteContextChanged = remoteContextKey !== durableContextKey;
              preserveContextLineage = remoteContextChanged;
              if (localContextIsClean && remoteContextChanged) {
                assignmentContextConflictKeyRef.current = null;
                setTeacherNotes(latest.teacherNotes ?? '');
                applyContextHydration({
                  selectedStudentId: source.selectedStudentId,
                  selectedProfileId: latest.selectedProfileId ?? '',
                  profileSelectionMode: context.profileSelectionMode,
                  selectedProfileRevisionId: latest.selectedProfileRevisionId,
                  selectedProfileRevisionHash: latest.selectedProfileRevisionHash,
                  profileAuthorityResolved: true,
                });
                setAssignmentSaveState('saved');
              } else if (
                !localContextIsClean &&
                remoteContextChanged &&
                localContextKey !== remoteContextKey
              ) {
                assignmentContextConflictKeyRef.current = localContextKey;
                setAssignmentSaveState('conflict');
              }
              activeAssignmentSessionRef.current = latest;
              setActiveAssignmentSession(latest);
              if (latest.confirmedStep === 'create' && latest.shareJobId) {
                shareRequestRef.current = latest.shareJobId;
                autoResumedShareSessionRef.current = latest.id;
                void handleShareAssignment();
              }
            }
          } catch {
            // Preserve the visible aggregate and let the next mutation surface a conflict.
          }
        }
        await Promise.all([refreshTranscriptPreservingLocal(), refreshDraftPreservingLocal()]);
        if (!preserveContextLineage) {
          refreshSelectedProfile();
        }
      })();
    };
    globalThis.addEventListener('focus', handleFocus);
    return () => globalThis.removeEventListener('focus', handleFocus);
  }, [
    applyContextHydration,
    applyJobStatusTransition,
    handleShareAssignment,
    loadStudentOptions,
    refreshDraftPreservingLocal,
    refreshSelectedProfile,
    refreshTranscriptPreservingLocal,
    resumeLoadResumeJobs,
    resumeSelectedResumeJobId,
    setActiveAssignmentSession,
    source.selectedStudentId,
    context.profileSelectionMode,
    context.selectedProfileId,
    context.selectedProfileRevisionHash,
    context.selectedProfileRevisionId,
    teacherNotes,
  ]);
  const linkedLesson = useMemo(() => {
    if (!linkedLessonId || !scheduleSurface) return null;
    return scheduleSurface.lessons.find((lesson) => lesson.id === linkedLessonId) ?? null;
  }, [linkedLessonId, scheduleSurface]);
  const linkedLessonContextLabel = linkedLessonId
    ? formatLessonContext(linkedLesson, linkedLessonId)
    : null;
  const lessonSuggestions = useMemo<AssignmentLessonSuggestion[]>(() => {
    if (!scheduleSurface) return [];
    const nowMs = Date.now();
    return scheduleSurface.lessons
      .filter((lesson) => lesson.id !== linkedLessonId)
      .filter((lesson) => isRecentPassedNoHomeworkLesson(lesson, nowMs))
      .sort((left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime())
      .slice(0, 3)
      .map((lesson) => {
        const topic = lesson.title?.trim() ? lesson.title.trim() : 'Untitled lesson';
        return {
          id: lesson.id,
          label: `${formatLessonDateTime(lesson.startsAt)} - ${topic}`,
          detail: `Lesson ${lesson.id}`,
        };
      });
  }, [linkedLessonId, scheduleSurface]);
  const workflowStages = useMemo<WorkflowStage[]>(() => {
    const downstreamArtifactReady = authoring.promptReady || hasAssignmentContent || jobReady;
    const startStatus: WorkflowStageStatus = hasStartedFlow ? 'complete' : 'current';
    const sourceStatus: WorkflowStageStatus = !hasStartedFlow
      ? 'locked'
      : transcriptReady || downstreamArtifactReady
        ? 'complete'
        : 'current';
    const contextStatus: WorkflowStageStatus = downstreamArtifactReady
      ? 'complete'
      : !transcriptReady
        ? 'locked'
        : authoring.promptReady
          ? 'complete'
          : 'current';
    const assignmentStatus: WorkflowStageStatus =
      hasAssignmentContent || jobReady
        ? 'complete'
        : !transcriptReady
          ? 'locked'
          : authoring.promptReady
            ? 'current'
            : 'available';
    const reviewStatus: WorkflowStageStatus = jobReady
      ? 'complete'
      : hasAssignmentContent
        ? 'current'
        : 'locked';
    const advancedStatus: WorkflowStageStatus = jobReady ? 'current' : 'locked';

    return [
      {
        id: 'start',
        title: 'Resume or start',
        description: jobReady
          ? `Working with assignment ${formatShortJobId(jobStatus?.jobId)}.`
          : hasStartedFlow
            ? 'Fresh assignment flow is active.'
            : 'Open recent work or begin a new assignment.',
        status: startStatus,
      },
      {
        id: 'source',
        title: 'Add lesson source',
        description: transcriptReady
          ? 'Transcript ready.'
          : source.recording
            ? 'Audio is uploaded. Finish the transcript before moving on.'
            : source.selectedStudentId
              ? 'Student selected. Recording needed.'
              : 'Student not selected yet.',
        status: sourceStatus,
      },
      {
        id: 'context',
        title: 'Add teaching context',
        description: authoring.promptReady
          ? 'Learner context is ready for the assignment.'
          : transcriptReady
            ? hasTeachingContext
              ? 'Context is ready. Create the assignment when you are happy with it.'
              : "Add lesson guidance or continue with the student's Learning page context."
            : 'Unlocks after the transcript is ready.',
        status: contextStatus,
      },
      {
        id: 'assignment',
        title: 'Create assignment',
        description: hasAssignmentContent
          ? 'Assignment content is ready to review.'
          : authoring.promptReady
            ? 'Generate or edit the assignment content.'
            : transcriptReady
              ? 'Create the assignment after you finish reviewing teaching context.'
              : 'Unlocks after the transcript is ready.',
        status: assignmentStatus,
      },
      {
        id: 'review',
        title: 'Review and share',
        description: jobReady
          ? `Latest share status: ${jobStatus?.state ?? 'unknown'}.`
          : reviewReady
            ? 'Preview is ready. Share when you are happy with it.'
            : hasAssignmentContent
              ? 'Preview the current version before sharing.'
              : 'Unlocks after assignment content exists.',
        status: reviewStatus,
      },
      {
        id: 'advanced',
        title: 'Advanced actions',
        description: jobReady ? 'Shared assignment ready.' : 'Available after sharing.',
        status: advancedStatus,
      },
    ];
  }, [
    authoring.promptReady,
    hasAssignmentContent,
    hasStartedFlow,
    jobReady,
    jobStatus?.jobId,
    jobStatus?.state,
    hasTeachingContext,
    source.recording,
    reviewReady,
    source.selectedStudentId,
    transcriptReady,
  ]);

  const startStage = workflowStages[0] ?? workflowStages.at(-1)!;
  const sourceStage = workflowStages[1] ?? startStage;
  const contextStage = workflowStages[2] ?? sourceStage;
  const assignmentStage = workflowStages[3] ?? contextStage;
  const reviewStage = workflowStages[4] ?? assignmentStage;
  const advancedStage = workflowStages[5] ?? reviewStage;

  return (
    <div className="minimal-assignment">
      <AssignmentWorkflow
        steps={focusedWorkflowSteps}
        activeStep={activeStep}
        highestAvailableStep={
          [...focusedWorkflowSteps].reverse().find((step) => step.status !== 'locked')?.id ??
          'student'
        }
        saveState={assignmentSaveState}
        onStepRequest={handleFocusedStepRequest}
        onBack={handleFocusedBack}
        {...(activeStep === 'review' || activeStep === 'student' || completedReferenceMode
          ? {}
          : {
              onContinue: handleFocusedContinue,
              continueLabel: 'Confirm and continue',
              continueDisabled,
              continueFeedback:
                activeStep === 'context' &&
                (!context.profileLineageReady || firstProfileAssistBusy === 'approving') ? (
                  <span role="status">Preparing learner context…</span>
                ) : assignmentConfirmationError ? (
                  <span role="alert">{assignmentConfirmationError}</span>
                ) : assignmentRecoveryError ? (
                  <span role="alert">{assignmentRecoveryError}</span>
                ) : assignmentRecoveryNotice ? (
                  <span role="status">{assignmentRecoveryNotice}</span>
                ) : null,
            })}
        {...(activeStep === 'review' && jobReady
          ? {
              onComplete: handleStartNewAssignmentWithSessionReset,
              completionLabel: 'Start another assignment',
            }
          : {})}
        postFooter={
          jobReady && activeStep === 'review' ? (
            <AdvancedActionsStage
              stage={advancedStage}
              sectionRef={advancedSectionRef}
              headingRef={advancedHeadingRef}
              jobReady
              controller={advancedActions}
              onRefreshActions={() => void loadJobOptions()}
              jobOptionsError={jobOptionsError}
              ttsProviders={ttsProviders}
              ttsModelOptionsByProvider={ttsModelOptionsByProvider}
              elevenlabsStandardModelOptions={elevenlabsStandardModelOptions}
              pronunciationChunkProviders={FALLBACK_PRONUNCIATION_CHUNK_TTS_PROVIDERS}
              studyTextStrategies={
                jobOptions?.ttsStrategies?.filter(isUiPublishTtsStrategy) ?? [
                  'auto',
                  'dialogue',
                  'tts',
                ]
              }
            />
          ) : null
        }
        support={
          jobReady ? (
            <AssignmentSupport>
              <AssignmentDiagnostics jobStatus={jobStatus} controller={advancedActions} />
            </AssignmentSupport>
          ) : null
        }
      >
        <div
          className="assignment-workflow__step-mount"
          data-active={activeStep === 'student' ? 'true' : 'false'}
          hidden={activeStep !== 'student'}
          inert={activeStep === 'student' ? undefined : true}
        >
          <AssignmentEntryStep
            view={entryView}
            recentLoading={resume.resumeLoading}
            recentError={resume.resumeError}
            recentLineages={resumeLineages}
            recentHasMore={resume.resumeHasMore}
            recentLoadingMore={resume.resumeLoadingMore}
            recentLoadMoreError={resume.resumeLoadMoreError}
            selectedRecentId={resume.selectedResumeJobId}
            learners={source.studentOptions}
            learnerLoading={source.studentOptionsLoading}
            learnerError={source.studentOptionsError}
            selectedLearnerId={source.selectedStudentId}
            opening={resume.resumeLoading && entryView === 'resume'}
            starting={startingAssignment}
            summary={resolvedEntrySummary}
            onEnterResume={() => setEntryView('resume')}
            onEnterNew={() => setEntryView('new')}
            onChangeChoice={() => setEntryView('choice')}
            onSelectRecent={resume.setSelectedResumeJobId}
            onRetryRecent={() => void resume.loadResumeJobs()}
            onLoadMoreRecent={resume.loadMoreResumeJobs}
            onOpenRecent={() => void handleOpenRecentAssignment()}
            onSelectLearner={handleStudentSelectionChange}
            onRetryLearners={() => void loadStudentOptions()}
            onStartNew={() => void commitNewAssignment(source.selectedStudentId)}
            onChangeAssignment={handleStartNewAssignmentWithSessionReset}
          />
        </div>

        <div
          className="assignment-workflow__step-mount"
          data-active={activeStep === 'source' ? 'true' : 'false'}
          hidden={activeStep !== 'source'}
          inert={activeStep === 'source' ? undefined : true}
        >
          <LessonSourceStep
            studentSelected={Boolean(source.selectedStudentId)}
            manualSaving={source.manualTranscriptSaving}
            manualError={source.manualTranscriptError}
            transcriptReady={transcriptReady}
            onCreateManualTranscript={handleCreateManualTranscript}
          >
            <SourceStageSection
              hideStudentSelection
              stage={sourceStage}
              sectionRef={sourceSectionRef}
              headingRef={sourceHeadingRef}
              studentSelectRef={sourceStudentSelectRef}
              studentOptions={source.studentOptions}
              studentOptionsError={source.studentOptionsError}
              selectedStudentId={source.selectedStudentId}
              onSelectedStudentIdChange={(value) => {
                if (linkedLessonId) return;
                handleStudentSelectionChange(value);
              }}
              selectedStudent={source.selectedStudent}
              linkedLessonId={linkedLessonId || null}
              linkedLessonContextLabel={linkedLessonContextLabel}
              lessonSuggestions={lessonSuggestions}
              lessonSuggestionsError={scheduleSurfaceError}
              onSelectLessonSuggestion={handleLinkedLessonSelection}
              selectedSttProvider={source.selectedSttProvider}
              sttProviderOverrideActive={source.sttProviderOverrideActive}
              selectedAudioTopology={source.selectedAudioTopology}
              onSelectedSttProviderChange={(provider) => {
                markAssignmentUserEdit();
                handleSelectedSttProviderChange(provider);
              }}
              onSelectedAudioTopologyChange={(topology) => {
                markAssignmentUserEdit();
                source.handleSelectedAudioTopologyChange(topology);
              }}
              sttProviders={source.sttProviders}
              formatSttProviderLabel={formatSttProviderLabel}
              recordingFileAccept={RECORDING_FILE_ACCEPT}
              uploading={source.uploading}
              replacingAudio={source.replacingAudio}
              canReplaceAudio={Boolean(
                source.recording?.source === 'upload' &&
                  activeAssignmentSession &&
                  activeAssignmentSession.confirmedStep !== 'share' &&
                  !activeAssignmentSession.shareJobId &&
                  assignmentSessionWritesAllowed(),
              )}
              selectedFileName={source.selectedFileName}
              uploadProgress={source.uploadProgress}
              onFiles={(files) => {
                markAssignmentUserEdit();
                handleFiles(files);
              }}
              onBeginAudioReplacement={source.beginAudioReplacement}
              onCancelAudioReplacement={source.cancelAudioReplacement}
              onCancelUpload={handleCancelUpload}
              canRetryUpload={source.canRetryUpload}
              onRetryUpload={source.retryPendingUpload}
              uploadError={source.uploadError}
              uploadCacheNotice={source.uploadCacheNotice}
              recording={source.recording}
              transcriptProvider={source.transcript?.sttProvider ?? null}
              recordingError={source.recordingError}
              transcriptStatus={source.transcriptStatus}
              transcriptError={source.transcriptError}
              transcriptReady={transcriptReady}
              transcriptText={source.transcriptText}
              onTranscriptTextChange={(value) => {
                markAssignmentUserEdit();
                setTranscriptText(value);
              }}
              transcriptDirty={source.transcriptDirty}
              transcriptSaving={source.transcriptSaving}
              mixedSpeakerRoles={mixedSpeakerRoles}
              onMixedSpeakerRoleChange={(speaker, role) =>
                setMixedSpeakerRoleSelections((current) => ({ ...current, [speaker]: role }))
              }
              onSaveMixedSpeakerRoles={() => {
                const roles = mixedSpeakerRoles
                  .filter((item): item is { speaker: number; role: 'teacher' | 'student' } =>
                    Boolean(item.role),
                  )
                  .map((item) => ({ speaker: item.speaker, role: item.role }));
                void source.handleSaveTranscript({ roles });
              }}
              readOnly={completedReferenceMode}
            />
          </LessonSourceStep>
        </div>

        <div
          className="assignment-workflow__step-mount"
          data-active={activeStep === 'context' ? 'true' : 'false'}
          hidden={activeStep !== 'context'}
          inert={activeStep === 'context' ? undefined : true}
        >
          <TeachingContextStep>
            <ContextStageSection
              stage={contextStage}
              sectionRef={contextSectionRef}
              headingRef={contextHeadingRef}
              studentId={source.selectedStudentId}
              studentName={source.selectedStudent?.name ?? null}
              selectedProfileId={context.selectedProfileId}
              profilePreview={context.profilePreview}
              profileRevisionError={context.profileRevisionError}
              firstProfileAssist={{
                visible: firstProfileAssistVisible,
                sourceConfirmed: firstProfileLessonMemoryConfirmed,
                lessonMemoryStatus:
                  firstProfileLessonMemoryReadyCount > 0 ? 'ready' : firstProfileLessonMemoryStatus,
                draftProfileId: firstProfileDraft?.profileId ?? null,
                draftRevisionId: firstProfileDraft?.draftRevisionId ?? null,
                draftPreview: firstProfileDraft?.structuredContent ?? null,
                busy: firstProfileAssistBusy,
                approved: firstProfileAssistApproved,
                error: firstProfileAssistError,
                onPopulate: handlePopulateFirstProfile,
                onApprove: handleApproveFirstProfileDraft,
                onRetry: () => void refreshFirstProfileLessonMemory(),
              }}
              teacherNotes={teacherNotes}
              readOnly={completedReferenceMode}
              onTeacherNotesChange={(value) => {
                markAssignmentUserEdit();
                setTeacherNotes(value);
              }}
            />
          </TeachingContextStep>
        </div>

        <div
          className="assignment-workflow__step-mount"
          data-active={activeStep === 'assignment' ? 'true' : 'false'}
          hidden={activeStep !== 'assignment'}
          inert={activeStep === 'assignment' ? undefined : true}
        >
          <CreateAssignmentStep>
            <AssignmentStageSection
              stage={assignmentStage}
              sectionRef={assignmentSectionRef}
              headingRef={assignmentHeadingRef}
              generateDraftButtonRef={assignmentGenerateDraftButtonRef}
              transcriptReady={transcriptReady}
              promptLoading={authoring.promptLoading}
              promptOptionsReady={Boolean(promptOptions)}
              promptError={authoring.promptError}
              validating={authoring.validating}
              draftDirty={authoring.draftDirty}
              generationOptionsAvailable={Boolean(generationOptions)}
              onGenerateAssignment={() => void handleGenerateAssignment()}
              generatingDraft={authoring.generatingDraft}
              generationBlockedByQuota={authoring.generationBlockedByQuota}
              generationQuotaBlockedReason={authoring.generationQuotaBlockedReason}
              generationError={authoring.generationError}
              generationSuccess={authoring.generationSuccess}
              draftText={authoring.draftText}
              onDraftTextChange={(value) => {
                markAssignmentUserEdit();
                authoring.setDraftText(value);
              }}
              validation={authoring.validation}
              validationError={authoring.validationError}
              draftError={authoring.draftError}
              readOnly={completedReferenceMode && !correctionMode}
              allowGenerate={!completedReferenceMode}
            />
          </CreateAssignmentStep>
        </div>

        <div
          className="assignment-workflow__step-mount"
          data-active={activeStep === 'review' ? 'true' : 'false'}
          hidden={activeStep !== 'review'}
          inert={activeStep === 'review' ? undefined : true}
        >
          <ReviewShareStep>
            <ReviewStageSection
              stage={reviewStage}
              sectionRef={reviewSectionRef}
              headingRef={reviewHeadingRef}
              previewButtonRef={reviewPreviewButtonRef}
              onPublish={() => void handleShareAssignment()}
              shareAvailable={activeAssignmentSession?.confirmedStep === 'create'}
              onCancelJob={() => void advancedActions.handleCancelJob()}
              canPublishWithPreview={authoring.canPublishWithPreview && shareRecoveryReady}
              cancelEnabled={advancedActions.cancelEnabled}
              actionBusy={advancedActions.actionBusy}
              publishing={authoring.publishing || sharingAssignment}
              previewing={authoring.previewing}
              onPreviewDraft={() => void authoring.previewDraft()}
              draftHasContent={authoring.draftText.trim().length > 0}
              previewReadyForCurrentDraft={authoring.previewReadyForCurrentDraft}
              previewError={authoring.previewError}
              previewHtml={authoring.previewHtml}
              publishError={assignmentShareError ?? authoring.publishError}
              currentJobStatus={jobStatus}
              jobFailureReason={
                jobStatus?.state === 'failed' && jobStatus.error
                  ? describeJobFailureReason(jobStatus)
                  : null
              }
              jobReady={Boolean(jobReady)}
              publishUrl={publishUrl}
              publishLabel={publishLabel}
              publishPending={publishPending}
              completedReferenceMode={completedReferenceMode}
              correctionAvailable={validPublicationParent}
              publicationRecoveryAvailable={publicationRecoveryAvailable}
              correctionMode={correctionMode}
              correctionPublishing={correctionPublishing}
              correctionError={correctionError}
              correctionCanPublish={Boolean(
                correctionMode &&
                  !correctionPublishing &&
                  !correctionReconciliationRef.current &&
                  Boolean(authoring.draft?.id) &&
                  !authoring.draftDirty &&
                  !authoring.draftRecoveryConflict,
              )}
              savedUnpublishedChanges={savedUnpublishedChanges}
              onEnterCorrection={enterCorrectionMode}
              onRetryPublication={() => void handleRetryPublication()}
              onExitCorrection={exitCorrectionMode}
              onPublishCorrection={() => void handlePublishCorrection()}
            />
          </ReviewShareStep>
        </div>
      </AssignmentWorkflow>
    </div>
  );
};
