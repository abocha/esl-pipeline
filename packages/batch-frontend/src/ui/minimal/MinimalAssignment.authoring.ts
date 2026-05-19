import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type {
  DraftResponse,
  GenerateDraftRequest,
  GenerateDraftResponse,
  JobOptionsResponse,
  JobStatus,
  MarkdownValidationResponse,
  PromptPackageResponse,
} from '../../utils/api';
import {
  approveJob,
  createDraft,
  createPromptPackage,
  GenerationDraftApiError,
  generateDraft,
  getJobStatus,
  materializeDraft,
  renderHtmlPreview,
  updateDraft,
  validateMarkdown,
} from '../../utils/api';
import { copyTextToClipboard } from '../../utils/clipboard';
import {
  buildPublishJobOverrides,
  getDraftPreviewGate,
  getNextGenerationQuotaSnapshot,
  hasActiveGenerationQuotaSelection,
  type MinimalPublishTarget,
} from './MinimalAssignment.logic';
import { getGenerationQuotaWindowDecision } from './MinimalAssignment.quota-window';

type UiTtsProvider = 'elevenlabs' | 'google';
type UiPublishTtsStrategy = 'auto' | 'dialogue' | 'tts';
type TranscriptUiStatus = 'idle' | 'loading' | 'processing' | 'ready' | 'failed';
type PronunciationMode =
  | 'shadow_sentence'
  | 'connected_speech'
  | 'intonation'
  | 'rhythm_chunking'
  | 'sentence_stress'
  | 'minimal_pair';
type GenerationOptions = NonNullable<JobOptionsResponse['generation']>;
type GenerationModelOption = GenerationOptions['modelOptions'][number];
const FALLBACK_ELEVENLABS_STANDARD_MODEL = 'eleven_multilingual_v2';

function normalizePresetSelection(
  availablePresets: readonly string[] | undefined,
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

const DEFAULT_TTS_PROVIDER: UiTtsProvider = 'elevenlabs';
const DEFAULT_TTS_STRATEGY: UiPublishTtsStrategy = 'auto';
const DEFAULT_PUBLISH_TARGET: MinimalPublishTarget = 'html';
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 1500;
const DRAFT_AUTOSAVE_MIN_INTERVAL_MS = 5000;

export interface AuthoringHydrationSnapshot {
  publishTarget: MinimalPublishTarget;
  selectedTtsProvider: UiTtsProvider;
  selectedTtsStrategy: UiPublishTtsStrategy;
  selectedTtsModel: string;
  selectedPreset: string;
  selectedGenerationProvider: string;
  selectedGenerationModel: string;
  promptPackage: PromptPackageResponse | null;
  promptText: string;
  promptError: string | null;
  draft: DraftResponse | null;
  draftText: string;
  draftError: string | null;
  publishError: string | null;
  previewHtml: string | null;
  previewError: string | null;
  lastPreviewedDraftHash: string | null;
  validation: MarkdownValidationResponse | null;
  validationError: string | null;
}

export interface AuthoringState extends AuthoringHydrationSnapshot {
  promptLoading: boolean;
  promptCopyState: 'idle' | 'copied' | 'error';
  generatingDraft: boolean;
  generationError: string | null;
  generationSuccess: string | null;
  selectedGenerationProvider: string;
  selectedGenerationModel: string;
  generationRuntimeQuotaSnapshot: GenerateDraftResponse['quota'] | null;
  generationRuntimeSelection: { provider: string; model: string } | null;
  quotaWindowTickMs: number;
  validating: boolean;
  previewing: boolean;
  publishing: boolean;
}

export type AuthoringAction =
  | {
      type: 'reset_authoring';
      payload: {
        publishTarget: MinimalPublishTarget;
        selectedPreset: string;
      };
    }
  | { type: 'hydrate_authoring_snapshot'; payload: AuthoringHydrationSnapshot }
  | { type: 'prompt_generate_started' }
  | { type: 'prompt_error_set'; payload: { error: string | null } }
  | {
      type: 'prompt_generate_succeeded';
      payload: { promptPackage: PromptPackageResponse; promptText: string };
    }
  | { type: 'prompt_generate_failed'; payload: { error: string } }
  | { type: 'prompt_text_changed'; payload: { value: string } }
  | { type: 'prompt_copy_state_changed'; payload: { value: AuthoringState['promptCopyState'] } }
  | { type: 'draft_text_changed'; payload: { value: string } }
  | { type: 'draft_generate_started' }
  | {
      type: 'draft_generate_succeeded';
      payload: {
        draftText: string;
        quota: GenerateDraftResponse['quota'] | null;
        runtimeSelection: { provider: string; model: string };
        successMessage: string;
        quotaWindowTickMs: number;
      };
    }
  | { type: 'draft_generate_failed'; payload: { error: string } }
  | { type: 'draft_save_started' }
  | {
      type: 'draft_save_succeeded';
      payload: { draft: DraftResponse; preserveCurrentText?: boolean };
    }
  | { type: 'draft_save_failed'; payload: { error: string } }
  | { type: 'validation_started' }
  | { type: 'validation_succeeded'; payload: { validation: MarkdownValidationResponse } }
  | { type: 'validation_failed'; payload: { error: string } }
  | { type: 'validation_cleared' }
  | { type: 'preview_started' }
  | {
      type: 'preview_succeeded';
      payload: { html: string; lastPreviewedDraftHash: string };
    }
  | { type: 'preview_failed'; payload: { error: string } }
  | { type: 'preview_invalidated' }
  | {
      type: 'publish_config_updated';
      payload: Partial<
        Pick<
          AuthoringState,
          | 'publishTarget'
          | 'selectedTtsProvider'
          | 'selectedTtsStrategy'
          | 'selectedTtsModel'
          | 'selectedPreset'
          | 'selectedGenerationProvider'
          | 'selectedGenerationModel'
        >
      >;
    }
  | { type: 'publish_started' }
  | { type: 'publish_succeeded' }
  | { type: 'publish_failed'; payload: { error: string } }
  | { type: 'publish_error_set'; payload: { error: string | null } }
  | { type: 'invalidate_generation_requests' }
  | { type: 'quota_window_tick'; payload: { nowMs: number } };

function createInitialAuthoringState(
  overrides: Partial<
    Pick<AuthoringState, 'publishTarget' | 'selectedPreset' | 'selectedTtsProvider'>
  > = {},
): AuthoringState {
  return {
    promptPackage: null,
    promptText: '',
    promptLoading: false,
    promptError: null,
    promptCopyState: 'idle',
    draft: null,
    draftText: '',
    draftError: null,
    generatingDraft: false,
    generationError: null,
    generationSuccess: null,
    selectedGenerationProvider: '',
    selectedGenerationModel: '',
    generationRuntimeQuotaSnapshot: null,
    generationRuntimeSelection: null,
    quotaWindowTickMs: Date.now(),
    validation: null,
    validationError: null,
    validating: false,
    previewHtml: null,
    previewError: null,
    previewing: false,
    lastPreviewedDraftHash: null,
    publishTarget: overrides.publishTarget ?? DEFAULT_PUBLISH_TARGET,
    selectedTtsProvider: overrides.selectedTtsProvider ?? DEFAULT_TTS_PROVIDER,
    selectedTtsStrategy: DEFAULT_TTS_STRATEGY,
    selectedTtsModel: '',
    selectedPreset: overrides.selectedPreset ?? '',
    publishing: false,
    publishError: null,
  };
}

function authoringReducer(state: AuthoringState, action: AuthoringAction): AuthoringState {
  switch (action.type) {
    case 'reset_authoring':
      return createInitialAuthoringState({
        publishTarget: action.payload.publishTarget,
        selectedPreset: action.payload.selectedPreset,
      });
    case 'hydrate_authoring_snapshot':
      return {
        ...createInitialAuthoringState({
          publishTarget: action.payload.publishTarget,
          selectedPreset: action.payload.selectedPreset,
          selectedTtsProvider: action.payload.selectedTtsProvider,
        }),
        ...action.payload,
      };
    case 'prompt_generate_started':
      return {
        ...state,
        promptLoading: true,
        promptError: null,
        generationError: null,
        generationSuccess: null,
      };
    case 'prompt_error_set':
      return {
        ...state,
        promptError: action.payload.error,
      };
    case 'prompt_generate_succeeded':
      return {
        ...state,
        promptLoading: false,
        promptPackage: action.payload.promptPackage,
        promptText: action.payload.promptText,
      };
    case 'prompt_generate_failed':
      return {
        ...state,
        promptLoading: false,
        promptError: action.payload.error,
      };
    case 'prompt_text_changed':
      return {
        ...state,
        promptText: action.payload.value,
      };
    case 'prompt_copy_state_changed':
      return {
        ...state,
        promptCopyState: action.payload.value,
      };
    case 'draft_text_changed': {
      if (state.draftText === action.payload.value) {
        return state;
      }
      return {
        ...state,
        draftText: action.payload.value,
      };
    }
    case 'draft_generate_started':
      return {
        ...state,
        generatingDraft: true,
        generationError: null,
        generationSuccess: null,
      };
    case 'draft_generate_succeeded':
      return {
        ...state,
        generatingDraft: false,
        draft: null,
        draftText: action.payload.draftText,
        draftError: null,
        validation: null,
        validationError: null,
        previewHtml: null,
        previewError: null,
        lastPreviewedDraftHash: null,
        generationRuntimeQuotaSnapshot: getNextGenerationQuotaSnapshot(
          state.generationRuntimeQuotaSnapshot,
          { kind: 'success', quota: action.payload.quota },
        ),
        generationRuntimeSelection: action.payload.runtimeSelection,
        quotaWindowTickMs: action.payload.quotaWindowTickMs,
        generationSuccess: action.payload.successMessage,
      };
    case 'draft_generate_failed':
      return {
        ...state,
        generatingDraft: false,
        generationError: action.payload.error,
      };
    case 'draft_save_started':
      return {
        ...state,
        draftError: null,
      };
    case 'draft_save_succeeded':
      return {
        ...state,
        draft: action.payload.draft,
        draftText: action.payload.preserveCurrentText
          ? state.draftText
          : (action.payload.draft.text ?? state.draftText),
        draftError: null,
      };
    case 'draft_save_failed':
      return {
        ...state,
        draftError: action.payload.error,
      };
    case 'validation_started':
      return {
        ...state,
        validating: true,
        validationError: null,
      };
    case 'validation_succeeded':
      return {
        ...state,
        validating: false,
        validation: action.payload.validation,
      };
    case 'validation_failed':
      return {
        ...state,
        validating: false,
        validationError: action.payload.error,
      };
    case 'validation_cleared':
      return {
        ...state,
        validation: null,
        validationError: null,
      };
    case 'preview_started':
      return {
        ...state,
        previewing: true,
        previewError: null,
      };
    case 'preview_succeeded':
      return {
        ...state,
        previewing: false,
        previewHtml: action.payload.html,
        lastPreviewedDraftHash: action.payload.lastPreviewedDraftHash,
      };
    case 'preview_failed':
      return {
        ...state,
        previewing: false,
        previewError: action.payload.error,
        previewHtml: null,
        lastPreviewedDraftHash: null,
      };
    case 'preview_invalidated':
      return {
        ...state,
        previewHtml: null,
        previewError: null,
        lastPreviewedDraftHash: null,
      };
    case 'publish_config_updated':
      return {
        ...state,
        ...action.payload,
      };
    case 'publish_started':
      return {
        ...state,
        publishing: true,
        publishError: null,
      };
    case 'publish_succeeded':
      return {
        ...state,
        publishing: false,
      };
    case 'publish_failed':
      return {
        ...state,
        publishing: false,
        publishError: action.payload.error,
      };
    case 'publish_error_set':
      return {
        ...state,
        publishError: action.payload.error,
      };
    case 'invalidate_generation_requests':
      return {
        ...state,
        generatingDraft: false,
      };
    case 'quota_window_tick':
      return {
        ...state,
        quotaWindowTickMs: action.payload.nowMs,
      };
    default:
      return state;
  }
}

function mapGenerationError(error: unknown): string {
  const candidate = error as { code?: unknown; requestId?: unknown };
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
}

interface UseMinimalAssignmentAuthoringControllerParams {
  recordingId: string | null;
  lessonId?: string | null;
  transcriptStatus: TranscriptUiStatus;
  teacherNotes: string;
  selectedProfileId: string;
  selectedTemplateId: string;
  currentJobId: string | null;
  learningPresetCatalogEnabled: boolean;
  presetOptionIds: readonly string[];
  generationOptions: GenerationOptions | null;
  ttsProviders: readonly UiTtsProvider[];
  ttsModelOptionsByProvider: { elevenlabs: readonly string[]; google: readonly string[] };
  elevenlabsModelOptions: readonly string[];
  elevenlabsStandardModelOptions: readonly string[];
  googleTtsModelOptions: readonly string[];
  defaultTtsProvider: UiTtsProvider | null;
  defaultTtsModelByProvider: JobOptionsResponse['defaultTtsModelByProvider'] | null | undefined;
  configuredTtsStrategies: readonly UiPublishTtsStrategy[];
  onDraftPronunciationModeDetected: (mode: PronunciationMode | null) => void;
  onTeacherNotesResolved: (value: string) => void;
}

export interface AuthoringController extends AuthoringState {
  generationProviders: readonly string[];
  generationModelsForProvider: GenerationModelOption[];
  promptReady: boolean;
  draftDirty: boolean;
  draftPreviewGate: ReturnType<typeof getDraftPreviewGate>;
  previewReadyForCurrentDraft: boolean;
  canPublishWithPreview: boolean;
  activeGenerationQuota: GenerateDraftResponse['quota'] | null;
  generationQuotaSourceLabel: string | null;
  generationQuotaUpdatedRelative: string | null;
  generationQuotaUpdatedAbsolute: string | null;
  generationQuotaHasNumericValues: boolean;
  generationQuotaBlockedReason: string | null;
  generationBlockedByQuota: boolean;
  shouldTrackQuotaWindow: boolean;
  availablePublishTtsStrategies: readonly UiPublishTtsStrategy[];
  publishModelSelectionDisabled: boolean;
  publishElevenlabsModelOptions: readonly string[];
  selectedTtsModelOptions: readonly string[];
  setPromptText: (value: string) => void;
  setDraftText: (value: string) => void;
  setSelectedGenerationProvider: (value: string) => void;
  setSelectedGenerationModel: (value: string) => void;
  setPublishTarget: (value: MinimalPublishTarget) => void;
  setSelectedTtsProvider: (value: UiTtsProvider) => void;
  setSelectedTtsStrategy: (value: UiPublishTtsStrategy) => void;
  setSelectedTtsModel: (value: string) => void;
  setSelectedPreset: (value: string) => void;
  setPublishError: (value: string | null) => void;
  setPromptError: (value: string | null) => void;
  generatePrompt: () => Promise<void>;
  copyPrompt: () => Promise<void>;
  generateDraft: () => Promise<GenerateDraftResponse | null>;
  runValidation: () => Promise<MarkdownValidationResponse>;
  saveDraft: () => Promise<DraftResponse | null>;
  previewDraft: () => Promise<void>;
  publishAssignment: (params: {
    onPublishedJob: (job: JobStatus) => void;
    refreshResumeJobs: () => Promise<unknown>;
    completeAssignmentSession?: () => Promise<unknown>;
  }) => Promise<void>;
  applyHydrationSnapshot: (snapshot: AuthoringHydrationSnapshot) => void;
  resetAuthoring: () => void;
  invalidatePendingGeneration: () => void;
}

export function useMinimalAssignmentAuthoringController({
  recordingId,
  lessonId,
  transcriptStatus,
  teacherNotes,
  selectedProfileId,
  selectedTemplateId,
  currentJobId,
  learningPresetCatalogEnabled,
  presetOptionIds,
  generationOptions,
  ttsProviders,
  ttsModelOptionsByProvider,
  elevenlabsModelOptions,
  elevenlabsStandardModelOptions,
  googleTtsModelOptions,
  defaultTtsProvider,
  defaultTtsModelByProvider,
  configuredTtsStrategies,
  onDraftPronunciationModeDetected,
  onTeacherNotesResolved,
}: UseMinimalAssignmentAuthoringControllerParams): AuthoringController {
  const [state, dispatch] = useReducer(authoringReducer, undefined, () =>
    createInitialAuthoringState(),
  );
  const generationRequestVersionRef = useRef(0);
  const authoringPersistenceVersionRef = useRef(0);
  const promptCopyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTextRef = useRef('');
  const draftAutosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftAutosaveLastSavedAtRef = useRef(0);
  const draftAutosaveInFlightRef = useRef(false);
  const draftAutosavePendingRef = useRef(false);
  const [draftAutosaveRescheduleToken, requestDraftAutosaveReschedule] = useReducer(
    (value: number) => value + 1,
    0,
  );

  const generationProviders = useMemo(
    () => generationOptions?.providers ?? [],
    [generationOptions],
  );
  const generationModelOptions = useMemo(
    () => generationOptions?.modelOptions ?? [],
    [generationOptions],
  );
  const generationModelsForProvider = useMemo(
    () =>
      generationModelOptions.filter(
        (option) => option.provider === state.selectedGenerationProvider,
      ),
    [generationModelOptions, state.selectedGenerationProvider],
  );
  const availablePublishTtsStrategies = useMemo<UiPublishTtsStrategy[]>(() => {
    if (configuredTtsStrategies.length > 0) {
      return [...configuredTtsStrategies];
    }
    return state.selectedTtsStrategy === 'auto' ? ['auto'] : [state.selectedTtsStrategy, 'auto'];
  }, [configuredTtsStrategies, state.selectedTtsStrategy]);
  const publishElevenlabsModelOptions = useMemo(() => {
    if (state.selectedTtsStrategy === 'dialogue') {
      return elevenlabsModelOptions.includes('eleven_v3')
        ? ['eleven_v3']
        : (['eleven_v3'] as const);
    }
    if (state.selectedTtsStrategy === 'tts') {
      return elevenlabsStandardModelOptions.length > 0
        ? elevenlabsStandardModelOptions
        : [FALLBACK_ELEVENLABS_STANDARD_MODEL];
    }
    return [] as readonly string[];
  }, [elevenlabsModelOptions, elevenlabsStandardModelOptions, state.selectedTtsStrategy]);
  const selectedTtsModelOptions = useMemo(
    () =>
      state.selectedTtsProvider === 'google'
        ? googleTtsModelOptions
        : [...publishElevenlabsModelOptions].filter(Boolean),
    [googleTtsModelOptions, publishElevenlabsModelOptions, state.selectedTtsProvider],
  );
  const publishModelSelectionDisabled =
    state.selectedTtsProvider === 'elevenlabs' && state.selectedTtsStrategy === 'auto';
  const promptReady = Boolean(state.promptPackage?.id && state.promptText.trim().length > 0);
  const draftDirty = useMemo(() => {
    const original = state.draft?.text ?? '';
    return state.draftText.trim() !== original.trim();
  }, [state.draft?.text, state.draftText]);
  const draftPreviewGate = useMemo(
    () =>
      getDraftPreviewGate({
        draftText: state.draftText,
        previewHtml: state.previewHtml,
        lastPreviewedDraftHash: state.lastPreviewedDraftHash,
      }),
    [state.draftText, state.lastPreviewedDraftHash, state.previewHtml],
  );
  const previewReadyForCurrentDraft = draftPreviewGate.previewReady;
  const canPublish = promptReady && state.draftText.trim().length > 0 && !state.publishing;
  const canPublishWithPreview = canPublish && previewReadyForCurrentDraft;
  const activeGenerationQuota =
    state.generationRuntimeQuotaSnapshot ?? generationOptions?.quota ?? null;
  const generationQuotaSourceLabel = activeGenerationQuota
    ? toGenerationQuotaSourceLabel(activeGenerationQuota.source)
    : null;
  const generationQuotaUpdatedRelative = activeGenerationQuota
    ? formatRelativeTimestamp(activeGenerationQuota.lastUpdatedAt, state.quotaWindowTickMs)
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
      state.selectedGenerationProvider as keyof NonNullable<
        typeof generationOptions
      >['defaultModelByProvider']
    ] ?? generationModelsForProvider[0]?.id;
  const activeQuotaAppliesToCurrentSelection = hasActiveGenerationQuotaSelection({
    generationRuntimeQuotaSnapshot: state.generationRuntimeQuotaSnapshot,
    generationRuntimeSelection: state.generationRuntimeSelection,
    selectedGenerationProvider: state.selectedGenerationProvider,
    selectedGenerationModel: state.selectedGenerationModel,
    generationDefaultProvider: generationOptions?.defaultProvider,
    generationDefaultModelForSelection,
    generationOptionsLoaded: Boolean(generationOptions),
  });
  const quotaWindowDecision = getGenerationQuotaWindowDecision({
    quota: activeGenerationQuota,
    quotaWindowTickMs: state.quotaWindowTickMs,
    activeQuotaAppliesToCurrentSelection,
  });
  const generationQuotaBlockedReason = quotaWindowDecision.blockedReason;
  const generationBlockedByQuota = Boolean(generationQuotaBlockedReason);
  const shouldTrackQuotaWindow = quotaWindowDecision.shouldTrackWindow;

  const invalidatePendingGeneration = useCallback(() => {
    generationRequestVersionRef.current += 1;
    dispatch({ type: 'invalidate_generation_requests' });
  }, []);

  const invalidateDraftPersistence = useCallback(() => {
    authoringPersistenceVersionRef.current += 1;
    draftAutosaveInFlightRef.current = false;
    draftAutosavePendingRef.current = false;
    if (draftAutosaveTimeoutRef.current) {
      clearTimeout(draftAutosaveTimeoutRef.current);
      draftAutosaveTimeoutRef.current = null;
    }
  }, []);

  const resetAuthoring = useCallback(() => {
    invalidatePendingGeneration();
    invalidateDraftPersistence();
    if (promptCopyResetTimeoutRef.current) {
      clearTimeout(promptCopyResetTimeoutRef.current);
      promptCopyResetTimeoutRef.current = null;
    }
    dispatch({
      type: 'reset_authoring',
      payload: {
        publishTarget: state.publishTarget,
        selectedPreset: state.selectedPreset,
      },
    });
  }, [
    invalidateDraftPersistence,
    invalidatePendingGeneration,
    state.publishTarget,
    state.selectedPreset,
  ]);

  const applyHydrationSnapshot = useCallback(
    (snapshot: AuthoringHydrationSnapshot) => {
      invalidateDraftPersistence();
      if (promptCopyResetTimeoutRef.current) {
        clearTimeout(promptCopyResetTimeoutRef.current);
        promptCopyResetTimeoutRef.current = null;
      }
      dispatch({ type: 'hydrate_authoring_snapshot', payload: snapshot });
    },
    [invalidateDraftPersistence],
  );

  const setPromptText = useCallback((value: string) => {
    dispatch({ type: 'prompt_text_changed', payload: { value } });
  }, []);

  const setDraftText = useCallback((value: string) => {
    dispatch({ type: 'draft_text_changed', payload: { value } });
  }, []);

  const setSelectedGenerationProvider = useCallback((value: string) => {
    dispatch({ type: 'publish_config_updated', payload: { selectedGenerationProvider: value } });
  }, []);

  const setSelectedGenerationModel = useCallback((value: string) => {
    dispatch({ type: 'publish_config_updated', payload: { selectedGenerationModel: value } });
  }, []);

  const setPublishTarget = useCallback((value: MinimalPublishTarget) => {
    dispatch({ type: 'publish_config_updated', payload: { publishTarget: value } });
  }, []);

  const setSelectedTtsProvider = useCallback((value: UiTtsProvider) => {
    dispatch({ type: 'publish_config_updated', payload: { selectedTtsProvider: value } });
  }, []);

  const setSelectedTtsStrategy = useCallback((value: UiPublishTtsStrategy) => {
    dispatch({ type: 'publish_config_updated', payload: { selectedTtsStrategy: value } });
  }, []);

  const setSelectedTtsModel = useCallback((value: string) => {
    dispatch({ type: 'publish_config_updated', payload: { selectedTtsModel: value } });
  }, []);

  const setSelectedPreset = useCallback((value: string) => {
    dispatch({ type: 'publish_config_updated', payload: { selectedPreset: value } });
  }, []);

  const setPublishError = useCallback((value: string | null) => {
    dispatch({ type: 'publish_error_set', payload: { error: value } });
  }, []);

  const setPromptError = useCallback((value: string | null) => {
    dispatch({ type: 'prompt_error_set', payload: { error: value } });
  }, []);

  const runValidation = useCallback(async (): Promise<MarkdownValidationResponse> => {
    if (!state.draftText.trim()) {
      dispatch({ type: 'validation_cleared' });
      return { ok: false, errors: [], warnings: [] } as MarkdownValidationResponse;
    }
    dispatch({ type: 'validation_started' });
    try {
      const selectedValidationPreset =
        state.selectedPreset && presetOptionIds.includes(state.selectedPreset)
          ? state.selectedPreset
          : null;
      const response = await validateMarkdown(
        state.draftText.trim(),
        true,
        learningPresetCatalogEnabled ? { learningPresetId: selectedValidationPreset } : undefined,
      );
      dispatch({ type: 'validation_succeeded', payload: { validation: response } });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to validate markdown.';
      dispatch({ type: 'validation_failed', payload: { error: message } });
      return { ok: false, errors: [message], warnings: [] } as MarkdownValidationResponse;
    }
  }, [learningPresetCatalogEnabled, presetOptionIds, state.draftText, state.selectedPreset]);

  useEffect(() => {
    draftTextRef.current = state.draftText;
  }, [state.draftText]);

  const persistDraftText = useCallback(
    async (
      text: string,
      options: { preserveCurrentText?: boolean } = {},
    ): Promise<DraftResponse | null> => {
      const normalizedText = text.trim();
      if (!state.promptPackage?.id || !normalizedText) {
        return null;
      }
      const persistenceVersion = authoringPersistenceVersionRef.current;
      const response = state.draft?.id
        ? await updateDraft(state.draft.id, normalizedText)
        : await createDraft(state.promptPackage.id, normalizedText);
      if (authoringPersistenceVersionRef.current !== persistenceVersion) {
        return null;
      }
      const preserveCurrentText =
        options.preserveCurrentText || draftTextRef.current.trim() !== normalizedText;
      dispatch({
        type: 'draft_save_succeeded',
        payload: { draft: response, preserveCurrentText },
      });
      onDraftPronunciationModeDetected(detectPronunciationModeFromDraft(response.text ?? text));
      return response;
    },
    [onDraftPronunciationModeDetected, state.draft?.id, state.promptPackage?.id],
  );

  const saveDraft = useCallback(async (): Promise<DraftResponse | null> => {
    if (!state.promptPackage?.id) {
      dispatch({
        type: 'draft_save_failed',
        payload: { error: 'Generate a prompt package first.' },
      });
      return null;
    }
    if (!state.draftText.trim()) {
      dispatch({
        type: 'draft_save_failed',
        payload: { error: 'Paste the assignment draft text first.' },
      });
      return null;
    }

    const validationResult = await runValidation();
    if (validationResult.errors && validationResult.errors.length > 0) {
      dispatch({
        type: 'draft_save_failed',
        payload: { error: 'Fix validation errors before saving.' },
      });
      return null;
    }

    dispatch({ type: 'draft_save_started' });
    try {
      const response = await persistDraftText(state.draftText);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save draft.';
      dispatch({ type: 'draft_save_failed', payload: { error: message } });
      return null;
    }
  }, [persistDraftText, runValidation, state.draftText, state.promptPackage]);

  const generatePrompt = useCallback(async () => {
    if (!recordingId) {
      dispatch({ type: 'prompt_generate_failed', payload: { error: 'Upload a recording first.' } });
      return;
    }
    if (!selectedTemplateId) {
      dispatch({
        type: 'prompt_generate_failed',
        payload: {
          error: 'Prompt template defaults are missing. Check prompt templates in settings.',
        },
      });
      return;
    }
    if (transcriptStatus !== 'ready') {
      dispatch({
        type: 'prompt_generate_failed',
        payload: { error: 'Transcript is not ready yet.' },
      });
      return;
    }

    invalidatePendingGeneration();
    dispatch({ type: 'prompt_generate_started' });
    try {
      const normalizedTeacherNotes = teacherNotes.trim();
      const response = await createPromptPackage(recordingId, {
        ...(normalizedTeacherNotes ? { notes: normalizedTeacherNotes } : {}),
        templateId: selectedTemplateId,
        profileId: selectedProfileId || undefined,
        ...(lessonId ? { lessonId } : {}),
      });
      onTeacherNotesResolved(response.notes ?? normalizedTeacherNotes);
      dispatch({
        type: 'prompt_generate_succeeded',
        payload: {
          promptPackage: response,
          promptText: response.text ?? '',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to generate prompt.';
      dispatch({ type: 'prompt_generate_failed', payload: { error: message } });
    }
  }, [
    invalidatePendingGeneration,
    lessonId,
    onTeacherNotesResolved,
    recordingId,
    selectedProfileId,
    selectedTemplateId,
    teacherNotes,
    transcriptStatus,
  ]);

  const copyPrompt = useCallback(async () => {
    if (!state.promptText.trim()) return;
    const success = await copyTextToClipboard(state.promptText);
    dispatch({
      type: 'prompt_copy_state_changed',
      payload: { value: success ? 'copied' : 'error' },
    });
    if (promptCopyResetTimeoutRef.current) {
      clearTimeout(promptCopyResetTimeoutRef.current);
    }
    promptCopyResetTimeoutRef.current = setTimeout(() => {
      dispatch({ type: 'prompt_copy_state_changed', payload: { value: 'idle' } });
      promptCopyResetTimeoutRef.current = null;
    }, 2000);
  }, [state.promptText]);

  const generateDraftHandler = useCallback(async (): Promise<GenerateDraftResponse | null> => {
    if (!state.promptPackage?.id) {
      dispatch({
        type: 'draft_generate_failed',
        payload: { error: 'Generate a prompt package first.' },
      });
      return null;
    }
    if (generationOptions && !state.selectedGenerationProvider) {
      dispatch({
        type: 'draft_generate_failed',
        payload: { error: 'Select a generation provider.' },
      });
      return null;
    }
    if (generationOptions && !state.selectedGenerationModel) {
      dispatch({
        type: 'draft_generate_failed',
        payload: { error: 'Select a generation model.' },
      });
      return null;
    }

    dispatch({ type: 'draft_generate_started' });
    const requestVersion = generationRequestVersionRef.current + 1;
    generationRequestVersionRef.current = requestVersion;

    try {
      const generated = await generateDraft({
        promptPackageId: state.promptPackage.id,
        provider: (state.selectedGenerationProvider ||
          undefined) as GenerateDraftRequest['provider'],
        model: state.selectedGenerationModel || undefined,
      });
      if (generationRequestVersionRef.current !== requestVersion) {
        return null;
      }
      dispatch({
        type: 'draft_generate_succeeded',
        payload: {
          draftText: generated.text ?? '',
          quota: generated.quota ?? null,
          runtimeSelection: {
            provider: generated.provider,
            model: generated.model,
          },
          successMessage: `Generated with ${generated.provider}/${generated.model}. Draft saved automatically.`,
          quotaWindowTickMs: Date.now(),
        },
      });
      if (generated.text?.trim()) {
        try {
          await persistDraftText(generated.text);
          draftAutosaveLastSavedAtRef.current = Date.now();
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Generated draft is visible, but could not be saved yet.';
          dispatch({ type: 'draft_save_failed', payload: { error: message } });
        }
      }
      return generated;
    } catch (error) {
      if (generationRequestVersionRef.current !== requestVersion) {
        return null;
      }
      dispatch({
        type: 'draft_generate_failed',
        payload: { error: mapGenerationError(error) },
      });
      return null;
    }
  }, [
    generationOptions,
    persistDraftText,
    state.promptPackage?.id,
    state.selectedGenerationModel,
    state.selectedGenerationProvider,
  ]);

  const previewDraft = useCallback(async () => {
    const normalizedDraft = state.draftText.trim();
    if (!normalizedDraft) {
      dispatch({
        type: 'preview_failed',
        payload: { error: 'Paste the assignment markdown first.' },
      });
      return;
    }
    dispatch({ type: 'preview_started' });
    try {
      const validationResult = await runValidation();
      if (validationResult.errors && validationResult.errors.length > 0) {
        dispatch({
          type: 'preview_failed',
          payload: { error: 'Fix validation errors before preview.' },
        });
        return;
      }
      const validPreset =
        state.selectedPreset && presetOptionIds.includes(state.selectedPreset)
          ? state.selectedPreset
          : null;
      const htmlResponse = await renderHtmlPreview({
        text: normalizedDraft,
        title: validationResult.meta?.title?.trim() || undefined,
        learningPresetId: learningPresetCatalogEnabled ? validPreset : null,
      });
      dispatch({
        type: 'preview_succeeded',
        payload: {
          html: htmlResponse.html,
          lastPreviewedDraftHash: draftPreviewGate.draftHash,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to render preview.';
      dispatch({ type: 'preview_failed', payload: { error: message } });
    }
  }, [
    draftPreviewGate.draftHash,
    learningPresetCatalogEnabled,
    presetOptionIds,
    runValidation,
    state.draftText,
    state.selectedPreset,
  ]);

  const publishAssignment = useCallback(
    async ({
      onPublishedJob,
      refreshResumeJobs,
      completeAssignmentSession,
    }: {
      onPublishedJob: (job: JobStatus) => void;
      refreshResumeJobs: () => Promise<unknown>;
      completeAssignmentSession?: () => Promise<unknown>;
    }) => {
      dispatch({ type: 'publish_config_updated', payload: { publishError: null } as never });
      if (!draftPreviewGate.previewReady) {
        dispatch({
          type: 'publish_failed',
          payload: { error: 'Preview current draft before publishing.' },
        });
        return;
      }

      dispatch({ type: 'publish_started' });
      try {
        let savedDraft = state.draft;
        if (!savedDraft || draftDirty) {
          savedDraft = await saveDraft();
        }
        if (!savedDraft) {
          dispatch({ type: 'publish_succeeded' });
          return;
        }

        const validPreset =
          state.selectedPreset && presetOptionIds.includes(state.selectedPreset)
            ? state.selectedPreset
            : '';
        const materialized = await materializeDraft(savedDraft.id, {
          ...(currentJobId ? { jobId: currentJobId } : {}),
          jobOverrides: buildPublishJobOverrides({
            publishTarget: state.publishTarget,
            selectedTtsProvider: state.selectedTtsProvider,
            selectedTtsStrategy: state.selectedTtsStrategy,
            selectedTtsModel: state.selectedTtsModel,
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
        onPublishedJob(refreshed);
        await completeAssignmentSession?.();
        await refreshResumeJobs();
        dispatch({ type: 'publish_succeeded' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to publish assignment.';
        dispatch({ type: 'publish_failed', payload: { error: message } });
      }
    },
    [
      currentJobId,
      draftDirty,
      draftPreviewGate.previewReady,
      learningPresetCatalogEnabled,
      presetOptionIds,
      saveDraft,
      state.draft,
      state.publishTarget,
      state.selectedPreset,
      state.selectedTtsModel,
      state.selectedTtsProvider,
      state.selectedTtsStrategy,
    ],
  );

  useEffect(() => {
    return () => {
      if (promptCopyResetTimeoutRef.current) {
        clearTimeout(promptCopyResetTimeoutRef.current);
      }
      if (draftAutosaveTimeoutRef.current) {
        clearTimeout(draftAutosaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!state.promptPackage?.id || !state.draftText.trim() || !draftDirty) {
      if (draftAutosaveTimeoutRef.current) {
        clearTimeout(draftAutosaveTimeoutRef.current);
        draftAutosaveTimeoutRef.current = null;
      }
      return;
    }

    const elapsedMs = Date.now() - draftAutosaveLastSavedAtRef.current;
    const delayMs = Math.max(
      DRAFT_AUTOSAVE_DEBOUNCE_MS,
      DRAFT_AUTOSAVE_MIN_INTERVAL_MS - elapsedMs,
    );

    if (draftAutosaveTimeoutRef.current) {
      clearTimeout(draftAutosaveTimeoutRef.current);
    }
    draftAutosaveTimeoutRef.current = setTimeout(() => {
      draftAutosaveTimeoutRef.current = null;
      if (draftAutosaveInFlightRef.current) {
        draftAutosavePendingRef.current = true;
        return;
      }
      const textToSave = state.draftText;
      draftAutosaveInFlightRef.current = true;
      void persistDraftText(textToSave, {
        preserveCurrentText: draftTextRef.current.trim() !== textToSave.trim(),
      })
        .then((saved) => {
          if (saved) {
            draftAutosaveLastSavedAtRef.current = Date.now();
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Unable to autosave draft.';
          dispatch({ type: 'draft_save_failed', payload: { error: message } });
        })
        .finally(() => {
          draftAutosaveInFlightRef.current = false;
          const latestText = draftTextRef.current.trim();
          const savedText = textToSave.trim();
          if (draftAutosavePendingRef.current || (latestText && latestText !== savedText)) {
            draftAutosavePendingRef.current = false;
            requestDraftAutosaveReschedule();
          }
        });
    }, delayMs);

    return () => {
      if (draftAutosaveTimeoutRef.current) {
        clearTimeout(draftAutosaveTimeoutRef.current);
        draftAutosaveTimeoutRef.current = null;
      }
    };
  }, [
    draftAutosaveRescheduleToken,
    draftDirty,
    persistDraftText,
    state.draftText,
    state.promptPackage?.id,
  ]);

  useEffect(() => {
    const normalizedPreset = normalizePresetSelection(
      presetOptionIds,
      undefined,
      state.selectedPreset,
    );
    if (normalizedPreset !== state.selectedPreset) {
      dispatch({ type: 'publish_config_updated', payload: { selectedPreset: normalizedPreset } });
    }
  }, [presetOptionIds, state.selectedPreset]);

  useEffect(() => {
    if (ttsProviders.length === 0) return;
    const preferredProvider =
      (defaultTtsProvider && ttsProviders.includes(defaultTtsProvider)
        ? defaultTtsProvider
        : ttsProviders[0]) ?? DEFAULT_TTS_PROVIDER;
    if (!ttsProviders.includes(state.selectedTtsProvider)) {
      dispatch({
        type: 'publish_config_updated',
        payload: { selectedTtsProvider: preferredProvider },
      });
    }
  }, [defaultTtsProvider, state.selectedTtsProvider, ttsProviders]);

  useEffect(() => {
    const fallbackStrategy = availablePublishTtsStrategies[0];
    if (!fallbackStrategy) return;
    if (!availablePublishTtsStrategies.includes(state.selectedTtsStrategy)) {
      dispatch({
        type: 'publish_config_updated',
        payload: { selectedTtsStrategy: fallbackStrategy },
      });
    }
  }, [availablePublishTtsStrategies, state.selectedTtsStrategy]);

  useEffect(() => {
    const modelOptions = ttsModelOptionsByProvider[state.selectedTtsProvider] ?? [];
    if (state.selectedTtsProvider === 'google') {
      if (modelOptions.length === 0) {
        if (state.selectedTtsModel) {
          dispatch({ type: 'publish_config_updated', payload: { selectedTtsModel: '' } });
        }
        return;
      }
      const configuredDefault = defaultTtsModelByProvider?.google;
      const preferredModel =
        configuredDefault && modelOptions.includes(configuredDefault)
          ? configuredDefault
          : modelOptions[0];
      if (!preferredModel) return;
      if (!state.selectedTtsModel || !modelOptions.includes(state.selectedTtsModel)) {
        dispatch({
          type: 'publish_config_updated',
          payload: { selectedTtsModel: preferredModel },
        });
      }
      return;
    }

    if (state.selectedTtsStrategy === 'auto') {
      if (state.selectedTtsModel) {
        dispatch({ type: 'publish_config_updated', payload: { selectedTtsModel: '' } });
      }
      return;
    }

    if (state.selectedTtsStrategy === 'dialogue') {
      if (state.selectedTtsModel !== 'eleven_v3') {
        dispatch({ type: 'publish_config_updated', payload: { selectedTtsModel: 'eleven_v3' } });
      }
      return;
    }

    if (publishElevenlabsModelOptions.length === 0) {
      if (state.selectedTtsModel) {
        dispatch({ type: 'publish_config_updated', payload: { selectedTtsModel: '' } });
      }
      return;
    }

    const configuredDefault = defaultTtsModelByProvider?.elevenlabs;
    const preferredModel =
      configuredDefault &&
      configuredDefault !== 'eleven_v3' &&
      publishElevenlabsModelOptions.includes(configuredDefault)
        ? configuredDefault
        : (publishElevenlabsModelOptions.find(
            (model) => model === FALLBACK_ELEVENLABS_STANDARD_MODEL,
          ) ?? publishElevenlabsModelOptions[0]);
    if (!preferredModel) return;
    if (
      !state.selectedTtsModel ||
      !publishElevenlabsModelOptions.includes(state.selectedTtsModel) ||
      state.selectedTtsModel === 'eleven_v3'
    ) {
      dispatch({
        type: 'publish_config_updated',
        payload: { selectedTtsModel: preferredModel },
      });
    }
  }, [
    defaultTtsModelByProvider,
    publishElevenlabsModelOptions,
    state.selectedTtsModel,
    state.selectedTtsProvider,
    state.selectedTtsStrategy,
    ttsModelOptionsByProvider,
  ]);

  useEffect(() => {
    if (generationProviders.length === 0) {
      if (state.selectedGenerationProvider) {
        dispatch({
          type: 'publish_config_updated',
          payload: { selectedGenerationProvider: '' },
        });
      }
      return;
    }

    const configuredDefault = generationOptions?.defaultProvider;
    const fallbackProvider =
      (configuredDefault && generationProviders.includes(configuredDefault)
        ? configuredDefault
        : generationProviders[0]) ?? '';
    const hasSelectedProvider = generationProviders.some(
      (provider) => provider === state.selectedGenerationProvider,
    );
    if (!state.selectedGenerationProvider || !hasSelectedProvider) {
      dispatch({
        type: 'publish_config_updated',
        payload: { selectedGenerationProvider: fallbackProvider },
      });
    }
  }, [generationOptions?.defaultProvider, generationProviders, state.selectedGenerationProvider]);

  useEffect(() => {
    if (!state.selectedGenerationProvider || generationModelsForProvider.length === 0) {
      if (state.selectedGenerationModel) {
        dispatch({
          type: 'publish_config_updated',
          payload: { selectedGenerationModel: '' },
        });
      }
      return;
    }

    const modelIds = generationModelsForProvider.map((option) => option.id);
    const configuredDefaultModel =
      generationOptions?.defaultModelByProvider?.[
        state.selectedGenerationProvider as keyof NonNullable<
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
    if (!state.selectedGenerationModel || !modelIds.includes(state.selectedGenerationModel)) {
      dispatch({
        type: 'publish_config_updated',
        payload: { selectedGenerationModel: fallbackModel },
      });
    }
  }, [
    generationModelsForProvider,
    generationOptions?.defaultModelByProvider,
    state.selectedGenerationModel,
    state.selectedGenerationProvider,
  ]);

  useEffect(() => {
    if (!shouldTrackQuotaWindow) {
      return;
    }
    const interval = globalThis.setInterval(() => {
      dispatch({ type: 'quota_window_tick', payload: { nowMs: Date.now() } });
    }, 15_000);
    return () => {
      globalThis.clearInterval(interval);
    };
  }, [shouldTrackQuotaWindow]);

  return {
    ...state,
    generationProviders,
    generationModelsForProvider,
    promptReady,
    draftDirty,
    draftPreviewGate,
    previewReadyForCurrentDraft,
    canPublishWithPreview,
    activeGenerationQuota,
    generationQuotaSourceLabel,
    generationQuotaUpdatedRelative,
    generationQuotaUpdatedAbsolute,
    generationQuotaHasNumericValues,
    generationQuotaBlockedReason,
    generationBlockedByQuota,
    shouldTrackQuotaWindow,
    availablePublishTtsStrategies,
    publishModelSelectionDisabled,
    publishElevenlabsModelOptions,
    selectedTtsModelOptions,
    setPromptText,
    setDraftText,
    setSelectedGenerationProvider,
    setSelectedGenerationModel,
    setPublishTarget,
    setSelectedTtsProvider,
    setSelectedTtsStrategy,
    setSelectedTtsModel,
    setSelectedPreset,
    setPublishError,
    setPromptError,
    generatePrompt,
    copyPrompt,
    generateDraft: generateDraftHandler,
    runValidation,
    saveDraft,
    previewDraft,
    publishAssignment,
    applyHydrationSnapshot,
    resetAuthoring,
    invalidatePendingGeneration,
  };
}
