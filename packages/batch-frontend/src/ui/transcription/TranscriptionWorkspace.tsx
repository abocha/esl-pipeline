import copy from 'copy-to-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useStudentSelection } from '../../context/StudentSelectionContext';
import {
  type DraftResponse,
  type MaterializeDraftResponse,
  type PromptOptionsResponse,
  type PromptPackageResponse,
  type RecordingTranscriptResponse,
  type RecordingStatus,
  type StudentOption,
  approveJob,
  createDraft,
  createPromptPackage,
  fetchPromptOptions,
  fetchStudentOptions,
  fetchPromptPackage,
  fetchRecordingTranscript,
  materializeDraft,
  retryRecordingTranscription,
  uploadRecording,
  updateRecordingTranscript,
} from '../../utils/api';
import { JobConnectionBanner } from '../jobs/JobConnectionBanner';
import { DropZone } from '../shared/DropZone';
import { UploadProgress } from '../shared/UploadProgress';

const ClipboardIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const DownloadIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const RefreshIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const SparkIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 3v4" />
    <path d="M3 5h4" />
    <path d="M19 3v4" />
    <path d="M17 5h4" />
    <path d="M12 12l3 3-3 3-3-3z" />
  </svg>
);

const DraftIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3h18v18H3z" />
    <path d="M7 7h10" />
    <path d="M7 12h10" />
    <path d="M7 17h6" />
  </svg>
);

const RECORDING_STATUS_META: Record<
  RecordingStatus,
  { label: string; note: string; detail: string }
> = {
  ingested: {
    label: 'Ingested',
    note: 'Ingested, awaiting queue',
    detail: 'Ingested and waiting for the transcription queue.',
  },
  queued: {
    label: 'Queued',
    note: 'Queued for transcription',
    detail: 'Queued for transcription.',
  },
  transcribing: {
    label: 'Transcribing',
    note: 'Transcription in progress',
    detail: 'Transcription in progress.',
  },
  transcribed: {
    label: 'Transcribed',
    note: 'Transcript ready',
    detail: 'Transcript ready.',
  },
  failed: {
    label: 'Failed',
    note: 'Transcription failed',
    detail: 'Transcription failed.',
  },
};

const RECORDING_STATUS_OPTIONS: { value: RecordingStatus; label: string }[] = [
  { value: 'ingested', label: 'Ingested' },
  { value: 'queued', label: 'Queued' },
  { value: 'transcribing', label: 'Transcribing' },
  { value: 'transcribed', label: 'Transcribed' },
  { value: 'failed', label: 'Failed' },
];

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus'];

const getRecordingStatusMeta = (status?: RecordingStatus | null) => {
  if (!status) {
    return {
      label: 'Unknown',
      note: 'Status unavailable',
      detail: 'Status unavailable.',
    };
  }
  return RECORDING_STATUS_META[status];
};

export const TranscriptionWorkspace: React.FC = () => {
  const { recordings, registerRecording, refreshRecordings, trackJob } = useJobMonitor();
  const { selectedStudent } = useStudentSelection();
  const [selectedRecordingId, setSelectedRecordingId] = useState('');
  const [recordingInput, setRecordingInput] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentFilter, setStudentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RecordingStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadStudentId, setUploadStudentId] = useState('');
  const [recordingPanelError, setRecordingPanelError] = useState<string | null>(null);
  const [recordingDetailError, setRecordingDetailError] = useState<string | null>(null);
  const [studentOptionsError, setStudentOptionsError] = useState<string | null>(null);
  const [promptOptionsError, setPromptOptionsError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const [transcript, setTranscript] = useState<RecordingTranscriptResponse | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  const [notes, setNotes] = useState('');
  const [promptTemplateId, setPromptTemplateId] = useState('');
  const [promptProfileId, setPromptProfileId] = useState('');
  const [promptOptions, setPromptOptions] = useState<PromptOptionsResponse | null>(null);
  const [promptPackage, setPromptPackage] = useState<PromptPackageResponse | null>(null);
  const [promptPackageId, setPromptPackageId] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const [draftText, setDraftText] = useState('');
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [materializeLoading, setMaterializeLoading] = useState(false);
  const [materialized, setMaterialized] = useState<MaterializeDraftResponse | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const lastStudentSelectionRef = useRef<string | null>(null);
  const lastStudentProfileRef = useRef<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const selectedRecording = useMemo(
    () => recordings.find((item) => item.recordingId === selectedRecordingId) ?? null,
    [recordings, selectedRecordingId],
  );

  const studentLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of studentOptions) {
      map.set(student.id, student.name);
    }
    return map;
  }, [studentOptions]);

  const filteredRecordings = useMemo(() => {
    let items = recordings;
    if (studentFilter === 'unassigned') {
      items = items.filter((recording) => !recording.studentId);
    } else if (studentFilter !== 'all') {
      items = items.filter((recording) => recording.studentId === studentFilter);
    }

    if (statusFilter !== 'all') {
      items = items.filter((recording) => recording.status === statusFilter);
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;

    return items.filter((recording) => {
      const haystack = [recording.displayName ?? '', recording.recordingId];
      return haystack.some((value) => value.toLowerCase().includes(query));
    });
  }, [recordings, studentFilter, statusFilter, searchQuery]);

  const templateOptions = promptOptions?.templates ?? [];
  const profileOptions = promptOptions?.profiles ?? [];
  const selectedStatusMeta = selectedRecording
    ? getRecordingStatusMeta(selectedRecording.status)
    : null;

  useEffect(() => {
    if (!selectedStudent) {
      setUploadStudentId('');
      setPromptProfileId('');
      lastStudentSelectionRef.current = null;
      lastStudentProfileRef.current = null;
      return;
    }
    const selectionChanged = lastStudentSelectionRef.current !== selectedStudent.id;
    const profileChanged =
      (selectedStudent.profileId ?? null) !== lastStudentProfileRef.current;

    if (selectionChanged) {
      setUploadStudentId(selectedStudent.id);
    }
    if (selectionChanged || profileChanged) {
      if (selectedStudent.profileId) {
        setPromptProfileId(selectedStudent.profileId);
      } else {
        setPromptProfileId('');
      }
    }

    lastStudentSelectionRef.current = selectedStudent.id;
    lastStudentProfileRef.current = selectedStudent.profileId ?? null;
  }, [selectedStudent]);

  useEffect(() => {
    let active = true;
    const status = statusFilter === 'all' ? undefined : statusFilter;
    const studentId =
      studentFilter === 'all' || studentFilter === 'unassigned' ? undefined : studentFilter;
    const q = searchQuery.trim() || undefined;

    const timeout = setTimeout(() => {
      const run = async () => {
        try {
          await refreshRecordings({
            status,
            studentId,
            q,
          });
          if (!active) return;
          setRecordingPanelError(null);
        } catch (error) {
          if (!active) return;
          const message =
            error instanceof Error ? error.message : 'Unable to load recordings';
          setRecordingPanelError(message);
        }
      };
      void run();
    }, q ? 250 : 0);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [refreshRecordings, searchQuery, statusFilter, studentFilter]);

  useEffect(() => {
    let active = true;
    const loadStudents = async () => {
      try {
        const response = await fetchStudentOptions();
        if (!active) return;
        setStudentOptions(response.students ?? []);
        setStudentOptionsError(null);
      } catch (error) {
        if (!active) return;
        console.warn('Failed to load student options', error);
        const message = error instanceof Error ? error.message : 'Unable to load student options';
        setStudentOptionsError(message);
      }
    };
    void loadStudents();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadPromptOptions = async () => {
      try {
        const response = await fetchPromptOptions();
        if (!active) return;
        setPromptOptions(response);
        setPromptOptionsError(null);
        const templateFallback = response.defaults.templateId ?? response.templates?.[0]?.id ?? '';
        const profileFallback = response.defaults.profileId ?? response.profiles?.[0]?.id ?? '';
        setPromptTemplateId((prev) => prev || templateFallback);
        setPromptProfileId((prev) => prev || profileFallback);
      } catch (error) {
        if (!active) return;
        console.warn('Failed to load prompt options', error);
        const message = error instanceof Error ? error.message : 'Unable to load prompt options';
        setPromptOptionsError(message);
      }
    };
    void loadPromptOptions();
    return () => {
      active = false;
    };
  }, []);


  const handleUploadRecording = async () => {
    if (uploading) return;
    if (!uploadFile) {
      toast.error('Select an audio file to upload');
      return;
    }
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploading(true);
    setUploadProgress(0);
    setRecordingPanelError(null);
    try {
      const record = await uploadRecording(uploadFile, {
        studentId: uploadStudentId || undefined,
        signal: controller.signal,
        onProgress: (progress) => setUploadProgress(progress),
      });
      registerRecording(record.recordingId, {
        recordingId: record.recordingId,
        status: record.status,
        transcriptId: record.transcriptId ?? null,
        error: record.error ?? null,
        source: record.source,
        studentId: record.studentId ?? null,
        displayName: record.displayName ?? null,
        durationSec: record.durationSec ?? null,
        channels: record.channels ?? null,
        bytes: record.bytes,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
      setSelectedRecordingId(record.recordingId);
      setRecordingInput(record.recordingId);
      resetPromptState();
      toast.success('Recording uploaded');
    } catch (error) {
      if (controller.signal.aborted) {
        setRecordingPanelError('Upload canceled.');
        return;
      }
      const message = error instanceof Error ? error.message : 'Unable to upload recording';
      setRecordingPanelError(message);
      toast.error(message);
    } finally {
      setUploading(false);
      setUploadFile(null);
      setUploadProgress(0);
      uploadAbortRef.current = null;
    }
  };

  const handleUploadFiles = (files: File[]) => {
    if (uploading) return;
    const nextFile = files[0];
    if (!nextFile) return;
    setUploadFile(nextFile);
    setUploadProgress(0);
    setRecordingPanelError(null);
  };

  const handleCancelUpload = () => {
    if (!uploadAbortRef.current) return;
    uploadAbortRef.current.abort();
  };

  const resetPromptState = () => {
    setPromptPackage(null);
    setPromptPackageId('');
    setPromptError(null);
    setDraft(null);
    setDraftText('');
    setMaterialized(null);
    setDraftError(null);
    setRecordingDetailError(null);
  };

  const handleSelectRecording = (recordingId: string) => {
    setSelectedRecordingId(recordingId);
    setRecordingInput(recordingId);
    registerRecording(recordingId);
    setTranscriptError(null);
    resetPromptState();
  };

  const handleLoadTranscript = useCallback(async (recordingId?: string) => {
    const target = (recordingId ?? recordingInput ?? selectedRecordingId).trim();
    if (!target) {
      toast.error('Enter a recording ID first');
      return;
    }
    setTranscriptLoading(true);
    setTranscriptError(null);
    try {
      const data = await fetchRecordingTranscript(target);
      setTranscript(data);
      setTranscriptText(data.text);
      setSelectedRecordingId(target);
      registerRecording(target);
      resetPromptState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load transcript';
      setTranscriptError(message);
    } finally {
      setTranscriptLoading(false);
    }
  }, [recordingInput, selectedRecordingId, registerRecording]);

  const handleSaveTranscript = async () => {
    if (!selectedRecordingId) {
      toast.error('Select a recording first');
      return;
    }
    setTranscriptSaving(true);
    setTranscriptError(null);
    try {
      const updated = await updateRecordingTranscript(selectedRecordingId, transcriptText);
      setTranscript(updated);
      toast.success('Transcript updated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update transcript';
      setTranscriptError(message);
    } finally {
      setTranscriptSaving(false);
    }
  };

  const handleRetryTranscription = async () => {
    if (!selectedRecordingId) {
      toast.error('Select a recording first');
      return;
    }
    setRetrying(true);
    setRecordingDetailError(null);
    try {
      const updated = await retryRecordingTranscription(selectedRecordingId);
      registerRecording(updated.recordingId, {
        recordingId: updated.recordingId,
        status: updated.status,
        transcriptId: updated.transcriptId ?? null,
        error: updated.error ?? null,
        source: updated.source,
        studentId: updated.studentId ?? null,
        displayName: updated.displayName ?? null,
        durationSec: updated.durationSec ?? null,
        channels: updated.channels ?? null,
        bytes: updated.bytes,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      });
      toast.success('Transcription retry queued');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to retry transcription';
      setRecordingDetailError(message);
      toast.error(message);
    } finally {
      setRetrying(false);
    }
  };

  const handleCreatePromptPackage = async () => {
    if (!selectedRecordingId) {
      toast.error('Select a recording first');
      return;
    }
    setPromptLoading(true);
    setPromptError(null);
    try {
      const result = await createPromptPackage(selectedRecordingId, {
        notes: notes.trim() || undefined,
        profileId: promptProfileId || undefined,
        templateId: promptTemplateId || undefined,
      });
      setPromptPackage(result);
      setPromptPackageId(result.id);
      toast.success('Prompt package created');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create prompt package';
      setPromptError(message);
    } finally {
      setPromptLoading(false);
    }
  };

  const handleFetchPromptPackage = useCallback(async (overrideId?: string) => {
    const target = (overrideId ?? promptPackageId).trim();
    if (!target) {
      toast.error('Enter a prompt package ID');
      return;
    }
    setPromptLoading(true);
    setPromptError(null);
    try {
      const result = await fetchPromptPackage(target);
      setPromptPackage(result);
      setPromptPackageId(target);
      toast.success('Prompt package loaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load prompt package';
      setPromptError(message);
    } finally {
      setPromptLoading(false);
    }
  }, [promptPackageId]);

  useEffect(() => {
    const handleOpenTranscript = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const recordingId = event.detail?.recordingId as string | undefined;
      if (recordingId) {
        void handleLoadTranscript(recordingId);
      }
    };

    const handleOpenPrompt = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const promptPackageId = event.detail?.promptPackageId as string | undefined;
      if (promptPackageId) {
        void handleFetchPromptPackage(promptPackageId);
      }
    };

    globalThis.addEventListener('esl:open-transcript', handleOpenTranscript);
    globalThis.addEventListener('esl:open-prompt-package', handleOpenPrompt);

    return () => {
      globalThis.removeEventListener('esl:open-transcript', handleOpenTranscript);
      globalThis.removeEventListener('esl:open-prompt-package', handleOpenPrompt);
    };
  }, [handleFetchPromptPackage, handleLoadTranscript]);

  const handleCopyPrompt = () => {
    if (!promptPackage?.text) return;
    copy(promptPackage.text);
    toast.success('Prompt package copied');
  };

  const handleDownloadPrompt = () => {
    if (!promptPackage?.text) return;
    const blob = new Blob([promptPackage.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `prompt-${promptPackage.id}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleCreateDraft = async () => {
    if (!promptPackage?.id) {
      toast.error('Create or load a prompt package first');
      return;
    }
    if (!draftText.trim()) {
      toast.error('Paste a draft first');
      return;
    }
    setDraftLoading(true);
    setDraftError(null);
    try {
      const result = await createDraft(promptPackage.id, draftText.trim());
      setDraft(result);
      toast.success('Draft saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save draft';
      setDraftError(message);
    } finally {
      setDraftLoading(false);
    }
  };

  const handleMaterializeAndApprove = async () => {
    if (!draft?.id) {
      toast.error('Save the draft first');
      return;
    }

    setMaterializeLoading(true);
    setDraftError(null);
    try {
      const materializedResult = await materializeDraft(draft.id);
      setMaterialized(materializedResult);
      await approveJob(materializedResult.jobId, materializedResult.mdPath);
      await trackJob(materializedResult.jobId);
      toast.success('Draft materialized and job approved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to materialize draft';
      setDraftError(message);
    } finally {
      setMaterializeLoading(false);
    }
  };

  return (
    <section id="transcription-workspace" className="transcription-workspace card animate-fade-in-up">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">Phase 2</span>
          <h2>Transcription Workspace</h2>
          <p>
            Review transcripts, assemble prompt packages, and approve drafts using live recording
            updates.
          </p>
        </div>
      </header>

      <JobConnectionBanner />

      <div className="workspace-grid">
        <div className="workspace-panel recordings-panel">
          <div className="panel-header">
            <div>
              <h3>Recording feed</h3>
              <p>Live state changes from /jobs/events. Select a recording to review.</p>
            </div>
          </div>

          {recordingPanelError && <p className="error-text">{recordingPanelError}</p>}
          {studentOptionsError && <p className="error-text">{studentOptionsError}</p>}

          <div className="recording-input">
            <input
              type="text"
              placeholder="Recording ID"
              value={recordingInput}
              onChange={(event) => setRecordingInput(event.target.value)}
            />
            <button type="button" className="btn-secondary btn-small" onClick={() => handleLoadTranscript()}>
              Load transcript
            </button>
          </div>

          <div className="recording-filter">
            <div className="filter-field">
              <label className="field-label" htmlFor="recording-search">
                Search
              </label>
              <input
                id="recording-search"
                type="search"
                placeholder="ID or filename"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <div className="filter-field">
              <label className="field-label" htmlFor="recording-student-filter">
                Student
              </label>
              <select
                id="recording-student-filter"
                value={studentFilter}
                onChange={(event) => setStudentFilter(event.target.value)}
              >
                <option value="all">All students</option>
                <option value="unassigned">Unassigned</option>
                {studentOptions.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label className="field-label" htmlFor="recording-status-filter">
                Status
              </label>
              <select
                id="recording-status-filter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'all' | RecordingStatus)
                }
              >
                <option value="all">All statuses</option>
                {RECORDING_STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="recording-upload">
            <DropZone
              title={uploading ? 'Uploading audio...' : 'Drop audio file'}
              description="Drag an audio file here or click to browse."
              hint="Single file upload"
              accept={{ 'audio/*': AUDIO_EXTENSIONS }}
              multiple={false}
              disabled={uploading}
              onFiles={handleUploadFiles}
            />
            {uploading ? (
              <UploadProgress
                fileName={uploadFile?.name}
                progress={uploadProgress}
                onCancel={handleCancelUpload}
              />
            ) : null}
            {uploadFile && <div className="upload-meta">Selected: {uploadFile.name}</div>}
            <div className="recording-upload-actions">
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={handleUploadRecording}
                disabled={!uploadFile || uploading}
              >
                {uploading ? 'Uploading...' : 'Upload recording'}
              </button>
            </div>
          </div>
          <div className="recording-upload-options">
            <label className="field-label" htmlFor="recording-student-upload">
              Upload student
            </label>
            <select
              id="recording-student-upload"
              value={uploadStudentId}
              onChange={(event) => setUploadStudentId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {studentOptions.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </div>

          <div className="recordings-list">
            {filteredRecordings.length === 0 ? (
              <div className="empty-state">
                <p>No recordings for this filter.</p>
                <span>Adjust the filter or ingest new audio.</span>
              </div>
            ) : (
              filteredRecordings.map((recording) => {
                const studentLabel = recording.studentId
                  ? studentLabelById.get(recording.studentId) ?? recording.studentId
                  : 'Unassigned';
                const statusMeta = getRecordingStatusMeta(recording.status);
                const transcriptLabel = recording.transcriptId
                  ? `Transcript: ${recording.transcriptId}`
                  : 'Transcript pending';
                const displayName = recording.displayName || recording.recordingId;
                const showId = displayName !== recording.recordingId;
                return (
                  <button
                    type="button"
                    key={recording.recordingId}
                    className={`recording-card${recording.recordingId === selectedRecordingId ? ' active' : ''
                      }`}
                    onClick={() => handleSelectRecording(recording.recordingId)}
                  >
                    <div className="recording-title">
                      <div className="recording-title-text">
                        <span className="recording-name">{displayName}</span>
                        {showId && <span className="mono recording-id">{recording.recordingId}</span>}
                      </div>
                      <span className={`status-pill status-${recording.status}`}>
                        {statusMeta.label}
                      </span>
                    </div>
                    <div className="recording-sub">
                      {`Upload • ${studentLabel} | ${statusMeta.note} | ${transcriptLabel}`}
                    </div>
                    <div className="recording-meta">
                      Updated {new Date(recording.updatedAt).toLocaleString()}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="workspace-panel workspace-detail">
          <section className="detail-card">
            <header>
              <h3>Transcript review</h3>
              <div className="detail-meta">
                <span>
                  {(selectedRecording?.displayName ?? selectedRecordingId) ||
                    'No recording selected'}
                </span>
                {selectedRecording?.displayName &&
                  selectedRecordingId &&
                  selectedRecording.displayName !== selectedRecordingId && (
                    <span className="mono">{selectedRecordingId}</span>
                  )}
                {selectedRecording && selectedStatusMeta && (
                  <>
                    <span className={`status-pill status-${selectedRecording.status}`}>
                      {selectedStatusMeta.label}
                    </span>
                    <span className="status-note">{selectedStatusMeta.detail}</span>
                  </>
                )}
              </div>
            </header>

            {transcriptError && <p className="error-text">{transcriptError}</p>}
            {recordingDetailError && <p className="error-text">{recordingDetailError}</p>}
            {selectedRecording?.status === 'failed' && (
              <p className="error-text">
                {selectedRecording.error
                  ? `Transcription failed: ${selectedRecording.error}`
                  : 'Transcription failed.'}
              </p>
            )}

            {transcript ? (
              <div className="transcript-meta">
                <div>
                  <strong>Model:</strong> {transcript.model}
                </div>
                <div>
                  <strong>Language:</strong> {transcript.language}
                </div>
                <div>
                  <strong>Mode:</strong> {transcript.mode}
                </div>
                <div>
                  <strong>Updated:</strong>{' '}
                  {new Date(transcript.updatedAt).toLocaleString()}
                </div>
              </div>
            ) : (
              <p className="helper-text">
                Load a transcript to edit or continue to prompt assembly.
              </p>
            )}

            <textarea
              value={transcriptText}
              onChange={(event) => setTranscriptText(event.target.value)}
              placeholder="Transcript text will appear here"
              rows={8}
              disabled={transcriptLoading}
            />

            <div className="detail-actions">
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={() => handleLoadTranscript(selectedRecordingId)}
                disabled={transcriptLoading}
              >
                <RefreshIcon />
                Refresh
              </button>
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={handleSaveTranscript}
                disabled={!selectedRecordingId || transcriptSaving}
              >
                Save transcript
              </button>
              {selectedRecording?.status === 'failed' && (
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={handleRetryTranscription}
                  disabled={retrying}
                >
                  <RefreshIcon />
                  {retrying ? 'Retrying…' : 'Retry transcription'}
                </button>
              )}
            </div>
          </section>

          <section className="detail-card">
            <header>
              <h3>Prompt package</h3>
              <div className="detail-meta">
                <span>Recording: {selectedRecordingId || '—'}</span>
              </div>
            </header>

            {promptError && <p className="error-text">{promptError}</p>}
            {promptOptionsError && <p className="error-text">{promptOptionsError}</p>}

            <div className="prompt-controls">
              <input
                type="text"
                placeholder="Prompt package ID"
                value={promptPackageId}
                onChange={(event) => setPromptPackageId(event.target.value)}
              />
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={() => void handleFetchPromptPackage()}
                disabled={promptLoading}
              >
                Load
              </button>
            </div>

            <label className="field-label">Notes</label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional lesson notes"
              rows={3}
            />

            <div className="prompt-selection">
              <label className="field-label" htmlFor="prompt-template-select">
                Template
              </label>
              <select
                id="prompt-template-select"
                value={promptTemplateId}
                onChange={(event) => setPromptTemplateId(event.target.value)}
                disabled={templateOptions.length === 0}
              >
                {templateOptions.length === 0 ? (
                  <option value="">No templates available</option>
                ) : null}
                {templateOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="prompt-selection">
              <label className="field-label" htmlFor="prompt-profile-select">
                Profile
              </label>
              <select
                id="prompt-profile-select"
                value={promptProfileId}
                onChange={(event) => setPromptProfileId(event.target.value)}
                disabled={profileOptions.length === 0}
              >
                {profileOptions.length === 0 ? (
                  <option value="">No profiles available</option>
                ) : null}
                {profileOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="detail-actions">
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={handleCreatePromptPackage}
                disabled={!selectedRecordingId || promptLoading}
              >
                <SparkIcon />
                {promptLoading ? 'Building…' : 'Build prompt package'}
              </button>
            </div>

            {promptPackage && (
              <div className="prompt-output">
                <div className="prompt-actions">
                  <button type="button" className="btn-ghost btn-small" onClick={handleCopyPrompt}>
                    <ClipboardIcon />
                    Copy
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-small"
                    onClick={handleDownloadPrompt}
                  >
                    <DownloadIcon />
                    Download
                  </button>
                </div>
                <textarea value={promptPackage.text} readOnly rows={6} />
              </div>
            )}
          </section>

          <section className="detail-card">
            <header>
              <h3>Draft approval</h3>
              <div className="detail-meta">
                <span>Prompt package: {promptPackage?.id ?? '—'}</span>
              </div>
            </header>

            {draftError && <p className="error-text">{draftError}</p>}

            <label className="field-label">Paste draft</label>
            <textarea
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              placeholder="Paste LLM draft markdown"
              rows={5}
            />

            <div className="detail-actions">
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={handleCreateDraft}
                disabled={!promptPackage || draftLoading}
              >
                <DraftIcon />
                {draftLoading ? 'Saving…' : 'Save draft'}
              </button>
            </div>

            {draft && (
              <div className="draft-meta">
                Draft ID: <span className="mono">{draft.id}</span>
              </div>
            )}

            <div className="detail-actions">
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={handleMaterializeAndApprove}
                disabled={!draft || materializeLoading}
              >
                {materializeLoading ? 'Approving…' : 'Materialize & approve'}
              </button>
            </div>

            {materialized && (
              <div className="draft-meta">
                Materialized: <span className="mono">{materialized.mdPath}</span>
                <br />
                Approval job: <span className="mono">{materialized.jobId}</span>
              </div>
            )}
          </section>
        </div>
      </div>

      <style>{`
        .transcription-workspace {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .workspace-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-4);
        }

        .workspace-header h2 {
          margin-top: var(--space-2);
          font-size: var(--text-2xl);
        }

        .workspace-header p {
          color: var(--text-secondary);
          max-width: 520px;
        }

        .workspace-grid {
          display: grid;
          grid-template-columns: minmax(260px, 1fr) minmax(0, 2fr);
          gap: var(--space-6);
        }

        .workspace-panel {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .panel-header h3 {
          font-size: var(--text-lg);
        }

        .panel-header p {
          color: var(--text-secondary);
          margin-top: var(--space-1);
        }

        .recording-input {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: var(--space-3);
        }

        .recording-filter,
        .recording-upload-options {
          display: grid;
          gap: var(--space-2);
        }

        .recording-filter {
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        }

        .recording-filter .filter-field {
          display: grid;
          gap: var(--space-1);
        }

        .recording-filter select,
        .recording-filter input[type='search'],
        .recording-upload-options select {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: var(--space-2) var(--space-3);
          color: var(--text-primary);
        }

        .recording-upload {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .recording-upload-actions {
          display: flex;
          justify-content: flex-end;
        }

        .upload-meta {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .recordings-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          max-height: 520px;
          overflow: auto;
          padding-right: var(--space-2);
        }

        .recording-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xl);
          padding: var(--space-3);
          text-align: left;
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          transition: all var(--transition-fast);
        }

        .recording-card:hover {
          border-color: var(--border-focus);
          transform: translateY(-1px);
        }

        .recording-card.active {
          border-color: var(--border-focus);
          box-shadow: var(--shadow-sm);
          background: var(--bg-primary);
        }

        .recording-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-sm);
        }

        .recording-title-text {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .recording-name {
          font-weight: 600;
          color: var(--text-primary);
        }

        .recording-id {
          color: var(--text-tertiary);
          font-size: var(--text-xs);
        }

        .recording-sub {
          color: var(--text-secondary);
          font-size: var(--text-sm);
        }

        .recording-meta {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .empty-state {
          padding: var(--space-6);
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          text-align: center;
          color: var(--text-secondary);
        }

        .workspace-detail {
          gap: var(--space-4);
        }

        .detail-card {
          border-radius: var(--radius-2xl);
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          padding: var(--space-5);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .detail-card header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-3);
        }

        .detail-meta {
          display: flex;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
          flex-wrap: wrap;
        }

        .transcript-meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: var(--space-2);
          font-size: var(--text-xs);
          color: var(--text-secondary);
        }

        .detail-actions {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .prompt-controls {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: var(--space-2);
        }

        .prompt-selection {
          display: grid;
          gap: var(--space-2);
        }

        .prompt-selection select {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: var(--space-2) var(--space-3);
          color: var(--text-primary);
        }

        .prompt-output {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .prompt-actions {
          display: flex;
          justify-content: flex-end;
          gap: var(--space-2);
        }

        .draft-meta {
          font-size: var(--text-xs);
          color: var(--text-secondary);
        }

        .helper-text {
          color: var(--text-secondary);
        }

        .error-text {
          color: var(--color-error-600);
          background: rgba(244, 63, 94, 0.08);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-lg);
          font-size: var(--text-sm);
        }

        .status-note {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .field-label {
          font-size: var(--text-xs);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .mono {
          font-family: var(--font-mono);
        }

        .btn-small {
          padding: var(--space-2) var(--space-4);
          font-size: var(--text-xs);
        }

        .status-ingested {
          background: rgba(99, 102, 241, 0.12);
          color: var(--color-primary-600);
        }

        .status-queued {
          background: rgba(59, 130, 246, 0.12);
          color: var(--color-info-600);
        }

        .status-transcribing {
          background: rgba(14, 165, 233, 0.15);
          color: var(--color-info-600);
          animation: pulse-status 2s ease-in-out infinite;
        }

        .status-transcribed {
          background: rgba(16, 185, 129, 0.15);
          color: var(--color-success-600);
        }

        .status-failed {
          background: rgba(244, 63, 94, 0.15);
          color: var(--color-error-600);
        }

        @media (max-width: 1024px) {
          .workspace-grid {
            grid-template-columns: 1fr;
          }

          .recordings-list {
            max-height: 320px;
          }
        }

        @media (max-width: 640px) {
          .workspace-header {
            flex-direction: column;
            align-items: flex-start;
          }

          .recording-input,
          .recording-filter,
          .recording-upload,
          .recording-upload-options,
          .prompt-controls {
            grid-template-columns: 1fr;
          }

          .detail-card header {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </section>
  );
};
