import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AssignmentSession,
  FoundationalProfile,
  GenerationProvider,
  JobEvent,
  JobOptionsResponse,
  JobStatus,
  PromptOptionsResponse,
  SttProvider,
  StudentScheduleBillingSurface,
  UpdateAssignmentSessionRequest,
} from '../../utils/api';
import {
  activateProfileRevision,
  archiveAssignmentSession,
  createAssignmentSession,
  fetchJobOptions,
  fetchPromptOptions,
  getJobStatus,
  getStudentMemoryHealth,
  getStudentScheduleBillingSurface,
  populateFirstProfileFromLesson,
  requestLessonMemoryFromTranscript,
  subscribeToJobEvents,
  updateAssignmentSession,
} from '../../utils/api';
import { AssignmentSupport } from '../assignments/AssignmentSupport';
import { AssignmentWorkflow } from '../assignments/AssignmentWorkflow';
import {
  type AssignmentStepId,
  deriveAssignmentWorkflow,
  getTeacherNotesCommitDecision,
  resolveInitialAssignmentStep,
} from '../assignments/assignment-workflow';
import { CreateAssignmentStep } from '../assignments/steps/CreateAssignmentStep';
import { LessonSourceStep } from '../assignments/steps/LessonSourceStep';
import { ReviewShareStep } from '../assignments/steps/ReviewShareStep';
import { StudentStep } from '../assignments/steps/StudentStep';
import { TeachingContextStep } from '../assignments/steps/TeachingContextStep';
import {
  AdvancedActionsStage,
  AssignmentDiagnostics,
  useAdvancedActionsController,
} from './MinimalAssignment.advanced';
import { useMinimalAssignmentAuthoringController } from './MinimalAssignment.authoring';
import { useMinimalAssignmentContextController } from './MinimalAssignment.context';
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
  useMinimalAssignmentResume,
} from './MinimalAssignment.resume';
import {
  buildCurrentAssignmentCard,
  buildRecentAssignmentItems,
} from './MinimalAssignment.resume-presentation';
import { useMinimalAssignmentSourceController } from './MinimalAssignment.source';
import {
  AssignmentStageSection,
  ContextStageSection,
  type CurrentAssignmentCard,
  ReviewStageSection,
  SourceStageSection,
  type StartStageMode,
  StartStageSection,
  type WorkflowStage,
  type WorkflowStageStatus,
} from './MinimalAssignment.stages';
import './MinimalAssignment.css';

const AUDIO_EXTENSIONS = ['.opus'] as const;
const FOCUSED_STEP_ORDER: AssignmentStepId[] = ['student', 'source', 'context', 'create', 'review'];
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
  const [jobOptions, setJobOptions] = useState<JobOptionsResponse | null>(null);
  const [jobOptionsError, setJobOptionsError] = useState<string | null>(null);
  const [showAllResumeJobs, setShowAllResumeJobs] = useState(false);
  const [startStageMode, setStartStageMode] = useState<StartStageMode>('idle');
  const [activeStep, setActiveStep] = useState<AssignmentStepId>('student');
  const [firstProfileLessonMemoryStatus, setFirstProfileLessonMemoryStatus] = useState<
    'checking' | 'building' | 'ready'
  >('checking');
  const [firstProfileLessonMemoryReadyCount, setFirstProfileLessonMemoryReadyCount] = useState(0);
  const [firstProfileDraft, setFirstProfileDraft] = useState<{
    profileId: string;
    draftRevisionId: string;
    structuredContent: FoundationalProfile | null;
  } | null>(null);
  const [firstProfileLessonMemoryConfirmation, setFirstProfileLessonMemoryConfirmation] = useState<{
    studentId: string;
    recordingId: string;
    transcriptId: string;
    transcriptUpdatedAt: string | null;
  } | null>(null);
  const [firstProfileAssistBusy, setFirstProfileAssistBusy] = useState<
    'confirming' | 'drafting' | 'approving' | null
  >(null);
  const [firstProfileAssistApproved, setFirstProfileAssistApproved] = useState(false);
  const [firstProfileAssistError, setFirstProfileAssistError] = useState<string | null>(null);

  const [rerunTargetPronunciationMode, setRerunTargetPronunciationMode] =
    useState<PronunciationMode | null>(null);

  const startSectionRef = useRef<HTMLElement | null>(null);
  const startHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const sourceSectionRef = useRef<HTMLElement | null>(null);
  const sourceHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const sourceStudentSelectRef = useRef<HTMLSelectElement | null>(null);
  const contextSectionRef = useRef<HTMLElement | null>(null);
  const contextHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const contextProfileSelectRef = useRef<HTMLSelectElement | null>(null);
  const assignmentSectionRef = useRef<HTMLElement | null>(null);
  const assignmentHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const assignmentGenerateDraftButtonRef = useRef<HTMLButtonElement | null>(null);
  const reviewSectionRef = useRef<HTMLElement | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const reviewPreviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const advancedSectionRef = useRef<HTMLElement | null>(null);
  const advancedHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const activeStepHydrationKeyRef = useRef<string | null>(null);
  const assignmentSessionMutationQueueRef = useRef<Promise<AssignmentSession | null>>(
    Promise.resolve(null),
  );
  const assignmentSessionSettingsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const context = useMinimalAssignmentContextController({
    selectedStudentId: source.selectedStudentId,
    resolveBoundProfileId: source.resolveBoundProfileId,
  });
  const {
    resetSourceFlow,
    applyHydratedSnapshot: applySourceHydration,
    loadStudentOptions,
    loadTranscript,
    handleRetryTranscription,
    handleSaveTranscript,
    handleSelectedSttProviderChange,
    handleStudentSelectionChange,
    handleFiles,
    handleCancelUpload,
    setTranscriptText,
  } = source;
  const { applyHydratedSnapshot: applyContextHydration } = context;
  const activeAssignmentProfileId = context.profilePreview ? context.selectedProfileId : '';

  const authoring = useMinimalAssignmentAuthoringController({
    recordingId: source.recording?.recordingId ?? null,
    lessonId: linkedLessonId || null,
    transcriptStatus: source.transcriptStatus,
    teacherNotes,
    selectedProfileId: activeAssignmentProfileId,
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

  const markAssignmentUserEdit = useCallback(() => {
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

  const beginHydration = useCallback((mode: HydrationMode): HydrationContext => {
    hydrationIdRef.current += 1;
    assignmentSessionUserEditedRef.current = false;
    assignmentSessionPersistenceSuppressedRef.current = mode !== 'new';
    if (assignmentSessionSettingsTimeoutRef.current) {
      clearTimeout(assignmentSessionSettingsTimeoutRef.current);
      assignmentSessionSettingsTimeoutRef.current = null;
    }
    return { id: hydrationIdRef.current, mode };
  }, []);

  const isCurrentHydration = useCallback(
    (context: HydrationContext) => hydrationIdRef.current === context.id,
    [],
  );

  const resetFlow = useCallback(() => {
    beginHydration('new');
    committedTeacherNotesRef.current = '';
    invalidateAuthoringGeneration();
    resetAuthoring();
    resetSourceFlow({ resetStudent: true });
    resetJobShell();
  }, [
    beginHydration,
    invalidateAuthoringGeneration,
    resetAuthoring,
    resetJobShell,
    resetSourceFlow,
  ]);

  const handleStartNewAssignment = useCallback(() => {
    setShowAllResumeJobs(false);
    resetFlow();
    setStartStageMode('start');
  }, [resetFlow]);

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
        selectedProfileId: snapshot.selectedProfileId,
        profileSelectionMode: snapshot.profileSelectionMode,
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
  });
  const activeAssignmentSession = resume.activeAssignmentSession;
  const setActiveAssignmentSession = resume.setActiveAssignmentSession;

  const assignmentSessionWritesAllowed = useCallback(() => {
    return (
      !assignmentSessionPersistenceSuppressedRef.current || assignmentSessionUserEditedRef.current
    );
  }, []);

  const saveAssignmentSessionProgress = useCallback(
    async (patch: UpdateAssignmentSessionRequest): Promise<AssignmentSession | null> => {
      const cleaned = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as UpdateAssignmentSessionRequest;
      if (Object.keys(cleaned).length === 0) {
        return activeAssignmentSession;
      }

      const run = assignmentSessionMutationQueueRef.current
        .catch(() => null)
        .then(async (latest) => {
          const current = latest ?? activeAssignmentSession;
          if (!current && jobStatus?.jobId) {
            return null;
          }
          const saved = current
            ? await updateAssignmentSession(current.id, cleaned)
            : await createAssignmentSession(cleaned);
          setActiveAssignmentSession(saved);
          return saved;
        });
      assignmentSessionMutationQueueRef.current = run;
      try {
        return await run;
      } catch (error) {
        console.warn('Unable to save assignment session progress', error);
        return null;
      }
    },
    [activeAssignmentSession, jobStatus?.jobId, setActiveAssignmentSession],
  );

  const archiveActiveAssignmentSession = useCallback(async () => {
    const session = activeAssignmentSession;
    if (!session) return;
    try {
      const archived = await archiveAssignmentSession(session.id);
      setActiveAssignmentSession(archived);
    } catch (error) {
      console.warn('Unable to archive assignment session', error);
    }
  }, [activeAssignmentSession, setActiveAssignmentSession]);

  const handleLinkedLessonSelection = useCallback(
    (lessonId: string) => {
      setLinkedLessonId(lessonId);
      assignmentSessionMilestoneRef.current.lessonId = lessonId;
      markAssignmentUserEdit();
      if (!assignmentSessionWritesAllowed()) return;
      void saveAssignmentSessionProgress({
        studentId: source.selectedStudentId || null,
        lessonId,
        currentStage: 'source',
      });
    },
    [
      assignmentSessionWritesAllowed,
      markAssignmentUserEdit,
      saveAssignmentSessionProgress,
      source.selectedStudentId,
    ],
  );

  const handleStartNewAssignmentWithSessionReset = useCallback(() => {
    assignmentSessionMutationQueueRef.current = Promise.resolve(null);
    if (assignmentSessionSettingsTimeoutRef.current) {
      clearTimeout(assignmentSessionSettingsTimeoutRef.current);
      assignmentSessionSettingsTimeoutRef.current = null;
    }
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
    setActiveStep('student');
    handleStartNewAssignment();
  }, [
    fallbackTemplateId,
    handleStartNewAssignment,
    scheduleFollowupContext.lessonId,
    setActiveAssignmentSession,
  ]);

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
      studentId: (source.recording?.studentId ?? source.selectedStudentId) || null,
      recordingId,
      ...(linkedLessonId ? { lessonId: linkedLessonId } : {}),
      currentStage: 'source',
    });
  }, [
    saveAssignmentSessionProgress,
    source.recording?.recordingId,
    source.recording?.studentId,
    source.selectedStudentId,
    linkedLessonId,
    assignmentSessionWritesAllowed,
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
      transcriptId,
      currentStage: 'context',
    });
  }, [
    assignmentSessionWritesAllowed,
    saveAssignmentSessionProgress,
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
      ...(linkedLessonId ? { lessonId: linkedLessonId } : {}),
      teacherNotes: teacherNotes.trim() || null,
      selectedGenerationProvider: isGenerationProvider(authoring.selectedGenerationProvider)
        ? authoring.selectedGenerationProvider
        : null,
      selectedGenerationModel: authoring.selectedGenerationModel || null,
      currentStage: 'assignment',
    });
  }, [
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
      currentStage: 'review',
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
      return;
    }
    assignmentSessionSettingsRef.current = settingsKey;
    if (!assignmentSessionWritesAllowed()) {
      return;
    }
    if (assignmentSessionSettingsTimeoutRef.current) {
      clearTimeout(assignmentSessionSettingsTimeoutRef.current);
    }
    assignmentSessionSettingsTimeoutRef.current = setTimeout(() => {
      assignmentSessionSettingsTimeoutRef.current = null;
      void saveAssignmentSessionProgress({
        teacherNotes: committedTeacherNotesRef.current || null,
        selectedGenerationProvider,
        selectedGenerationModel: authoring.selectedGenerationModel || null,
        publishTarget: authoring.publishTarget,
        selectedTtsProvider: authoring.selectedTtsProvider,
        selectedTtsStrategy: authoring.selectedTtsStrategy,
        selectedTtsModel: authoring.selectedTtsModel || null,
        selectedPreset: authoring.selectedPreset || null,
        currentStage: authoring.draft?.id ? 'review' : 'assignment',
      });
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
    saveAssignmentSessionProgress,
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
  const resumeSetSelectedResumeJobId = resume.setSelectedResumeJobId;

  const handleShowResumeChoice = useCallback(() => {
    setStartStageMode('resume');
  }, []);

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
  const firstProfileAssistVisible = Boolean(
    source.selectedStudentId &&
    transcriptReady &&
    (context.profilePreviewStatus === 'none' || context.profilePreviewStatus === 'unstructured'),
  );
  const firstProfileLessonMemoryKey = useMemo(() => {
    const studentId = source.selectedStudentId;
    const recordingId = source.recording?.recordingId ?? '';
    const transcriptId = source.transcript?.transcriptId ?? '';
    if (!studentId || !recordingId || !transcriptId) {
      return null;
    }
    return {
      studentId,
      recordingId,
      transcriptId,
      transcriptUpdatedAt: source.transcript?.updatedAt ?? null,
    };
  }, [
    source.recording?.recordingId,
    source.selectedStudentId,
    source.transcript?.transcriptId,
    source.transcript?.updatedAt,
  ]);
  const firstProfileLessonMemoryConfirmed = Boolean(
    firstProfileLessonMemoryKey &&
    firstProfileLessonMemoryConfirmation &&
    firstProfileLessonMemoryConfirmation.studentId === firstProfileLessonMemoryKey.studentId &&
    firstProfileLessonMemoryConfirmation.recordingId === firstProfileLessonMemoryKey.recordingId &&
    firstProfileLessonMemoryConfirmation.transcriptId ===
      firstProfileLessonMemoryKey.transcriptId &&
    firstProfileLessonMemoryConfirmation.transcriptUpdatedAt ===
      firstProfileLessonMemoryKey.transcriptUpdatedAt &&
    !source.transcriptDirty,
  );
  const firstProfileLessonMemoryNeedsUpdate = Boolean(
    firstProfileLessonMemoryConfirmation && !firstProfileLessonMemoryConfirmed,
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
    setFirstProfileLessonMemoryConfirmation(null);
  }, [source.selectedStudentId, source.recording?.recordingId]);

  const handleConfirmFirstProfileLessonMemory = useCallback(async () => {
    if (!source.selectedStudentId || !firstProfileLessonMemoryKey || source.transcriptDirty) {
      return;
    }
    markAssignmentUserEdit();
    setFirstProfileAssistBusy('confirming');
    setFirstProfileAssistError(null);
    try {
      const response = await requestLessonMemoryFromTranscript(source.selectedStudentId, {
        recordingId: firstProfileLessonMemoryKey.recordingId,
        transcriptId: firstProfileLessonMemoryKey.transcriptId,
        lessonId: linkedLessonId || null,
      });
      setFirstProfileLessonMemoryConfirmation(firstProfileLessonMemoryKey);
      if (response.outcome === 'ready_exists') {
        setFirstProfileLessonMemoryReadyCount((current) => Math.max(current, 1));
        setFirstProfileLessonMemoryStatus('ready');
      } else {
        setFirstProfileLessonMemoryReadyCount(0);
        setFirstProfileLessonMemoryStatus('building');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to confirm the lesson memory request.';
      setFirstProfileAssistError(message);
    } finally {
      setFirstProfileAssistBusy(null);
    }
  }, [
    firstProfileLessonMemoryKey,
    linkedLessonId,
    markAssignmentUserEdit,
    source.selectedStudentId,
    source.transcriptDirty,
  ]);

  const handleChangeFirstProfileStudent = useCallback(() => {
    sourceSectionRef.current?.scrollIntoView({ block: 'start' });
    sourceStudentSelectRef.current?.focus();
  }, []);

  const handleReplaceFirstProfileAudio = useCallback(() => {
    markAssignmentUserEdit();
    source.resetSourceFlow({ resetStudent: false });
  }, [markAssignmentUserEdit, source]);

  const handlePopulateFirstProfile = useCallback(async () => {
    if (!source.selectedStudentId) return;
    markAssignmentUserEdit();
    setFirstProfileAssistBusy('drafting');
    setFirstProfileAssistError(null);
    try {
      const response = await populateFirstProfileFromLesson(source.selectedStudentId);
      setFirstProfileDraft({
        profileId: response.profileId,
        draftRevisionId: response.draftRevisionId,
        structuredContent: response.draftRevision.structuredContent ?? null,
      });
      setFirstProfileLessonMemoryReadyCount(response.lessonMemoryIds.length);
      setFirstProfileLessonMemoryStatus('ready');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to populate the first profile draft.';
      setFirstProfileAssistError(message);
    } finally {
      setFirstProfileAssistBusy(null);
    }
  }, [markAssignmentUserEdit, source.selectedStudentId]);

  const handleApproveFirstProfileDraft = useCallback(async () => {
    if (!firstProfileDraft) return;
    markAssignmentUserEdit();
    setFirstProfileAssistBusy('approving');
    setFirstProfileAssistError(null);
    try {
      await activateProfileRevision(firstProfileDraft.profileId, firstProfileDraft.draftRevisionId);
      source.bindStudentProfile(source.selectedStudentId, firstProfileDraft.profileId);
      context.selectProfileId(firstProfileDraft.profileId);
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
  const hasAssignmentContent = authoring.draftText.trim().length > 0;
  const hasDownstreamAssignmentState = Boolean(
    authoring.promptReady ||
    hasAssignmentContent ||
    authoring.previewReadyForCurrentDraft ||
    jobStatus?.jobId ||
    activeAssignmentSession?.promptPackageId ||
    activeAssignmentSession?.draftId,
  );
  const hasStartedFlow =
    startStageMode === 'start' ||
    source.selectedStudentId.trim().length > 0 ||
    source.recording !== null ||
    transcriptReady ||
    authoring.promptReady ||
    hasAssignmentContent ||
    jobReady;
  const studentNameById = useMemo(
    () => new Map(source.studentOptions.map((student) => [student.id, student.name])),
    [source.studentOptions],
  );
  const totalResumeItems = resume.assignmentSessions.length + resume.resumeJobs.length;
  useEffect(() => {
    if (totalResumeItems <= 4 && showAllResumeJobs) {
      setShowAllResumeJobs(false);
    }
  }, [showAllResumeJobs, totalResumeItems]);
  const resumeJobItems = useMemo(() => {
    const allItems = buildRecentAssignmentItems(
      resume.assignmentSessions,
      resume.resumeJobs,
      resume.selectedResumeJobId,
      studentNameById,
    );
    return showAllResumeJobs ? allItems : allItems.slice(0, 4);
  }, [
    resume.assignmentSessions,
    resume.resumeJobs,
    resume.selectedResumeJobId,
    showAllResumeJobs,
    studentNameById,
  ]);
  const canToggleResumeJobs = totalResumeItems > 4;
  const currentAssignmentCard = useMemo<CurrentAssignmentCard | null>(() => {
    return buildCurrentAssignmentCard(jobStatus, studentNameById);
  }, [jobStatus, studentNameById]);
  const publishUrl = jobStatus?.htmlUrl;
  const publishLabel = 'Open Assignment Handout';
  const publishPending = 'HTML link pending...';
  const hasTeachingContext = Boolean(
    context.profilePreviewStatus === 'ready' || teacherNotes.trim() || authoring.promptReady,
  );
  const reviewReady =
    hasAssignmentContent &&
    (!authoring.draftPreviewGate.previewRequired || authoring.previewReadyForCurrentDraft);
  const focusedWorkflowSteps = useMemo(
    () =>
      deriveAssignmentWorkflow({
        selectedStudent: Boolean(source.selectedStudentId),
        transcriptReady,
        promptReady: authoring.promptReady,
        draftReady: hasAssignmentContent,
        previewReady: authoring.previewReadyForCurrentDraft,
        published: jobReady,
      }),
    [
      authoring.previewReadyForCurrentDraft,
      authoring.promptReady,
      hasAssignmentContent,
      jobReady,
      source.selectedStudentId,
      transcriptReady,
    ],
  );
  const focusedWorkflowInput = useMemo(
    () => ({
      selectedStudent: Boolean(source.selectedStudentId),
      transcriptReady,
      promptReady: authoring.promptReady,
      draftReady: hasAssignmentContent,
      previewReady: authoring.previewReadyForCurrentDraft,
      published: jobReady,
    }),
    [
      authoring.previewReadyForCurrentDraft,
      authoring.promptReady,
      hasAssignmentContent,
      jobReady,
      source.selectedStudentId,
      transcriptReady,
    ],
  );
  useEffect(() => {
    if (!activeAssignmentSession) {
      activeStepHydrationKeyRef.current = null;
      return;
    }
    if (activeStepHydrationKeyRef.current === activeAssignmentSession.id) return;
    activeStepHydrationKeyRef.current = activeAssignmentSession.id;
    setActiveStep(
      resolveInitialAssignmentStep(activeAssignmentSession.currentStage, focusedWorkflowInput),
    );
  }, [activeAssignmentSession, focusedWorkflowInput]);

  const activeStepIndex = FOCUSED_STEP_ORDER.indexOf(activeStep);
  const commitTeacherNotes = useCallback(async (): Promise<TeacherNotesCommitResult> => {
    const normalizedTeacherNotes = teacherNotes.trim();
    const decision = getTeacherNotesCommitDecision({
      currentNotes: normalizedTeacherNotes,
      committedNotes: committedTeacherNotesRef.current,
      hasDownstreamAssignment: hasDownstreamAssignmentState,
    });
    if (decision === 'unchanged') return 'unchanged';
    if (
      decision === 'confirm-and-invalidate' &&
      !globalThis.confirm(
        'This will require a new assignment draft. Your lesson source and transcript will stay saved.',
      )
    ) {
      return null;
    }

    if (assignmentSessionSettingsTimeoutRef.current) {
      clearTimeout(assignmentSessionSettingsTimeoutRef.current);
      assignmentSessionSettingsTimeoutRef.current = null;
    }

    const saved = await saveAssignmentSessionProgress({
      studentId: source.selectedStudentId || null,
      recordingId: source.recording?.recordingId ?? null,
      transcriptId: source.transcript?.transcriptId ?? null,
      teacherNotes: normalizedTeacherNotes || null,
      ...(decision === 'confirm-and-invalidate' ? { promptPackageId: null, draftId: null } : {}),
      currentStage: 'assignment',
    });
    if (!saved) return null;

    committedTeacherNotesRef.current = normalizedTeacherNotes;
    if (decision === 'confirm-and-invalidate') {
      invalidateAuthoringGeneration();
      resetAuthoring();
      setJobStatusState(null);
      assignmentSessionMilestoneRef.current.promptPackageId = '';
      assignmentSessionMilestoneRef.current.draftId = '';
      return 'invalidated';
    }
    return 'committed';
  }, [
    hasDownstreamAssignmentState,
    invalidateAuthoringGeneration,
    resetAuthoring,
    saveAssignmentSessionProgress,
    source.recording?.recordingId,
    source.selectedStudentId,
    source.transcript?.transcriptId,
    teacherNotes,
  ]);
  const handleGenerateAssignment = useCallback(async () => {
    markAssignmentUserEdit();
    const commitResult = await commitTeacherNotes();
    if (!commitResult) return;
    await authoring.generateAssignment({ forceFreshPrompt: commitResult === 'invalidated' });
  }, [authoring, commitTeacherNotes, markAssignmentUserEdit]);
  const handleFocusedStepRequest = useCallback(
    async (requestedStep: AssignmentStepId) => {
      const requested = focusedWorkflowSteps.find((step) => step.id === requestedStep);
      const isForwardTeachingContextRequest =
        activeStep === 'context' && FOCUSED_STEP_ORDER.indexOf(requestedStep) > activeStepIndex;
      if (
        requested?.status === 'locked' &&
        FOCUSED_STEP_ORDER.indexOf(requestedStep) > activeStepIndex
      ) {
        return;
      }
      if (isForwardTeachingContextRequest) {
        const invalidatesDownstreamAssignment =
          getTeacherNotesCommitDecision({
            currentNotes: teacherNotes,
            committedNotes: committedTeacherNotesRef.current,
            hasDownstreamAssignment: hasDownstreamAssignmentState,
          }) === 'confirm-and-invalidate';
        if (!(await commitTeacherNotes())) return;
        if (invalidatesDownstreamAssignment) {
          setActiveStep(
            FOCUSED_STEP_ORDER[Math.min(FOCUSED_STEP_ORDER.length - 1, activeStepIndex + 1)] ??
              'create',
          );
          return;
        }
      }
      setActiveStep(requestedStep);
    },
    [
      activeStep,
      activeStepIndex,
      commitTeacherNotes,
      focusedWorkflowSteps,
      hasDownstreamAssignmentState,
      teacherNotes,
    ],
  );
  const handleFocusedBack = useCallback(() => {
    setActiveStep(FOCUSED_STEP_ORDER[Math.max(0, activeStepIndex - 1)] ?? 'student');
  }, [activeStepIndex]);
  const handleFocusedContinue = useCallback(async () => {
    if (activeStep === 'context') {
      if (!(await commitTeacherNotes())) return;
    }
    if (activeStep === 'create' && authoring.draftDirty) {
      await authoring.saveDraft();
    }
    setActiveStep(
      FOCUSED_STEP_ORDER[Math.min(FOCUSED_STEP_ORDER.length - 1, activeStepIndex + 1)] ?? 'review',
    );
  }, [activeStep, activeStepIndex, authoring, commitTeacherNotes]);
  const continueDisabled =
    activeStep === 'student'
      ? !hasStartedFlow || !source.selectedStudentId
      : activeStep === 'source'
        ? !transcriptReady
        : activeStep === 'create'
          ? !hasAssignmentContent
          : false;
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
  useEffect(() => {
    if (!hasStartedFlow || startStageMode !== 'idle') return;
    setStartStageMode('start');
  }, [hasStartedFlow, startStageMode]);

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
          : startStageMode === 'resume'
            ? 'Choose a recent assignment to reopen.'
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
    startStageMode,
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
        saveState={activeAssignmentSession ? 'saved' : 'idle'}
        onStepRequest={handleFocusedStepRequest}
        onBack={handleFocusedBack}
        {...(activeStep === 'review'
          ? {}
          : {
              onContinue: handleFocusedContinue,
              continueLabel: 'Confirm and continue',
              continueDisabled,
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
              jobStatus={jobStatus}
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
          inert={activeStep === 'student' ? undefined : true}
        >
          <StudentStep
            students={source.studentOptions}
            selectedStudentId={source.selectedStudentId}
            selectionLocked={Boolean(linkedLessonId)}
            error={source.studentOptionsError}
            onSelect={handleStudentSelectionChange}
          >
            <StartStageSection
              stage={startStage}
              sectionRef={startSectionRef}
              headingRef={startHeadingRef}
              mode={startStageMode}
              selectedStudentName={source.selectedStudent?.name ?? null}
              onStartNewAssignment={handleStartNewAssignmentWithSessionReset}
              onShowResumeChoice={handleShowResumeChoice}
              onRefreshRecentWork={() => void resume.loadResumeJobs()}
              onResumeSelectedAssignment={resume.handleResumeSelectedJob}
              resumeLoading={resume.resumeLoading}
              selectedResumeJobId={resume.selectedResumeJobId}
              onSelectedResumeJobIdChange={resume.setSelectedResumeJobId}
              resumeJobItems={resumeJobItems}
              totalResumeJobs={totalResumeItems}
              canToggleResumeJobs={canToggleResumeJobs}
              showAllResumeJobs={showAllResumeJobs}
              onToggleShowAllResumeJobs={() => setShowAllResumeJobs((current) => !current)}
              resumeError={resume.resumeError}
              currentJobStatus={jobStatus}
              currentAssignmentCard={currentAssignmentCard}
              publishUrl={publishUrl}
              publishLabel={publishLabel}
              publishPending={publishPending}
            />
          </StudentStep>
        </div>

        <div
          className="assignment-workflow__step-mount"
          data-active={activeStep === 'source' ? 'true' : 'false'}
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
              onRefreshStudents={() => void loadStudentOptions()}
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
              onSelectedSttProviderChange={(provider) => {
                markAssignmentUserEdit();
                handleSelectedSttProviderChange(provider);
              }}
              sttProviders={source.sttProviders}
              formatSttProviderLabel={formatSttProviderLabel}
              audioExtensions={AUDIO_EXTENSIONS}
              uploading={source.uploading}
              selectedFileName={source.selectedFileName}
              uploadProgress={source.uploadProgress}
              onFiles={(files) => {
                markAssignmentUserEdit();
                handleFiles(files);
              }}
              onCancelUpload={handleCancelUpload}
              uploadError={source.uploadError}
              uploadCacheNotice={source.uploadCacheNotice}
              recording={source.recording}
              recordingStatus={source.recordingStatus}
              recordingError={source.recordingError}
              transcriptStatus={source.transcriptStatus}
              transcriptError={source.transcriptError}
              transcriptReady={transcriptReady}
              onRefreshTranscript={() => void loadTranscript()}
              retryingTranscript={source.retryingTranscript}
              onRetryTranscript={() => void handleRetryTranscription()}
              transcriptText={source.transcriptText}
              onTranscriptTextChange={(value) => {
                markAssignmentUserEdit();
                setTranscriptText(value);
              }}
              transcriptDirty={source.transcriptDirty}
              transcriptSaving={source.transcriptSaving}
              onSaveTranscript={() => {
                markAssignmentUserEdit();
                void handleSaveTranscript();
              }}
            />
          </LessonSourceStep>
        </div>

        <div
          className="assignment-workflow__step-mount"
          data-active={activeStep === 'context' ? 'true' : 'false'}
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
                confirmationState: firstProfileLessonMemoryConfirmed
                  ? 'confirmed'
                  : firstProfileLessonMemoryNeedsUpdate
                    ? 'edited'
                    : 'unconfirmed',
                confirmDisabled: source.transcriptDirty || !firstProfileLessonMemoryKey,
                lessonMemoryStatus:
                  firstProfileLessonMemoryReadyCount > 0 ? 'ready' : firstProfileLessonMemoryStatus,
                draftProfileId: firstProfileDraft?.profileId ?? null,
                draftRevisionId: firstProfileDraft?.draftRevisionId ?? null,
                draftPreview: firstProfileDraft?.structuredContent ?? null,
                busy: firstProfileAssistBusy,
                approved: firstProfileAssistApproved,
                error: firstProfileAssistError,
                onConfirm: handleConfirmFirstProfileLessonMemory,
                onChangeStudent: handleChangeFirstProfileStudent,
                onReplaceAudio: handleReplaceFirstProfileAudio,
                onPopulate: handlePopulateFirstProfile,
                onApprove: handleApproveFirstProfileDraft,
                onRefresh: () => void refreshFirstProfileLessonMemory(),
              }}
              teacherNotes={teacherNotes}
              onTeacherNotesChange={(value) => {
                markAssignmentUserEdit();
                setTeacherNotes(value);
              }}
            />
          </TeachingContextStep>
        </div>

        <div
          className="assignment-workflow__step-mount"
          data-active={activeStep === 'create' ? 'true' : 'false'}
          inert={activeStep === 'create' ? undefined : true}
        >
          <CreateAssignmentStep>
            <AssignmentStageSection
              stage={assignmentStage}
              sectionRef={assignmentSectionRef}
              headingRef={assignmentHeadingRef}
              generateDraftButtonRef={assignmentGenerateDraftButtonRef}
              transcriptReady={transcriptReady}
              promptLoading={authoring.promptLoading}
              promptReady={authoring.promptReady}
              promptOptionsReady={Boolean(promptOptions)}
              onReloadPromptOptions={() => void loadPromptOptions()}
              promptError={authoring.promptError}
              onSaveDraft={() => {
                markAssignmentUserEdit();
                void authoring.saveDraft();
              }}
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
            />
          </CreateAssignmentStep>
        </div>

        <div
          className="assignment-workflow__step-mount"
          data-active={activeStep === 'review' ? 'true' : 'false'}
          inert={activeStep === 'review' ? undefined : true}
        >
          <ReviewShareStep>
            <ReviewStageSection
              stage={reviewStage}
              sectionRef={reviewSectionRef}
              headingRef={reviewHeadingRef}
              previewButtonRef={reviewPreviewButtonRef}
              onPublish={() =>
                void authoring.publishAssignment({
                  onPublishedJob: resume.applyJobStatusTransition,
                  refreshResumeJobs: resume.loadResumeJobs,
                  completeAssignmentSession: archiveActiveAssignmentSession,
                })
              }
              onCancelJob={() => void advancedActions.handleCancelJob()}
              canPublishWithPreview={authoring.canPublishWithPreview}
              cancelEnabled={advancedActions.cancelEnabled}
              actionBusy={advancedActions.actionBusy}
              publishing={authoring.publishing}
              previewing={authoring.previewing}
              onPreviewDraft={() => void authoring.previewDraft()}
              draftHasContent={authoring.draftText.trim().length > 0}
              previewReadyForCurrentDraft={authoring.previewReadyForCurrentDraft}
              previewError={authoring.previewError}
              previewHtml={authoring.previewHtml}
              publishError={authoring.publishError}
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
            />
          </ReviewShareStep>
        </div>
      </AssignmentWorkflow>
    </div>
  );
};
