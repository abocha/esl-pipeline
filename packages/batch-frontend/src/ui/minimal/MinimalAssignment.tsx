import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import copy from 'copy-to-clipboard';

import type {
  DraftResponse,
  JobStatus,
  MarkdownValidationResponse,
  PromptOptionsResponse,
  PromptPackageResponse,
  RecordingListItem,
  RecordingStatus,
  RecordingTranscriptResponse,
} from '../../utils/api';
import {
  approveJob,
  createDraft,
  createPromptPackage,
  fetchPromptOptions,
  fetchRecordingTranscript,
  getJobStatus,
  getRecording,
  materializeDraft,
  retryRecordingTranscription,
  updateDraft,
  updateRecordingTranscript,
  uploadRecording,
  validateMarkdown,
} from '../../utils/api';
import { DropZone } from '../shared/DropZone';
import { UploadProgress } from '../shared/UploadProgress';

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus'];
const POLL_INTERVAL_MS = 3000;

export const MinimalAssignment: React.FC = () => {
  const [recording, setRecording] = useState<RecordingListItem | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const [transcript, setTranscript] = useState<RecordingTranscriptResponse | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptStatus, setTranscriptStatus] = useState<'idle' | 'loading' | 'processing' | 'ready' | 'failed'>('idle');
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [retryingTranscript, setRetryingTranscript] = useState(false);

  const [promptOptions, setPromptOptions] = useState<PromptOptionsResponse | null>(null);
  const [promptPackage, setPromptPackage] = useState<PromptPackageResponse | null>(null);
  const [promptText, setPromptText] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptCopyState, setPromptCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const [draftText, setDraftText] = useState('');
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [validation, setValidation] = useState<MarkdownValidationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [jobStatus, setJobStatusState] = useState<JobStatus | null>(null);
  const [publishTarget, setPublishTarget] = useState<'notion' | 'anytype'>('notion');

  const resetFlow = useCallback(() => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
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
    setPromptText('');
    setPromptError(null);
    setPromptCopyState('idle');
    setDraft(null);
    setDraftText('');
    setDraftError(null);
    setValidation(null);
    setValidationError(null);
    setValidating(false);
    setPublishing(false);
    setPublishError(null);
    setJobStatusState(null);
    setSelectedFileName(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploading(false);
  }, []);

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

  useEffect(() => {
    void loadPromptOptions();
  }, [loadPromptOptions]);

  const handleUpload = useCallback(async (file: File) => {
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
        signal: controller.signal,
        onProgress: (progress) => setUploadProgress(progress),
      });
      setRecording(response);
      setRecordingStatus(response.status);
      setRecordingError(response.error ?? null);
      setSelectedFileName(response.displayName || file.name);
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
  }, [resetFlow, uploading]);

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

    const pollRecording = async () => {
      try {
        const updated = await getRecording(recording.recordingId);
        if (!active) return;
        setRecording(updated);
        setRecordingStatus(updated.status);
        setRecordingError(updated.error ?? null);
        if (updated.status === 'transcribed' && !transcript?.transcriptId) {
          void loadTranscript();
        }
        if (updated.status === 'failed') {
          setTranscriptStatus('failed');
          setTranscriptError(updated.error ?? 'Transcription failed.');
        }
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Unable to refresh recording status.';
        setRecordingError(message);
      }
    };

    void pollRecording();
    const interval = setInterval(pollRecording, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
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
      const response = await updateRecordingTranscript(recording.recordingId, transcriptText.trim());
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
      const updated = await retryRecordingTranscription(recording.recordingId);
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

  const selectedProfileId = useMemo(() => {
    if (!promptOptions) return '';
    return promptOptions.defaults.profileId ?? promptOptions.profiles?.[0]?.id ?? '';
  }, [promptOptions]);

  const handleGeneratePrompt = async () => {
    if (!recording?.recordingId) {
      setPromptError('Upload a recording first.');
      return;
    }
    if (!selectedTemplateId || !selectedProfileId) {
      setPromptError('Prompt defaults are missing. Check prompt templates in settings.');
      return;
    }
    if (transcriptStatus !== 'ready') {
      setPromptError('Transcript is not ready yet.');
      return;
    }

    setPromptLoading(true);
    setPromptError(null);
    try {
      const response = await createPromptPackage(recording.recordingId, {
        templateId: selectedTemplateId,
        profileId: selectedProfileId,
      });
      setPromptPackage(response);
      setPromptText(response.text ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to generate prompt.';
      setPromptError(message);
    } finally {
      setPromptLoading(false);
    }
  };

  const handleCopyPrompt = () => {
    if (!promptText.trim()) return;
    const success = copy(promptText);
    setPromptCopyState(success ? 'copied' : 'error');
    setTimeout(() => setPromptCopyState('idle'), 2000);
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
      const response = await validateMarkdown(draftText.trim(), true);
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
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save draft.';
      setDraftError(message);
      return null;
    }
  };

  const handlePublish = async () => {
    if (publishTarget === 'anytype') {
      setPublishError('Anytype publishing is not wired in the web UI yet. Switch to Notion to publish.');
      return;
    }
    setPublishError(null);
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

      const materialized = await materializeDraft(savedDraft.id, {});
      await approveJob(materialized.jobId, materialized.mdPath);
      const refreshed = await getJobStatus(materialized.jobId);
      setJobStatusState(refreshed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to publish assignment.';
      setPublishError(message);
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    if (!jobStatus?.jobId) return;
    let active = true;
    const interval = setInterval(async () => {
      try {
        const refreshed = await getJobStatus(jobStatus.jobId);
        if (!active) return;
        setJobStatusState(refreshed);
        if (refreshed.state === 'succeeded' || refreshed.state === 'failed') {
          clearInterval(interval);
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
  }, [jobStatus?.jobId]);

  const transcriptReady = transcriptStatus === 'ready' && transcriptText.trim().length > 0;
  const promptReady = promptPackage?.id && promptText.trim().length > 0;
  const jobReady = jobStatus?.jobId;
  const canPublish =
    promptReady && draftText.trim().length > 0 && !publishing && publishTarget === 'notion';

  return (
    <div className="minimal-assignment">
      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>1. Upload recording</h2>
          <button type="button" className="minimal-secondary" onClick={resetFlow}>
            Start new
          </button>
        </div>
        <p className="minimal-help">Upload an audio recording to start the assignment pipeline.</p>
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
        {recording ? (
          <div className="minimal-meta">
            <span>Recording ID: {recording.recordingId}</span>
            <span>Status: {recordingStatus ?? 'unknown'}</span>
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
        {transcriptStatus === 'loading' ? <p className="minimal-help">Loading transcript...</p> : null}
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
          <h2>3. Prompt</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-primary"
              onClick={() => void handleGeneratePrompt()}
              disabled={!transcriptReady || promptLoading || !promptOptions}
            >
              {promptLoading ? 'Generating...' : promptReady ? 'Regenerate prompt' : 'Generate prompt'}
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
          Uses the default template and profile. Prompt options load once on page start.
        </p>
        {promptError ? <p className="minimal-error">{promptError}</p> : null}
        {promptText ? (
          <textarea value={promptText} onChange={(event) => setPromptText(event.target.value)} rows={12} />
        ) : (
          <p className="minimal-muted">Generate a prompt to continue.</p>
        )}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>4. Draft</h2>
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
        <p className="minimal-help">Paste the assignment markdown from your LLM.</p>
        <textarea
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
          <h2>5. Publish</h2>
          <button
            type="button"
            className="minimal-primary"
            onClick={() => void handlePublish()}
            disabled={!canPublish}
          >
            {publishing ? 'Publishing...' : 'Publish assignment'}
          </button>
        </div>
        <label className="minimal-select">
          Publish to
          <select
            value={publishTarget}
            onChange={(event) => setPublishTarget(event.target.value as 'notion' | 'anytype')}
          >
            <option value="notion">Notion</option>
            <option value="anytype">Anytype</option>
          </select>
        </label>
        <p className="minimal-help">Publishes the markdown as a job and approves it.</p>
        {publishTarget === 'anytype' ? (
          <p className="minimal-muted">
            Anytype export is available via the adapter package. Web UI publishing is Notion-only for now.
          </p>
        ) : null}
        {publishError ? <p className="minimal-error">{publishError}</p> : null}
        {jobReady ? (
          <div className="minimal-meta">
            <span>Job ID: {jobStatus?.jobId}</span>
            <span>Status: {jobStatus?.state}</span>
            {jobStatus?.notionUrl ? (
              <a href={jobStatus.notionUrl} target="_blank" rel="noreferrer">
                Open in Notion
              </a>
            ) : (
              <span className="minimal-muted">Notion link pending...</span>
            )}
          </div>
        ) : null}
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
