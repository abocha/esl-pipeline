import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AssignmentSession,
  AudioInputTopology,
  JobEvent,
  RecordingListItem,
  RecordingStatus,
  RecordingTranscriptResponse,
  SttProvider,
  StudentOption,
} from '../../utils/api';
import {
  ArtifactWorkingConflictApiError,
  createManualTranscriptSource,
  fetchRecordingTranscript,
  fetchStudentOptions,
  getRecording as getRecordingStatus,
  getRecordingUploadOperation,
  RecordingUploadPreDispatchError,
  subscribeToJobEvents,
  updateRecordingTranscript,
  uploadRecording,
} from '../../utils/api';
import { getRecordingErrorAction, selectNewestRecording } from '../../utils/recording-state';
import {
  getNextFallbackPollingDelay,
  getRecordingPollingDecision,
  INITIAL_FALLBACK_POLL_MS,
  isFallbackPollingPaused,
  SSE_STALE_TIMEOUT_MS,
} from './MinimalAssignment.polling';

const FALLBACK_STT_PROVIDERS: SttProvider[] = ['deepgram', 'elevenlabs', 'google'];
const PENDING_UPLOAD_OPERATION_STORAGE_KEY = 'esl-pipeline.pending-recording-upload.v1';

interface PendingUploadOperation {
  id: string;
  workflowId: string;
  studentId: string;
  sttProvider: SttProvider | null;
  audioTopology: AudioInputTopology;
}

const UPLOAD_WORKFLOW_STORAGE_KEY = 'esl-pipeline.recording-upload-workflow.v1';

function loadUploadWorkflowId(): string {
  if (typeof window === 'undefined') return crypto.randomUUID();
  try {
    const existing = sessionStorage.getItem(UPLOAD_WORKFLOW_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    // A private browsing/storage failure only makes this browser session non-resumable.
  }
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(UPLOAD_WORKFLOW_STORAGE_KEY, id);
  } catch {
    // Keep the in-memory scope even when persistence is unavailable.
  }
  return id;
}

function persistUploadWorkflowId(id: string): void {
  try {
    sessionStorage.setItem(UPLOAD_WORKFLOW_STORAGE_KEY, id);
  } catch {
    // The operation metadata remains protected by the in-memory workflow scope.
  }
}

function loadPendingUploadOperation(): PendingUploadOperation | null {
  if (typeof window === 'undefined') return null;
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(PENDING_UPLOAD_OPERATION_STORAGE_KEY) ?? 'null',
    );
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<PendingUploadOperation>;
    return typeof candidate.id === 'string' &&
      typeof candidate.workflowId === 'string' &&
      typeof candidate.studentId === 'string'
      ? (candidate as PendingUploadOperation)
      : null;
  } catch {
    return null;
  }
}

function persistPendingUploadOperation(operation: PendingUploadOperation | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (operation)
      localStorage.setItem(PENDING_UPLOAD_OPERATION_STORAGE_KEY, JSON.stringify(operation));
    else localStorage.removeItem(PENDING_UPLOAD_OPERATION_STORAGE_KEY);
  } catch {
    // Storage unavailability must not change the in-memory retry identity.
  }
}

export type TranscriptUiStatus = 'idle' | 'loading' | 'processing' | 'ready' | 'failed';

function sortStudentsForPicker(students: StudentOption[]): StudentOption[] {
  return [...students].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;

    return left.id.localeCompare(right.id);
  });
}

export interface SourceHydrationSnapshot {
  recording: RecordingListItem | null;
  recordingStatus: RecordingStatus | null;
  recordingError: string | null;
  selectedFileName: string | null;
  transcript: RecordingTranscriptResponse | null;
  transcriptText: string;
  transcriptStatus: TranscriptUiStatus;
  transcriptError: string | null;
  selectedStudentId: string;
  uploadError: string | null;
  uploadCacheNotice: string | null;
}

export interface SourceResetOptions {
  resetStudent?: boolean;
  nextStudentId?: string;
  preserveRecordingSettings?: boolean;
  /** Internal source reset before a selected-file submission; not a new assignment intent. */
  preserveUploadWorkflow?: boolean;
}

interface UseMinimalAssignmentSourceControllerParams {
  configuredSttProviders: readonly string[] | null | undefined;
  defaultSttProvider: SttProvider | null;
  initialSelectedStudentId?: string | null;
  onBeforeUploadReset: () => void;
}

export interface SourceController extends SourceHydrationSnapshot {
  canonicalAssignmentResume: AssignmentSession | null;
  consumeCanonicalAssignmentResume: () => void;
  uploading: boolean;
  canRetryUpload: boolean;
  replacingAudio: boolean;
  uploadProgress: number;
  selectedSttProvider: SttProvider;
  sttProviderOverrideActive: boolean;
  selectedAudioTopology: AudioInputTopology;
  transcriptSaving: boolean;
  manualTranscriptSaving: boolean;
  manualTranscriptError: string | null;
  studentOptions: StudentOption[];
  studentOptionsLoading: boolean;
  studentOptionsResolved: boolean;
  studentOptionsError: string | null;
  sttProviders: readonly SttProvider[];
  selectedStudent: StudentOption | null;
  transcriptDirty: boolean;
  transcriptRecoveryConflict: boolean;
  transcriptReady: boolean;
  setTranscriptText: (value: string) => void;
  loadStudentOptions: () => Promise<void>;
  handleStudentSelectionChange: (nextStudentId: string) => void;
  handleSelectedSttProviderChange: (provider: SttProvider | 'auto') => void;
  handleSelectedAudioTopologyChange: (topology: AudioInputTopology) => void;
  handleFiles: (files: File[]) => void;
  beginAudioReplacement: () => void;
  cancelAudioReplacement: () => void;
  handleCancelUpload: () => void;
  retryPendingUpload: () => void;
  loadTranscript: () => Promise<void>;
  refreshTranscriptPreservingLocal: () => Promise<void>;
  reconcileRecordingAndTranscript: () => Promise<void>;
  handleSaveTranscript: (speakerRoleMapping?: {
    roles: { speaker: number; role: 'teacher' | 'student' }[];
  }) => Promise<RecordingTranscriptResponse | null>;
  createManualTranscript: (text: string, displayName?: string) => Promise<void>;
  resetSourceFlow: (options?: SourceResetOptions) => void;
  applyHydratedSnapshot: (snapshot: SourceHydrationSnapshot) => void;
}

function isSttProvider(value: string | null | undefined): value is SttProvider {
  return value === 'deepgram' || value === 'elevenlabs' || value === 'google';
}

export function useMinimalAssignmentSourceController({
  configuredSttProviders,
  defaultSttProvider,
  initialSelectedStudentId,
  onBeforeUploadReset,
}: UseMinimalAssignmentSourceControllerParams): SourceController {
  const [recording, setRecording] = useState<RecordingListItem | null>(null);
  const [canonicalAssignmentResume, setCanonicalAssignmentResume] =
    useState<AssignmentSession | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [replacingAudio, setReplacingAudio] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedSttProvider, setSelectedSttProvider] = useState<SttProvider>('deepgram');
  const [sttProviderOverrideActive, setSttProviderOverrideActive] = useState(false);
  const [selectedAudioTopology, setSelectedAudioTopology] =
    useState<AudioInputTopology>('mixed_recording');
  const uploadAbortRef = useRef<AbortController | null>(null);
  const pendingUploadFileRef = useRef<File | null>(null);
  const pendingUploadOperationRef = useRef<PendingUploadOperation | null>(
    loadPendingUploadOperation(),
  );
  const uploadWorkflowIdRef = useRef(loadUploadWorkflowId());
  const selectedStudentIdRef = useRef(initialSelectedStudentId ?? '');
  const sttProviderUserChangedRef = useRef(false);
  const [transcript, setTranscript] = useState<RecordingTranscriptResponse | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptUiStatus>('idle');
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [manualTranscriptSaving, setManualTranscriptSaving] = useState(false);
  const [manualTranscriptError, setManualTranscriptError] = useState<string | null>(null);
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentOptionsLoading, setStudentOptionsLoading] = useState(false);
  const [studentOptionsResolved, setStudentOptionsResolved] = useState(false);
  const [studentOptionsError, setStudentOptionsError] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState(initialSelectedStudentId ?? '');
  const [uploadCacheNotice, setUploadCacheNotice] = useState<string | null>(null);
  const latestRecordingRef = useRef<RecordingListItem | null>(null);
  const latestTranscriptIdRef = useRef<string | null>(null);
  const latestTranscriptRef = useRef<RecordingTranscriptResponse | null>(null);
  const transcriptTextRef = useRef('');
  const transcriptSaveQueueRef = useRef<Promise<RecordingTranscriptResponse | null>>(
    Promise.resolve(null),
  );
  const pendingTranscriptTextRef = useRef<string | null>(null);
  const transcriptConflictTextRef = useRef<string | null>(null);

  const ownsPendingUploadOperation = useCallback((operation: PendingUploadOperation): boolean => {
    const pending = pendingUploadOperationRef.current;
    return (
      pending?.id === operation.id &&
      pending.workflowId === operation.workflowId &&
      pending.studentId === operation.studentId &&
      uploadWorkflowIdRef.current === operation.workflowId &&
      selectedStudentIdRef.current === operation.studentId
    );
  }, []);

  const clearPendingUploadOperation = useCallback(
    (operation: PendingUploadOperation) => {
      if (!ownsPendingUploadOperation(operation)) return false;
      pendingUploadOperationRef.current = null;
      pendingUploadFileRef.current = null;
      persistPendingUploadOperation(null);
      return true;
    },
    [ownsPendingUploadOperation],
  );

  useEffect(() => {
    latestRecordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    const pending = pendingUploadOperationRef.current;
    if (!pending) return;
    // On a fresh page load the assignment context has not necessarily been
    // selected yet. Keep immutable operation metadata until the user selects
    // a context to compare; clearing it here would make an unresolved upload
    // neither reconcilable nor retryable after refresh.
    if (!selectedStudentId) return;
    if (
      pending.workflowId !== uploadWorkflowIdRef.current ||
      pending.studentId !== selectedStudentId
    ) {
      pendingUploadOperationRef.current = null;
      persistPendingUploadOperation(null);
      return;
    }
    const reconciliationOwner = { ...pending };
    void getRecordingUploadOperation(reconciliationOwner.id)
      .then((resolved) => {
        if (!resolved) return;
        // The result belongs to the captured workflow, student, and operation.
        // A reset, resume, student change, or replacement invalidates it.
        if ('outcome' in resolved) {
          if (!clearPendingUploadOperation(reconciliationOwner)) return;
          setCanonicalAssignmentResume(resolved.session);
          return;
        }
        if (!('source' in resolved)) return;
        if (!clearPendingUploadOperation(reconciliationOwner)) return;
        latestRecordingRef.current = resolved;
        setRecording(resolved);
        setRecordingStatus(resolved.status);
        setRecordingError(
          resolved.productState === 'attention'
            ? getRecordingErrorAction(resolved.errorCode)
            : null,
        );
        setSelectedFileName(resolved.displayName ?? null);
      })
      .catch(() => undefined);
  }, [clearPendingUploadOperation, selectedStudentId]);

  useEffect(() => {
    latestTranscriptIdRef.current = transcript?.transcriptId ?? null;
    latestTranscriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    transcriptTextRef.current = transcriptText;
  }, [transcriptText]);

  const sttProviders = useMemo<SttProvider[]>(() => {
    const providers = (configuredSttProviders ?? [])
      .map((provider) => (isSttProvider(provider) ? provider : null))
      .filter((provider): provider is SttProvider => provider !== null);
    const availableProviders =
      providers.length > 0 ? [...new Set(providers)] : FALLBACK_STT_PROVIDERS;
    return selectedAudioTopology === 'trusted_split_channels'
      ? availableProviders.filter((provider) => provider === 'deepgram')
      : availableProviders;
  }, [configuredSttProviders, selectedAudioTopology]);

  const selectedStudent = useMemo(
    () => studentOptions.find((student) => student.id === selectedStudentId) ?? null,
    [selectedStudentId, studentOptions],
  );

  const transcriptDirty = useMemo(() => {
    const original = transcript?.text ?? '';
    return transcriptText.trim() !== original.trim();
  }, [transcript?.text, transcriptText]);

  const transcriptReady = transcriptStatus === 'ready' && transcriptText.trim().length > 0;

  const resetSourceFlow = useCallback(
    (options?: SourceResetOptions) => {
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
      if (!options?.preserveUploadWorkflow) {
        uploadWorkflowIdRef.current = crypto.randomUUID();
        persistUploadWorkflowId(uploadWorkflowIdRef.current);
        pendingUploadOperationRef.current = null;
        pendingUploadFileRef.current = null;
        persistPendingUploadOperation(null);
      }
      if (!options?.preserveRecordingSettings) {
        sttProviderUserChangedRef.current = false;
        setSttProviderOverrideActive(false);
        setSelectedAudioTopology('mixed_recording');
      }
      if (options?.nextStudentId !== undefined) {
        selectedStudentIdRef.current = options.nextStudentId;
        setSelectedStudentId(options.nextStudentId);
      } else if (options?.resetStudent) {
        selectedStudentIdRef.current = initialSelectedStudentId ?? '';
        setSelectedStudentId(initialSelectedStudentId ?? '');
      }
      setRecording(null);
      setCanonicalAssignmentResume(null);
      latestRecordingRef.current = null;
      setRecordingStatus(null);
      setRecordingError(null);
      setTranscript(null);
      latestTranscriptIdRef.current = null;
      latestTranscriptRef.current = null;
      setTranscriptText('');
      setTranscriptStatus('idle');
      setTranscriptError(null);
      setTranscriptSaving(false);
      setManualTranscriptSaving(false);
      setManualTranscriptError(null);
      setSelectedFileName(null);
      setUploadError(null);
      setUploadProgress(0);
      setUploading(false);
      setReplacingAudio(false);
      setUploadCacheNotice(null);
    },
    [initialSelectedStudentId],
  );

  const applyHydratedSnapshot = useCallback((snapshot: SourceHydrationSnapshot) => {
    setCanonicalAssignmentResume(null);
    latestRecordingRef.current = snapshot.recording;
    latestTranscriptIdRef.current = snapshot.transcript?.transcriptId ?? null;
    latestTranscriptRef.current = snapshot.transcript;
    selectedStudentIdRef.current = snapshot.selectedStudentId;
    setReplacingAudio(false);
    setRecording(snapshot.recording);
    setSelectedAudioTopology(snapshot.recording?.audioTopology ?? 'mixed_recording');
    setRecordingStatus(snapshot.recordingStatus);
    setRecordingError(snapshot.recordingError);
    setSelectedFileName(snapshot.selectedFileName);
    setTranscript(snapshot.transcript);
    setTranscriptText(snapshot.transcriptText);
    setTranscriptStatus(snapshot.transcriptStatus);
    setTranscriptError(snapshot.transcriptError);
    setSelectedStudentId(snapshot.selectedStudentId);
    setUploadError(snapshot.uploadError);
    setUploadCacheNotice(snapshot.uploadCacheNotice);
  }, []);

  const loadStudentOptions = useCallback(async () => {
    setStudentOptionsLoading(true);
    try {
      const response = await fetchStudentOptions();
      const sortedStudents = sortStudentsForPicker(response.students ?? []);
      setStudentOptions(sortedStudents);
      setSelectedStudentId((current) => {
        if (current && sortedStudents.some((student) => student.id === current)) {
          return current;
        }
        return '';
      });
      setStudentOptionsResolved(true);
      setStudentOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load students.';
      setStudentOptionsError(message);
    } finally {
      setStudentOptionsLoading(false);
    }
  }, []);

  const handleStudentSelectionChange = useCallback(
    (nextStudentId: string) => {
      if (nextStudentId !== selectedStudentId) {
        uploadWorkflowIdRef.current = crypto.randomUUID();
        persistUploadWorkflowId(uploadWorkflowIdRef.current);
        pendingUploadOperationRef.current = null;
        pendingUploadFileRef.current = null;
        persistPendingUploadOperation(null);
      }
      selectedStudentIdRef.current = nextStudentId;
      setSelectedStudentId(nextStudentId);
    },
    [selectedStudentId],
  );

  const handleSelectedSttProviderChange = useCallback((provider: SttProvider | 'auto') => {
    if (provider === 'auto') {
      sttProviderUserChangedRef.current = false;
      setSttProviderOverrideActive(false);
      return;
    }
    sttProviderUserChangedRef.current = true;
    setSttProviderOverrideActive(true);
    setSelectedSttProvider(provider);
  }, []);
  const handleSelectedAudioTopologyChange = useCallback(
    (topology: AudioInputTopology) => {
      if (
        topology === 'trusted_split_channels' &&
        sttProviderUserChangedRef.current &&
        selectedSttProvider !== 'deepgram'
      ) {
        sttProviderUserChangedRef.current = false;
        setSttProviderOverrideActive(false);
      }
      setSelectedAudioTopology(topology);
    },
    [selectedSttProvider],
  );

  const beginAudioReplacement = useCallback(() => {
    if (!latestRecordingRef.current || latestRecordingRef.current.source !== 'upload') return;
    setUploadError(null);
    setReplacingAudio(true);
  }, []);

  const cancelAudioReplacement = useCallback(() => {
    if (uploadAbortRef.current) return;
    setUploadError(null);
    setReplacingAudio(false);
  }, []);

  const handleUpload = useCallback(
    async (file: File, intent: 'selection' | 'retry') => {
      if (uploading) return;
      if (!selectedStudentId) {
        setUploadError('Select a student before uploading a recording.');
        return;
      }
      const replacingCurrentAudio =
        replacingAudio && latestRecordingRef.current?.source === 'upload';
      const previousFileName = selectedFileName;
      if (!replacingCurrentAudio) {
        onBeforeUploadReset();
        resetSourceFlow({ preserveRecordingSettings: true, preserveUploadWorkflow: true });
      }
      setSelectedFileName(file.name);
      setUploading(true);
      setUploadError(null);
      setUploadProgress(0);

      const requestedProvider = sttProviderUserChangedRef.current ? selectedSttProvider : null;
      const requestedTopology: AudioInputTopology =
        selectedAudioTopology === 'trusted_split_channels'
          ? selectedAudioTopology
          : 'mixed_recording';
      const pending = pendingUploadOperationRef.current;
      const sameLogicalUpload =
        intent === 'retry' &&
        !replacingCurrentAudio &&
        pending?.studentId === selectedStudentId &&
        pending.workflowId === uploadWorkflowIdRef.current &&
        pending.sttProvider === requestedProvider &&
        pending.audioTopology === requestedTopology;
      const operation: PendingUploadOperation =
        sameLogicalUpload && pending
          ? pending
          : {
              id: crypto.randomUUID(),
              workflowId: uploadWorkflowIdRef.current,
              studentId: selectedStudentId,
              sttProvider: requestedProvider,
              audioTopology: requestedTopology,
            };
      pendingUploadOperationRef.current = operation;
      pendingUploadFileRef.current = file;
      persistPendingUploadOperation(operation);

      const controller = new AbortController();
      uploadAbortRef.current = controller;
      try {
        // An uncertain response may already have committed server-side. Resolve it
        // before sending bytes again; a refresh retains only this metadata, never
        // the media bytes themselves.
        if (sameLogicalUpload) {
          const resolved = await getRecordingUploadOperation(operation.id);
          if (resolved && 'outcome' in resolved) {
            if (!clearPendingUploadOperation(operation)) return;
            setCanonicalAssignmentResume(resolved.session);
            setReplacingAudio(false);
            return;
          }
          if (resolved && 'source' in resolved) {
            if (!clearPendingUploadOperation(operation)) return;
            latestRecordingRef.current = resolved;
            setRecording(resolved);
            setRecordingStatus(resolved.status);
            setRecordingError(
              resolved.productState === 'attention'
                ? getRecordingErrorAction(resolved.errorCode)
                : null,
            );
            setSelectedFileName(resolved.displayName || file.name);
            setReplacingAudio(false);
            return;
          }
          if (resolved && resolved.status !== 'reclaimable') {
            if (!ownsPendingUploadOperation(operation)) return;
            setUploadError(
              'The previous upload is still processing. It will resolve before another upload can start.',
            );
            return;
          }
        }
        const response = await uploadRecording(file, {
          studentId: selectedStudentId || undefined,
          sttProvider: requestedProvider ?? undefined,
          audioTopology:
            selectedAudioTopology === 'trusted_split_channels' ? selectedAudioTopology : undefined,
          uploadOperationId: operation.id,
          signal: controller.signal,
          onProgress: (progress) => setUploadProgress(progress),
        });
        if (!ownsPendingUploadOperation(operation)) return;
        if ('outcome' in response) {
          clearPendingUploadOperation(operation);
          setCanonicalAssignmentResume(response.session);
          setReplacingAudio(false);
          return;
        }
        latestRecordingRef.current = response;
        if (replacingCurrentAudio) {
          latestTranscriptIdRef.current = null;
          latestTranscriptRef.current = null;
          transcriptTextRef.current = '';
          pendingTranscriptTextRef.current = null;
          transcriptConflictTextRef.current = null;
          setTranscript(null);
          setTranscriptText('');
          setTranscriptStatus('idle');
          setTranscriptError(null);
          setTranscriptSaving(false);
        }
        setRecording(response);
        setRecordingStatus(response.status);
        setRecordingError(
          response.productState === 'attention'
            ? getRecordingErrorAction(response.errorCode)
            : null,
        );
        setSelectedFileName(response.displayName || file.name);
        setUploadCacheNotice(
          response.cacheHit ? 'Reused an existing transcript for this exact audio file.' : null,
        );
        setReplacingAudio(false);
        clearPendingUploadOperation(operation);
      } catch (error) {
        if (!ownsPendingUploadOperation(operation)) return;
        if (replacingCurrentAudio) setSelectedFileName(previousFileName);
        if (error instanceof RecordingUploadPreDispatchError) {
          clearPendingUploadOperation(operation);
          setUploadError(error.message);
        } else if (controller.signal.aborted) {
          setUploadError('Upload canceled.');
        } else {
          const message = error instanceof Error ? error.message : 'Unable to upload recording.';
          setUploadError(message);
        }
      } finally {
        if (uploadAbortRef.current === controller) {
          setUploading(false);
          uploadAbortRef.current = null;
        }
      }
    },
    [
      onBeforeUploadReset,
      clearPendingUploadOperation,
      ownsPendingUploadOperation,
      replacingAudio,
      resetSourceFlow,
      selectedFileName,
      selectedStudentId,
      selectedSttProvider,
      selectedAudioTopology,
      uploading,
    ],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      // A file-selection event is explicit new/replacement intent. Retrying an
      // ambiguous request is a separate UI action and is the only UUID reuse path.
      void handleUpload(file, 'selection');
    },
    [handleUpload],
  );

  const handleCancelUpload = useCallback(() => {
    if (!uploadAbortRef.current) return;
    uploadAbortRef.current.abort();
  }, []);

  const retryPendingUpload = useCallback(() => {
    const pending = pendingUploadOperationRef.current;
    const file = pendingUploadFileRef.current;
    if (!pending || !file || uploading) return;
    void handleUpload(file, 'retry');
  }, [handleUpload, uploading]);

  const loadTranscriptForRecording = useCallback(
    async (recordingId: string, currentRecordingStatus: RecordingStatus | null) => {
      setTranscriptStatus('loading');
      setTranscriptError(null);

      try {
        const response = await fetchRecordingTranscript(recordingId);
        if (latestRecordingRef.current?.recordingId !== recordingId) return;
        latestTranscriptIdRef.current = response.transcriptId;
        latestTranscriptRef.current = response;
        setTranscript(response);
        setTranscriptText(response.text ?? '');
        setTranscriptStatus('ready');
      } catch (error) {
        if (latestRecordingRef.current?.recordingId !== recordingId) return;
        const message = error instanceof Error ? error.message : 'Unable to load transcript.';
        if (currentRecordingStatus && currentRecordingStatus !== 'transcribed') {
          setTranscriptStatus('processing');
          setTranscriptError(null);
        } else {
          setTranscriptStatus('failed');
          setTranscriptError(message);
        }
      }
    },
    [],
  );

  const loadTranscript = useCallback(async () => {
    if (!recording?.recordingId) return;
    await loadTranscriptForRecording(recording.recordingId, recordingStatus);
  }, [loadTranscriptForRecording, recording?.recordingId, recordingStatus]);

  const refreshTranscriptPreservingLocal = useCallback(async () => {
    if (!recording?.recordingId) return;
    const recordingId = recording.recordingId;
    const durable = latestTranscriptRef.current;
    const localText = transcriptTextRef.current.trim();
    const durableText = durable?.text?.trim() ?? '';
    const preserveLocalText = localText !== durableText;
    try {
      const response = await fetchRecordingTranscript(recordingId);
      if (latestRecordingRef.current?.recordingId !== recordingId) return;
      const remoteText = response.text?.trim() ?? '';
      const remoteChanged =
        durable !== null &&
        (response.workingVersion !== durable.workingVersion ||
          response.contentHash !== durable.contentHash);
      latestTranscriptRef.current = response;
      setTranscript(response);
      if (preserveLocalText && remoteChanged && localText !== remoteText) {
        transcriptConflictTextRef.current = localText;
        setTranscriptError(
          'Newer saved transcript work was found. Review your text before retrying.',
        );
      } else {
        transcriptConflictTextRef.current = null;
        if (!preserveLocalText) setTranscriptText(response.text ?? '');
        setTranscriptError(null);
      }
      setTranscriptStatus('ready');
    } catch (error) {
      if (latestRecordingRef.current?.recordingId !== recordingId) return;
      setTranscriptError(error instanceof Error ? error.message : 'Unable to refresh transcript.');
    }
  }, [recording?.recordingId]);

  const reconcileRecordingAndTranscript = useCallback(async () => {
    const recordingId = latestRecordingRef.current?.recordingId;
    if (!recordingId) return;
    try {
      const updated = await getRecordingStatus(recordingId);
      if (latestRecordingRef.current?.recordingId !== recordingId) return;
      latestRecordingRef.current = updated;
      setRecording(updated);
      setSelectedAudioTopology(updated.audioTopology ?? 'mixed_recording');
      setRecordingStatus(updated.status);
      setRecordingError(
        updated.productState === 'attention' ? getRecordingErrorAction(updated.errorCode) : null,
      );
      await refreshTranscriptPreservingLocal();
    } catch (error) {
      if (latestRecordingRef.current?.recordingId !== recordingId) return;
      setRecordingError(
        error instanceof Error ? error.message : 'Unable to refresh the recording source.',
      );
    }
  }, [refreshTranscriptPreservingLocal]);

  const transcriptRecoveryConflict = transcriptConflictTextRef.current === transcriptText.trim();

  useEffect(() => {
    if (!recording?.recordingId) return;
    const recordingId = recording.recordingId;
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

    const applyRecordingTransition = (updated: RecordingListItem) => {
      if (latestRecordingRef.current?.recordingId !== recordingId) return false;
      const selected = selectNewestRecording(latestRecordingRef.current, updated);
      if (selected !== updated) return true;
      latestRecordingRef.current = selected;
      setRecording(selected);
      setRecordingStatus(selected.status);
      setRecordingError(
        selected.productState === 'attention' ? getRecordingErrorAction(selected.errorCode) : null,
      );
      const decision = getRecordingPollingDecision({
        recording: selected,
        hasTranscriptId: Boolean(latestTranscriptIdRef.current),
      });
      if (decision.shouldLoadTranscript) {
        void loadTranscriptForRecording(recordingId, selected.status);
      }
      if (decision.shouldMarkTranscriptFailed) {
        setTranscriptStatus('failed');
        setTranscriptError(decision.transcriptFailureMessage);
      }
      if (!decision.shouldContinuePolling) {
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
        void pollRecording();
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

    const pollRecording = async (scheduleNext = true) => {
      try {
        const updated = await getRecordingStatus(recordingId);
        if (!active) return;
        const shouldContinue = applyRecordingTransition(updated);
        if (shouldContinue && scheduleNext) {
          fallbackDelay = getNextFallbackPollingDelay(fallbackDelay);
          scheduleFallbackPoll(fallbackDelay);
        }
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : 'Unable to refresh recording status.';
        setRecordingError(message);
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

    const applyRecordingEvent = (event: JobEvent) => {
      if (event.type !== 'recording_state_changed') return;
      if (event.recordingId !== recordingId) return;
      if (!active) return;
      const currentRecording = latestRecordingRef.current;
      if (!currentRecording || currentRecording.recordingId !== recordingId) return;
      armSseStaleTimeout();
      const { type: _type, ...updated } = event;
      applyRecordingTransition(updated);
    };

    documentRef?.addEventListener('visibilitychange', handleVisibilityChange);

    try {
      eventSource = subscribeToJobEvents(applyRecordingEvent, {
        recordingIds: [recordingId],
        onOpen: armSseStaleTimeout,
        onError: startFallbackPolling,
      });
      armSseStaleTimeout();
      void pollRecording(false);
    } catch {
      startFallbackPolling();
    }

    return () => {
      stopMonitoring();
      documentRef?.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadTranscriptForRecording, recording?.recordingId]);

  useEffect(() => {
    if (transcriptText.trim()) {
      setTranscriptStatus('ready');
      setTranscriptError(null);
    }
  }, [transcriptText]);

  const handleSaveTranscript = useCallback(
    async (speakerRoleMapping?: {
      roles: { speaker: number; role: 'teacher' | 'student' }[];
    }): Promise<RecordingTranscriptResponse | null> => {
      if (!recording?.recordingId) return null;
      const normalizedText = transcriptText.trim();
      if (pendingTranscriptTextRef.current === normalizedText) {
        return transcriptSaveQueueRef.current;
      }
      if (!latestTranscriptRef.current?.workingVersion) {
        setTranscriptError('Reload the transcript before saving this edit.');
        return null;
      }
      setTranscriptSaving(true);
      setTranscriptError(null);
      pendingTranscriptTextRef.current = normalizedText;
      const run = transcriptSaveQueueRef.current
        .catch(() => null)
        .then(async () => {
          const current = latestTranscriptRef.current;
          if (!current?.workingVersion)
            throw new Error('Reload the transcript before saving this edit.');
          const response = await updateRecordingTranscript(
            recording.recordingId,
            normalizedText,
            current.workingVersion,
            speakerRoleMapping,
          );
          latestTranscriptRef.current = response;
          transcriptConflictTextRef.current = null;
          setTranscript(response);
          if (transcriptTextRef.current.trim() === normalizedText) {
            setTranscriptText(response.text ?? normalizedText);
          }
          setTranscriptStatus('ready');
          return response;
        });
      transcriptSaveQueueRef.current = run;
      try {
        return await run;
      } catch (error) {
        if (error instanceof ArtifactWorkingConflictApiError) {
          try {
            const latest = await fetchRecordingTranscript(recording.recordingId);
            latestTranscriptRef.current = latest;
            setTranscript(latest);
            transcriptConflictTextRef.current = normalizedText;
          } catch {
            // Keep the conflict result and local buffer; a later retry can refresh again.
          }
        }
        const message = error instanceof Error ? error.message : 'Unable to save transcript.';
        setTranscriptError(message);
        return null;
      } finally {
        if (pendingTranscriptTextRef.current === normalizedText) {
          pendingTranscriptTextRef.current = null;
        }
        setTranscriptSaving(false);
      }
    },
    [recording?.recordingId, transcriptText],
  );

  useEffect(() => {
    if (!transcriptDirty || !recording?.recordingId || !transcript?.workingVersion) return;
    if (transcriptConflictTextRef.current === transcriptText.trim()) return;
    const timeout = setTimeout(() => {
      void handleSaveTranscript();
    }, 1500);
    return () => clearTimeout(timeout);
  }, [
    handleSaveTranscript,
    recording?.recordingId,
    transcript?.workingVersion,
    transcriptDirty,
    transcriptRecoveryConflict,
    transcriptText,
  ]);

  const createManualTranscript = useCallback(
    async (text: string, displayName = 'Pasted lesson transcript') => {
      const normalizedText = text.trim();
      if (!selectedStudentId) {
        setManualTranscriptError('Select a student before adding an existing transcript.');
        return;
      }
      if (!normalizedText) {
        setManualTranscriptError('Paste the existing transcript before continuing.');
        return;
      }

      setManualTranscriptSaving(true);
      setManualTranscriptError(null);
      setUploadError(null);
      setTranscriptError(null);
      onBeforeUploadReset();
      try {
        const created = await createManualTranscriptSource({
          studentId: selectedStudentId,
          text: normalizedText,
          displayName,
        });
        if ('outcome' in created) {
          setCanonicalAssignmentResume(created.session);
          return;
        }
        latestRecordingRef.current = created;
        setRecording(created);
        setRecordingStatus(created.status);
        setRecordingError(
          created.productState === 'attention' ? getRecordingErrorAction(created.errorCode) : null,
        );
        setSelectedFileName(created.displayName || displayName);
        setUploadCacheNotice(null);

        const loaded = await fetchRecordingTranscript(created.recordingId);
        setTranscript(loaded);
        setTranscriptText(loaded.text ?? normalizedText);
        setTranscriptStatus('ready');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to save the existing transcript.';
        setManualTranscriptError(message);
      } finally {
        setManualTranscriptSaving(false);
      }
    },
    [onBeforeUploadReset, selectedStudentId],
  );

  const consumeCanonicalAssignmentResume = useCallback(
    () => setCanonicalAssignmentResume(null),
    [],
  );

  useEffect(() => {
    if (sttProviders.length === 0) return;
    const preferredProvider =
      defaultSttProvider && sttProviders.includes(defaultSttProvider)
        ? defaultSttProvider
        : sttProviders[0];
    if (!preferredProvider) return;
    if (
      defaultSttProvider &&
      sttProviders.includes(defaultSttProvider) &&
      !sttProviderUserChangedRef.current &&
      selectedSttProvider !== defaultSttProvider
    ) {
      setSelectedSttProvider(defaultSttProvider);
      return;
    }

    if (!sttProviders.includes(selectedSttProvider)) {
      setSelectedSttProvider(preferredProvider);
    }
  }, [defaultSttProvider, selectedSttProvider, sttProviders]);

  return {
    canonicalAssignmentResume,
    consumeCanonicalAssignmentResume,
    recording,
    recordingStatus,
    recordingError,
    uploading,
    canRetryUpload: Boolean(
      pendingUploadOperationRef.current && pendingUploadFileRef.current && !uploading,
    ),
    replacingAudio,
    uploadProgress,
    uploadError,
    selectedFileName,
    selectedSttProvider,
    sttProviderOverrideActive,
    selectedAudioTopology,
    transcript,
    transcriptText,
    transcriptStatus,
    transcriptError,
    transcriptSaving,
    manualTranscriptSaving,
    manualTranscriptError,
    studentOptions,
    studentOptionsLoading,
    studentOptionsResolved,
    studentOptionsError,
    selectedStudentId,
    uploadCacheNotice,
    sttProviders,
    selectedStudent,
    transcriptDirty,
    transcriptRecoveryConflict,
    transcriptReady,
    setTranscriptText,
    loadStudentOptions,
    handleStudentSelectionChange,
    handleSelectedSttProviderChange,
    handleSelectedAudioTopologyChange,
    handleFiles,
    beginAudioReplacement,
    cancelAudioReplacement,
    handleCancelUpload,
    retryPendingUpload,
    loadTranscript,
    refreshTranscriptPreservingLocal,
    reconcileRecordingAndTranscript,
    handleSaveTranscript,
    createManualTranscript,
    resetSourceFlow,
    applyHydratedSnapshot,
  };
}
