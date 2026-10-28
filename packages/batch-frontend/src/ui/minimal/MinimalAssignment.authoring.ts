import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import {
  type AssignmentFormat,
  type AssignmentValidationContext,
  parseAssignmentV1,
  serializeAssignmentV1,
} from '@esl-pipeline/contracts';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import type {
  AssignmentValidationResponse,
  DraftResponse,
  GenerateDraftRequest,
  GenerateDraftResponse,
  JobOptionsResponse,
  JobStatus,
  PromptPackageResponse,
} from '../../utils/api';
import {
  ArtifactWorkingConflictApiError,
  approveJob,
  createDraft,
  createPromptPackage,
  fetchDraft,
  GenerationDraftApiError,
  generateDraft,
  getJobStatus,
  materializeDraft,
  renderHtmlPreview,
  updateDraft,
} from '../../utils/api';
import { copyTextToClipboard } from '../../utils/clipboard';
import { formatTutorTime } from '../../utils/tutor-time';
import {
  buildPublishJobOverrides,
  getDraftPreviewGate,
  getNextGenerationQuotaSnapshot,
  hasActiveGenerationQuotaSelection,
  type MinimalPublishTarget,
} from './MinimalAssignment.logic';
import { getGenerationQuotaWindowDecision } from './MinimalAssignment.quota-window';

type UiTtsProvider = 'elevenlabs' | 'google' | 'inworld' | 'gemini';
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

const DEFAULT_TTS_PROVIDER: UiTtsProvider = 'gemini';
const DEFAULT_TTS_STRATEGY: UiPublishTtsStrategy = 'auto';
const DEFAULT_PUBLISH_TARGET: MinimalPublishTarget = 'html';
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 1500;
const DRAFT_AUTOSAVE_MIN_INTERVAL_MS = 5000;

export interface AuthoringHydrationSnapshot {
  draftFormat?: AssignmentFormat;
  generatedValidationContext?: AssignmentValidationContext;
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
  validation: AssignmentValidationResponse | null;
  validationError: string | null;
}

export interface AuthoringState extends AuthoringHydrationSnapshot {
  savingDraft: boolean;
  ttsSelectionExplicit: boolean;
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
        draftFormat?: AssignmentFormat;
        generatedValidationContext?: AssignmentValidationContext;
        quota: GenerateDraftResponse['quota'] | null;
        runtimeSelection: { provider: string; model: string };
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
  | { type: 'validation_succeeded'; payload: { validation: AssignmentValidationResponse } }
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
          | 'ttsSelectionExplicit'
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
    savingDraft: false,
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
    ttsSelectionExplicit: false,
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
        ttsSelectionExplicit: true,
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
        draftError: null,
        validation: null,
        validationError: null,
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
        draftFormat: action.payload.draftFormat,
        generatedValidationContext: action.payload.generatedValidationContext,
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
        generationSuccess: null,
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
        savingDraft: true,
        draftError: null,
      };
    case 'draft_save_succeeded':
      return {
        ...state,
        savingDraft: false,
        draft: action.payload.draft,
        draftText: action.payload.preserveCurrentText
          ? state.draftText
          : (action.payload.draft.text ?? state.draftText),
        draftError: null,
      };
    case 'draft_save_failed':
      return {
        ...state,
        savingDraft: false,
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
        ? 'Assignment generation is busy. Try again shortly.'
        : code === 'provider_timeout'
          ? 'Assignment generation timed out. Retry shortly.'
          : code === 'provider_contract_error'
            ? 'Assignment generation failed because the service rejected the request. Retry or contact support.'
            : code === 'budget_exceeded'
              ? `Assignment generation is paused by the safety budget.${limitDetails} Try again after reset.`
              : error instanceof Error
                ? error.message
                : 'Unable to generate draft.';
    return requestId ? `${baseMessage} Request ID: ${requestId}` : baseMessage;
  }
  return error instanceof Error ? error.message : 'Unable to generate draft.';
}

interface UseMinimalAssignmentAuthoringControllerParams {
  recordingId: string | null;
  getAssignmentSessionId: () => string | null;
  transcriptStatus: TranscriptUiStatus;
  teacherNotes: string;
  selectedTemplateId: string;
  currentJobId: string | null;
  learningPresetCatalogEnabled: boolean;
  presetOptionIds: readonly string[];
  generationOptions: GenerationOptions | null;
  ttsProviders: readonly UiTtsProvider[];
  ttsModelOptionsByProvider: {
    elevenlabs: readonly string[];
    google: readonly string[];
    inworld: readonly string[];
    gemini?: readonly string[];
  };
  elevenlabsModelOptions: readonly string[];
  elevenlabsStandardModelOptions: readonly string[];
  defaultTtsProvider: UiTtsProvider | null;
  defaultTtsModelByProvider: JobOptionsResponse['defaultTtsModelByProvider'] | null | undefined;
  configuredTtsStrategies: readonly UiPublishTtsStrategy[];
  onDraftPronunciationModeDetected: (mode: PronunciationMode | null) => void;
  onTeacherNotesResolved: (value: string) => void;
}

export interface AuthoringController extends AuthoringState {
  editorSessionKey: number;
  editorValidationContext: AssignmentValidationContext | undefined;
  reconcileDraft: (choice: 'local' | 'saved') => Promise<void>;
  generationProviders: readonly string[];
  generationModelsForProvider: GenerationModelOption[];
  promptReady: boolean;
  draftDirty: boolean;
  draftValid: boolean;
  structuredDraft: boolean;
  assignmentValidationError: string | null;
  isCurrentDraftValid: () => boolean;
  isCurrentDraftSaved: (draft: DraftResponse | null | undefined) => boolean;
  draftRecoveryConflict: boolean;
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
  generatePrompt: () => Promise<PromptPackageResponse | null>;
  copyPrompt: () => Promise<void>;
  generateAssignment: (options?: {
    forceFreshPrompt?: boolean;
  }) => Promise<GenerateDraftResponse | null>;
  generateDraft: () => Promise<GenerateDraftResponse | null>;
  runValidation: () => Promise<AssignmentValidationResponse>;
  saveDraft: () => Promise<DraftResponse | null>;
  flushDraftAutosave: () => Promise<DraftResponse | null>;
  refreshDraftPreservingLocal: (options?: { forcePreserveLocal?: boolean }) => Promise<void>;
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
  getAssignmentSessionId,
  transcriptStatus,
  teacherNotes,
  selectedTemplateId,
  currentJobId,
  learningPresetCatalogEnabled,
  presetOptionIds,
  generationOptions,
  ttsProviders,
  ttsModelOptionsByProvider,
  elevenlabsModelOptions,
  elevenlabsStandardModelOptions,
  defaultTtsProvider,
  defaultTtsModelByProvider,
  configuredTtsStrategies,
  onDraftPronunciationModeDetected,
  onTeacherNotesResolved,
}: UseMinimalAssignmentAuthoringControllerParams): AuthoringController {
  const timezone = useWorkspaceTimezone();
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
  const draftAutosaveInFlightPromiseRef = useRef<Promise<DraftResponse | null> | null>(null);
  const draftAutosavePendingRef = useRef(false);
  const draftConflictTextRef = useRef<string | null>(null);
  const draftLocalEditRevisionRef = useRef(0);
  const acknowledgedDraftRef = useRef<DraftResponse | null>(null);
  const draftReconciliationInFlightRef = useRef(false);
  const [editorSessionKey, resetEditorSession] = useReducer((value: number) => value + 1, 0);
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
      state.selectedTtsProvider === 'elevenlabs'
        ? [...publishElevenlabsModelOptions].filter(Boolean)
        : (ttsModelOptionsByProvider[state.selectedTtsProvider] ?? []),
    [publishElevenlabsModelOptions, state.selectedTtsProvider, ttsModelOptionsByProvider],
  );
  const publishModelSelectionDisabled =
    state.selectedTtsProvider === 'elevenlabs' && state.selectedTtsStrategy === 'auto';
  const promptReady = Boolean(state.promptPackage?.id && state.promptText.trim().length > 0);
  const structuredDraft = state.draft
    ? state.draft.format === 'assignment_v1'
    : state.draftFormat === 'assignment_v1' ||
      !state.promptPackage ||
      state.promptPackage.requestEnvelope?.promptVersion === 'assignment_v1';
  const validationContext =
    state.draft?.validationContext ??
    state.promptPackage?.requestEnvelope?.assignmentContext ??
    state.generatedValidationContext;
  const editableDraftAvailable = Boolean(
    state.draft || state.draftFormat || state.draftText.trim(),
  );
  const typedDraft = useMemo(() => {
    if (!structuredDraft)
      return {
        assignment: null,
        canonical: state.draftText.trim(),
        error: 'Historical Markdown assignments are read-only.',
      };
    if (state.generatingDraft || !editableDraftAvailable)
      return { assignment: null, canonical: null, error: null };
    try {
      if (!validationContext)
        throw new Error('Assignment validation context is missing. Reload the saved draft.');
      const assignment = parseAssignmentV1(state.draftText, validationContext);
      return { assignment, canonical: serializeAssignmentV1(assignment), error: null };
    } catch (error) {
      return {
        assignment: null,
        canonical: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [
    structuredDraft,
    state.generatingDraft,
    editableDraftAvailable,
    state.draftText,
    validationContext,
  ]);
  const draftValid = Boolean(typedDraft.assignment);
  const isCurrentDraftValid = useCallback(() => {
    if (!structuredDraft) return false;
    if (!validationContext) return false;
    try {
      parseAssignmentV1(draftTextRef.current, validationContext);
      return true;
    } catch {
      return false;
    }
  }, [structuredDraft, validationContext]);
  const isCurrentDraftSaved = useCallback(
    (draft: DraftResponse | null | undefined) => {
      if (!structuredDraft) return false;
      if (!draft?.assignment || !validationContext) return false;
      try {
        return (
          serializeAssignmentV1(parseAssignmentV1(draftTextRef.current, validationContext)) ===
          serializeAssignmentV1(draft.assignment)
        );
      } catch {
        return false;
      }
    },
    [structuredDraft, validationContext],
  );
  const draftDirty = useMemo(() => {
    const lineageChanged = Boolean(
      state.draft?.id &&
        state.promptPackage?.id &&
        state.draft.promptPackageId !== state.promptPackage.id,
    );
    if (structuredDraft) {
      if (!state.draftText.trim() && !state.draft?.id) return false;
      if (!typedDraft.assignment) return true;
      if (!state.draft?.assignment) return true;
      return (
        lineageChanged || typedDraft.canonical !== serializeAssignmentV1(state.draft.assignment)
      );
    }
    return false;
  }, [
    structuredDraft,
    typedDraft,
    state.draft?.assignment,
    state.draft?.id,
    state.draft?.promptPackageId,
    state.draftText,
    state.promptPackage?.id,
  ]);
  const draftPreviewGate = useMemo(
    () =>
      getDraftPreviewGate({
        draftText: typedDraft.canonical ?? state.draftText,
        previewHtml: draftValid ? state.previewHtml : null,
        lastPreviewedDraftHash: state.lastPreviewedDraftHash,
      }),
    [
      typedDraft.canonical,
      draftValid,
      state.draftText,
      state.lastPreviewedDraftHash,
      state.previewHtml,
    ],
  );
  const previewReadyForCurrentDraft = draftPreviewGate.previewReady;
  const canPublish =
    draftValid && promptReady && state.draftText.trim().length > 0 && !state.publishing;
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
    ? formatTutorTime(activeGenerationQuota.lastUpdatedAt, timezone)
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
    resetEditorSession();
    draftConflictTextRef.current = null;
    acknowledgedDraftRef.current = null;
    draftReconciliationInFlightRef.current = false;
    draftLocalEditRevisionRef.current += 1;
    authoringPersistenceVersionRef.current += 1;
    draftAutosaveInFlightRef.current = false;
    draftAutosaveInFlightPromiseRef.current = null;
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
      acknowledgedDraftRef.current = snapshot.draft;
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
    draftLocalEditRevisionRef.current += 1;
    draftTextRef.current = value;
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
    dispatch({
      type: 'publish_config_updated',
      payload: { selectedTtsProvider: value, ttsSelectionExplicit: true },
    });
  }, []);

  const setSelectedTtsStrategy = useCallback((value: UiPublishTtsStrategy) => {
    dispatch({ type: 'publish_config_updated', payload: { selectedTtsStrategy: value } });
  }, []);

  const setSelectedTtsModel = useCallback((value: string) => {
    dispatch({
      type: 'publish_config_updated',
      payload: { selectedTtsModel: value, ttsSelectionExplicit: true },
    });
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

  const runValidation = useCallback(async (): Promise<AssignmentValidationResponse> => {
    if (structuredDraft) {
      const response = {
        ok: draftValid,
        errors: typedDraft.error ? [typedDraft.error] : [],
        warnings: [],
        meta: typedDraft.assignment?.metadata,
      } as AssignmentValidationResponse;
      dispatch({ type: 'validation_succeeded', payload: { validation: response } });
      return response;
    }
    const response = {
      ok: false,
      errors: ['Historical Markdown assignments are read-only.'],
      warnings: [],
    };
    dispatch({ type: 'validation_succeeded', payload: { validation: response } });
    return response;
  }, [structuredDraft, draftValid, typedDraft]);

  useEffect(() => {
    draftTextRef.current = state.draftText;
  }, [state.draftText]);

  const writeDraftText = useCallback(
    async (
      text: string,
      options: {
        preserveCurrentText?: boolean;
        promptPackageId?: string;
        format?: AssignmentFormat;
        validationContext?: AssignmentValidationContext;
      } = {},
    ): Promise<DraftResponse | null> => {
      const typed = options.format ? options.format === 'assignment_v1' : structuredDraft;
      if (!typed) throw new Error('Historical Markdown assignments are read-only.');
      if (typed) {
        const context = options.validationContext ?? validationContext;
        if (!context) throw new Error('Assignment validation context is missing');
        parseAssignmentV1(text, context);
      }
      const normalizedText = text.trim();
      const promptPackageId = options.promptPackageId ?? state.promptPackage?.id;
      if (!promptPackageId || !normalizedText) {
        return null;
      }
      const acknowledged = acknowledgedDraftRef.current ?? state.draft;
      const reusableDraft = acknowledged?.promptPackageId === promptPackageId ? acknowledged : null;
      const persistenceVersion = authoringPersistenceVersionRef.current;
      if (draftConflictTextRef.current !== null)
        throw new Error('Resolve the saved draft conflict before saving.');
      dispatch({ type: 'draft_save_started' });
      let response: DraftResponse;
      try {
        response = reusableDraft?.id
          ? await updateDraft(reusableDraft.id, normalizedText, reusableDraft.workingVersion)
          : await createDraft(promptPackageId, normalizedText);
      } catch (error) {
        if (authoringPersistenceVersionRef.current !== persistenceVersion) return null;
        if (error instanceof ArtifactWorkingConflictApiError && reusableDraft?.id) {
          draftConflictTextRef.current = normalizedText;
          try {
            const latest = await fetchDraft(reusableDraft.id);
            if (authoringPersistenceVersionRef.current === persistenceVersion) {
              draftConflictTextRef.current = normalizedText;
              acknowledgedDraftRef.current = latest;
              dispatch({
                type: 'draft_save_succeeded',
                payload: { draft: latest, preserveCurrentText: true },
              });
            }
          } catch {
            // Preserve the local buffer and original conflict if refresh also fails.
          }
        }
        throw error;
      }
      if (authoringPersistenceVersionRef.current !== persistenceVersion) {
        return null;
      }
      draftConflictTextRef.current = null;
      acknowledgedDraftRef.current = response;
      const preserveCurrentText =
        options.preserveCurrentText || draftTextRef.current.trim() !== normalizedText;
      dispatch({
        type: 'draft_save_succeeded',
        payload: { draft: response, preserveCurrentText },
      });
      onDraftPronunciationModeDetected(response.assignment?.pronunciation?.mode ?? null);
      return response;
    },
    [
      onDraftPronunciationModeDetected,
      structuredDraft,
      validationContext,
      state.draft?.id,
      state.draft?.promptPackageId,
      state.draft?.workingVersion,
      state.promptPackage?.id,
      state.draft,
    ],
  );

  // Every save entry (autosave, explicit save, correction/reconciliation) shares one flight.
  const persistDraftText = useCallback(
    (text: string, options: Parameters<typeof writeDraftText>[1] = {}) => {
      const existing = draftAutosaveInFlightPromiseRef.current;
      if (existing) return existing;
      const persistenceVersion = authoringPersistenceVersionRef.current;
      draftAutosaveInFlightRef.current = true;
      const tracked = writeDraftText(text, options)
        .then((saved) => {
          if (saved && persistenceVersion === authoringPersistenceVersionRef.current)
            draftAutosaveLastSavedAtRef.current = Date.now();
          return saved;
        })
        .catch((error) => {
          if (persistenceVersion === authoringPersistenceVersionRef.current)
            dispatch({
              type: 'draft_save_failed',
              payload: { error: error instanceof Error ? error.message : 'Unable to save draft.' },
            });
          return null;
        })
        .finally(() => {
          if (persistenceVersion !== authoringPersistenceVersionRef.current) return;
          if (draftAutosaveInFlightPromiseRef.current === tracked)
            draftAutosaveInFlightPromiseRef.current = null;
          draftAutosaveInFlightRef.current = false;
          if (draftAutosavePendingRef.current || draftTextRef.current.trim() !== text.trim()) {
            draftAutosavePendingRef.current = false;
            requestDraftAutosaveReschedule();
          }
        });
      draftAutosaveInFlightPromiseRef.current = tracked;
      return tracked;
    },
    [writeDraftText],
  );

  const saveDraft = useCallback(async (): Promise<DraftResponse | null> => {
    if (draftConflictTextRef.current !== null) return null;
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
      return isCurrentDraftSaved(response) ? response : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save draft.';
      dispatch({ type: 'draft_save_failed', payload: { error: message } });
      return null;
    }
  }, [isCurrentDraftSaved, persistDraftText, runValidation, state.draftText, state.promptPackage]);

  const flushDraftAutosave = useCallback(async (): Promise<DraftResponse | null> => {
    if (draftConflictTextRef.current !== null) return null;
    if (draftAutosaveTimeoutRef.current) {
      clearTimeout(draftAutosaveTimeoutRef.current);
      draftAutosaveTimeoutRef.current = null;
    }
    const inFlight = draftAutosaveInFlightPromiseRef.current;
    let inFlightDraft: DraftResponse | null | undefined;
    if (inFlight) {
      inFlightDraft = await inFlight;
      if (!isCurrentDraftValid()) return null;
      if (structuredDraft) return isCurrentDraftSaved(inFlightDraft) ? inFlightDraft : null;
      if (inFlightDraft && draftTextRef.current.trim() === (inFlightDraft.text ?? '').trim()) {
        return inFlightDraft;
      }
    }
    if (draftDirty) {
      return saveDraft();
    }
    const saved = inFlightDraft ?? state.draft;
    return isCurrentDraftSaved(saved) ? saved : null;
  }, [
    isCurrentDraftSaved,
    isCurrentDraftValid,
    structuredDraft,
    draftDirty,
    saveDraft,
    state.draft,
  ]);

  const refreshDraftPreservingLocal = useCallback(
    async (options?: { forcePreserveLocal?: boolean }) => {
      if (!state.draft?.id) return;
      const persistenceVersion = authoringPersistenceVersionRef.current;
      const localEditRevision = draftLocalEditRevisionRef.current;
      const durableText = (state.draft.text ?? '').trim();
      try {
        const latest = await fetchDraft(state.draft.id);
        if (persistenceVersion !== authoringPersistenceVersionRef.current) return;
        // A read started before/during a write must not replace that write's acknowledgement.
        if (draftAutosaveInFlightRef.current || draftReconciliationInFlightRef.current) return;
        const acknowledged = acknowledgedDraftRef.current ?? state.draft;
        if (
          latest.id === acknowledged.id &&
          (latest.workingVersion ?? 0) < (acknowledged.workingVersion ?? 0)
        )
          return;
        const localText = draftTextRef.current.trim();
        const preserveCurrentText =
          options?.forcePreserveLocal === true ||
          draftLocalEditRevisionRef.current !== localEditRevision ||
          localText !== durableText;
        const remoteText = (latest.text ?? '').trim();
        const remoteChanged =
          latest.workingVersion !== acknowledged.workingVersion ||
          latest.contentHash !== acknowledged.contentHash;
        const overlapsRemote = preserveCurrentText && remoteChanged && localText !== remoteText;
        if (overlapsRemote) {
          draftConflictTextRef.current = localText;
        }
        acknowledgedDraftRef.current = latest;
        dispatch({
          type: 'draft_save_succeeded',
          payload: { draft: latest, preserveCurrentText },
        });
        if (overlapsRemote) {
          dispatch({
            type: 'draft_save_failed',
            payload: {
              error: 'Newer saved draft work was found. Review your text before retrying.',
            },
          });
        }
      } catch (error) {
        if (persistenceVersion !== authoringPersistenceVersionRef.current) return;
        dispatch({
          type: 'draft_save_failed',
          payload: {
            error: error instanceof Error ? error.message : 'Unable to refresh saved draft.',
          },
        });
      }
    },
    [state.draft],
  );

  const draftRecoveryConflict = draftConflictTextRef.current !== null;

  const reconcileDraft = useCallback(
    async (choice: 'local' | 'saved') => {
      if (
        !state.draft?.id ||
        draftAutosaveInFlightRef.current ||
        draftReconciliationInFlightRef.current
      )
        return;
      draftReconciliationInFlightRef.current = true;
      dispatch({ type: 'draft_save_started' });
      const persistenceVersion = authoringPersistenceVersionRef.current;
      const localAtChoice = draftTextRef.current;
      try {
        const latest = await fetchDraft(state.draft.id);
        if (persistenceVersion !== authoringPersistenceVersionRef.current) return;
        if (
          latest.workingVersion !== state.draft.workingVersion ||
          latest.contentHash !== state.draft.contentHash
        ) {
          draftConflictTextRef.current = draftTextRef.current;
          acknowledgedDraftRef.current = latest;
          dispatch({
            type: 'draft_save_succeeded',
            payload: { draft: latest, preserveCurrentText: true },
          });
          dispatch({
            type: 'draft_save_failed',
            payload: { error: 'The saved version changed again. Inspect it and choose again.' },
          });
          return;
        }
        if (choice === 'saved') {
          if (draftTextRef.current !== localAtChoice) {
            dispatch({
              type: 'draft_save_failed',
              payload: { error: 'You made more local edits. Review them and choose again.' },
            });
            return;
          }
          draftConflictTextRef.current = null;
          setDraftText(latest.text);
          dispatch({
            type: 'draft_save_succeeded',
            payload: { draft: latest, preserveCurrentText: true },
          });
        } else {
          if (!isCurrentDraftValid())
            throw new Error('Fix local fields before saving your version.');
          draftConflictTextRef.current = null;
          await persistDraftText(draftTextRef.current, { preserveCurrentText: true });
        }
      } catch (error) {
        if (persistenceVersion !== authoringPersistenceVersionRef.current) return;
        dispatch({
          type: 'draft_save_failed',
          payload: { error: error instanceof Error ? error.message : 'Unable to reconcile draft.' },
        });
      } finally {
        if (persistenceVersion === authoringPersistenceVersionRef.current)
          draftReconciliationInFlightRef.current = false;
      }
    },
    [state.draft, isCurrentDraftValid, persistDraftText, setDraftText],
  );

  const generatePrompt = useCallback(async (): Promise<PromptPackageResponse | null> => {
    if (!recordingId) {
      dispatch({ type: 'prompt_generate_failed', payload: { error: 'Upload a recording first.' } });
      return null;
    }
    if (!selectedTemplateId) {
      dispatch({
        type: 'prompt_generate_failed',
        payload: {
          error: 'Assignment defaults are missing. Check settings before generating.',
        },
      });
      return null;
    }
    if (transcriptStatus !== 'ready') {
      dispatch({
        type: 'prompt_generate_failed',
        payload: { error: 'Transcript is not ready yet.' },
      });
      return null;
    }
    const assignmentSessionId = getAssignmentSessionId();
    if (!assignmentSessionId) {
      dispatch({
        type: 'prompt_generate_failed',
        payload: { error: 'Confirm the assignment context before generating.' },
      });
      return null;
    }

    invalidatePendingGeneration();
    dispatch({ type: 'prompt_generate_started' });
    try {
      const normalizedTeacherNotes = teacherNotes.trim();
      const response = await createPromptPackage(recordingId, {
        assignmentSessionId,
        templateId: selectedTemplateId,
      });
      onTeacherNotesResolved(response.notes ?? normalizedTeacherNotes);
      dispatch({
        type: 'prompt_generate_succeeded',
        payload: {
          promptPackage: response,
          promptText: response.text ?? '',
        },
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to generate prompt.';
      dispatch({ type: 'prompt_generate_failed', payload: { error: message } });
      return null;
    }
  }, [
    invalidatePendingGeneration,
    getAssignmentSessionId,
    onTeacherNotesResolved,
    recordingId,
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

  const generateDraftForPromptPackageId = useCallback(
    async (promptPackageId: string | null | undefined): Promise<GenerateDraftResponse | null> => {
      if (!promptPackageId) {
        dispatch({
          type: 'draft_generate_failed',
          payload: { error: 'Generate the assignment first.' },
        });
        return null;
      }
      dispatch({ type: 'draft_generate_started' });
      const requestVersion = generationRequestVersionRef.current + 1;
      generationRequestVersionRef.current = requestVersion;

      try {
        const fallbackProvider =
          state.selectedGenerationProvider ||
          generationOptions?.defaultProvider ||
          generationOptions?.providers?.[0] ||
          undefined;
        const fallbackModel =
          state.selectedGenerationModel ||
          (fallbackProvider
            ? generationOptions?.defaultModelByProvider?.[
                fallbackProvider as keyof NonNullable<
                  typeof generationOptions
                >['defaultModelByProvider']
              ]
            : undefined) ||
          generationOptions?.modelOptions.find((option) => option.provider === fallbackProvider)
            ?.id ||
          undefined;
        const generated = await generateDraft({
          promptPackageId,
          provider: fallbackProvider as GenerateDraftRequest['provider'],
          model: fallbackModel,
        });
        if (generationRequestVersionRef.current !== requestVersion) {
          return null;
        }
        const generatedText = generated.text ?? '';
        resetEditorSession();
        draftTextRef.current = generatedText;
        dispatch({
          type: 'draft_generate_succeeded',
          payload: {
            draftText: generatedText,
            draftFormat: generated.format,
            generatedValidationContext: generated.validationContext,
            quota: generated.quota ?? null,
            runtimeSelection: {
              provider: generated.provider,
              model: generated.model,
            },
            quotaWindowTickMs: Date.now(),
          },
        });
        if (generated.text?.trim()) {
          try {
            await persistDraftText(generated.text, {
              promptPackageId,
              format: generated.format,
              validationContext: generated.validationContext,
            });
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
    },
    [
      generationOptions,
      persistDraftText,
      state.selectedGenerationModel,
      state.selectedGenerationProvider,
    ],
  );

  const generateDraftHandler = useCallback(async (): Promise<GenerateDraftResponse | null> => {
    if (!state.promptPackage?.id) {
      dispatch({
        type: 'draft_generate_failed',
        payload: { error: 'Generate the assignment first.' },
      });
      return null;
    }
    if (!structuredDraft) return null;
    return generateDraftForPromptPackageId(state.promptPackage.id);
  }, [generateDraftForPromptPackageId, state.promptPackage?.id, structuredDraft]);

  const generateAssignment = useCallback(
    async (options?: { forceFreshPrompt?: boolean }): Promise<GenerateDraftResponse | null> => {
      if (!structuredDraft) return null;
      const promptPackage =
        !options?.forceFreshPrompt && state.promptPackage?.id
          ? state.promptPackage
          : await generatePrompt();
      if (!promptPackage?.id) return null;
      return generateDraftForPromptPackageId(promptPackage.id);
    },
    [generateDraftForPromptPackageId, generatePrompt, state.promptPackage, structuredDraft],
  );

  const previewDraft = useCallback(async () => {
    const normalizedDraft = state.draftText.trim();
    if (!normalizedDraft) {
      dispatch({
        type: 'preview_failed',
        payload: { error: 'Create the assignment first.' },
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
      if (!typedDraft.assignment) throw new Error('Historical Markdown assignments are read-only.');
      const htmlResponse = await renderHtmlPreview({
        assignment: typedDraft.assignment,
        promptPackageId: state.promptPackage?.id,
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
    typedDraft.assignment,
    state.promptPackage?.id,
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: the token restarts autosave when a pending write settles without a content change.
  useEffect(() => {
    if (!draftValid || !state.promptPackage?.id || !state.draftText.trim() || !draftDirty) {
      if (draftAutosaveTimeoutRef.current) {
        clearTimeout(draftAutosaveTimeoutRef.current);
        draftAutosaveTimeoutRef.current = null;
      }
      return;
    }
    if (draftConflictTextRef.current !== null) return;

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
      void persistDraftText(textToSave).catch((error) => {
        const message = error instanceof Error ? error.message : 'Unable to autosave draft.';
        dispatch({ type: 'draft_save_failed', payload: { error: message } });
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
    draftRecoveryConflict,
    draftValid,
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
        : ttsProviders.find((provider) => provider === DEFAULT_TTS_PROVIDER)) ??
      ttsProviders[0] ??
      DEFAULT_TTS_PROVIDER;
    if (
      !ttsProviders.includes(state.selectedTtsProvider) ||
      (!state.ttsSelectionExplicit && state.selectedTtsProvider !== preferredProvider)
    ) {
      dispatch({
        type: 'publish_config_updated',
        payload: { selectedTtsProvider: preferredProvider },
      });
    }
  }, [defaultTtsProvider, state.selectedTtsProvider, state.ttsSelectionExplicit, ttsProviders]);

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
    if (state.selectedTtsProvider === 'inworld' || state.selectedTtsProvider === 'gemini') {
      if (modelOptions.length === 0) {
        if (state.selectedTtsModel) {
          dispatch({ type: 'publish_config_updated', payload: { selectedTtsModel: '' } });
        }
        return;
      }
      const configuredDefault = defaultTtsModelByProvider?.[state.selectedTtsProvider];
      const preferredModel =
        configuredDefault && modelOptions.includes(configuredDefault)
          ? configuredDefault
          : modelOptions[0];
      if (!preferredModel) return;
      if (
        !state.selectedTtsModel ||
        !modelOptions.includes(state.selectedTtsModel) ||
        (!state.ttsSelectionExplicit && state.selectedTtsModel !== preferredModel)
      ) {
        dispatch({
          type: 'publish_config_updated',
          payload: { selectedTtsModel: preferredModel },
        });
      }
      return;
    }

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
      if (
        !state.selectedTtsModel ||
        !modelOptions.includes(state.selectedTtsModel) ||
        (!state.ttsSelectionExplicit && state.selectedTtsModel !== preferredModel)
      ) {
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
    state.ttsSelectionExplicit,
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
    editorSessionKey,
    editorValidationContext: validationContext,
    reconcileDraft,
    previewHtml: draftValid ? state.previewHtml : null,
    draftValid,
    structuredDraft,
    isCurrentDraftValid,
    isCurrentDraftSaved,
    assignmentValidationError: typedDraft.error,
    generationProviders,
    generationModelsForProvider,
    promptReady,
    draftDirty,
    draftRecoveryConflict,
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
    generateAssignment,
    generateDraft: generateDraftHandler,
    runValidation,
    saveDraft,
    flushDraftAutosave,
    refreshDraftPreservingLocal,
    previewDraft,
    publishAssignment,
    applyHydrationSnapshot,
    resetAuthoring,
    invalidatePendingGeneration,
  };
}
