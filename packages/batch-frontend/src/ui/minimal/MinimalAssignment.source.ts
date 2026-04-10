import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  RecordingListItem,
  RecordingStatus,
  RecordingTranscriptResponse,
  SttProvider,
  StudentOption,
} from '../../utils/api';
import {
  fetchRecordingTranscript,
  fetchStudentOptions,
  getRecording as getRecordingStatus,
  retryRecordingTranscription,
  updateRecordingTranscript,
  uploadRecording,
} from '../../utils/api';
import { getRecordingPollingDecision } from './MinimalAssignment.polling';

const POLL_INTERVAL_MS = 3000;
const FALLBACK_STT_PROVIDERS: SttProvider[] = ['deepgram', 'elevenlabs', 'google'];

export type TranscriptUiStatus = 'idle' | 'loading' | 'processing' | 'ready' | 'failed';

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

interface UseMinimalAssignmentSourceControllerParams {
  configuredSttProviders: readonly string[] | null | undefined;
  defaultSttProvider: SttProvider | null;
  onBeforeUploadReset: () => void;
}

export interface SourceController extends SourceHydrationSnapshot {
  uploading: boolean;
  uploadProgress: number;
  selectedSttProvider: SttProvider;
  transcriptSaving: boolean;
  retryingTranscript: boolean;
  studentOptions: StudentOption[];
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
  handleSaveTranscript: () => Promise<void>;
  handleRetryTranscription: () => Promise<void>;
  resetSourceFlow: () => void;
  applyHydratedSnapshot: (snapshot: SourceHydrationSnapshot) => void;
  resolveBoundProfileId: (studentId: string) => string;
}

function isSttProvider(value: string | null | undefined): value is SttProvider {
  return value === 'deepgram' || value === 'elevenlabs' || value === 'google';
}

export function useMinimalAssignmentSourceController({
  configuredSttProviders,
  defaultSttProvider,
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
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentOptionsError, setStudentOptionsError] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [uploadCacheNotice, setUploadCacheNotice] = useState<string | null>(null);

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

  const resetSourceFlow = useCallback(() => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    sttProviderUserChangedRef.current = false;
    setRecording(null);
    setRecordingStatus(null);
    setRecordingError(null);
    setTranscript(null);
    setTranscriptText('');
    setTranscriptStatus('idle');
    setTranscriptError(null);
    setTranscriptSaving(false);
    setRetryingTranscript(false);
    setSelectedFileName(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploading(false);
    setUploadCacheNotice(null);
  }, []);

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
        const updated = await getRecordingStatus(recording.recordingId);
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
  }, [loadTranscript, recording?.recordingId, transcript?.transcriptId]);

  useEffect(() => {
    if (transcriptText.trim()) {
      setTranscriptStatus('ready');
      setTranscriptError(null);
    }
  }, [transcriptText]);

  const handleSaveTranscript = useCallback(async () => {
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
  }, [recording?.recordingId, transcriptText]);

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
    retryingTranscript,
    studentOptions,
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
    resetSourceFlow,
    applyHydratedSnapshot,
    resolveBoundProfileId,
  };
}
