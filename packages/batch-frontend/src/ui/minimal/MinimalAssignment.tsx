import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  JobEvent,
  JobOptionsResponse,
  JobStatus,
  PromptOptionsResponse,
  SttProvider,
} from '../../utils/api';
import {
  fetchJobOptions,
  fetchPromptOptions,
  getJobStatus,
  subscribeToJobEvents,
} from '../../utils/api';
import { AdvancedActionsStage, useAdvancedActionsController } from './MinimalAssignment.advanced';
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
  useMinimalAssignmentResume,
} from './MinimalAssignment.resume';
import {
  buildCurrentAssignmentCard,
  buildResumeJobItems,
} from './MinimalAssignment.resume-presentation';
import { useMinimalAssignmentSourceController } from './MinimalAssignment.source';
import {
  AssignmentStageSection,
  ContextStageSection,
  type CurrentAssignmentCard,
  type ResumeJobListItem,
  ReviewStageSection,
  SourceStageSection,
  type StartStageMode,
  StartStageSection,
  WorkflowOverview,
  type WorkflowStage,
  type WorkflowStageId,
  type WorkflowStageStatus,
  type WorkflowSummaryItem,
} from './MinimalAssignment.stages';
import './MinimalAssignment.css';

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus'];
const FALLBACK_TTS_PROVIDERS = ['elevenlabs', 'google'] as const;
const FALLBACK_PRONUNCIATION_CHUNK_TTS_PROVIDERS = ['google', 'elevenlabs', 'edge-tts'] as const;
const FALLBACK_GOOGLE_TTS_MODELS = ['chirp3_hd', 'studio', 'neural2', 'wavenet'] as const;
const FALLBACK_ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const FALLBACK_ELEVENLABS_MODELS = [
  'eleven_v3',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_flash_v2',
] as const;

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
  return value === 'elevenlabs' || value === 'google';
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

function formatPublishTtsStrategyLabel(strategy: UiPublishTtsStrategy): string {
  if (strategy === 'auto') return 'Auto from draft';
  if (strategy === 'dialogue') return 'Dialogue';
  return 'TTS';
}

function writeJobIdToQuery(jobId: string | null): void {
  if (globalThis.window === undefined) return;
  const nextUrl = new URL(globalThis.location.href);
  if (jobId) {
    nextUrl.searchParams.set('jobId', jobId);
  } else {
    nextUrl.searchParams.delete('jobId');
  }
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

export const MinimalAssignment: React.FC = () => {
  const [promptOptions, setPromptOptions] = useState<PromptOptionsResponse | null>(null);
  const [teacherNotes, setTeacherNotes] = useState('');
  const [jobStatus, setJobStatusState] = useState<JobStatus | null>(null);
  const [jobOptions, setJobOptions] = useState<JobOptionsResponse | null>(null);
  const [jobOptionsError, setJobOptionsError] = useState<string | null>(null);
  const [showAllResumeJobs, setShowAllResumeJobs] = useState(false);
  const [startStageMode, setStartStageMode] = useState<StartStageMode>('idle');

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
  const guidedStageIdsRef = useRef<Set<WorkflowStageId>>(new Set());
  const hasInitializedGuidedFlowRef = useRef(false);

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
    const elevenlabsDefault =
      (jobOptions?.defaultTtsModelByProvider?.elevenlabs ?? '').trim() || FALLBACK_ELEVENLABS_MODEL;
    const elevenlabsOptions = [
      ...new Set([...elevenlabsConfigured, elevenlabsDefault].filter(Boolean)),
    ];
    const googleOptions = [
      ...new Set(googleConfigured.length > 0 ? googleConfigured : [...FALLBACK_GOOGLE_TTS_MODELS]),
    ];

    return {
      elevenlabs: elevenlabsOptions.length > 0 ? elevenlabsOptions : [FALLBACK_ELEVENLABS_MODEL],
      google: googleOptions.length > 0 ? googleOptions : [...FALLBACK_GOOGLE_TTS_MODELS],
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
  const googleTtsModelOptions = useMemo(
    () => ttsModelOptionsByProvider.google ?? [...FALLBACK_GOOGLE_TTS_MODELS],
    [ttsModelOptionsByProvider],
  );
  const defaultPronunciationChunkProvider = useMemo<UiPronunciationChunkTtsProvider>(
    () => getDefaultPronunciationChunkProviderForMode(rerunTargetPronunciationMode),
    [rerunTargetPronunciationMode],
  );

  const presetOptions = useMemo(() => buildSelectablePresetOptions(jobOptions), [jobOptions]);
  const presetOptionIds = useMemo(() => presetOptions.map((preset) => preset.id), [presetOptions]);
  const learningPresetCatalogEnabled = (jobOptions?.learningPresets?.length ?? 0) > 0;
  const selectedTemplateId = useMemo(() => {
    if (!promptOptions) return '';
    return promptOptions.defaults.templateId ?? promptOptions.templates?.[0]?.id ?? '';
  }, [promptOptions]);

  const resetJobShell = useCallback(() => {
    writeJobIdToQuery(null);
    setTeacherNotes('');
    setJobStatusState(null);
    setRerunTargetPronunciationMode(null);
  }, []);

  const source = useMinimalAssignmentSourceController({
    configuredSttProviders: jobOptions?.sttProviders,
    defaultSttProvider: isSttProvider(jobOptions?.defaultSttProvider)
      ? jobOptions.defaultSttProvider
      : null,
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

  const authoring = useMinimalAssignmentAuthoringController({
    recordingId: source.recording?.recordingId ?? null,
    transcriptStatus: source.transcriptStatus,
    teacherNotes,
    selectedProfileId: context.selectedProfileId,
    selectedTemplateId,
    currentJobId: jobStatus?.jobId ?? null,
    learningPresetCatalogEnabled,
    presetOptionIds,
    generationOptions,
    ttsProviders,
    ttsModelOptionsByProvider,
    elevenlabsModelOptions,
    elevenlabsStandardModelOptions,
    googleTtsModelOptions,
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

  const resetFlow = useCallback(() => {
    invalidateAuthoringGeneration();
    resetAuthoring();
    resetSourceFlow();
    resetJobShell();
  }, [invalidateAuthoringGeneration, resetAuthoring, resetJobShell, resetSourceFlow]);

  const handleStartNewAssignment = useCallback(() => {
    guidedStageIdsRef.current.clear();
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
      setRerunTargetPronunciationMode(snapshot.rerunTargetPronunciationMode);
      applyContextHydration({
        selectedProfileId: snapshot.selectedProfileId,
        profileSelectionMode: snapshot.profileSelectionMode,
      });
      applyAuthoringHydration(snapshot.authoring);
    },
    [applyAuthoringHydration, applyContextHydration, applySourceHydration],
  );

  const applyCurrentJobStatus = useCallback((job: JobStatus | null) => {
    setJobStatusState(job);
  }, []);

  const resume = useMinimalAssignmentResume({
    applyHydratedSnapshot,
    applyCurrentJobStatus,
    invalidateDraftGenerationRequests: invalidateAuthoringGeneration,
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

  const advancedActions = useAdvancedActionsController({
    jobStatus,
    jobOptions,
    selectedTtsProvider: authoring.selectedTtsProvider,
    ttsProviders,
    googleTtsModelOptions,
    elevenlabsStandardModelOptions,
    defaultPronunciationChunkProvider,
    applyJobStatusTransition: resume.applyJobStatusTransition,
    refreshResumeJobs: resume.loadResumeJobs,
  });
  const resumeLoadResumeJobs = resume.loadResumeJobs;
  const resumeSetPinnedJobExpanded = resume.setPinnedJobExpanded;
  const resumeSetSelectedResumeJobId = resume.setSelectedResumeJobId;

  const handleShowResumeChoice = useCallback(() => {
    setStartStageMode('resume');
  }, []);

  useEffect(() => {
    void loadPromptOptions();
    void loadJobOptions();
    void loadStudentOptions();
  }, [loadJobOptions, loadPromptOptions, loadStudentOptions]);

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
      resumeSetPinnedJobExpanded(false);
      if (jobStatus.state === 'failed' && jobStatus.error) {
        setAuthoringPublishError(describeJobFailureReason(jobStatus));
      }
    }
  }, [
    jobStatus,
    resumeSetPinnedJobExpanded,
    resumeSetSelectedResumeJobId,
    setAuthoringPublishError,
  ]);

  useEffect(() => {
    if (resume.resumeJobs.length <= 4 && showAllResumeJobs) {
      setShowAllResumeJobs(false);
    }
  }, [resume.resumeJobs.length, showAllResumeJobs]);

  const transcriptReady = source.transcriptReady;
  const jobReady = Boolean(jobStatus?.jobId);
  const hasAssignmentContent = authoring.draftText.trim().length > 0;
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
  const resumeJobItems = useMemo<ResumeJobListItem[]>(() => {
    const jobsToRender = showAllResumeJobs ? resume.resumeJobs : resume.resumeJobs.slice(0, 4);
    return buildResumeJobItems(jobsToRender, resume.selectedResumeJobId, studentNameById);
  }, [resume.resumeJobs, resume.selectedResumeJobId, showAllResumeJobs, studentNameById]);
  const canToggleResumeJobs = resume.resumeJobs.length > 4;
  const currentAssignmentCard = useMemo<CurrentAssignmentCard | null>(() => {
    return buildCurrentAssignmentCard(jobStatus, studentNameById);
  }, [jobStatus, studentNameById]);
  const publishUrl = jobStatus?.htmlUrl;
  const publishLabel = 'Open published HTML';
  const publishPending = 'HTML link pending...';
  const hasTeachingContext = Boolean(
    context.selectedProfileId || teacherNotes.trim() || authoring.promptReady,
  );
  const reviewReady =
    hasAssignmentContent &&
    (!authoring.draftPreviewGate.previewRequired || authoring.previewReadyForCurrentDraft);

  useEffect(() => {
    if (!hasStartedFlow || startStageMode !== 'idle') return;
    setStartStageMode('start');
  }, [hasStartedFlow, startStageMode]);

  const workflowStages = useMemo<WorkflowStage[]>(() => {
    const startStatus: WorkflowStageStatus = hasStartedFlow ? 'complete' : 'current';
    const sourceStatus: WorkflowStageStatus = !hasStartedFlow
      ? 'locked'
      : transcriptReady
        ? 'complete'
        : 'current';
    const contextStatus: WorkflowStageStatus = !transcriptReady
      ? 'locked'
      : authoring.promptReady
        ? 'complete'
        : 'current';
    const assignmentStatus: WorkflowStageStatus = !transcriptReady
      ? 'locked'
      : hasAssignmentContent
        ? 'complete'
        : authoring.promptReady
          ? 'current'
          : 'available';
    const reviewStatus: WorkflowStageStatus = jobReady
      ? 'complete'
      : hasAssignmentContent
        ? 'current'
        : 'locked';
    const advancedStatus: WorkflowStageStatus = jobReady
      ? advancedActions.showAdvancedActions
        ? 'current'
        : 'available'
      : 'locked';

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
          ? 'Transcript is ready for review and editing.'
          : source.recording
            ? 'Audio is uploaded. Finish the transcript before moving on.'
            : 'Choose a student and upload a recording.',
        status: sourceStatus,
      },
      {
        id: 'context',
        title: 'Add teaching context',
        description: authoring.promptReady
          ? 'Learner context has been applied to the instructions.'
          : transcriptReady
            ? hasTeachingContext
              ? 'Context is ready. Generate instructions when you are happy with it.'
              : 'Choose a learner profile or add lesson guidance for this lesson.'
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
              ? 'Generate instructions after you finish reviewing teaching context.'
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
        description: jobReady
          ? 'Republish, rerun audio, or inspect assignment lineage.'
          : 'Available after the assignment has been shared once.',
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
    advancedActions.showAdvancedActions,
    transcriptReady,
  ]);

  const actionableStageId =
    workflowStages.find((stage) => stage.status === 'current')?.id ??
    workflowStages.find((stage) => stage.status === 'available')?.id ??
    null;

  const currentStageTitle =
    workflowStages.find((stage) => stage.status === 'current')?.title ??
    workflowStages.find((stage) => stage.status === 'available')?.title ??
    workflowStages[workflowStages.length - 1]?.title ??
    'Assignment builder';

  useEffect(() => {
    if (!actionableStageId) return;
    if (!hasInitializedGuidedFlowRef.current) {
      hasInitializedGuidedFlowRef.current = true;
      guidedStageIdsRef.current.add(actionableStageId);
      return;
    }
    if (guidedStageIdsRef.current.has(actionableStageId)) {
      return;
    }

    guidedStageIdsRef.current.add(actionableStageId);

    const sectionTarget =
      actionableStageId === 'start'
        ? startSectionRef.current
        : actionableStageId === 'source'
          ? sourceSectionRef.current
          : actionableStageId === 'context'
            ? contextSectionRef.current
            : actionableStageId === 'assignment'
              ? assignmentSectionRef.current
              : actionableStageId === 'review'
                ? reviewSectionRef.current
                : advancedSectionRef.current;

    const focusTarget =
      actionableStageId === 'start'
        ? startHeadingRef.current
        : actionableStageId === 'source'
          ? (sourceStudentSelectRef.current ?? sourceHeadingRef.current)
          : actionableStageId === 'context'
            ? (contextProfileSelectRef.current ?? contextHeadingRef.current)
            : actionableStageId === 'assignment'
              ? (assignmentGenerateDraftButtonRef.current ?? assignmentHeadingRef.current)
              : actionableStageId === 'review'
                ? (reviewPreviewButtonRef.current ?? reviewHeadingRef.current)
                : advancedHeadingRef.current;

    sectionTarget?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const focusTimer = globalThis.window?.setTimeout(() => {
      focusTarget?.focus({ preventScroll: true });
    }, 0);

    return () => {
      if (focusTimer !== undefined) {
        globalThis.window?.clearTimeout(focusTimer);
      }
    };
  }, [actionableStageId]);

  const workflowSummaryItems = useMemo<WorkflowSummaryItem[]>(
    () => [
      {
        label: 'Student',
        value: source.selectedStudent?.name ?? 'No student yet',
        note: context.selectedProfileId
          ? `Profile: ${context.selectedProfileId}`
          : 'Select a student to unlock recording upload.',
      },
      {
        label: 'Transcript',
        value: transcriptReady ? 'Ready' : source.recording ? source.transcriptStatus : 'Waiting',
        note: transcriptReady ? 'You can still edit wording before moving on.' : undefined,
      },
      {
        label: 'Assignment',
        value: hasAssignmentContent
          ? 'Drafted'
          : authoring.promptReady
            ? 'Instructions ready'
            : 'Not started',
        note: authoring.draftDirty ? 'You have unsaved assignment edits.' : undefined,
      },
      {
        label: 'Share status',
        value: jobStatus?.state ?? 'Not shared yet',
        note: publishUrl ? publishLabel : 'Preview before publishing.',
      },
    ],
    [
      authoring.draftDirty,
      authoring.promptReady,
      hasAssignmentContent,
      jobStatus?.state,
      publishLabel,
      publishUrl,
      source.recording,
      source.selectedStudent?.name,
      context.selectedProfileId,
      transcriptReady,
      source.transcriptStatus,
    ],
  );
  const startStage = workflowStages[0] ?? workflowStages.at(-1)!;
  const sourceStage = workflowStages[1] ?? startStage;
  const contextStage = workflowStages[2] ?? sourceStage;
  const assignmentStage = workflowStages[3] ?? contextStage;
  const reviewStage = workflowStages[4] ?? assignmentStage;
  const advancedStage = workflowStages[5] ?? reviewStage;

  return (
    <div className="minimal-assignment">
      <WorkflowOverview
        currentStageTitle={currentStageTitle}
        stages={workflowStages}
        summaryItems={workflowSummaryItems}
      />

      <StartStageSection
        stage={startStage}
        sectionRef={startSectionRef}
        headingRef={startHeadingRef}
        mode={startStageMode}
        onStartNewAssignment={handleStartNewAssignment}
        onShowResumeChoice={handleShowResumeChoice}
        onRefreshRecentWork={() => void resume.loadResumeJobs()}
        onResumeSelectedAssignment={() => void resume.handleResumeSelectedJob()}
        resumeLoading={resume.resumeLoading}
        selectedResumeJobId={resume.selectedResumeJobId}
        onSelectedResumeJobIdChange={resume.setSelectedResumeJobId}
        resumeJobItems={resumeJobItems}
        totalResumeJobs={resume.resumeJobs.length}
        canToggleResumeJobs={canToggleResumeJobs}
        showAllResumeJobs={showAllResumeJobs}
        onToggleShowAllResumeJobs={() => setShowAllResumeJobs((current) => !current)}
        resumeError={resume.resumeError}
        currentJobStatus={jobStatus}
        currentAssignmentCard={currentAssignmentCard}
        publishUrl={publishUrl}
        publishLabel={publishLabel}
        publishPending={publishPending}
        pinnedJobExpanded={resume.pinnedJobExpanded}
        onTogglePinnedJobExpanded={() => resume.setPinnedJobExpanded((current) => !current)}
        onRegeneratePronunciationAudio={() =>
          void advancedActions.handleRegeneratePronunciationAudio()
        }
        onRepublishCurrentDraft={() => void advancedActions.handleRepublishCurrentDraft()}
        onCancelJob={() => void advancedActions.handleCancelJob()}
        rerunEnabled={advancedActions.rerunEnabled}
        cancelEnabled={advancedActions.cancelEnabled}
        actionBusy={advancedActions.actionBusy}
      />

      <SourceStageSection
        stage={sourceStage}
        sectionRef={sourceSectionRef}
        headingRef={sourceHeadingRef}
        studentSelectRef={sourceStudentSelectRef}
        onRefreshStudents={() => void loadStudentOptions()}
        studentOptions={source.studentOptions}
        studentOptionsError={source.studentOptionsError}
        selectedStudentId={source.selectedStudentId}
        onSelectedStudentIdChange={handleStudentSelectionChange}
        selectedStudent={source.selectedStudent}
        selectedSttProvider={source.selectedSttProvider}
        onSelectedSttProviderChange={handleSelectedSttProviderChange}
        sttProviders={source.sttProviders}
        formatSttProviderLabel={formatSttProviderLabel}
        audioExtensions={AUDIO_EXTENSIONS}
        uploading={source.uploading}
        selectedFileName={source.selectedFileName}
        uploadProgress={source.uploadProgress}
        onFiles={handleFiles}
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
        onTranscriptTextChange={setTranscriptText}
        transcriptDirty={source.transcriptDirty}
        transcriptSaving={source.transcriptSaving}
        onSaveTranscript={() => void handleSaveTranscript()}
      />

      <ContextStageSection
        stage={contextStage}
        sectionRef={contextSectionRef}
        headingRef={contextHeadingRef}
        studentId={source.selectedStudentId}
        selectedProfileId={context.selectedProfileId}
        profilePreview={context.profilePreview}
        profileRevisionError={context.profileRevisionError}
        teacherNotes={teacherNotes}
        onTeacherNotesChange={setTeacherNotes}
      />

      <AssignmentStageSection
        stage={assignmentStage}
        sectionRef={assignmentSectionRef}
        headingRef={assignmentHeadingRef}
        generateDraftButtonRef={assignmentGenerateDraftButtonRef}
        transcriptReady={transcriptReady}
        promptLoading={authoring.promptLoading}
        promptReady={authoring.promptReady}
        promptOptionsReady={Boolean(promptOptions)}
        onGeneratePrompt={() => void authoring.generatePrompt()}
        onCopyPrompt={authoring.copyPrompt}
        promptCopyState={authoring.promptCopyState}
        onReloadPromptOptions={() => void loadPromptOptions()}
        promptError={authoring.promptError}
        promptPackage={authoring.promptPackage}
        promptText={authoring.promptText}
        onPromptTextChange={authoring.setPromptText}
        onSaveDraft={() => void authoring.saveDraft()}
        validating={authoring.validating}
        draftDirty={authoring.draftDirty}
        generationOptionsAvailable={Boolean(generationOptions)}
        selectedGenerationProvider={authoring.selectedGenerationProvider}
        onSelectedGenerationProviderChange={authoring.setSelectedGenerationProvider}
        generationProviders={authoring.generationProviders}
        selectedGenerationModel={authoring.selectedGenerationModel}
        onSelectedGenerationModelChange={authoring.setSelectedGenerationModel}
        generationModelsForProvider={authoring.generationModelsForProvider}
        onGenerateDraft={() => void authoring.generateDraft()}
        generatingDraft={authoring.generatingDraft}
        generationBlockedByQuota={authoring.generationBlockedByQuota}
        activeGenerationQuota={authoring.activeGenerationQuota}
        generationQuotaSourceLabel={authoring.generationQuotaSourceLabel}
        generationQuotaUpdatedRelative={authoring.generationQuotaUpdatedRelative}
        generationQuotaUpdatedAbsolute={authoring.generationQuotaUpdatedAbsolute}
        generationQuotaHasNumericValues={authoring.generationQuotaHasNumericValues}
        generationQuotaBlockedReason={authoring.generationQuotaBlockedReason}
        generationError={authoring.generationError}
        generationSuccess={authoring.generationSuccess}
        draftText={authoring.draftText}
        onDraftTextChange={authoring.setDraftText}
        validation={authoring.validation}
        validationError={authoring.validationError}
        draftError={authoring.draftError}
      />

      <ReviewStageSection
        stage={reviewStage}
        sectionRef={reviewSectionRef}
        headingRef={reviewHeadingRef}
        previewButtonRef={reviewPreviewButtonRef}
        onPublish={() =>
          void authoring.publishAssignment({
            onPublishedJob: resume.applyJobStatusTransition,
            refreshResumeJobs: resume.loadResumeJobs,
          })
        }
        canPublishWithPreview={authoring.canPublishWithPreview}
        publishing={authoring.publishing}
        previewing={authoring.previewing}
        onPreviewDraft={() => void authoring.previewDraft()}
        draftHasContent={authoring.draftText.trim().length > 0}
        previewReadyForCurrentDraft={authoring.previewReadyForCurrentDraft}
        selectedPreset={authoring.selectedPreset}
        onSelectedPresetChange={authoring.setSelectedPreset}
        presetOptions={presetOptions}
        jobOptionsLoaded={Boolean(jobOptions)}
        selectedTtsProvider={authoring.selectedTtsProvider}
        onSelectedTtsProviderChange={authoring.setSelectedTtsProvider}
        ttsProviders={ttsProviders}
        selectedTtsStrategy={authoring.selectedTtsStrategy}
        onSelectedTtsStrategyChange={authoring.setSelectedTtsStrategy}
        availablePublishTtsStrategies={authoring.availablePublishTtsStrategies}
        formatPublishTtsStrategyLabel={formatPublishTtsStrategyLabel}
        selectedTtsModel={authoring.selectedTtsModel}
        onSelectedTtsModelChange={authoring.setSelectedTtsModel}
        publishModelSelectionDisabled={authoring.publishModelSelectionDisabled}
        selectedTtsModelOptions={authoring.selectedTtsModelOptions}
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

      <AdvancedActionsStage
        stage={advancedStage}
        sectionRef={advancedSectionRef}
        headingRef={advancedHeadingRef}
        jobReady={Boolean(jobReady)}
        jobStatus={jobStatus}
        controller={advancedActions}
        onRefreshActions={() => void loadJobOptions()}
        jobOptionsError={jobOptionsError}
        ttsProviders={ttsProviders}
        googleTtsModelOptions={googleTtsModelOptions}
        elevenlabsStandardModelOptions={elevenlabsStandardModelOptions}
        pronunciationChunkProviders={FALLBACK_PRONUNCIATION_CHUNK_TTS_PROVIDERS}
        studyTextStrategies={
          jobOptions?.ttsStrategies?.filter(isUiPublishTtsStrategy) ?? ['auto', 'dialogue', 'tts']
        }
      />
    </div>
  );
};
