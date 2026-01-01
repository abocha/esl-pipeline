import copy from 'copy-to-clipboard';
import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { useJobMonitor } from '../../context/JobMonitorContext';
import {
  type DraftResponse,
  type MaterializeDraftResponse,
  type PromptPackageResponse,
  type RecordingTranscriptResponse,
  approveJob,
  createDraft,
  createPromptPackage,
  fetchPromptPackage,
  fetchRecordingTranscript,
  materializeDraft,
  syncRecordings,
  updateRecordingTranscript,
} from '../../utils/api';

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

export const TranscriptionWorkspace: React.FC = () => {
  const { recordings, registerRecording, trackJob } = useJobMonitor();
  const [selectedRecordingId, setSelectedRecordingId] = useState('');
  const [recordingInput, setRecordingInput] = useState('');
  const [syncing, setSyncing] = useState(false);

  const [transcript, setTranscript] = useState<RecordingTranscriptResponse | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  const [notes, setNotes] = useState('');
  const [profilePath, setProfilePath] = useState('');
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

  const selectedRecording = useMemo(
    () => recordings.find((item) => item.recordingId === selectedRecordingId) ?? null,
    [recordings, selectedRecordingId],
  );

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncRecordings();
      toast.success(`Recording scan complete. Discovered ${result.discovered}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sync recordings';
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  };

  const resetPromptState = () => {
    setPromptPackage(null);
    setPromptPackageId('');
    setPromptError(null);
    setDraft(null);
    setDraftText('');
    setMaterialized(null);
    setDraftError(null);
  };

  const handleSelectRecording = (recordingId: string) => {
    setSelectedRecordingId(recordingId);
    setRecordingInput(recordingId);
    registerRecording(recordingId);
    resetPromptState();
  };

  const handleLoadTranscript = async (recordingId?: string) => {
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
  };

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
        profilePath: profilePath.trim() || undefined,
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

  const handleFetchPromptPackage = async () => {
    const target = promptPackageId.trim();
    if (!target) {
      toast.error('Enter a prompt package ID');
      return;
    }
    setPromptLoading(true);
    setPromptError(null);
    try {
      const result = await fetchPromptPackage(target);
      setPromptPackage(result);
      toast.success('Prompt package loaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load prompt package';
      setPromptError(message);
    } finally {
      setPromptLoading(false);
    }
  };

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
    <section className="transcription-workspace card animate-fade-in-up">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">Phase 2</span>
          <h2>Transcription Workspace</h2>
          <p>
            Review transcripts, assemble prompt packages, and approve drafts using live recording
            updates.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary btn-small"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshIcon />
          {syncing ? 'Syncing…' : 'Sync recordings'}
        </button>
      </header>

      <div className="workspace-grid">
        <div className="workspace-panel recordings-panel">
          <div className="panel-header">
            <div>
              <h3>Recording feed</h3>
              <p>Live state changes from /jobs/events. Select a recording to review.</p>
            </div>
          </div>

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

          <div className="recordings-list">
            {recordings.length === 0 ? (
              <div className="empty-state">
                <p>No recording events yet.</p>
                <span>Run a sync or wait for new audio to arrive.</span>
              </div>
            ) : (
              recordings.map((recording) => (
                <button
                  type="button"
                  key={recording.recordingId}
                  className={`recording-card${
                    recording.recordingId === selectedRecordingId ? ' active' : ''
                  }`}
                  onClick={() => handleSelectRecording(recording.recordingId)}
                >
                  <div className="recording-title">
                    <span className="mono">{recording.recordingId}</span>
                    <span className={`status-pill status-${recording.status}`}>
                      {recording.status}
                    </span>
                  </div>
                  <div className="recording-sub">
                    {recording.transcriptId
                      ? `Transcript: ${recording.transcriptId}`
                      : 'Transcript pending'}
                  </div>
                  <div className="recording-meta">
                    Updated {new Date(recording.updatedAt).toLocaleString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="workspace-panel workspace-detail">
          <section className="detail-card">
            <header>
              <h3>Transcript review</h3>
              <div className="detail-meta">
                <span>{selectedRecordingId || 'No recording selected'}</span>
                {selectedRecording && (
                  <span className={`status-pill status-${selectedRecording.status}`}>
                    {selectedRecording.status}
                  </span>
                )}
              </div>
            </header>

            {transcriptError && <p className="error-text">{transcriptError}</p>}

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
                onClick={handleFetchPromptPackage}
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

            <label className="field-label">Profile path (optional)</label>
            <input
              type="text"
              value={profilePath}
              onChange={(event) => setProfilePath(event.target.value)}
              placeholder="profiles/student.md"
            />

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

        .status-transcribing {
          background: rgba(14, 165, 233, 0.15);
          color: var(--color-info-600);
          animation: pulse-status 2s ease-in-out infinite;
        }

        .status-transcribed {
          background: rgba(16, 185, 129, 0.15);
          color: var(--color-success-600);
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
