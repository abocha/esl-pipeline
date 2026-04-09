import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  DraftResponse,
  GenerateDraftRequest,
  GenerateDraftResponse,
  JobOptionsResponse,
  JobProvenanceResponse,
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
  cancelJob,
  createDraft,
  createPromptPackage,
  fetchDraft,
  fetchJobOptions,
  fetchJobProvenance,
  fetchPromptOptions,
  fetchPromptPackage,
  fetchRecordingTranscript,
  fetchStudentOptions,
  GenerationDraftApiError,
  generateDraft,
  getJobStatus,
  getProfileContent,
  getRecording,
  listProfileContents,
  listProfileRevisions,
  listUserJobs,
  materializeDraft,
  renderHtmlPreview,
  rerunJob,
  restoreProfileRevision,
  retryRecordingTranscription,
  updateDraft,
  updateRecordingTranscript,
  uploadRecording,
  upsertProfileContent,
  validateMarkdown,
} from '../../utils/api';
import { copyTextToClipboard } from '../../utils/clipboard';
import { DropZone } from '../shared/DropZone';
import { UploadProgress } from '../shared/UploadProgress';
import {
  buildCustomRerunPayload,
  buildPresetRerunPayload,
  buildPublishJobOverrides,
  getDraftPreviewGate,
  getNextGenerationQuotaSnapshot,
  hasActiveGenerationQuotaSelection,
} from './MinimalAssignment.logic';
import {
  getJobPollingDecision,
  getRecordingPollingDecision,
  isActivelyProcessingJobState,
  isTerminalJobState,
} from './MinimalAssignment.polling';
import { getGenerationQuotaWindowDecision } from './MinimalAssignment.quota-window';

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

function isUiPronunciationChunkTtsProvider(
  value: string | null | undefined,
): value is UiPronunciationChunkTtsProvider {
  return value === 'edge-tts' || value === 'elevenlabs' || value === 'google';
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

function readJobIdFromQuery(): string | null {
  if (globalThis.window === undefined) return null;
  const params = new URLSearchParams(globalThis.location.search);
  const value = params.get('jobId')?.trim();
  return value || null;
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
  const [resumeJobs, setResumeJobs] = useState<JobStatus[]>([]);
  const [selectedResumeJobId, setSelectedResumeJobId] = useState('');
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [pinnedJobExpanded, setPinnedJobExpanded] = useState(true);
  const [uploadCacheNotice, setUploadCacheNotice] = useState<string | null>(null);
  const resumeInitializedRef = useRef(false);

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

  const [actionBusy, setActionBusy] = useState<'rerun' | 'cancel' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [jobProvenance, setJobProvenance] = useState<JobProvenanceResponse | null>(null);
  const [jobProvenanceLoading, setJobProvenanceLoading] = useState(false);
  const [jobProvenanceError, setJobProvenanceError] = useState<string | null>(null);

  const [showCustomRerun, setShowCustomRerun] = useState(false);
  const [rerunStudyTextAudio, setRerunStudyTextAudio] = useState(false);
  const [rerunPronunciationMainAudio, setRerunPronunciationMainAudio] = useState(false);
  const [rerunPronunciationChunkAudio, setRerunPronunciationChunkAudio] = useState(false);
  const [rerunStudyTextProvider, setRerunStudyTextProvider] = useState<UiTtsProvider>('elevenlabs');
  const [rerunStudyTextModel, setRerunStudyTextModel] = useState('');
  const [rerunStudyTextVoiceId, setRerunStudyTextVoiceId] = useState('');
  const [rerunStudyTextVoiceAccent, setRerunStudyTextVoiceAccent] = useState('');
  const [rerunStudyTextStrategy, setRerunStudyTextStrategy] = useState<'auto' | 'dialogue' | 'tts'>(
    'auto',
  );
  const [rerunStudyTextDialogueLanguage, setRerunStudyTextDialogueLanguage] = useState('');
  const [rerunStudyTextDialogueStability, setRerunStudyTextDialogueStability] = useState('');
  const [rerunStudyTextDialogueSeed, setRerunStudyTextDialogueSeed] = useState('');
  const [rerunPronunciationMainProvider, setRerunPronunciationMainProvider] =
    useState<UiTtsProvider>('elevenlabs');
  const [rerunPronunciationMainModel, setRerunPronunciationMainModel] = useState('');
  const [rerunPronunciationMainVoiceId, setRerunPronunciationMainVoiceId] = useState('');
  const [rerunPronunciationMainVoiceAccent, setRerunPronunciationMainVoiceAccent] = useState('');
  const [rerunPronunciationChunkProvider, setRerunPronunciationChunkProvider] =
    useState<UiPronunciationChunkTtsProvider>('edge-tts');
  const [rerunPronunciationChunkProviderDirty, setRerunPronunciationChunkProviderDirty] =
    useState(false);
  const [rerunTargetPronunciationMode, setRerunTargetPronunciationMode] =
    useState<PronunciationMode | null>(null);
  const [rerunPronunciationChunkModel, setRerunPronunciationChunkModel] = useState('');
  const [rerunPronunciationChunkVoiceId, setRerunPronunciationChunkVoiceId] = useState('');
  const [rerunPronunciationChunkVoiceAccent, setRerunPronunciationChunkVoiceAccent] = useState('');
  const [rerunPronunciationChunkEdgeVoice, setRerunPronunciationChunkEdgeVoice] = useState('');
  const [cancelReason, setCancelReason] = useState('');
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
  }, [jobOptions, jobOptions?.ttsStrategies, selectedTtsStrategy]);
  const publishModelSelectionDisabled =
    selectedTtsProvider === 'elevenlabs' && selectedTtsStrategy === 'auto';
  const defaultPronunciationChunkProvider = useMemo<UiPronunciationChunkTtsProvider>(
    () => getDefaultPronunciationChunkProviderForMode(rerunTargetPronunciationMode),
    [rerunTargetPronunciationMode],
  );

  const presetOptions = useMemo(() => buildSelectablePresetOptions(jobOptions), [jobOptions]);
  const presetOptionIds = useMemo(() => presetOptions.map((preset) => preset.id), [presetOptions]);
  const learningPresetCatalogEnabled = (jobOptions?.learningPresets?.length ?? 0) > 0;

  const loadJobProvenance = useCallback(async (jobId: string) => {
    setJobProvenanceLoading(true);
    setJobProvenanceError(null);
    try {
      const provenance = await fetchJobProvenance(jobId);
      setJobProvenance(provenance);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load job provenance details.';
      setJobProvenanceError(message);
    } finally {
      setJobProvenanceLoading(false);
    }
  }, []);

  const loadResumeJobs = useCallback(async (): Promise<JobStatus[]> => {
    try {
      const response = await listUserJobs({
        limit: 20,
        offset: 0,
        order: 'desc',
      });
      const jobs = response.jobs ?? [];
      setResumeJobs(jobs);
      setSelectedResumeJobId((current) => {
        if (current && jobs.some((job) => job.jobId === current)) return current;
        return (
          jobs.find((job) => isActivelyProcessingJobState(job.state))?.jobId ?? jobs[0]?.jobId ?? ''
        );
      });
      setResumeError(null);
      return jobs;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load recent jobs.';
      setResumeError(message);
      setResumeJobs([]);
      setSelectedResumeJobId('');
      return [];
    }
  }, []);

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
    setJobProvenance(null);
    setJobProvenanceError(null);
    setJobProvenanceLoading(false);
    setSelectedFileName(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploading(false);
    setUploadCacheNotice(null);
    setResumeError(null);
    setPinnedJobExpanded(true);
    setPreviewHtml(null);
    setPreviewError(null);
    setPreviewing(false);
    setLastPreviewedDraftHash(null);
    setShowCustomRerun(false);
    setRerunStudyTextAudio(false);
    setRerunPronunciationMainAudio(false);
    setRerunPronunciationChunkAudio(false);
    setRerunStudyTextProvider('elevenlabs');
    setRerunStudyTextModel('');
    setRerunPronunciationMainProvider('elevenlabs');
    setRerunPronunciationMainModel('');
    setRerunPronunciationChunkProvider('edge-tts');
    setRerunPronunciationChunkModel('');
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
    if (!ttsProviders.includes(rerunStudyTextProvider)) {
      setRerunStudyTextProvider(selectedTtsProvider);
    }
  }, [rerunStudyTextProvider, selectedTtsProvider, ttsProviders]);

  useEffect(() => {
    if (!ttsProviders.includes(rerunPronunciationMainProvider)) {
      setRerunPronunciationMainProvider(selectedTtsProvider);
    }
  }, [rerunPronunciationMainProvider, selectedTtsProvider, ttsProviders]);

  useEffect(() => {
    if (!isUiPronunciationChunkTtsProvider(rerunPronunciationChunkProvider)) {
      setRerunPronunciationChunkProvider(defaultPronunciationChunkProvider);
    }
  }, [defaultPronunciationChunkProvider, rerunPronunciationChunkProvider]);

  useEffect(() => {
    if (!rerunPronunciationChunkProviderDirty) {
      setRerunPronunciationChunkProvider(defaultPronunciationChunkProvider);
    }
  }, [defaultPronunciationChunkProvider, rerunPronunciationChunkProviderDirty, jobStatus?.jobId]);

  useEffect(() => {
    if (rerunStudyTextProvider === 'google') {
      if (!rerunStudyTextModel || !googleTtsModelOptions.includes(rerunStudyTextModel)) {
        setRerunStudyTextModel(googleTtsModelOptions[0] ?? '');
      }
      return;
    }
    if (rerunStudyTextStrategy === 'auto') {
      if (rerunStudyTextModel) {
        setRerunStudyTextModel('');
      }
      return;
    }
    if (rerunStudyTextStrategy === 'dialogue') {
      if (rerunStudyTextModel !== 'eleven_v3') {
        setRerunStudyTextModel('eleven_v3');
      }
      return;
    }
    if (
      rerunStudyTextModel &&
      !elevenlabsStandardModelOptions.includes(
        rerunStudyTextModel as (typeof elevenlabsStandardModelOptions)[number],
      )
    ) {
      setRerunStudyTextModel('');
    }
  }, [
    elevenlabsStandardModelOptions,
    googleTtsModelOptions,
    rerunStudyTextModel,
    rerunStudyTextProvider,
    rerunStudyTextStrategy,
  ]);

  useEffect(() => {
    if (rerunPronunciationMainProvider === 'google') {
      if (
        !rerunPronunciationMainModel ||
        !googleTtsModelOptions.includes(rerunPronunciationMainModel)
      ) {
        setRerunPronunciationMainModel(googleTtsModelOptions[0] ?? '');
      }
      return;
    }
    if (
      !rerunPronunciationMainModel ||
      !elevenlabsStandardModelOptions.includes(
        rerunPronunciationMainModel as (typeof elevenlabsStandardModelOptions)[number],
      )
    ) {
      setRerunPronunciationMainModel(
        elevenlabsStandardModelOptions.find((model) => model === 'eleven_flash_v2_5') ??
          elevenlabsStandardModelOptions[0] ??
          '',
      );
    }
  }, [
    elevenlabsStandardModelOptions,
    googleTtsModelOptions,
    rerunPronunciationMainModel,
    rerunPronunciationMainProvider,
  ]);

  useEffect(() => {
    if (rerunPronunciationChunkProvider === 'google') {
      if (
        !rerunPronunciationChunkModel ||
        !googleTtsModelOptions.includes(rerunPronunciationChunkModel)
      ) {
        setRerunPronunciationChunkModel(googleTtsModelOptions[0] ?? '');
      }
      return;
    }
    if (rerunPronunciationChunkProvider === 'elevenlabs') {
      if (
        !rerunPronunciationChunkModel ||
        !elevenlabsStandardModelOptions.includes(
          rerunPronunciationChunkModel as (typeof elevenlabsStandardModelOptions)[number],
        )
      ) {
        setRerunPronunciationChunkModel(
          elevenlabsStandardModelOptions.find((model) => model === 'eleven_flash_v2_5') ??
            elevenlabsStandardModelOptions[0] ??
            '',
        );
      }
      return;
    }
    if (rerunPronunciationChunkModel) {
      setRerunPronunciationChunkModel('');
    }
  }, [
    elevenlabsStandardModelOptions,
    googleTtsModelOptions,
    rerunPronunciationChunkModel,
    rerunPronunciationChunkProvider,
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

  const hydrateFromJob = useCallback(
    async (jobId: string, knownJobs?: JobStatus[]) => {
      if (!jobId) return;

      invalidateDraftGenerationRequests();
      setResumeLoading(true);
      setResumeError(null);
      setPublishError(null);
      setActionError(null);
      setActionSuccess(null);
      setUploadError(null);
      setUploadCacheNotice(null);
      setPreviewHtml(null);
      setPreviewError(null);
      setLastPreviewedDraftHash(null);

      try {
        const status = await getJobStatus(jobId);
        setJobStatusState(status);
        setSelectedResumeJobId(status.jobId);
        setPinnedJobExpanded(!isTerminalJobState(status.state));
        writeJobIdToQuery(status.jobId);
        const candidateJobs = knownJobs ?? resumeJobs;
        let resolvedStudentId =
          candidateJobs.find((job) => job.jobId === status.jobId)?.studentId ??
          status.studentId ??
          null;

        if (status.publishTarget) {
          setPublishTarget(status.publishTarget);
        }
        if (status.ttsStrategy) {
          setSelectedTtsStrategy(status.ttsStrategy);
        }
        const resumedTtsProvider = status.ttsProvider;
        if (isUiTtsProvider(resumedTtsProvider)) {
          setSelectedTtsProvider(resumedTtsProvider);
          setRerunStudyTextProvider(resumedTtsProvider);
          setRerunPronunciationMainProvider(resumedTtsProvider);
        }
        if (
          typeof status.studyTextElevenlabsModel === 'string' &&
          status.studyTextElevenlabsModel.trim().length > 0
        ) {
          setSelectedTtsModel(status.studyTextElevenlabsModel);
          setRerunStudyTextModel(status.studyTextElevenlabsModel);
        } else if (
          typeof status.googleTtsModel === 'string' &&
          status.googleTtsModel.trim().length > 0
        ) {
          setSelectedTtsModel(status.googleTtsModel);
          setRerunStudyTextModel(status.googleTtsModel);
          setRerunPronunciationMainModel(status.googleTtsModel);
        }
        const resumedPresetId = status.learningPresetId ?? status.preset;
        if (resumedPresetId) {
          setSelectedPreset((current) =>
            normalizePresetSelection(
              jobOptions ? presetOptionIds : undefined,
              resumedPresetId,
              current,
            ),
          );
        }

        if (status.recordingId) {
          try {
            const resumedRecording = await getRecording(status.recordingId);
            setRecording(resumedRecording);
            setRecordingStatus(resumedRecording.status);
            setRecordingError(resumedRecording.error ?? null);
            setSelectedFileName(resumedRecording.displayName || null);
            if (resumedRecording.studentId) {
              resolvedStudentId = resumedRecording.studentId;
            }

            if (
              status.transcriptId ||
              resumedRecording.transcriptId ||
              resumedRecording.status === 'transcribed'
            ) {
              try {
                const resumedTranscript = await fetchRecordingTranscript(
                  resumedRecording.recordingId,
                );
                setTranscript(resumedTranscript);
                setTranscriptText(resumedTranscript.text ?? '');
                setTranscriptStatus('ready');
                setTranscriptError(null);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : 'Unable to load transcript.';
                if (
                  resumedRecording.status === 'transcribing' ||
                  resumedRecording.status === 'queued'
                ) {
                  setTranscriptStatus('processing');
                  setTranscriptError(null);
                } else {
                  setTranscriptStatus('failed');
                  setTranscriptError(message);
                }
              }
            } else if (resumedRecording.status === 'failed') {
              setTranscriptStatus('failed');
              setTranscriptError(resumedRecording.error ?? 'Transcription failed.');
            } else {
              setTranscript(null);
              setTranscriptText('');
              setTranscriptStatus('processing');
              setTranscriptError(null);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load recording.';
            setRecording(null);
            setRecordingStatus(null);
            setRecordingError(message);
            setTranscript(null);
            setTranscriptText('');
            setTranscriptStatus('failed');
            setTranscriptError(message);
          }
        } else {
          setRecording(null);
          setRecordingStatus(null);
          setRecordingError(null);
          setTranscript(null);
          setTranscriptText('');
          setTranscriptStatus('idle');
          setTranscriptError(null);
        }

        if (status.promptPackageId) {
          try {
            const resumedPromptPackage = await fetchPromptPackage(status.promptPackageId);
            setPromptPackage(resumedPromptPackage);
            setTeacherNotes(resumedPromptPackage.notes ?? '');
            setPromptText(resumedPromptPackage.text ?? '');
            setPromptError(null);
            if (!resolvedStudentId && resumedPromptPackage.studentId) {
              resolvedStudentId = resumedPromptPackage.studentId;
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Unable to load prompt package.';
            setPromptPackage(null);
            setTeacherNotes('');
            setPromptText('');
            setPromptError(message);
          }
        } else {
          setPromptPackage(null);
          setTeacherNotes('');
          setPromptText('');
          setPromptError(null);
        }

        const persistedPronunciationMode = status.pronunciationMode ?? null;

        if (status.draftId) {
          try {
            const resumedDraft = await fetchDraft(status.draftId);
            setDraft(resumedDraft);
            setDraftText(resumedDraft.text ?? '');
            setRerunTargetPronunciationMode(
              detectPronunciationModeFromDraft(resumedDraft.text ?? ''),
            );
            setDraftError(null);
            if (!resolvedStudentId && resumedDraft.studentId) {
              resolvedStudentId = resumedDraft.studentId;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load saved draft.';
            setDraft(null);
            setDraftText('');
            setRerunTargetPronunciationMode(persistedPronunciationMode);
            setDraftError(message);
          }
        } else {
          setDraft(null);
          setDraftText('');
          setRerunTargetPronunciationMode(persistedPronunciationMode);
          setDraftError(null);
        }

        setValidation(null);
        setValidationError(null);
        if (status.state === 'failed' && status.error) {
          setPublishError(describeJobFailureReason(status));
        }
        if (resolvedStudentId) {
          setProfileSelectionMode('auto');
          setSelectedStudentId(resolvedStudentId);
          setSelectedProfileId(resolveBoundProfileId(resolvedStudentId));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to resume the selected assignment.';
        setResumeError(message);
      } finally {
        setResumeLoading(false);
      }
    },
    [
      invalidateDraftGenerationRequests,
      jobOptions,
      presetOptionIds,
      resolveBoundProfileId,
      resumeJobs,
    ],
  );

  const handleResumeSelectedJob = useCallback(async () => {
    if (!selectedResumeJobId) return;
    await hydrateFromJob(selectedResumeJobId, resumeJobs);
    await loadResumeJobs();
  }, [hydrateFromJob, loadResumeJobs, resumeJobs, selectedResumeJobId]);

  useEffect(() => {
    if (resumeInitializedRef.current) return;
    resumeInitializedRef.current = true;

    const initializeResume = async () => {
      setResumeLoading(true);
      const jobs = await loadResumeJobs();
      const queryJobId = readJobIdFromQuery();
      if (queryJobId) {
        setSelectedResumeJobId(queryJobId);
        await hydrateFromJob(queryJobId, jobs);
        return;
      }

      const candidate = jobs.find((job) => isActivelyProcessingJobState(job.state)) ?? null;
      if (candidate) {
        await hydrateFromJob(candidate.jobId, jobs);
      } else {
        setResumeLoading(false);
      }
    };

    void initializeResume();
  }, [hydrateFromJob, loadResumeJobs]);

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
      setJobStatusState(refreshed);
      setSelectedResumeJobId(refreshed.jobId);
      setPinnedJobExpanded(!isTerminalJobState(refreshed.state));
      writeJobIdToQuery(refreshed.jobId);
      await loadResumeJobs();
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
            void loadResumeJobs();
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
  }, [jobStatus?.jobId, jobStatus?.state, loadResumeJobs]);

  useEffect(() => {
    setActionBusy(null);
    setActionError(null);
    setActionSuccess(null);
    setShowCustomRerun(false);
    setCancelReason('');
    setRerunPronunciationChunkProviderDirty(false);
  }, [jobStatus?.jobId]);

  useEffect(() => {
    if (!jobStatus) return;
    setSelectedResumeJobId((current) => current || jobStatus.jobId);
    if (isTerminalJobState(jobStatus.state)) {
      setPinnedJobExpanded(false);
      if (jobStatus.state === 'failed' && jobStatus.error) {
        setPublishError(describeJobFailureReason(jobStatus));
      }
    }
  }, [jobStatus]);

  useEffect(() => {
    if (!jobStatus?.jobId) {
      setJobProvenance(null);
      setJobProvenanceError(null);
      setJobProvenanceLoading(false);
      return;
    }
    void loadJobProvenance(jobStatus.jobId);
  }, [jobStatus?.jobId, loadJobProvenance]);

  const queueRerun = async (payload: Parameters<typeof rerunJob>[1], fallbackMessage: string) => {
    if (!jobStatus?.jobId) return;

    setActionBusy('rerun');
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await rerunJob(jobStatus.jobId, payload);
      setActionSuccess(result.message ?? fallbackMessage);
      const nextJobId = result.jobId || jobStatus.jobId;
      const refreshed = await getJobStatus(nextJobId);
      setJobStatusState(refreshed);
      setSelectedResumeJobId(refreshed.jobId);
      setPinnedJobExpanded(!isTerminalJobState(refreshed.state));
      writeJobIdToQuery(refreshed.jobId);
      await loadJobProvenance(refreshed.jobId);
      await loadResumeJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackMessage;
      setActionError(message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleRepublishCurrentDraft = async () => {
    await queueRerun(buildPresetRerunPayload('republish'), 'Republish queued.');
  };

  const handleRegeneratePronunciationAudio = async () => {
    await queueRerun(buildPresetRerunPayload('pronunciation'), 'Pronunciation rerun queued.');
  };

  const handleRegenerateStudyTextAudio = async () => {
    await queueRerun(buildPresetRerunPayload('studyText'), 'Study-text rerun queued.');
  };

  const handleRegenerateAllAudio = async () => {
    await queueRerun(buildPresetRerunPayload('allAudio'), 'Full audio rerun queued.');
  };

  const handleCustomRerun = async () => {
    if (!jobStatus?.jobId) return;

    const payload = buildCustomRerunPayload({
      rerunStudyTextAudio,
      rerunPronunciationMainAudio,
      rerunPronunciationChunkAudio,
      rerunStudyTextProvider,
      rerunStudyTextModel,
      rerunStudyTextVoiceId,
      rerunStudyTextVoiceAccent,
      rerunStudyTextStrategy,
      rerunStudyTextDialogueLanguage,
      rerunStudyTextDialogueStability,
      rerunStudyTextDialogueSeed,
      rerunPronunciationMainProvider,
      rerunPronunciationMainModel,
      rerunPronunciationMainVoiceId,
      rerunPronunciationMainVoiceAccent,
      rerunPronunciationChunkProvider,
      rerunPronunciationChunkModel,
      rerunPronunciationChunkVoiceId,
      rerunPronunciationChunkVoiceAccent,
      rerunPronunciationChunkEdgeVoice,
    });
    if (!payload.ok) {
      setActionError(payload.error);
      return;
    }

    await queueRerun(payload.payload, 'Custom rerun queued.');
  };

  const handleCancelJob = async () => {
    if (!jobStatus?.jobId) return;

    const trimmedReason = cancelReason.trim();
    setActionBusy('cancel');
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await cancelJob(
        jobStatus.jobId,
        trimmedReason ? { reason: trimmedReason } : undefined,
      );
      setActionSuccess(result.message ?? 'Job cancellation requested.');
      const refreshed = await getJobStatus(jobStatus.jobId);
      setJobStatusState(refreshed);
      await loadJobProvenance(jobStatus.jobId);
      await loadResumeJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to cancel job.';
      setActionError(message);
    } finally {
      setActionBusy(null);
    }
  };

  const transcriptReady = transcriptStatus === 'ready' && transcriptText.trim().length > 0;
  const promptReady = promptPackage?.id && promptText.trim().length > 0;
  const jobReady = jobStatus?.jobId;
  const selectedResumeJob = useMemo(
    () => resumeJobs.find((job) => job.jobId === selectedResumeJobId) ?? null,
    [resumeJobs, selectedResumeJobId],
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
  const actionCapabilities = jobOptions?.supportedActions ?? [];
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
  const rerunImplemented =
    actionCapabilities.find((capability) => capability.type === 'rerun')?.implemented ?? false;
  const cancelImplemented =
    actionCapabilities.find((capability) => capability.type === 'cancel')?.implemented ?? false;
  const cancelAllowedState = jobStatus?.state === 'queued' || jobStatus?.state === 'running';
  const rerunEnabled = Boolean(jobStatus?.jobId) && rerunImplemented && actionBusy === null;
  const cancelEnabled =
    Boolean(jobStatus?.jobId) && cancelImplemented && cancelAllowedState && actionBusy === null;
  const customRerunHasSelection =
    rerunStudyTextAudio || rerunPronunciationMainAudio || rerunPronunciationChunkAudio;
  const customRerunSummary = [
    rerunStudyTextAudio ? 'regenerate study-text audio' : 'reuse study-text audio',
    rerunPronunciationMainAudio
      ? 'regenerate main pronunciation audio'
      : 'reuse main pronunciation audio',
    rerunPronunciationChunkAudio
      ? 'regenerate pronunciation chunk audio'
      : 'reuse pronunciation chunk audio',
    'refresh published output',
  ];
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
      <section className="minimal-section minimal-section-compact">
        <div className="minimal-section-header">
          <h2>0. Resume workflow</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-secondary"
              onClick={() => void loadResumeJobs()}
              disabled={resumeLoading}
            >
              {resumeLoading ? 'Refreshing...' : 'Refresh jobs'}
            </button>
            <button
              type="button"
              className="minimal-primary"
              onClick={() => void handleResumeSelectedJob()}
              disabled={!selectedResumeJobId || resumeLoading}
            >
              Resume selected
            </button>
          </div>
        </div>
        <label className="minimal-select">
          Recent jobs
          <select
            value={selectedResumeJobId}
            onChange={(event) => setSelectedResumeJobId(event.target.value)}
            disabled={resumeJobs.length === 0 || resumeLoading}
          >
            {resumeJobs.length === 0 ? <option value="">No saved jobs yet</option> : null}
            {resumeJobs.map((job) => (
              <option key={job.jobId} value={job.jobId}>
                {formatResumeJobLabel(job)}
              </option>
            ))}
          </select>
        </label>
        {resumeError ? <p className="minimal-error">{resumeError}</p> : null}
        {selectedResumeJob ? (
          <p className="minimal-muted">
            Selected job target: {selectedResumeJob.jobId} ({selectedResumeJob.state} •{' '}
            {describeResumeJobStudent(selectedResumeJob)})
          </p>
        ) : null}
        {jobStatus?.jobId ? (
          <div className="minimal-pinned-job">
            <div className="minimal-section-header">
              <div className="minimal-meta">
                <span>Pinned job: {jobStatus.jobId}</span>
                <span>State: {jobStatus.state}</span>
              </div>
              <button
                type="button"
                className="minimal-secondary"
                onClick={() => setPinnedJobExpanded((current) => !current)}
              >
                {pinnedJobExpanded ? 'Collapse details' : 'Expand details'}
              </button>
            </div>
            {pinnedJobExpanded ? (
              <div className="minimal-inline">
                {publishUrl ? (
                  <a href={publishUrl} target="_blank" rel="noreferrer">
                    {publishLabel}
                  </a>
                ) : null}
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void handleRegeneratePronunciationAudio()}
                  disabled={!rerunEnabled}
                >
                  {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Regenerate pronunciation'}
                </button>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void handleRepublishCurrentDraft()}
                  disabled={!rerunEnabled}
                >
                  {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Republish'}
                </button>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void handleCancelJob()}
                  disabled={!cancelEnabled}
                >
                  {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel job'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>1. Upload recording</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-secondary"
              onClick={() => void loadStudentOptions()}
            >
              Refresh students
            </button>
            <button type="button" className="minimal-secondary" onClick={resetFlow}>
              Start new
            </button>
          </div>
        </div>
        <p className="minimal-help">Upload an audio recording to start the assignment pipeline.</p>
        <label className="minimal-select">
          Student (optional)
          <select
            value={selectedStudentId}
            onChange={(event) => handleStudentSelectionChange(event.target.value)}
          >
            {studentOptions.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
        </label>
        <label className="minimal-select">
          STT provider
          <select
            value={selectedSttProvider}
            onChange={(event) => {
              sttProviderUserChangedRef.current = true;
              setSelectedSttProvider(event.target.value as SttProvider);
            }}
            disabled={sttProviders.length === 0}
          >
            {sttProviders.map((provider) => (
              <option key={provider} value={provider}>
                {formatSttProviderLabel(provider)}
              </option>
            ))}
          </select>
        </label>
        {selectedStudent ? (
          <p className="minimal-muted">
            Selected: {selectedStudent.name}
            {selectedStudent.profileId ? ` (profile: ${selectedStudent.profileId})` : ''}
          </p>
        ) : null}
        {studentOptionsError ? <p className="minimal-error">{studentOptionsError}</p> : null}
        <DropZone
          title={uploading ? 'Uploading...' : 'Drop audio file'}
          description="Drag a recording here or click to browse"
          hint="Single file upload"
          accept={{ 'audio/*': AUDIO_EXTENSIONS }}
          multiple={false}
          disabled={uploading}
          onFiles={handleFiles}
        />
        {uploading ? (
          <UploadProgress
            fileName={selectedFileName}
            progress={uploadProgress}
            onCancel={handleCancelUpload}
          />
        ) : null}
        {uploadError ? <p className="minimal-error">{uploadError}</p> : null}
        {uploadCacheNotice ? <p className="minimal-success">{uploadCacheNotice}</p> : null}
        {recording ? (
          <div className="minimal-meta">
            <span>Recording ID: {recording.recordingId}</span>
            <span>Status: {recordingStatus ?? 'unknown'}</span>
            <span>STT provider: {selectedSttProvider}</span>
            {selectedStudent ? <span>Student: {selectedStudent.name}</span> : null}
          </div>
        ) : null}
        {recordingError ? <p className="minimal-error">{recordingError}</p> : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>2. Transcript</h2>
          <button
            type="button"
            className="minimal-secondary"
            onClick={() => void loadTranscript()}
            disabled={!recording?.recordingId || transcriptStatus === 'loading'}
          >
            Refresh
          </button>
        </div>
        {recording ? (
          transcriptStatus === 'processing' || transcriptStatus === 'idle' ? (
            <p className="minimal-help">
              Transcription in progress. We check every few seconds automatically.
            </p>
          ) : null
        ) : (
          <p className="minimal-help">Upload a recording to begin transcription.</p>
        )}
        {transcriptStatus === 'loading' ? (
          <p className="minimal-help">Loading transcript...</p>
        ) : null}
        {transcriptStatus === 'failed' ? (
          <div className="minimal-block">
            <p className="minimal-error">{transcriptError ?? 'Transcript failed to load.'}</p>
            <button
              type="button"
              className="minimal-secondary"
              onClick={() => void handleRetryTranscription()}
              disabled={retryingTranscript}
            >
              {retryingTranscript ? 'Retrying...' : 'Retry transcription'}
            </button>
          </div>
        ) : null}
        {transcriptReady ? (
          <div className="minimal-block">
            <textarea
              aria-label="Transcript text"
              value={transcriptText}
              onChange={(event) => setTranscriptText(event.target.value)}
              rows={10}
            />
            <div className="minimal-inline">
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void handleSaveTranscript()}
                disabled={!transcriptDirty || transcriptSaving}
              >
                {transcriptSaving ? 'Saving...' : 'Save transcript edits'}
              </button>
              {transcriptDirty ? <span className="minimal-muted">Unsaved edits</span> : null}
            </div>
            {transcriptError ? <p className="minimal-error">{transcriptError}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>3. Profiles</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-secondary"
              onClick={() => void loadProfileOptions()}
              disabled={profileBusy !== null}
            >
              Refresh profiles
            </button>
            <button
              type="button"
              className="minimal-primary"
              onClick={() => void handleSaveProfile()}
              disabled={!selectedProfileId || profileBusy !== null || !profileDirty}
            >
              {profileBusy === 'saving' ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        </div>
        <p className="minimal-help">
          Edit profile text used for prompt generation. Every save creates an append-only revision
          snapshot.
        </p>
        <label className="minimal-select">
          Profile
          <select
            value={selectedProfileId}
            onChange={(event) => {
              const nextProfileId = event.target.value;
              if (!nextProfileId) {
                setProfileSelectionMode('auto');
                setSelectedProfileId(
                  selectedStudentId ? resolveBoundProfileId(selectedStudentId) : '',
                );
                return;
              }
              setProfileSelectionMode('manual');
              setSelectedProfileId(nextProfileId);
            }}
          >
            <option value="">Select profile</option>
            {profileOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label} ({profile.id})
              </option>
            ))}
          </select>
        </label>
        <div className="minimal-inline">
          <label className="minimal-field grow">
            <span>Create profile ID</span>
            <input
              value={newProfileId}
              onChange={(event) => setNewProfileId(event.target.value)}
              placeholder="profiles/new-student.md"
            />
          </label>
          <button
            type="button"
            className="minimal-secondary"
            onClick={() => void handleCreateProfile()}
            disabled={profileBusy !== null}
          >
            {profileBusy === 'creating' ? 'Creating...' : 'Create profile'}
          </button>
        </div>
        <textarea
          aria-label="Profile content"
          value={profileEditorText}
          onChange={(event) => setProfileEditorText(event.target.value)}
          rows={10}
          placeholder="Profile content..."
          disabled={!selectedProfileId && !newProfileId.trim()}
        />
        {profileDirty ? <p className="minimal-muted">Unsaved profile edits</p> : null}
        {profileOptionsError ? <p className="minimal-error">{profileOptionsError}</p> : null}
        {profileRevisionError ? <p className="minimal-error">{profileRevisionError}</p> : null}
        {profileSuccess ? <p className="minimal-success">{profileSuccess}</p> : null}
        {selectedProfileId ? (
          <div className="minimal-block">
            <p className="minimal-muted">Recent revisions</p>
            {profileRevisions.length > 0 ? (
              <div className="minimal-list">
                {profileRevisions.map((revision) => (
                  <div key={revision.id} className="minimal-list-item">
                    <span>
                      {revision.source} • {new Date(revision.createdAt).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      className="minimal-secondary"
                      onClick={() => void handleRestoreRevision(revision.id)}
                      disabled={profileBusy !== null}
                    >
                      {profileBusy === 'restoring' ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="minimal-muted">No revisions yet.</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>4. Teacher notes</h2>
        </div>
        <p className="minimal-help">
          Optional lesson-specific guidance. Included downstream in the prompt as{' '}
          <code>[TEACHER_NOTES]</code>.
        </p>
        <textarea
          aria-label="Teacher notes"
          value={teacherNotes}
          onChange={(event) => setTeacherNotes(event.target.value)}
          rows={6}
          placeholder="Add lesson-specific context, corrections, or priorities for this prompt..."
        />
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>5. Prompt</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-primary"
              onClick={() => void handleGeneratePrompt()}
              disabled={!transcriptReady || promptLoading || !promptOptions}
            >
              {promptLoading
                ? 'Generating...'
                : promptReady
                  ? 'Regenerate prompt'
                  : 'Generate prompt'}
            </button>
            <button
              type="button"
              className="minimal-secondary"
              onClick={handleCopyPrompt}
              disabled={!promptText.trim()}
            >
              {promptCopyState === 'copied' ? 'Copied' : 'Copy'}
            </button>
            {promptOptions ? null : (
              <button
                type="button"
                className="minimal-secondary"
                onClick={() => void loadPromptOptions()}
              >
                Reload prompts
              </button>
            )}
          </div>
        </div>
        <p className="minimal-help">
          Uses the default template and applies the selected profile when provided.
        </p>
        {promptError ? <p className="minimal-error">{promptError}</p> : null}
        {promptPackage?.profileDrift?.detected ? (
          <div className="minimal-alert warning">
            <strong>Profile drift detected</strong>
            <p className="minimal-help">
              The profile changed after this prompt package was created (
              {promptPackage.profileDrift.reason}
              ). Regenerate the prompt to use the latest profile.
            </p>
          </div>
        ) : null}
        {promptText ? (
          <textarea
            aria-label="Prompt text"
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            rows={12}
          />
        ) : (
          <p className="minimal-muted">Generate a prompt to continue.</p>
        )}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>6. Draft</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-primary"
              onClick={() => void handleSaveDraft()}
              disabled={!promptReady || validating}
            >
              {validating ? 'Validating...' : draft ? 'Save draft' : 'Save draft'}
            </button>
            {draftDirty ? <span className="minimal-muted">Unsaved changes</span> : null}
          </div>
        </div>
        <div className="minimal-generation-block">
          <div className="minimal-inline">
            <label className="minimal-select">
              Generation provider
              <select
                value={selectedGenerationProvider}
                onChange={(event) => setSelectedGenerationProvider(event.target.value)}
                disabled={!generationOptions || generatingDraft || generationProviders.length === 0}
              >
                {generationProviders.length === 0 ? (
                  <option value="">No providers available</option>
                ) : null}
                {generationProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
            <label className="minimal-select">
              Generation model
              <select
                value={selectedGenerationModel}
                onChange={(event) => setSelectedGenerationModel(event.target.value)}
                disabled={
                  !generationOptions ||
                  generatingDraft ||
                  !selectedGenerationProvider ||
                  generationModelsForProvider.length === 0
                }
              >
                {generationModelsForProvider.length === 0 ? (
                  <option value="">No models available</option>
                ) : null}
                {generationModelsForProvider.map((modelOption) => (
                  <option key={`${modelOption.provider}:${modelOption.id}`} value={modelOption.id}>
                    {modelOption.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="minimal-secondary"
              onClick={() => void handleGenerateDraft()}
              disabled={
                !promptReady ||
                generatingDraft ||
                !generationOptions ||
                !selectedGenerationProvider ||
                !selectedGenerationModel ||
                generationBlockedByQuota
              }
            >
              {generatingDraft ? 'Generating draft...' : 'Generate draft from prompt'}
            </button>
          </div>
          {generationOptions ? (
            <div className="minimal-quota-panel">
              <p className="minimal-help">
                <strong>Generation quota</strong>
              </p>
              {activeGenerationQuota ? (
                <>
                  <div className="minimal-meta">
                    <span>Source: {generationQuotaSourceLabel}</span>
                    <span>
                      Updated: {generationQuotaUpdatedRelative} ({generationQuotaUpdatedAbsolute})
                    </span>
                  </div>
                  {generationQuotaHasNumericValues ? (
                    <div className="minimal-quota-grid">
                      {activeGenerationQuota.requestsPerMinute === undefined ||
                      activeGenerationQuota.requestsPerMinute === null ? null : (
                        <div className="minimal-quota-item">
                          RPM: {activeGenerationQuota.requestsPerMinute}
                        </div>
                      )}
                      {activeGenerationQuota.tokensPerMinute === undefined ||
                      activeGenerationQuota.tokensPerMinute === null ? null : (
                        <div className="minimal-quota-item">
                          TPM: {activeGenerationQuota.tokensPerMinute}
                        </div>
                      )}
                      {activeGenerationQuota.requestsPerDay === undefined ||
                      activeGenerationQuota.requestsPerDay === null ? null : (
                        <div className="minimal-quota-item">
                          RPD: {activeGenerationQuota.requestsPerDay}
                        </div>
                      )}
                      {activeGenerationQuota.dailyTokenBudget === undefined ||
                      activeGenerationQuota.dailyTokenBudget === null ? null : (
                        <div className="minimal-quota-item">
                          Daily token budget: {activeGenerationQuota.dailyTokenBudget}
                        </div>
                      )}
                      {activeGenerationQuota.dailyTokenRemaining === undefined ||
                      activeGenerationQuota.dailyTokenRemaining === null ? null : (
                        <div className="minimal-quota-item">
                          Daily token remaining: {activeGenerationQuota.dailyTokenRemaining}
                        </div>
                      )}
                      {activeGenerationQuota.dailyRequestBudget === undefined ||
                      activeGenerationQuota.dailyRequestBudget === null ? null : (
                        <div className="minimal-quota-item">
                          Daily request budget: {activeGenerationQuota.dailyRequestBudget}
                        </div>
                      )}
                      {activeGenerationQuota.dailyRequestRemaining === undefined ||
                      activeGenerationQuota.dailyRequestRemaining === null ? null : (
                        <div className="minimal-quota-item">
                          Daily request remaining: {activeGenerationQuota.dailyRequestRemaining}
                        </div>
                      )}
                      {activeGenerationQuota.rpmBudget === undefined ||
                      activeGenerationQuota.rpmBudget === null ? null : (
                        <div className="minimal-quota-item">
                          RPM budget: {activeGenerationQuota.rpmBudget}
                        </div>
                      )}
                      {activeGenerationQuota.rpmRemaining === undefined ||
                      activeGenerationQuota.rpmRemaining === null ? null : (
                        <div className="minimal-quota-item">
                          RPM remaining: {activeGenerationQuota.rpmRemaining}
                        </div>
                      )}
                      {activeGenerationQuota.usedRequestsToday === undefined ||
                      activeGenerationQuota.usedRequestsToday === null ? null : (
                        <div className="minimal-quota-item">
                          Used requests today: {activeGenerationQuota.usedRequestsToday}
                        </div>
                      )}
                      {activeGenerationQuota.usedTokensToday === undefined ||
                      activeGenerationQuota.usedTokensToday === null ? null : (
                        <div className="minimal-quota-item">
                          Used tokens today: {activeGenerationQuota.usedTokensToday}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="minimal-muted">No numeric limits available for this model.</p>
                  )}
                  {activeGenerationQuota.dashboardUrl ? (
                    <a href={activeGenerationQuota.dashboardUrl} target="_blank" rel="noreferrer">
                      View provider limits
                    </a>
                  ) : null}
                  {generationQuotaBlockedReason ? (
                    <p className="minimal-error">{generationQuotaBlockedReason}</p>
                  ) : null}
                </>
              ) : (
                <p className="minimal-muted">Quota snapshot unavailable.</p>
              )}
            </div>
          ) : (
            <p className="minimal-muted">Generation options unavailable. Reload job options.</p>
          )}
          {generationError ? <p className="minimal-error">{generationError}</p> : null}
          {generationSuccess ? <p className="minimal-success">{generationSuccess}</p> : null}
        </div>
        <p className="minimal-help">Paste the assignment markdown from your LLM.</p>
        <textarea
          aria-label="Draft markdown"
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          rows={14}
        />
        {validation?.errors?.length ? (
          <div className="minimal-alert">
            <strong>Validation errors</strong>
            <ul>
              {validation.errors.map((error, index) => (
                <li key={`${error}-${index}`}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {validation?.warnings?.length ? (
          <div className="minimal-alert warning">
            <strong>Warnings</strong>
            <ul>
              {validation.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {validationError ? <p className="minimal-error">{validationError}</p> : null}
        {draftError ? <p className="minimal-error">{draftError}</p> : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>7. Publish</h2>
          <button
            type="button"
            className="minimal-primary"
            onClick={() => void handlePublish()}
            disabled={!canPublishWithPreview}
          >
            {publishing ? 'Publishing...' : 'Publish assignment'}
          </button>
        </div>
        <div className="minimal-inline">
          <button
            type="button"
            className="minimal-secondary"
            onClick={() => void handlePreviewDraft()}
            disabled={previewing || draftText.trim().length === 0}
          >
            {previewing ? 'Rendering preview...' : 'Preview current draft'}
          </button>
          <span className={previewReadyForCurrentDraft ? 'minimal-success' : 'minimal-muted'}>
            {previewReadyForCurrentDraft
              ? 'Preview ready for current draft.'
              : 'Preview required before publish.'}
          </span>
        </div>
        <label className="minimal-select">
          Preset
          <select
            value={selectedPreset}
            onChange={(event) => setSelectedPreset(event.target.value)}
            disabled={!jobOptions || presetOptions.length === 0}
          >
            {presetOptions.length > 0 ? null : <option value="">No presets available</option>}
            {presetOptions.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="minimal-select">
          TTS provider
          <select
            value={selectedTtsProvider}
            onChange={(event) => setSelectedTtsProvider(event.target.value as UiTtsProvider)}
            disabled={ttsProviders.length === 0}
          >
            {ttsProviders.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>
        <label className="minimal-select">
          Study text strategy
          <select
            value={selectedTtsStrategy}
            onChange={(event) => setSelectedTtsStrategy(event.target.value as UiPublishTtsStrategy)}
          >
            {availablePublishTtsStrategies.map((strategy) => (
              <option key={strategy} value={strategy}>
                {formatPublishTtsStrategyLabel(strategy)}
              </option>
            ))}
          </select>
        </label>
        <label className="minimal-select">
          TTS model
          <select
            value={selectedTtsModel}
            onChange={(event) => setSelectedTtsModel(event.target.value)}
            disabled={publishModelSelectionDisabled || selectedTtsModelOptions.length === 0}
          >
            {publishModelSelectionDisabled ? (
              <option value="">Auto follows the draft</option>
            ) : selectedTtsModelOptions.length === 0 ? (
              <option value="">No models available</option>
            ) : null}
            {selectedTtsModelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
        {publishModelSelectionDisabled ? (
          <p className="minimal-muted">
            Auto follows the draft at runtime; choose Dialogue or TTS to lock a model.
          </p>
        ) : null}
        <label className="minimal-select">
          Publish to
          <select
            value={publishTarget}
            onChange={(event) =>
              setPublishTarget(event.target.value as 'notion' | 'anytype' | 'html')
            }
          >
            <option value="notion">Notion</option>
            <option value="anytype">Anytype</option>
            <option value="html">HTML page</option>
          </select>
        </label>
        <p className="minimal-help">
          Preview then publish. Publish is enabled only for the currently previewed draft revision.
        </p>
        {previewError ? <p className="minimal-error">{previewError}</p> : null}
        {previewHtml ? (
          <details className="minimal-preview" open>
            <summary>Preview panel</summary>
            <iframe className="minimal-preview-frame" srcDoc={previewHtml} title="Draft preview" />
          </details>
        ) : null}
        {publishError ? <p className="minimal-error">{publishError}</p> : null}
        {jobStatus?.state === 'failed' && jobStatus.error ? (
          <p className="minimal-error">{describeJobFailureReason(jobStatus)}</p>
        ) : null}
        {jobReady ? (
          <div className="minimal-meta">
            <span>Job ID: {jobStatus?.jobId}</span>
            <span>Status: {jobStatus?.state}</span>
            {publishUrl ? (
              <a href={publishUrl} target="_blank" rel="noreferrer">
                {publishLabel}
              </a>
            ) : (
              <span className="minimal-muted">{publishPending}</span>
            )}
          </div>
        ) : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>8. Job actions</h2>
          <button type="button" className="minimal-secondary" onClick={() => void loadJobOptions()}>
            Refresh actions
          </button>
        </div>
        {jobReady ? (
          <>
            <p className="minimal-help">
              Choose exactly what to regenerate. Audio families you do not select stay as-is, and
              any regeneration automatically uploads fresh artifacts and refreshes the published
              result.
            </p>
            <div className="minimal-meta">
              <span>Job ID: {jobStatus?.jobId}</span>
              <span>State: {jobStatus?.state}</span>
            </div>
            <div className="minimal-grid">
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void handleRepublishCurrentDraft()}
                disabled={!rerunEnabled}
              >
                {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Republish current draft'}
              </button>
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void handleRegeneratePronunciationAudio()}
                disabled={!rerunEnabled}
              >
                {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Regenerate pronunciation audio'}
              </button>
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void handleRegenerateStudyTextAudio()}
                disabled={!rerunEnabled}
              >
                {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Regenerate study-text audio'}
              </button>
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void handleRegenerateAllAudio()}
                disabled={!rerunEnabled}
              >
                {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Regenerate all audio'}
              </button>
              <button
                type="button"
                className="minimal-secondary"
                onClick={() => setShowCustomRerun((current) => !current)}
                disabled={!rerunEnabled}
              >
                {showCustomRerun ? 'Hide custom rerun' : 'Custom rerun'}
              </button>
            </div>
            <p className="minimal-help">
              Pronunciation chunks default to `edge-tts`, except `connected_speech`, which defaults
              to ElevenLabs.
            </p>
            {showCustomRerun ? (
              <div className="minimal-block">
                <div className="minimal-grid">
                  <label className="minimal-checkbox">
                    <input
                      type="checkbox"
                      checked={rerunStudyTextAudio}
                      onChange={(event) => setRerunStudyTextAudio(event.target.checked)}
                    />
                    <span>Study-text audio</span>
                  </label>
                  <label className="minimal-checkbox">
                    <input
                      type="checkbox"
                      checked={rerunPronunciationMainAudio}
                      onChange={(event) => setRerunPronunciationMainAudio(event.target.checked)}
                    />
                    <span>Main pronunciation audio</span>
                  </label>
                  <label className="minimal-checkbox">
                    <input
                      type="checkbox"
                      checked={rerunPronunciationChunkAudio}
                      onChange={(event) => setRerunPronunciationChunkAudio(event.target.checked)}
                    />
                    <span>Pronunciation chunk audio</span>
                  </label>
                </div>
                <p className="minimal-help">{customRerunSummary.join(' • ')}</p>
                {rerunStudyTextAudio ? (
                  <div className="minimal-grid">
                    <label className="minimal-field">
                      <span>Study-text provider</span>
                      <select
                        value={rerunStudyTextProvider}
                        onChange={(event) =>
                          setRerunStudyTextProvider(event.target.value as UiTtsProvider)
                        }
                      >
                        {ttsProviders.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Study-text model</span>
                      <select
                        value={rerunStudyTextModel}
                        onChange={(event) => setRerunStudyTextModel(event.target.value)}
                      >
                        {rerunStudyTextProvider === 'google' ? (
                          googleTtsModelOptions.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))
                        ) : rerunStudyTextStrategy === 'auto' ? (
                          <option value="">
                            Strategy default (`dialogue` {`->`} `eleven_v3`, `tts` {`->`}{' '}
                            `eleven_multilingual_v2`)
                          </option>
                        ) : rerunStudyTextStrategy === 'dialogue' ? (
                          <>
                            <option value="">Dialogue default (`eleven_v3`)</option>
                            <option value="eleven_v3">eleven_v3</option>
                          </>
                        ) : (
                          <>
                            <option value="">TTS default (`eleven_multilingual_v2`)</option>
                            {elevenlabsStandardModelOptions.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Study-text voice ID</span>
                      <input
                        value={rerunStudyTextVoiceId}
                        onChange={(event) => setRerunStudyTextVoiceId(event.target.value)}
                        placeholder="voice id override"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Study-text accent</span>
                      <input
                        value={rerunStudyTextVoiceAccent}
                        onChange={(event) => setRerunStudyTextVoiceAccent(event.target.value)}
                        placeholder="accent override"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Study-text strategy</span>
                      <select
                        value={rerunStudyTextStrategy}
                        onChange={(event) =>
                          setRerunStudyTextStrategy(
                            event.target.value as 'auto' | 'dialogue' | 'tts',
                          )
                        }
                      >
                        {(jobOptions?.ttsStrategies?.length
                          ? jobOptions.ttsStrategies
                          : ['auto', 'dialogue', 'tts']
                        ).map((strategy) => (
                          <option key={strategy} value={strategy}>
                            {strategy}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Dialogue language</span>
                      <input
                        value={rerunStudyTextDialogueLanguage}
                        onChange={(event) => setRerunStudyTextDialogueLanguage(event.target.value)}
                        placeholder="e.g. es"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Dialogue stability (0..1)</span>
                      <input
                        value={rerunStudyTextDialogueStability}
                        onChange={(event) => setRerunStudyTextDialogueStability(event.target.value)}
                        placeholder="0.42"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Dialogue seed (integer)</span>
                      <input
                        value={rerunStudyTextDialogueSeed}
                        onChange={(event) => setRerunStudyTextDialogueSeed(event.target.value)}
                        placeholder="7"
                      />
                    </label>
                  </div>
                ) : null}
                {rerunPronunciationMainAudio ? (
                  <div className="minimal-grid">
                    <label className="minimal-field">
                      <span>Main pronunciation provider</span>
                      <select
                        value={rerunPronunciationMainProvider}
                        onChange={(event) =>
                          setRerunPronunciationMainProvider(event.target.value as UiTtsProvider)
                        }
                      >
                        {ttsProviders.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Main pronunciation model</span>
                      <select
                        value={rerunPronunciationMainModel}
                        onChange={(event) => setRerunPronunciationMainModel(event.target.value)}
                      >
                        {(rerunPronunciationMainProvider === 'google'
                          ? googleTtsModelOptions
                          : elevenlabsStandardModelOptions
                        ).map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Main pronunciation voice ID</span>
                      <input
                        value={rerunPronunciationMainVoiceId}
                        onChange={(event) => setRerunPronunciationMainVoiceId(event.target.value)}
                        placeholder="voice id override"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Main pronunciation accent</span>
                      <input
                        value={rerunPronunciationMainVoiceAccent}
                        onChange={(event) =>
                          setRerunPronunciationMainVoiceAccent(event.target.value)
                        }
                        placeholder="accent override"
                      />
                    </label>
                  </div>
                ) : null}
                {rerunPronunciationChunkAudio ? (
                  <div className="minimal-grid">
                    <label className="minimal-field">
                      <span>Pronunciation chunk provider</span>
                      <select
                        value={rerunPronunciationChunkProvider}
                        onChange={(event) => {
                          setRerunPronunciationChunkProviderDirty(true);
                          setRerunPronunciationChunkProvider(
                            event.target.value as UiPronunciationChunkTtsProvider,
                          );
                        }}
                      >
                        {FALLBACK_PRONUNCIATION_CHUNK_TTS_PROVIDERS.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </label>
                    {rerunPronunciationChunkProvider === 'edge-tts' ? (
                      <label className="minimal-field">
                        <span>Edge voice</span>
                        <input
                          value={rerunPronunciationChunkEdgeVoice}
                          onChange={(event) =>
                            setRerunPronunciationChunkEdgeVoice(event.target.value)
                          }
                          placeholder="e.g. en-US-AriaNeural"
                        />
                      </label>
                    ) : (
                      <>
                        <label className="minimal-field">
                          <span>Pronunciation chunk model</span>
                          <select
                            value={rerunPronunciationChunkModel}
                            onChange={(event) =>
                              setRerunPronunciationChunkModel(event.target.value)
                            }
                          >
                            {(rerunPronunciationChunkProvider === 'google'
                              ? googleTtsModelOptions
                              : elevenlabsStandardModelOptions
                            ).map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="minimal-field">
                          <span>Pronunciation chunk voice ID</span>
                          <input
                            value={rerunPronunciationChunkVoiceId}
                            onChange={(event) =>
                              setRerunPronunciationChunkVoiceId(event.target.value)
                            }
                            placeholder="voice id override"
                          />
                        </label>
                        <label className="minimal-field">
                          <span>Pronunciation chunk accent</span>
                          <input
                            value={rerunPronunciationChunkVoiceAccent}
                            onChange={(event) =>
                              setRerunPronunciationChunkVoiceAccent(event.target.value)
                            }
                            placeholder="accent override"
                          />
                        </label>
                      </>
                    )}
                  </div>
                ) : null}
                <div className="minimal-inline">
                  <button
                    type="button"
                    className="minimal-primary"
                    onClick={() => void handleCustomRerun()}
                    disabled={!rerunEnabled || !customRerunHasSelection}
                  >
                    {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Queue custom rerun'}
                  </button>
                </div>
                <p className="minimal-help">
                  `eleven_v3` is dialogue-only. `eleven_flash_v2` is the only ElevenLabs model that
                  supports IPA. `eleven_flash_v2_5` is the fast, cheap pronunciation option.
                </p>
              </div>
            ) : null}
            <div className="minimal-block">
              <div className="minimal-inline">
                <label className="minimal-field grow">
                  <span>Cancel reason (optional)</span>
                  <input
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    placeholder="reason for cancellation"
                  />
                </label>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void handleCancelJob()}
                  disabled={!cancelEnabled}
                >
                  {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel job'}
                </button>
              </div>
              {!cancelAllowedState && jobStatus ? (
                <p className="minimal-muted">
                  Cancel is only available for queued or running jobs.
                </p>
              ) : null}
            </div>
            {jobOptionsError ? <p className="minimal-error">{jobOptionsError}</p> : null}
            {!rerunImplemented || !cancelImplemented ? (
              <p className="minimal-muted">
                Some actions are unavailable because backend capability metadata does not mark them
                as implemented.
              </p>
            ) : null}
            {actionError ? <p className="minimal-error">{actionError}</p> : null}
            {actionSuccess ? <p className="minimal-success">{actionSuccess}</p> : null}
            <div className="minimal-block">
              <div className="minimal-section-header">
                <p className="minimal-help">Assignment provenance and lineage</p>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => jobStatus?.jobId && void loadJobProvenance(jobStatus.jobId)}
                  disabled={jobProvenanceLoading}
                >
                  {jobProvenanceLoading ? 'Refreshing...' : 'Refresh provenance'}
                </button>
              </div>
              {jobProvenanceError ? <p className="minimal-error">{jobProvenanceError}</p> : null}
              {jobProvenance ? (
                <>
                  <div className="minimal-meta">
                    <span>Source job: {jobProvenance.job.sourceJobId ?? 'none'}</span>
                    <span>Prompt package: {jobProvenance.promptPackage?.id ?? 'none'}</span>
                    <span>Draft: {jobProvenance.draft?.id ?? 'none'}</span>
                  </div>
                  {jobProvenance.tts ? (
                    <div className="minimal-meta">
                      <span>TTS provider: {jobProvenance.tts.provider ?? 'unknown'}</span>
                      <span>
                        Generated chars: {jobProvenance.tts.generatedCharacters ?? 0} (cached:{' '}
                        {jobProvenance.tts.cachedCharacters ?? 0})
                      </span>
                      <span>
                        Estimated spend:{' '}
                        {typeof jobProvenance.tts.estimatedSpendUsd === 'number'
                          ? `$${jobProvenance.tts.estimatedSpendUsd.toFixed(4)}`
                          : 'n/a'}
                      </span>
                    </div>
                  ) : null}
                  {jobProvenance.lineage?.profile?.snapshot?.revisionId ||
                  jobProvenance.lineage?.template?.snapshot?.revisionId ? (
                    <div className="minimal-meta">
                      <span>
                        Profile revision:{' '}
                        {jobProvenance.lineage?.profile?.snapshot?.revisionId ?? 'unknown'}
                      </span>
                      <span>
                        Template revision:{' '}
                        {jobProvenance.lineage?.template?.snapshot?.revisionId ?? 'unknown'}
                      </span>
                    </div>
                  ) : null}
                  {jobProvenance.lineage?.bindingAtCreation ? (
                    <div className="minimal-meta">
                      <span>
                        Bound profile at creation:{' '}
                        {jobProvenance.lineage.bindingAtCreation.profileId}
                      </span>
                      <span>
                        Bound from:{' '}
                        {new Date(
                          jobProvenance.lineage.bindingAtCreation.effectiveFrom,
                        ).toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                  {jobProvenance.actions.length > 0 ? (
                    <div className="minimal-list">
                      {jobProvenance.actions.slice(0, 6).map((event) => (
                        <div key={event.id} className="minimal-list-item">
                          <span>
                            {event.actionType} • {event.outcome} •{' '}
                            {new Date(event.requestedAt).toLocaleString()}
                          </span>
                          <span className="minimal-muted">{event.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="minimal-muted">No action audit events yet.</p>
                  )}
                </>
              ) : (
                <p className="minimal-muted">Provenance details will appear once loaded.</p>
              )}
            </div>
          </>
        ) : (
          <p className="minimal-help">
            Publish once to create a job, then actions become available.
          </p>
        )}
      </section>

      <style>{`
        .minimal-assignment {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .minimal-section {
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xl);
          padding: var(--space-5);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .minimal-section-compact {
          gap: var(--space-2);
        }

        .minimal-pinned-job {
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          padding: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .minimal-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          flex-wrap: wrap;
        }

        .minimal-section h2 {
          margin: 0;
          font-size: var(--text-lg);
        }

        .minimal-help {
          margin: 0;
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }

        .minimal-muted {
          color: var(--text-tertiary);
          font-size: var(--text-xs);
        }

        .minimal-success {
          margin: 0;
          color: #0f8b4c;
          font-size: var(--text-sm);
        }

        .minimal-primary,
        .minimal-secondary {
          padding: var(--space-2) var(--space-4);
          border-radius: var(--radius-full);
          font-size: var(--text-sm);
          cursor: pointer;
          border: 1px solid transparent;
          transition: background var(--transition-fast), border-color var(--transition-fast);
        }

        .minimal-primary {
          background: var(--color-primary-600);
          color: white;
        }

        .minimal-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .minimal-secondary {
          background: var(--bg-secondary);
          border-color: var(--border-medium);
          color: var(--text-primary);
        }

        .minimal-inline {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          flex-wrap: wrap;
        }

        .minimal-block {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .minimal-action-row {
          display: grid;
          gap: var(--space-3);
        }

        .minimal-action-card {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          padding: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .minimal-generation-block {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          padding: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .minimal-quota-panel {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          background: var(--bg-primary);
          padding: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .minimal-quota-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: var(--space-2);
        }

        .minimal-quota-item {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: var(--space-2);
          background: var(--bg-secondary);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .minimal-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .minimal-list-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          font-size: var(--text-sm);
        }

        .minimal-grid {
          display: grid;
          gap: var(--space-3);
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .minimal-field {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .minimal-field.grow {
          flex: 1;
          min-width: 240px;
        }

        .minimal-field input,
        .minimal-field select {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          background: var(--bg-secondary);
        }

        .minimal-checkbox {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .minimal-select {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .minimal-select select {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          background: var(--bg-secondary);
        }

        textarea {
          width: 100%;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          padding: var(--space-3);
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          background: var(--bg-secondary);
        }

        .minimal-meta {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-3);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .minimal-error {
          color: var(--color-error-500);
          font-size: var(--text-sm);
          margin: 0;
        }

        .minimal-alert {
          border: 1px solid rgba(239, 68, 68, 0.2);
          background: rgba(239, 68, 68, 0.08);
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          font-size: var(--text-sm);
        }

        .minimal-alert.warning {
          border-color: rgba(245, 158, 11, 0.2);
          background: rgba(245, 158, 11, 0.08);
        }

        .minimal-alert ul {
          margin: var(--space-2) 0 0;
          padding-left: var(--space-4);
          display: grid;
          gap: var(--space-1);
        }

        .minimal-preview {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          padding: var(--space-2) var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .minimal-preview summary {
          cursor: pointer;
          font-size: var(--text-sm);
          color: var(--text-secondary);
          font-weight: 600;
        }

        .minimal-preview-frame {
          width: 100%;
          min-height: 480px;
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          background: white;
        }

        a {
          color: var(--color-primary-600);
          text-decoration: none;
          font-weight: 600;
        }

        a:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
};
