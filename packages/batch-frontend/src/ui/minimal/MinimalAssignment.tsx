import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  DraftResponse,
  GenerateDraftRequest,
  GenerateDraftResponse,
  JobOptionsResponse,
  JobStatus,
  MarkdownValidationResponse,
  ProfileRevisionSummaryResponse,
  PromptOptionsResponse,
  PromptPackageResponse,
  RecordingListItem,
  RecordingStatus,
  RecordingTranscriptResponse,
  SttProvider,
  StudentOption,
} from '../../utils/api';
import {
  approveJob,
  createDraft,
  createPromptPackage,
  fetchJobOptions,
  fetchPromptOptions,
  fetchRecordingTranscript,
  fetchStudentOptions,
  GenerationDraftApiError,
  generateDraft,
  getJobStatus,
  getProfileContent,
  getRecording,
  listProfileContents,
  listProfileRevisions,
  materializeDraft,
  renderHtmlPreview,
  restoreProfileRevision,
  retryRecordingTranscription,
  updateDraft,
  updateRecordingTranscript,
  uploadRecording,
  upsertProfileContent,
  validateMarkdown,
} from '../../utils/api';
import { copyTextToClipboard } from '../../utils/clipboard';
import {
  buildPublishJobOverrides,
  getDraftPreviewGate,
  getNextGenerationQuotaSnapshot,
  hasActiveGenerationQuotaSelection,
} from './MinimalAssignment.logic';
import {
  AdvancedActionsStage,
  useAdvancedActionsController,
} from './MinimalAssignment.advanced';
import {
  getJobPollingDecision,
  getRecordingPollingDecision,
  isActivelyProcessingJobState,
  isTerminalJobState,
} from './MinimalAssignment.polling';
import { getGenerationQuotaWindowDecision } from './MinimalAssignment.quota-window';
import {
  type HydratedAssignmentSnapshot,
  useMinimalAssignmentResume,
} from './MinimalAssignment.resume';
import {
  AssignmentStageSection,
  ContextStageSection,
  ReviewStageSection,
  SourceStageSection,
  StartStageSection,
  WorkflowOverview,
  type WorkflowStage,
  type WorkflowStageStatus,
  type WorkflowSummaryItem,
} from './MinimalAssignment.stages';
import './MinimalAssignment.css';

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus'];
const POLL_INTERVAL_MS = 3000;
const FALLBACK_STT_PROVIDERS: SttProvider[] = ['deepgram', 'elevenlabs', 'google'];
const FALLBACK_TTS_PROVIDERS = ['elevenlabs', 'google'] as const;
const FALLBACK_PRONUNCIATION_CHUNK_TTS_PROVIDERS = ['edge-tts', 'elevenlabs', 'google'] as const;
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

function isDefaultStudentName(name: string): boolean {
  return name.trim().toLowerCase() === 'default';
}

function sortStudentsForPicker(students: StudentOption[]): StudentOption[] {
  return [...students].sort((left, right) => {
    const leftIsDefault = isDefaultStudentName(left.name);
    const rightIsDefault = isDefaultStudentName(right.name);

    if (leftIsDefault !== rightIsDefault) {
      return leftIsDefault ? -1 : 1;
    }

    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;

    return left.id.localeCompare(right.id);
  });
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
  const normalized = reason.toLowerCase();
  if (job.publishTarget === 'anytype' && normalized.includes('fetch failed')) {
    return 'Anytype server unreachable. Start Anytype Desktop app and retry publish.';
  }
  return reason;
}

function normalizePresetSelection(
  availablePresets: string[] | undefined,
  requestedPreset: string | null | undefined,
  currentPreset: string,
): string {
  if (availablePresets === undefined) {
    return requestedPreset ?? currentPreset;
  }
  if (availablePresets.length === 0) {
    return '';
  }
  if (requestedPreset && availablePresets.includes(requestedPreset)) {
    return requestedPreset;
  }
  if (currentPreset && availablePresets.includes(currentPreset)) {
    return currentPreset;
  }
  return availablePresets[0] ?? '';
}

function toGenerationQuotaSourceLabel(source: GenerateDraftResponse['quota']['source']): string {
  if (source === 'configured') return 'Configured';
  if (source === 'provider') return 'Provider';
  return 'Hybrid';
}

function formatRelativeTimestamp(timestamp: string, nowMs: number = Date.now()): string {
  const parsedMs = Date.parse(timestamp);
  if (Number.isNaN(parsedMs)) {
    return 'unknown';
  }
  const deltaMs = nowMs - parsedMs;
  if (deltaMs <= 60_000) {
    return 'just now';
  }
  if (deltaMs < 3_600_000) {
    return `${Math.floor(deltaMs / 60_000)}m ago`;
  }
  if (deltaMs < 86_400_000) {
    return `${Math.floor(deltaMs / 3_600_000)}h ago`;
  }
  return `${Math.floor(deltaMs / 86_400_000)}d ago`;
}

function formatAbsoluteTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  return parsed.toLocaleString();
}

function detectPronunciationModeFromDraft(text: string): PronunciationMode | null {
  const match = text.match(/\*\*Mode:\*\*\s*([a-z_]+)/i);
  if (!match) return null;
  const mode = match[1]?.trim().toLowerCase();
  return mode === 'shadow_sentence' ||
    mode === 'connected_speech' ||
    mode === 'intonation' ||
    mode === 'rhythm_chunking' ||
    mode === 'sentence_stress' ||
    mode === 'minimal_pair'
    ? mode
    : null;
}

function getDefaultPronunciationChunkProviderForMode(
  mode: PronunciationMode | null,
): UiPronunciationChunkTtsProvider {
  return mode === 'connected_speech' ? 'elevenlabs' : 'edge-tts';
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
  const [recording, setRecording] = useState<RecordingListItem | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedSttProvider, setSelectedSttProvider] = useState<SttProvider>('deepgram');
  const uploadAbortRef = useRef<AbortController | null>(null);
  const sttProviderUserChangedRef = useRef(false);
  const generationRequestVersionRef = useRef(0);

  const [transcript, setTranscript] = useState<RecordingTranscriptResponse | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptStatus, setTranscriptStatus] = useState<
    'idle' | 'loading' | 'processing' | 'ready' | 'failed'
  >('idle');
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [retryingTranscript, setRetryingTranscript] = useState(false);

  const [promptOptions, setPromptOptions] = useState<PromptOptionsResponse | null>(null);
  const [promptPackage, setPromptPackage] = useState<PromptPackageResponse | null>(null);
  const [teacherNotes, setTeacherNotes] = useState('');
  const [promptText, setPromptText] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptCopyState, setPromptCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const [draftText, setDraftText] = useState('');
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState<string | null>(null);
  const [selectedGenerationProvider, setSelectedGenerationProvider] = useState('');
  const [selectedGenerationModel, setSelectedGenerationModel] = useState('');
  const [generationRuntimeQuotaSnapshot, setGenerationRuntimeQuotaSnapshot] = useState<
    GenerateDraftResponse['quota'] | null
  >(null);
  const [generationRuntimeSelection, setGenerationRuntimeSelection] = useState<{
    provider: string;
    model: string;
  } | null>(null);
  const [quotaWindowTickMs, setQuotaWindowTickMs] = useState(() => Date.now());

  const [validation, setValidation] = useState<MarkdownValidationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [jobStatus, setJobStatusState] = useState<JobStatus | null>(null);
  const [publishTarget, setPublishTarget] = useState<'notion' | 'anytype' | 'html'>('html');
  const [selectedTtsProvider, setSelectedTtsProvider] = useState<UiTtsProvider>('elevenlabs');
  const [selectedTtsStrategy, setSelectedTtsStrategy] = useState<UiPublishTtsStrategy>('auto');
  const [selectedTtsModel, setSelectedTtsModel] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [jobOptions, setJobOptions] = useState<JobOptionsResponse | null>(null);
  const [jobOptionsError, setJobOptionsError] = useState<string | null>(null);
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentOptionsError, setStudentOptionsError] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [uploadCacheNotice, setUploadCacheNotice] = useState<string | null>(null);

  const [profileOptions, setProfileOptions] = useState<{ id: string; label: string }[]>([]);
  const [profileOptionsError, setProfileOptionsError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileSelectionMode, setProfileSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [newProfileId, setNewProfileId] = useState('');
  const [profileEditorText, setProfileEditorText] = useState('');
  const [loadedProfileContent, setLoadedProfileContent] = useState('');
  const [profileRevisions, setProfileRevisions] = useState<ProfileRevisionSummaryResponse[]>([]);
  const [profileRevisionError, setProfileRevisionError] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState<
    'loading' | 'saving' | 'creating' | 'restoring' | null
  >(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  const [rerunTargetPronunciationMode, setRerunTargetPronunciationMode] =
    useState<PronunciationMode | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [lastPreviewedDraftHash, setLastPreviewedDraftHash] = useState<string | null>(null);

  const generationOptions = jobOptions?.generation ?? null;
  const generationProviders = useMemo(
    () => generationOptions?.providers ?? [],
    [generationOptions],
  );
  const generationModelOptions = useMemo(
    () => generationOptions?.modelOptions ?? [],
    [generationOptions],
  );
  const generationModelsForProvider = useMemo(
    () => generationModelOptions.filter((option) => option.provider === selectedGenerationProvider),
    [generationModelOptions, selectedGenerationProvider],
  );
  const sttProviders = useMemo<SttProvider[]>(() => {
    const providers = (jobOptions?.sttProviders ?? [])
      .map((provider) => (isSttProvider(provider) ? provider : null))
      .filter((provider): provider is SttProvider => provider !== null);
    if (providers.length > 0) {
      return [...new Set(providers)];
    }
    return [...FALLBACK_STT_PROVIDERS];
  }, [jobOptions?.sttProviders]);
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
  const publishElevenlabsModelOptions = useMemo(() => {
    if (selectedTtsStrategy === 'dialogue') {
      return elevenlabsModelOptions.includes('eleven_v3')
        ? ['eleven_v3']
        : (['eleven_v3'] as const);
    }
    if (selectedTtsStrategy === 'tts') {
      return elevenlabsStandardModelOptions.length > 0
        ? elevenlabsStandardModelOptions
        : [FALLBACK_ELEVENLABS_MODEL];
    }
    return [] as readonly string[];
  }, [elevenlabsModelOptions, elevenlabsStandardModelOptions, selectedTtsStrategy]);
  const selectedTtsModelOptions = useMemo(
    () =>
      selectedTtsProvider === 'google' ? googleTtsModelOptions : [...publishElevenlabsModelOptions],
    [googleTtsModelOptions, publishElevenlabsModelOptions, selectedTtsProvider],
  );
  const availablePublishTtsStrategies = useMemo<UiPublishTtsStrategy[]>(() => {
    if (!jobOptions) {
      return selectedTtsStrategy === 'auto' ? ['auto'] : [selectedTtsStrategy, 'auto'];
    }
    const configured = (jobOptions?.ttsStrategies ?? []).filter(isUiPublishTtsStrategy);
    return configured.length > 0 ? configured : ['auto'];
  }, [jobOptions, selectedTtsStrategy]);
  const publishModelSelectionDisabled =
    selectedTtsProvider === 'elevenlabs' && selectedTtsStrategy === 'auto';
  const defaultPronunciationChunkProvider = useMemo<UiPronunciationChunkTtsProvider>(
    () => getDefaultPronunciationChunkProviderForMode(rerunTargetPronunciationMode),
    [rerunTargetPronunciationMode],
  );

  const presetOptions = useMemo(() => buildSelectablePresetOptions(jobOptions), [jobOptions]);
  const presetOptionIds = useMemo(() => presetOptions.map((preset) => preset.id), [presetOptions]);
  const learningPresetCatalogEnabled = (jobOptions?.learningPresets?.length ?? 0) > 0;

  const invalidateDraftGenerationRequests = useCallback(() => {
    generationRequestVersionRef.current += 1;
    setGeneratingDraft(false);
  }, []);

  const resetFlow = useCallback(() => {
    invalidateDraftGenerationRequests();
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    sttProviderUserChangedRef.current = false;
    writeJobIdToQuery(null);
    setRecording(null);
    setRecordingStatus(null);
    setRecordingError(null);
    setTranscript(null);
    setTranscriptText('');
    setTranscriptStatus('idle');
    setTranscriptError(null);
    setTranscriptSaving(false);
    setRetryingTranscript(false);
    setPromptPackage(null);
    setTeacherNotes('');
    setPromptText('');
    setPromptError(null);
    setPromptCopyState('idle');
    setDraft(null);
    setDraftText('');
    setDraftError(null);
    setGeneratingDraft(false);
    setGenerationError(null);
    setGenerationSuccess(null);
    setSelectedGenerationProvider('');
    setSelectedGenerationModel('');
    setGenerationRuntimeQuotaSnapshot(null);
    setGenerationRuntimeSelection(null);
    setQuotaWindowTickMs(Date.now());
    setValidation(null);
    setValidationError(null);
    setValidating(false);
    setPublishing(false);
    setPublishError(null);
    setSelectedTtsProvider('elevenlabs');
    setSelectedTtsStrategy('auto');
    setSelectedTtsModel('');
    setJobStatusState(null);
    setRerunTargetPronunciationMode(null);
    setSelectedFileName(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploading(false);
    setUploadCacheNotice(null);
    setPreviewHtml(null);
    setPreviewError(null);
    setPreviewing(false);
    setLastPreviewedDraftHash(null);
  }, [invalidateDraftGenerationRequests]);

  const loadPromptOptions = useCallback(async () => {
    try {
      const response = await fetchPromptOptions();
      setPromptOptions(response);
      setPromptError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load prompt options.';
      setPromptError(message);
    }
  }, []);

  const loadJobOptions = useCallback(async () => {
    try {
      const response = await fetchJobOptions();
      const nextPresetOptionIds = buildSelectablePresetOptions(response).map((preset) => preset.id);
      setJobOptions(response);
      setSelectedPreset((current) =>
        normalizePresetSelection(nextPresetOptionIds, undefined, current),
      );
      setJobOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load job options.';
      setJobOptionsError(message);
    }
  }, []);

  const loadStudentOptions = useCallback(async () => {
    try {
      const response = await fetchStudentOptions();
      const sortedStudents = sortStudentsForPicker(response.students ?? []);
      setStudentOptions(sortedStudents);
      setSelectedStudentId((current) => {
        if (current) return current;
        return sortedStudents.find((student) => isDefaultStudentName(student.name))?.id ?? '';
      });
      setStudentOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load students.';
      setStudentOptionsError(message);
    }
  }, []);

  const resolveBoundProfileId = useCallback(
    (studentId: string): string =>
      studentOptions.find((student) => student.id === studentId)?.profileId ?? '',
    [studentOptions],
  );

  const loadProfileOptions = useCallback(async () => {
    try {
      const response = await listProfileContents();
      setProfileOptions(response.profiles ?? []);
      setProfileOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load profiles.';
      setProfileOptionsError(message);
    }
  }, []);

  const applyHydratedSnapshot = useCallback((snapshot: HydratedAssignmentSnapshot) => {
    setJobStatusState(snapshot.jobStatus);
    setPublishTarget(snapshot.publishTarget);
    setSelectedTtsProvider(snapshot.selectedTtsProvider);
    setSelectedTtsStrategy(snapshot.selectedTtsStrategy);
    setSelectedTtsModel(snapshot.selectedTtsModel);
    setSelectedPreset(snapshot.selectedPreset);
    setRecording(snapshot.recording);
    setRecordingStatus(snapshot.recordingStatus);
    setRecordingError(snapshot.recordingError);
    setSelectedFileName(snapshot.selectedFileName);
    setTranscript(snapshot.transcript);
    setTranscriptText(snapshot.transcriptText);
    setTranscriptStatus(snapshot.transcriptStatus);
    setTranscriptError(snapshot.transcriptError);
    setPromptPackage(snapshot.promptPackage);
    setTeacherNotes(snapshot.teacherNotes);
    setPromptText(snapshot.promptText);
    setPromptError(snapshot.promptError);
    setDraft(snapshot.draft);
    setDraftText(snapshot.draftText);
    setDraftError(snapshot.draftError);
    setRerunTargetPronunciationMode(snapshot.rerunTargetPronunciationMode);
    setPublishError(snapshot.publishError);
    setSelectedStudentId(snapshot.selectedStudentId);
    setSelectedProfileId(snapshot.selectedProfileId);
    setProfileSelectionMode(snapshot.profileSelectionMode);
    setUploadError(snapshot.uploadError);
    setUploadCacheNotice(snapshot.uploadCacheNotice);
    setPreviewHtml(snapshot.previewHtml);
    setPreviewError(snapshot.previewError);
    setLastPreviewedDraftHash(snapshot.lastPreviewedDraftHash);
    setValidation(snapshot.validation);
    setValidationError(snapshot.validationError);
  }, []);

  const applyCurrentJobStatus = useCallback((job: JobStatus | null) => {
    setJobStatusState(job);
  }, []);

  const resume = useMinimalAssignmentResume({
    applyHydratedSnapshot,
    applyCurrentJobStatus,
    invalidateDraftGenerationRequests,
    jobOptions,
    presetOptionIds,
    resolveBoundProfileId,
    currentPublishTarget: publishTarget,
    currentSelectedTtsProvider: selectedTtsProvider,
    currentSelectedTtsStrategy: selectedTtsStrategy,
    currentSelectedTtsModel: selectedTtsModel,
    currentSelectedPreset: selectedPreset,
    currentSelectedStudentId: selectedStudentId,
    currentSelectedProfileId: selectedProfileId,
    currentProfileSelectionMode: profileSelectionMode,
  });

  const advancedActions = useAdvancedActionsController({
    jobStatus,
    jobOptions,
    selectedTtsProvider,
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

  useEffect(() => {
    void loadPromptOptions();
    void loadJobOptions();
    void loadStudentOptions();
    void loadProfileOptions();
  }, [loadJobOptions, loadProfileOptions, loadPromptOptions, loadStudentOptions]);

  const loadSelectedProfile = useCallback(async () => {
    if (!selectedProfileId) {
      setProfileEditorText('');
      setLoadedProfileContent('');
      setProfileRevisions([]);
      setProfileRevisionError(null);
      return;
    }

    setProfileBusy('loading');
    setProfileRevisionError(null);
    try {
      const [profile, revisions] = await Promise.all([
        getProfileContent(selectedProfileId),
        listProfileRevisions(selectedProfileId, { limit: 20, offset: 0, order: 'desc' }),
      ]);
      setProfileEditorText(profile.content ?? '');
      setLoadedProfileContent(profile.content ?? '');
      setProfileRevisions(revisions.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load selected profile.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    void loadSelectedProfile();
  }, [loadSelectedProfile]);

  useEffect(() => {
    if (!jobOptions) {
      return;
    }
    setSelectedPreset((current) => normalizePresetSelection(presetOptionIds, undefined, current));
  }, [jobOptions, presetOptionIds, selectedPreset]);

  useEffect(() => {
    if (sttProviders.length === 0) return;
    const configuredDefault = jobOptions?.defaultSttProvider;
    const preferredProvider =
      configuredDefault && sttProviders.includes(configuredDefault)
        ? configuredDefault
        : sttProviders[0];
    if (!preferredProvider) return;
    if (
      configuredDefault &&
      sttProviders.includes(configuredDefault) &&
      !sttProviderUserChangedRef.current &&
      selectedSttProvider !== configuredDefault
    ) {
      setSelectedSttProvider(configuredDefault);
      return;
    }

    if (!sttProviders.includes(selectedSttProvider)) {
      setSelectedSttProvider(preferredProvider);
    }
  }, [jobOptions?.defaultSttProvider, selectedSttProvider, sttProviders]);

  useEffect(() => {
    if (ttsProviders.length === 0) return;
    const configuredDefault = jobOptions?.defaultTtsProvider;
    const preferredProvider =
      configuredDefault && ttsProviders.includes(configuredDefault)
        ? configuredDefault
        : ttsProviders[0];
    if (!preferredProvider) return;
    if (!ttsProviders.includes(selectedTtsProvider)) {
      setSelectedTtsProvider(preferredProvider);
    }
  }, [jobOptions?.defaultTtsProvider, selectedTtsProvider, ttsProviders]);

  useEffect(() => {
    if (!jobOptions) return;
    const fallbackStrategy = availablePublishTtsStrategies[0];
    if (!fallbackStrategy) return;
    if (!availablePublishTtsStrategies.includes(selectedTtsStrategy)) {
      setSelectedTtsStrategy(fallbackStrategy);
    }
  }, [availablePublishTtsStrategies, jobOptions, selectedTtsStrategy]);

  useEffect(() => {
    const modelOptions = ttsModelOptionsByProvider[selectedTtsProvider] ?? [];
    if (selectedTtsProvider === 'google') {
      if (modelOptions.length === 0) {
        if (selectedTtsModel) setSelectedTtsModel('');
        return;
      }
      const configuredDefault = jobOptions?.defaultTtsModelByProvider?.google;
      const preferredModel =
        configuredDefault && modelOptions.includes(configuredDefault)
          ? configuredDefault
          : modelOptions[0];
      if (!preferredModel) return;
      if (!selectedTtsModel || !modelOptions.includes(selectedTtsModel)) {
        setSelectedTtsModel(preferredModel);
      }
      return;
    }

    if (selectedTtsStrategy === 'auto') {
      if (selectedTtsModel) {
        setSelectedTtsModel('');
      }
      return;
    }

    if (selectedTtsStrategy === 'dialogue') {
      if (selectedTtsModel !== 'eleven_v3') {
        setSelectedTtsModel('eleven_v3');
      }
      return;
    }

    if (publishElevenlabsModelOptions.length === 0) {
      if (selectedTtsModel) {
        setSelectedTtsModel('');
      }
      return;
    }

    const configuredDefault = jobOptions?.defaultTtsModelByProvider?.elevenlabs;
    const preferredModel =
      configuredDefault &&
      configuredDefault !== 'eleven_v3' &&
      publishElevenlabsModelOptions.includes(configuredDefault)
        ? configuredDefault
        : (publishElevenlabsModelOptions.find((model) => model === FALLBACK_ELEVENLABS_MODEL) ??
          publishElevenlabsModelOptions[0]);
    if (!preferredModel) return;
    if (
      !selectedTtsModel ||
      !publishElevenlabsModelOptions.includes(selectedTtsModel) ||
      selectedTtsModel === 'eleven_v3'
    ) {
      setSelectedTtsModel(preferredModel);
    }
  }, [
    jobOptions?.defaultTtsModelByProvider,
    publishElevenlabsModelOptions,
    selectedTtsModel,
    selectedTtsProvider,
    selectedTtsStrategy,
    ttsModelOptionsByProvider,
  ]);

  useEffect(() => {
    if (generationProviders.length === 0) {
      if (selectedGenerationProvider) {
        setSelectedGenerationProvider('');
      }
      return;
    }
    const configuredDefault = generationOptions?.defaultProvider;
    const fallbackProvider =
      (configuredDefault && generationProviders.includes(configuredDefault)
        ? configuredDefault
        : generationProviders[0]) ?? '';
    const hasSelectedProvider = generationProviders.includes(
      selectedGenerationProvider as (typeof generationProviders)[number],
    );
    if (!selectedGenerationProvider || !hasSelectedProvider) {
      setSelectedGenerationProvider(fallbackProvider);
    }
  }, [generationOptions?.defaultProvider, generationProviders, selectedGenerationProvider]);

  useEffect(() => {
    if (!selectedGenerationProvider || generationModelsForProvider.length === 0) {
      if (selectedGenerationModel) {
        setSelectedGenerationModel('');
      }
      return;
    }
    const modelIds = generationModelsForProvider.map((option) => option.id);
    const configuredDefaultModel =
      generationOptions?.defaultModelByProvider?.[
        selectedGenerationProvider as keyof NonNullable<
          typeof generationOptions
        >['defaultModelByProvider']
      ];
    const defaultSelectedModel = generationModelsForProvider.find(
      (option) => option.defaultSelected,
    )?.id;
    const fallbackModel =
      (configuredDefaultModel && modelIds.includes(configuredDefaultModel)
        ? configuredDefaultModel
        : defaultSelectedModel && modelIds.includes(defaultSelectedModel)
          ? defaultSelectedModel
          : modelIds[0]) ?? '';

    if (!selectedGenerationModel || !modelIds.includes(selectedGenerationModel)) {
      setSelectedGenerationModel(fallbackModel);
    }
  }, [
    generationModelsForProvider,
    generationOptions?.defaultModelByProvider,
    selectedGenerationModel,
    selectedGenerationProvider,
  ]);

  useEffect(() => {
    if (profileSelectionMode !== 'auto') {
      return;
    }
    if (!selectedStudentId) {
      setSelectedProfileId('');
      return;
    }
    const boundProfileId = resolveBoundProfileId(selectedStudentId);
    setSelectedProfileId((current) => (current === boundProfileId ? current : boundProfileId));
  }, [profileSelectionMode, resolveBoundProfileId, selectedStudentId]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (uploading) return;
      resetFlow();
      setSelectedFileName(file.name);
      setUploading(true);
      setUploadError(null);
      setUploadProgress(0);

      const controller = new AbortController();
      uploadAbortRef.current = controller;
      try {
        const response = await uploadRecording(file, {
          studentId: selectedStudentId || undefined,
          sttProvider: selectedSttProvider,
          signal: controller.signal,
          onProgress: (progress) => setUploadProgress(progress),
        });
        setRecording(response);
        setRecordingStatus(response.status);
        setRecordingError(response.error ?? null);
        setSelectedFileName(response.displayName || file.name);
        setUploadCacheNotice(
          response.cacheHit ? 'Reused an existing transcript for this exact audio file.' : null,
        );
      } catch (error) {
        if (controller.signal.aborted) {
          setUploadError('Upload canceled.');
        } else {
          const message = error instanceof Error ? error.message : 'Unable to upload recording.';
          setUploadError(message);
        }
      } finally {
        setUploading(false);
        uploadAbortRef.current = null;
      }
    },
    [resetFlow, selectedStudentId, selectedSttProvider, uploading],
  );

  const handleFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    void handleUpload(file);
  };

  const handleCancelUpload = () => {
    if (!uploadAbortRef.current) return;
    uploadAbortRef.current.abort();
  };

  const loadTranscript = useCallback(async () => {
    if (!recording?.recordingId) return;
    setTranscriptStatus('loading');
    setTranscriptError(null);

    try {
      const response = await fetchRecordingTranscript(recording.recordingId);
      setTranscript(response);
      setTranscriptText(response.text ?? '');
      setTranscriptStatus('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load transcript.';
      if (recordingStatus && recordingStatus !== 'transcribed') {
        setTranscriptStatus('processing');
        setTranscriptError(null);
      } else {
        setTranscriptStatus('failed');
        setTranscriptError(message);
      }
    }
  }, [recording?.recordingId, recordingStatus]);

  useEffect(() => {
    if (!recording?.recordingId) return;
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const pollRecording = async () => {
      try {
        const updated = await getRecording(recording.recordingId);
        if (!active) return;
        setRecording(updated);
        setRecordingStatus(updated.status);
        setRecordingError(updated.error ?? null);
        const decision = getRecordingPollingDecision({
          status: updated.status,
          error: updated.error,
          hasTranscriptId: Boolean(transcript?.transcriptId),
        });
        if (decision.shouldLoadTranscript) {
          void loadTranscript();
        }
        if (decision.shouldMarkTranscriptFailed) {
          setTranscriptStatus('failed');
          setTranscriptError(decision.transcriptFailureMessage);
        }
        if (!decision.shouldContinuePolling) {
          if (interval) clearInterval(interval);
          interval = null;
        }
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : 'Unable to refresh recording status.';
        setRecordingError(message);
      }
    };

    void pollRecording();
    interval = setInterval(pollRecording, POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [recording?.recordingId, loadTranscript, transcript?.transcriptId]);

  useEffect(() => {
    if (transcriptText.trim()) {
      setTranscriptStatus('ready');
      setTranscriptError(null);
    }
  }, [transcriptText]);

  const transcriptDirty = useMemo(() => {
    const original = transcript?.text ?? '';
    return transcriptText.trim() !== original.trim();
  }, [transcript?.text, transcriptText]);

  const handleSaveTranscript = async () => {
    if (!recording?.recordingId) return;
    setTranscriptSaving(true);
    setTranscriptError(null);
    try {
      const response = await updateRecordingTranscript(
        recording.recordingId,
        transcriptText.trim(),
      );
      setTranscript(response);
      setTranscriptText(response.text ?? transcriptText.trim());
      setTranscriptStatus('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save transcript.';
      setTranscriptError(message);
    } finally {
      setTranscriptSaving(false);
    }
  };

  const handleRetryTranscription = async () => {
    if (!recording?.recordingId) return;
    setRetryingTranscript(true);
    setTranscriptError(null);
    try {
      const updated = await retryRecordingTranscription(recording.recordingId, {
        sttProvider: selectedSttProvider,
      });
      setRecording(updated);
      setRecordingStatus(updated.status);
      setRecordingError(updated.error ?? null);
      setTranscriptStatus('processing');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to retry transcription.';
      setTranscriptError(message);
    } finally {
      setRetryingTranscript(false);
    }
  };

  const selectedTemplateId = useMemo(() => {
    if (!promptOptions) return '';
    return promptOptions.defaults.templateId ?? promptOptions.templates?.[0]?.id ?? '';
  }, [promptOptions]);

  const selectedStudent = useMemo(
    () => studentOptions.find((student) => student.id === selectedStudentId) ?? null,
    [studentOptions, selectedStudentId],
  );

  const handleStudentSelectionChange = useCallback(
    (nextStudentId: string) => {
      setProfileSelectionMode('auto');
      setSelectedStudentId(nextStudentId);
      if (!nextStudentId) {
        setSelectedProfileId('');
        return;
      }
      setSelectedProfileId(resolveBoundProfileId(nextStudentId));
    },
    [resolveBoundProfileId],
  );

  const profileDirty = useMemo(
    () => profileEditorText.trim() !== loadedProfileContent.trim(),
    [loadedProfileContent, profileEditorText],
  );

  const handleCreateProfile = async () => {
    const candidate = newProfileId.trim();
    if (!candidate) {
      setProfileRevisionError('Profile ID is required (for example: profiles/new-student.md).');
      return;
    }

    setProfileBusy('creating');
    setProfileRevisionError(null);
    setProfileSuccess(null);
    try {
      const created = await upsertProfileContent(candidate, profileEditorText);
      await loadProfileOptions();
      setProfileSelectionMode('manual');
      setSelectedProfileId(created.id);
      setNewProfileId('');
      setProfileSuccess(`Created profile ${created.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create profile.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedProfileId) {
      setProfileRevisionError('Select a profile to save.');
      return;
    }

    setProfileBusy('saving');
    setProfileRevisionError(null);
    setProfileSuccess(null);
    try {
      const saved = await upsertProfileContent(selectedProfileId, profileEditorText);
      setLoadedProfileContent(saved.content);
      const revisions = await listProfileRevisions(saved.id, {
        limit: 20,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess(`Saved ${saved.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save profile.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!selectedProfileId || !revisionId) return;

    setProfileBusy('restoring');
    setProfileRevisionError(null);
    setProfileSuccess(null);
    try {
      const restored = await restoreProfileRevision(selectedProfileId, revisionId);
      setProfileEditorText(restored.content);
      setLoadedProfileContent(restored.content);
      const revisions = await listProfileRevisions(restored.id, {
        limit: 20,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile restored from revision.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to restore profile revision.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleGeneratePrompt = async () => {
    if (!recording?.recordingId) {
      setPromptError('Upload a recording first.');
      return;
    }
    if (!selectedTemplateId) {
      setPromptError('Prompt template defaults are missing. Check prompt templates in settings.');
      return;
    }
    if (transcriptStatus !== 'ready') {
      setPromptError('Transcript is not ready yet.');
      return;
    }

    invalidateDraftGenerationRequests();
    setPromptLoading(true);
    setPromptError(null);
    setGenerationError(null);
    setGenerationSuccess(null);
    try {
      const normalizedTeacherNotes = teacherNotes.trim();
      const response = await createPromptPackage(recording.recordingId, {
        ...(normalizedTeacherNotes ? { notes: normalizedTeacherNotes } : {}),
        templateId: selectedTemplateId,
        profileId: selectedProfileId || undefined,
      });
      setPromptPackage(response);
      setTeacherNotes(response.notes ?? normalizedTeacherNotes);
      setPromptText(response.text ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to generate prompt.';
      setPromptError(message);
    } finally {
      setPromptLoading(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!promptText.trim()) return;
    const success = await copyTextToClipboard(promptText);
    setPromptCopyState(success ? 'copied' : 'error');
    setTimeout(() => setPromptCopyState('idle'), 2000);
  };

  const mapGenerationError = (error: unknown): string => {
    const candidate = error as { code?: unknown; requestId?: unknown; message?: unknown };
    const code = typeof candidate?.code === 'string' ? candidate.code : undefined;
    const requestId = typeof candidate?.requestId === 'string' ? candidate.requestId : undefined;
    const isMappedCategory =
      code === 'provider_rate_limit' ||
      code === 'provider_timeout' ||
      code === 'provider_contract_error' ||
      code === 'budget_exceeded';

    if (error instanceof GenerationDraftApiError || isMappedCategory) {
      const limitDetails =
        error instanceof GenerationDraftApiError && error.limitType
          ? ` Limit: ${error.used ?? '?'} / ${error.limit ?? '?'}` +
            (error.window ? ` (${error.window} window).` : '.')
          : '';
      const baseMessage =
        code === 'provider_rate_limit'
          ? 'Provider rate limit reached. Try again shortly or choose another model/provider.'
          : code === 'provider_timeout'
            ? 'Provider timed out. Retry or choose a faster model/provider.'
            : code === 'provider_contract_error'
              ? 'Provider request failed due to compatibility/contract error. Try another model/provider.'
              : code === 'budget_exceeded'
                ? `Generation blocked by safety budget policy.${limitDetails} Switch model/provider or wait for reset.`
                : error instanceof Error
                  ? error.message
                  : 'Unable to generate draft.';
      return requestId ? `${baseMessage} Request ID: ${requestId}` : baseMessage;
    }
    return error instanceof Error ? error.message : 'Unable to generate draft.';
  };

  const handleGenerateDraft = async (): Promise<GenerateDraftResponse | null> => {
    if (!promptPackage?.id) {
      setGenerationError('Generate a prompt package first.');
      setGenerationSuccess(null);
      return null;
    }
    if (generationOptions && !selectedGenerationProvider) {
      setGenerationError('Select a generation provider.');
      setGenerationSuccess(null);
      return null;
    }
    if (generationOptions && !selectedGenerationModel) {
      setGenerationError('Select a generation model.');
      setGenerationSuccess(null);
      return null;
    }

    setGeneratingDraft(true);
    setGenerationError(null);
    setGenerationSuccess(null);
    const requestVersion = generationRequestVersionRef.current + 1;
    generationRequestVersionRef.current = requestVersion;
    try {
      const generated = await generateDraft({
        promptPackageId: promptPackage.id,
        provider: (selectedGenerationProvider || undefined) as GenerateDraftRequest['provider'],
        model: selectedGenerationModel || undefined,
      });
      if (generationRequestVersionRef.current !== requestVersion) {
        return null;
      }
      setDraftText(generated.text ?? '');
      setDraft(null);
      setDraftError(null);
      setValidation(null);
      setValidationError(null);
      setPreviewHtml(null);
      setPreviewError(null);
      setLastPreviewedDraftHash(null);
      setGenerationRuntimeQuotaSnapshot((current) =>
        getNextGenerationQuotaSnapshot(current, { kind: 'success', quota: generated.quota }),
      );
      setGenerationRuntimeSelection({
        provider: generated.provider,
        model: generated.model,
      });
      setQuotaWindowTickMs(Date.now());
      setGenerationSuccess(
        `Generated with ${generated.provider}/${generated.model}. Review and save draft.`,
      );
      return generated;
    } catch (error) {
      if (generationRequestVersionRef.current !== requestVersion) {
        return null;
      }
      setGenerationError(mapGenerationError(error));
      return null;
    } finally {
      if (generationRequestVersionRef.current === requestVersion) {
        setGeneratingDraft(false);
      }
    }
  };

  const draftDirty = useMemo(() => {
    const original = draft?.text ?? '';
    return draftText.trim() !== original.trim();
  }, [draft?.text, draftText]);

  const runValidation = async () => {
    if (!draftText.trim()) {
      setValidation(null);
      setValidationError(null);
      return { ok: false } as MarkdownValidationResponse;
    }
    setValidating(true);
    setValidationError(null);
    try {
      const selectedValidationPreset =
        selectedPreset && presetOptionIds.includes(selectedPreset) ? selectedPreset : null;
      const response = await validateMarkdown(
        draftText.trim(),
        true,
        learningPresetCatalogEnabled ? { learningPresetId: selectedValidationPreset } : undefined,
      );
      setValidation(response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to validate markdown.';
      setValidationError(message);
      return { ok: false, errors: [message], warnings: [] } as MarkdownValidationResponse;
    } finally {
      setValidating(false);
    }
  };

  const handleSaveDraft = async (): Promise<DraftResponse | null> => {
    if (!promptPackage?.id) {
      setDraftError('Generate a prompt package first.');
      return null;
    }
    if (!draftText.trim()) {
      setDraftError('Paste the assignment draft text first.');
      return null;
    }

    const validationResult = await runValidation();
    if (validationResult.errors && validationResult.errors.length > 0) {
      setDraftError('Fix validation errors before saving.');
      return null;
    }

    setDraftError(null);
    try {
      const response = draft?.id
        ? await updateDraft(draft.id, draftText.trim())
        : await createDraft(promptPackage.id, draftText.trim());
      setDraft(response);
      setRerunTargetPronunciationMode(detectPronunciationModeFromDraft(response.text ?? draftText));
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save draft.';
      setDraftError(message);
      return null;
    }
  };

  const handlePublish = async () => {
    setPublishError(null);
    if (!draftPreviewGate.previewReady) {
      setPublishError('Preview current draft before publishing.');
      return;
    }
    setPublishing(true);

    try {
      let savedDraft = draft;
      if (!savedDraft || draftDirty) {
        savedDraft = await handleSaveDraft();
      }
      if (!savedDraft) {
        setPublishing(false);
        return;
      }

      const validPreset =
        selectedPreset && presetOptionIds.includes(selectedPreset) ? selectedPreset : '';
      const materialized = await materializeDraft(savedDraft.id, {
        ...(jobStatus?.jobId ? { jobId: jobStatus.jobId } : {}),
        jobOverrides: buildPublishJobOverrides({
          publishTarget,
          selectedTtsProvider,
          selectedTtsStrategy,
          selectedTtsModel,
          selectedPreset: validPreset,
          validPresetIds: presetOptionIds,
          learningPresetCatalogEnabled,
        }),
      });
      await approveJob(materialized.jobId, {
        md: materialized.mdPath,
        mdStorageUri: materialized.mdStorageUri,
      });
      const refreshed = await getJobStatus(materialized.jobId);
      resume.applyJobStatusTransition(refreshed);
      await resume.loadResumeJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to publish assignment.';
      setPublishError(message);
    } finally {
      setPublishing(false);
    }
  };

  const handlePreviewDraft = async () => {
    const normalizedDraft = draftText.trim();
    if (!normalizedDraft) {
      setPreviewError('Paste the assignment markdown first.');
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      const validationResult = await runValidation();
      if (validationResult.errors && validationResult.errors.length > 0) {
        setPreviewHtml(null);
        setLastPreviewedDraftHash(null);
        setPreviewError('Fix validation errors before preview.');
        return;
      }
      const validPreset =
        selectedPreset && presetOptionIds.includes(selectedPreset) ? selectedPreset : null;
      const htmlResponse = await renderHtmlPreview({
        text: normalizedDraft,
        title: validationResult.meta?.title?.trim() || undefined,
        learningPresetId: learningPresetCatalogEnabled ? validPreset : null,
      });
      const html = htmlResponse.html;
      setPreviewHtml(html);
      setLastPreviewedDraftHash(draftPreviewGate.draftHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to render preview.';
      setPreviewError(message);
      setPreviewHtml(null);
      setLastPreviewedDraftHash(null);
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => {
    if (!jobStatus?.jobId || !isActivelyProcessingJobState(jobStatus.state)) return;
    let active = true;
    const interval = setInterval(async () => {
      try {
        const refreshed = await getJobStatus(jobStatus.jobId);
        if (!active) return;
        setJobStatusState(refreshed);
        const decision = getJobPollingDecision(refreshed.state);
        if (!decision.shouldContinuePolling) {
          clearInterval(interval);
          if (decision.shouldRefreshResumeJobs) {
            void resumeLoadResumeJobs();
          }
        }
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Unable to refresh job status.';
        setPublishError(message);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [jobStatus?.jobId, jobStatus?.state, resumeLoadResumeJobs]);

  useEffect(() => {
    if (!jobStatus) return;
    resumeSetSelectedResumeJobId((current) => current || jobStatus.jobId);
    if (isTerminalJobState(jobStatus.state)) {
      resumeSetPinnedJobExpanded(false);
      if (jobStatus.state === 'failed' && jobStatus.error) {
        setPublishError(describeJobFailureReason(jobStatus));
      }
    }
  }, [jobStatus, resumeSetPinnedJobExpanded, resumeSetSelectedResumeJobId]);

  const transcriptReady = transcriptStatus === 'ready' && transcriptText.trim().length > 0;
  const promptReady = Boolean(promptPackage?.id && promptText.trim().length > 0);
  const jobReady = Boolean(jobStatus?.jobId);
  const selectedResumeJob = useMemo(
    () => resume.resumeJobs.find((job) => job.jobId === resume.selectedResumeJobId) ?? null,
    [resume.resumeJobs, resume.selectedResumeJobId],
  );
  const studentNameById = useMemo(
    () => new Map(studentOptions.map((student) => [student.id, student.name])),
    [studentOptions],
  );
  const describeResumeJobStudent = useCallback(
    (job: JobStatus): string => {
      const isAudioRerun = Boolean(job.sourceJobId && job.withTts);
      const baseName = job.studentId
        ? (studentNameById.get(job.studentId) ?? `Student ${job.studentId.slice(0, 8)}`)
        : 'No student';
      if (isAudioRerun) {
        if (!job.studentId) {
          return 'Audio regeneration';
        }
        return `${baseName} (Audio regeneration)`;
      }
      return baseName;
    },
    [studentNameById],
  );
  const formatResumeJobLabel = useCallback(
    (job: JobStatus): string =>
      `${job.jobId.slice(0, 8)} • ${job.state} • ${describeResumeJobStudent(job)} • ${new Date(
        job.createdAt,
      ).toLocaleString()}`,
    [describeResumeJobStudent],
  );
  const canPublish = promptReady && draftText.trim().length > 0 && !publishing;
  const draftPreviewGate = useMemo(
    () =>
      getDraftPreviewGate({
        draftText,
        previewHtml,
        lastPreviewedDraftHash,
      }),
    [draftText, previewHtml, lastPreviewedDraftHash],
  );
  const previewReadyForCurrentDraft = draftPreviewGate.previewReady;
  const canPublishWithPreview = canPublish && previewReadyForCurrentDraft;
  const jobPublishTarget = jobStatus?.publishTarget ?? publishTarget;
  const publishUrl =
    jobPublishTarget === 'anytype'
      ? (jobStatus?.anytypeUrl ?? jobStatus?.htmlUrl)
      : jobPublishTarget === 'html'
        ? jobStatus?.htmlUrl
        : jobStatus?.notionUrl;
  const publishLabel =
    jobPublishTarget === 'anytype'
      ? 'Open published page'
      : jobPublishTarget === 'html'
        ? 'Open published HTML'
        : 'Open in Notion';
  const publishPending =
    jobPublishTarget === 'anytype'
      ? 'Publish link pending...'
      : jobPublishTarget === 'html'
        ? 'HTML link pending...'
        : 'Notion link pending...';
  const activeGenerationQuota = generationRuntimeQuotaSnapshot ?? generationOptions?.quota ?? null;
  const generationQuotaSourceLabel = activeGenerationQuota
    ? toGenerationQuotaSourceLabel(activeGenerationQuota.source)
    : null;
  const generationQuotaUpdatedRelative = activeGenerationQuota
    ? formatRelativeTimestamp(activeGenerationQuota.lastUpdatedAt)
    : null;
  const generationQuotaUpdatedAbsolute = activeGenerationQuota
    ? formatAbsoluteTimestamp(activeGenerationQuota.lastUpdatedAt)
    : null;
  const generationQuotaHasNumericValues = Boolean(
    activeGenerationQuota &&
      [
        activeGenerationQuota.requestsPerMinute,
        activeGenerationQuota.tokensPerMinute,
        activeGenerationQuota.requestsPerDay,
        activeGenerationQuota.dailyTokenBudget,
        activeGenerationQuota.dailyRequestBudget,
        activeGenerationQuota.dailyRequestUsed,
        activeGenerationQuota.dailyRequestRemaining,
        activeGenerationQuota.dailyTokenUsed,
        activeGenerationQuota.dailyTokenRemaining,
        activeGenerationQuota.rpmBudget,
        activeGenerationQuota.rpmUsed,
        activeGenerationQuota.rpmRemaining,
        activeGenerationQuota.usedRequestsToday,
        activeGenerationQuota.usedTokensToday,
      ].some((value) => value !== undefined && value !== null),
  );
  const generationDefaultModelForSelection =
    generationOptions?.defaultModelByProvider?.[
      selectedGenerationProvider as keyof NonNullable<
        typeof generationOptions
      >['defaultModelByProvider']
    ] ?? generationModelsForProvider[0]?.id;
  const activeQuotaAppliesToCurrentSelection = hasActiveGenerationQuotaSelection({
    generationRuntimeQuotaSnapshot,
    generationRuntimeSelection,
    selectedGenerationProvider,
    selectedGenerationModel,
    generationDefaultProvider: generationOptions?.defaultProvider,
    generationDefaultModelForSelection,
    generationOptionsLoaded: Boolean(generationOptions),
  });
  const quotaWindowDecision = getGenerationQuotaWindowDecision({
    quota: activeGenerationQuota,
    quotaWindowTickMs,
    activeQuotaAppliesToCurrentSelection,
  });
  const generationQuotaBlockedReason = quotaWindowDecision.blockedReason;
  const generationBlockedByQuota = Boolean(generationQuotaBlockedReason);
  const shouldTrackQuotaWindow = quotaWindowDecision.shouldTrackWindow;
  const hasAssignmentContent = draftText.trim().length > 0;
  const hasTeachingContext = Boolean(selectedProfileId || teacherNotes.trim() || promptReady);
  const reviewReady =
    hasAssignmentContent && (!draftPreviewGate.previewRequired || previewReadyForCurrentDraft);

  const workflowStages = useMemo<WorkflowStage[]>(() => {
    const startStatus: WorkflowStageStatus =
      recording !== null || promptReady || hasAssignmentContent || Boolean(jobReady)
        ? 'complete'
        : 'current';
    const sourceStatus: WorkflowStageStatus = transcriptReady
      ? 'complete'
      : recording
        ? 'current'
        : 'locked';
    const contextStatus: WorkflowStageStatus = promptReady
      ? 'complete'
      : transcriptReady
        ? 'current'
        : 'locked';
    const assignmentStatus: WorkflowStageStatus = hasAssignmentContent
      ? 'complete'
      : promptReady
        ? 'current'
        : 'locked';
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
          ? `Working with assignment ${jobStatus?.jobId ?? ''}.`
          : 'Open recent work or begin a new assignment.',
        status: startStatus,
      },
      {
        id: 'source',
        title: 'Add lesson source',
        description: transcriptReady
          ? 'Transcript is ready for review and editing.'
          : recording
            ? 'Audio is uploaded. Finish the transcript before moving on.'
            : 'Choose a student and upload a recording.',
        status: sourceStatus,
      },
      {
        id: 'context',
        title: 'Add teaching context',
        description: promptReady
          ? 'Learner context has been applied to the instructions.'
          : transcriptReady
            ? hasTeachingContext
              ? 'Context is ready. Generate instructions when you are happy with it.'
              : 'Choose a learner profile and add lesson guidance.'
            : 'Unlocks after the transcript is ready.',
        status: contextStatus,
      },
      {
        id: 'assignment',
        title: 'Create assignment',
        description: hasAssignmentContent
          ? 'Assignment content is ready to review.'
          : promptReady
            ? 'Generate or edit the assignment content.'
            : 'Unlocks after instructions are ready.',
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
    hasAssignmentContent,
    jobReady,
    jobStatus?.jobId,
    jobStatus?.state,
    hasTeachingContext,
    promptReady,
    recording,
    reviewReady,
    advancedActions.showAdvancedActions,
    transcriptReady,
  ]);

  const currentStageTitle =
    workflowStages.find((stage) => stage.status === 'current')?.title ??
    workflowStages.find((stage) => stage.status === 'available')?.title ??
    workflowStages[workflowStages.length - 1]?.title ??
    'Assignment builder';

  const workflowSummaryItems = useMemo<WorkflowSummaryItem[]>(
    () => [
      {
        label: 'Student',
        value: selectedStudent?.name ?? 'No student yet',
        note: selectedProfileId ? `Profile: ${selectedProfileId}` : 'You can keep this optional.',
      },
      {
        label: 'Transcript',
        value: transcriptReady ? 'Ready' : recording ? transcriptStatus : 'Waiting',
        note: transcriptReady ? 'You can still edit wording before moving on.' : undefined,
      },
      {
        label: 'Assignment',
        value: hasAssignmentContent ? 'Drafted' : promptReady ? 'Instructions ready' : 'Not started',
        note: draftDirty ? 'You have unsaved assignment edits.' : undefined,
      },
      {
        label: 'Share status',
        value: jobStatus?.state ?? 'Not shared yet',
        note: publishUrl ? publishLabel : 'Preview before publishing.',
      },
    ],
    [
      draftDirty,
      hasAssignmentContent,
      jobStatus?.state,
      promptReady,
      publishLabel,
      publishUrl,
      recording,
      selectedProfileId,
      selectedStudent?.name,
      transcriptReady,
      transcriptStatus,
    ],
  );
  const startStage = workflowStages[0] ?? workflowStages.at(-1)!;
  const sourceStage = workflowStages[1] ?? startStage;
  const contextStage = workflowStages[2] ?? sourceStage;
  const assignmentStage = workflowStages[3] ?? contextStage;
  const reviewStage = workflowStages[4] ?? assignmentStage;
  const advancedStage = workflowStages[5] ?? reviewStage;

  useEffect(() => {
    if (!shouldTrackQuotaWindow) {
      return;
    }
    const interval = globalThis.setInterval(() => {
      setQuotaWindowTickMs(Date.now());
    }, 15_000);
    return () => {
      globalThis.clearInterval(interval);
    };
  }, [shouldTrackQuotaWindow]);

  return (
    <div className="minimal-assignment">
      <WorkflowOverview
        currentStageTitle={currentStageTitle}
        stages={workflowStages}
        summaryItems={workflowSummaryItems}
      />

      <StartStageSection
        stage={startStage}
        onStartNewAssignment={resetFlow}
        onRefreshRecentWork={() => void resume.loadResumeJobs()}
        onResumeSelectedAssignment={() => void resume.handleResumeSelectedJob()}
        resumeLoading={resume.resumeLoading}
        selectedResumeJobId={resume.selectedResumeJobId}
        onSelectedResumeJobIdChange={resume.setSelectedResumeJobId}
        resumeJobs={resume.resumeJobs}
        resumeError={resume.resumeError}
        selectedResumeJob={selectedResumeJob}
        formatResumeJobLabel={formatResumeJobLabel}
        describeResumeJobStudent={describeResumeJobStudent}
        currentJobStatus={jobStatus}
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
        onRefreshStudents={() => void loadStudentOptions()}
        studentOptions={studentOptions}
        studentOptionsError={studentOptionsError}
        selectedStudentId={selectedStudentId}
        onSelectedStudentIdChange={handleStudentSelectionChange}
        selectedStudent={selectedStudent}
        selectedSttProvider={selectedSttProvider}
        onSelectedSttProviderChange={(provider) => {
          sttProviderUserChangedRef.current = true;
          setSelectedSttProvider(provider);
        }}
        sttProviders={sttProviders}
        formatSttProviderLabel={formatSttProviderLabel}
        audioExtensions={AUDIO_EXTENSIONS}
        uploading={uploading}
        selectedFileName={selectedFileName}
        uploadProgress={uploadProgress}
        onFiles={handleFiles}
        onCancelUpload={handleCancelUpload}
        uploadError={uploadError}
        uploadCacheNotice={uploadCacheNotice}
        recording={recording}
        recordingStatus={recordingStatus}
        recordingError={recordingError}
        transcriptStatus={transcriptStatus}
        transcriptError={transcriptError}
        transcriptReady={transcriptReady}
        onRefreshTranscript={() => void loadTranscript()}
        retryingTranscript={retryingTranscript}
        onRetryTranscript={() => void handleRetryTranscription()}
        transcriptText={transcriptText}
        onTranscriptTextChange={setTranscriptText}
        transcriptDirty={transcriptDirty}
        transcriptSaving={transcriptSaving}
        onSaveTranscript={() => void handleSaveTranscript()}
      />

      <ContextStageSection
        stage={contextStage}
        onRefreshProfiles={() => void loadProfileOptions()}
        onSaveProfile={() => void handleSaveProfile()}
        profileBusy={profileBusy}
        selectedProfileId={selectedProfileId}
        onSelectedProfileIdChange={(nextProfileId) => {
          if (!nextProfileId) {
            setProfileSelectionMode('auto');
            setSelectedProfileId(selectedStudentId ? resolveBoundProfileId(selectedStudentId) : '');
            return;
          }
          setProfileSelectionMode('manual');
          setSelectedProfileId(nextProfileId);
        }}
        profileOptions={profileOptions}
        newProfileId={newProfileId}
        onNewProfileIdChange={setNewProfileId}
        onCreateProfile={() => void handleCreateProfile()}
        profileEditorText={profileEditorText}
        onProfileEditorTextChange={setProfileEditorText}
        profileDirty={profileDirty}
        profileOptionsError={profileOptionsError}
        profileRevisionError={profileRevisionError}
        profileSuccess={profileSuccess}
        profileRevisions={profileRevisions}
        onRestoreRevision={(revisionId) => void handleRestoreRevision(revisionId)}
        teacherNotes={teacherNotes}
        onTeacherNotesChange={setTeacherNotes}
      />

      <AssignmentStageSection
        stage={assignmentStage}
        transcriptReady={transcriptReady}
        promptLoading={promptLoading}
        promptReady={Boolean(promptReady)}
        promptOptionsReady={Boolean(promptOptions)}
        onGeneratePrompt={() => void handleGeneratePrompt()}
        onCopyPrompt={handleCopyPrompt}
        promptCopyState={promptCopyState}
        onReloadPromptOptions={() => void loadPromptOptions()}
        promptError={promptError}
        promptPackage={promptPackage}
        promptText={promptText}
        onPromptTextChange={setPromptText}
        onSaveDraft={() => void handleSaveDraft()}
        validating={validating}
        draftDirty={draftDirty}
        generationOptionsAvailable={Boolean(generationOptions)}
        selectedGenerationProvider={selectedGenerationProvider}
        onSelectedGenerationProviderChange={setSelectedGenerationProvider}
        generationProviders={generationProviders}
        selectedGenerationModel={selectedGenerationModel}
        onSelectedGenerationModelChange={setSelectedGenerationModel}
        generationModelsForProvider={generationModelsForProvider}
        onGenerateDraft={() => void handleGenerateDraft()}
        generatingDraft={generatingDraft}
        generationBlockedByQuota={generationBlockedByQuota}
        activeGenerationQuota={activeGenerationQuota}
        generationQuotaSourceLabel={generationQuotaSourceLabel}
        generationQuotaUpdatedRelative={generationQuotaUpdatedRelative}
        generationQuotaUpdatedAbsolute={generationQuotaUpdatedAbsolute}
        generationQuotaHasNumericValues={generationQuotaHasNumericValues}
        generationQuotaBlockedReason={generationQuotaBlockedReason}
        generationError={generationError}
        generationSuccess={generationSuccess}
        draftText={draftText}
        onDraftTextChange={setDraftText}
        validation={validation}
        validationError={validationError}
        draftError={draftError}
      />

      <ReviewStageSection
        stage={reviewStage}
        onPublish={() => void handlePublish()}
        canPublishWithPreview={canPublishWithPreview}
        publishing={publishing}
        previewing={previewing}
        onPreviewDraft={() => void handlePreviewDraft()}
        draftHasContent={draftText.trim().length > 0}
        previewReadyForCurrentDraft={previewReadyForCurrentDraft}
        publishTarget={publishTarget}
        onPublishTargetChange={setPublishTarget}
        selectedPreset={selectedPreset}
        onSelectedPresetChange={setSelectedPreset}
        presetOptions={presetOptions}
        jobOptionsLoaded={Boolean(jobOptions)}
        selectedTtsProvider={selectedTtsProvider}
        onSelectedTtsProviderChange={setSelectedTtsProvider}
        ttsProviders={ttsProviders}
        selectedTtsStrategy={selectedTtsStrategy}
        onSelectedTtsStrategyChange={setSelectedTtsStrategy}
        availablePublishTtsStrategies={availablePublishTtsStrategies}
        formatPublishTtsStrategyLabel={formatPublishTtsStrategyLabel}
        selectedTtsModel={selectedTtsModel}
        onSelectedTtsModelChange={setSelectedTtsModel}
        publishModelSelectionDisabled={publishModelSelectionDisabled}
        selectedTtsModelOptions={selectedTtsModelOptions}
        previewError={previewError}
        previewHtml={previewHtml}
        publishError={publishError}
        currentJobStatus={jobStatus}
        jobFailureReason={jobStatus?.state === 'failed' && jobStatus.error
          ? describeJobFailureReason(jobStatus)
          : null}
        jobReady={Boolean(jobReady)}
        publishUrl={publishUrl}
        publishLabel={publishLabel}
        publishPending={publishPending}
      />

      <AdvancedActionsStage
        stage={advancedStage}
        jobReady={Boolean(jobReady)}
        jobStatus={jobStatus}
        controller={advancedActions}
        onRefreshActions={() => void loadJobOptions()}
        jobOptionsError={jobOptionsError}
        ttsProviders={ttsProviders}
        googleTtsModelOptions={googleTtsModelOptions}
        elevenlabsStandardModelOptions={elevenlabsStandardModelOptions}
        pronunciationChunkProviders={FALLBACK_PRONUNCIATION_CHUNK_TTS_PROVIDERS}
        studyTextStrategies={jobOptions?.ttsStrategies?.filter(isUiPublishTtsStrategy) ?? [
          'auto',
          'dialogue',
          'tts',
        ]}
      />
    </div>
  );
};
