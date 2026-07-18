import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  JobEvent,
  RecordingListItem,
  RecordingStatus,
  RecordingTranscriptResponse,
  SttProvider,
  StudentOption,
} from '../../utils/api';
import {
  createManualTranscriptSource,
  fetchRecordingTranscript,
  fetchStudentOptions,
  getRecording as getRecordingStatus,
  retryRecordingTranscription,
  subscribeToJobEvents,
  updateRecordingTranscript,
  uploadRecording,
} from '../../utils/api';
import {
  getNextFallbackPollingDelay,
  getRecordingPollingDecision,
  INITIAL_FALLBACK_POLL_MS,
  isFallbackPollingPaused,
  SSE_STALE_TIMEOUT_MS,
} from './MinimalAssignment.polling';

const FALLBACK_STT_PROVIDERS: SttProvider[] = ['deepgram', 'elevenlabs', 'google'];

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
}

interface UseMinimalAssignmentSourceControllerParams {
  configuredSttProviders: readonly string[] | null | undefined;
  defaultSttProvider: SttProvider | null;
  initialSelectedStudentId?: string | null;
  onBeforeUploadReset: () => void;
}

export interface SourceController extends SourceHydrationSnapshot {
  uploading: boolean;
  uploadProgress: number;
  selectedSttProvider: SttProvider;
  transcriptSaving: boolean;
  manualTranscriptSaving: boolean;
  manualTranscriptError: string | null;
  retryingTranscript: boolean;
  studentOptions: StudentOption[];
  studentOptionsLoading: boolean;
  studentOptionsError: string | null;
  sttProviders: readonly SttProvider[];
  selectedStudent: StudentOption | null;
  transcriptDirty: boolean;
  transcriptReady: boolean;
  setTranscriptText: (value: string) => void;
  loadStudentOptions: () => Promise<void>;
  handleStudentSelectionChange: (nextStudentId: string) => void;
  handleSelectedSttProviderChange: (provider: SttProvider) => void;
  handleFiles: (files: File[]) => void;
  handleCancelUpload: () => void;
  loadTranscript: () => Promise<void>;
  handleSaveTranscript: () => Promise<RecordingTranscriptResponse | null>;
  handleRetryTranscription: () => Promise<void>;
  createManualTranscript: (text: string, displayName?: string) => Promise<void>;
  resetSourceFlow: (options?: SourceResetOptions) => void;
  applyHydratedSnapshot: (snapshot: SourceHydrationSnapshot) => void;
  resolveBoundProfileId: (studentId: string) => string;
  bindStudentProfile: (studentId: string, profileId: string) => void;
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
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedSttProvider, setSelectedSttProvider] = useState<SttProvider>('deepgram');
  const uploadAbortRef = useRef<AbortController | null>(null);
  const sttProviderUserChangedRef = useRef(false);
  const [transcript, setTranscript] = useState<RecordingTranscriptResponse | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptUiStatus>('idle');
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [retryingTranscript, setRetryingTranscript] = useState(false);
  const [manualTranscriptSaving, setManualTranscriptSaving] = useState(false);
  const [manualTranscriptError, setManualTranscriptError] = useState<string | null>(null);
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentOptionsLoading, setStudentOptionsLoading] = useState(false);
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

  useEffect(() => {
    latestRecordingRef.current = recording;
  }, [recording]);

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
    if (providers.length > 0) {
      return [...new Set(providers)];
    }
    return [...FALLBACK_STT_PROVIDERS];
  }, [configuredSttProviders]);

  const selectedStudent = useMemo(
    () => studentOptions.find((student) => student.id === selectedStudentId) ?? null,
    [selectedStudentId, studentOptions],
  );

  const transcriptDirty = useMemo(() => {
    const original = transcript?.text ?? '';
    return transcriptText.trim() !== original.trim();
  }, [transcript?.text, transcriptText]);

  const transcriptReady = transcriptStatus === 'ready' && transcriptText.trim().length > 0;

  const resolveBoundProfileId = useCallback(
    (studentId: string): string =>
      studentOptions.find((student) => student.id === studentId)?.profileId ?? '',
    [studentOptions],
  );

  const bindStudentProfile = useCallback((studentId: string, profileId: string) => {
    const trimmedStudentId = studentId.trim();
    const trimmedProfileId = profileId.trim();
    if (!trimmedStudentId || !trimmedProfileId) return;

    setStudentOptions((current) =>
      current.map((student) =>
        student.id === trimmedStudentId ? { ...student, profileId: trimmedProfileId } : student,
      ),
    );
  }, []);

  const resetSourceFlow = useCallback(
    (options?: SourceResetOptions) => {
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
      sttProviderUserChangedRef.current = false;
      if (options?.nextStudentId !== undefined) {
        setSelectedStudentId(options.nextStudentId);
      } else if (options?.resetStudent) {
        setSelectedStudentId(initialSelectedStudentId ?? '');
      }
      setRecording(null);
      setRecordingStatus(null);
      setRecordingError(null);
      setTranscript(null);
      setTranscriptText('');
      setTranscriptStatus('idle');
      setTranscriptError(null);
      setTranscriptSaving(false);
      setRetryingTranscript(false);
      setManualTranscriptSaving(false);
      setManualTranscriptError(null);
      setSelectedFileName(null);
      setUploadError(null);
      setUploadProgress(0);
      setUploading(false);
      setUploadCacheNotice(null);
    },
    [initialSelectedStudentId],
  );

  const applyHydratedSnapshot = useCallback((snapshot: SourceHydrationSnapshot) => {
    setRecording(snapshot.recording);
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
      setStudentOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load students.';
      setStudentOptionsError(message);
    } finally {
      setStudentOptionsLoading(false);
    }
  }, []);

  const handleStudentSelectionChange = useCallback((nextStudentId: string) => {
    setSelectedStudentId(nextStudentId);
  }, []);

  const handleSelectedSttProviderChange = useCallback((provider: SttProvider) => {
    sttProviderUserChangedRef.current = true;
    setSelectedSttProvider(provider);
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      if (uploading) return;
      if (!selectedStudentId) {
        setUploadError('Select a student before uploading a recording.');
        return;
      }
      onBeforeUploadReset();
      resetSourceFlow();
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
    [onBeforeUploadReset, resetSourceFlow, selectedStudentId, selectedSttProvider, uploading],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      void handleUpload(file);
    },
    [handleUpload],
  );

  const handleCancelUpload = useCallback(() => {
    if (!uploadAbortRef.current) return;
    uploadAbortRef.current.abort();
  }, []);

  const loadTranscriptForRecording = useCallback(
    async (recordingId: string, currentRecordingStatus: RecordingStatus | null) => {
      setTranscriptStatus('loading');
      setTranscriptError(null);

      try {
        const response = await fetchRecordingTranscript(recordingId);
        setTranscript(response);
        setTranscriptText(response.text ?? '');
        setTranscriptStatus('ready');
      } catch (error) {
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
      latestRecordingRef.current = updated;
      setRecording(updated);
      setRecordingStatus(updated.status);
      setRecordingError(updated.error ?? null);
      const decision = getRecordingPollingDecision({
        status: updated.status,
        error: updated.error,
        hasTranscriptId: Boolean(latestTranscriptIdRef.current),
      });
      if (decision.shouldLoadTranscript) {
        void loadTranscriptForRecording(recordingId, updated.status);
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
      applyRecordingTransition({
        ...currentRecording,
        status: event.status,
        transcriptId: event.transcriptId ?? currentRecording.transcriptId,
        error: event.error ?? null,
        studentId: event.studentId ?? currentRecording.studentId,
        source: event.source ?? currentRecording.source,
        displayName: event.displayName ?? currentRecording.displayName,
        durationSec: event.durationSec ?? currentRecording.durationSec,
        channels: event.channels ?? currentRecording.channels,
        bytes: event.bytes ?? currentRecording.bytes,
        createdAt: event.createdAt ?? currentRecording.createdAt,
        updatedAt: event.updatedAt ?? currentRecording.updatedAt,
      });
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

  const handleSaveTranscript =
    useCallback(async (): Promise<RecordingTranscriptResponse | null> => {
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
          );
          latestTranscriptRef.current = response;
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
        const message = error instanceof Error ? error.message : 'Unable to save transcript.';
        setTranscriptError(message);
        return null;
      } finally {
        if (pendingTranscriptTextRef.current === normalizedText) {
          pendingTranscriptTextRef.current = null;
        }
        setTranscriptSaving(false);
      }
    }, [recording?.recordingId, transcriptText]);

  useEffect(() => {
    if (!transcriptDirty || !recording?.recordingId || !transcript?.workingVersion) return;
    const timeout = setTimeout(() => {
      void handleSaveTranscript();
    }, 1500);
    return () => clearTimeout(timeout);
  }, [handleSaveTranscript, recording?.recordingId, transcript?.workingVersion, transcriptDirty]);

  const handleRetryTranscription = useCallback(async () => {
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
  }, [recording?.recordingId, selectedSttProvider]);

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
        setRecording(created);
        setRecordingStatus(created.status);
        setRecordingError(created.error ?? null);
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
    recording,
    recordingStatus,
    recordingError,
    uploading,
    uploadProgress,
    uploadError,
    selectedFileName,
    selectedSttProvider,
    transcript,
    transcriptText,
    transcriptStatus,
    transcriptError,
    transcriptSaving,
    manualTranscriptSaving,
    manualTranscriptError,
    retryingTranscript,
    studentOptions,
    studentOptionsLoading,
    studentOptionsError,
    selectedStudentId,
    uploadCacheNotice,
    sttProviders,
    selectedStudent,
    transcriptDirty,
    transcriptReady,
    setTranscriptText,
    loadStudentOptions,
    handleStudentSelectionChange,
    handleSelectedSttProviderChange,
    handleFiles,
    handleCancelUpload,
    loadTranscript,
    handleSaveTranscript,
    handleRetryTranscription,
    createManualTranscript,
    resetSourceFlow,
    applyHydratedSnapshot,
    resolveBoundProfileId,
    bindStudentProfile,
  };
}
