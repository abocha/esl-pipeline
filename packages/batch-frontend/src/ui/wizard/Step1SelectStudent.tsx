import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useStudentSelection } from '../../context/StudentSelectionContext';
import type { RecordingListItem, StudentOption } from '../../utils/api';
import { fetchStudentOptions, uploadRecording } from '../../utils/api';
import { DropZone } from '../shared/DropZone';
import { UploadProgress } from '../shared/UploadProgress';
import { WizardStep } from './WizardStep';

interface Step1SelectStudentProps {
  recordingId: string | null;
  autoMatchEnabled: boolean;
  onAutomationChange: (updates: { autoMatchStudent?: boolean }) => void;
  onRecordingReady: (recording: RecordingListItem) => void;
  onNext: () => void;
}

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus'];

interface StudentMatchSuggestion {
  student: StudentOption;
  confidence: number;
  matchedTokens: string[];
}

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1);

const findStudentSuggestion = (
  source: string,
  options: StudentOption[],
): StudentMatchSuggestion | null => {
  const sourceTokens = new Set(tokenize(source));
  if (sourceTokens.size === 0) return null;

  let best: StudentMatchSuggestion | null = null;
  for (const option of options) {
    const nameTokens = tokenize(option.name);
    if (nameTokens.length === 0) continue;
    const matchedTokens = nameTokens.filter((token) => sourceTokens.has(token));
    const confidence = matchedTokens.length / nameTokens.length;
    if (!best || confidence > best.confidence) {
      best = { student: option, confidence, matchedTokens };
    }
  }

  if (!best || best.confidence < 0.34) {
    return null;
  }
  return best;
};

export const Step1SelectStudent: React.FC<Step1SelectStudentProps> = ({
  recordingId,
  autoMatchEnabled,
  onAutomationChange,
  onRecordingReady,
  onNext,
}) => {
  const { registerRecording, logLedgerEntries } = useJobMonitor();
  const { selectedStudent, setSelectedStudent } = useStudentSelection();
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [autoMatchAppliedId, setAutoMatchAppliedId] = useState<string | null>(null);
  const [autoMatchLocked, setAutoMatchLocked] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    const loadStudents = async () => {
      try {
        const response = await fetchStudentOptions();
        if (!active) return;
        setStudentOptions(response.students ?? []);
      } catch (error) {
        if (!active) return;
        console.warn('Failed to load student options', error);
      } finally {
        if (active) {
          setLoadingStudents(false);
        }
      }
    };
    void loadStudents();
    return () => {
      active = false;
    };
  }, []);

  const selectedStudentId = selectedStudent?.id ?? null;

  const applyStudentSelection = useCallback((option: StudentOption | null, source: 'auto' | 'manual' | 'suggested') => {
    if (!option) {
      setSelectedStudent(null);
      if (source !== 'auto') {
        setAutoMatchLocked(true);
      }
      setAutoMatchAppliedId(null);
      return;
    }

    setSelectedStudent({
      id: option.id,
      student: option.name,
      profileId: option.profileId ?? null,
    });
    if (source === 'auto' || source === 'suggested') {
      setAutoMatchAppliedId(option.id);
    } else {
      setAutoMatchAppliedId(null);
    }
    if (source !== 'auto') {
      setAutoMatchLocked(true);
    }
  }, [setSelectedStudent]);

  const handleSelectStudent = (option: StudentOption | null) => {
    applyStudentSelection(option, 'manual');
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    if (uploading) return;
    setSelectedFileName(file.name);
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    try {
      const recording = await uploadRecording(file, {
        studentId: selectedStudentId ?? undefined,
        signal: controller.signal,
        onProgress: (progress) => setUploadProgress(progress),
      });
      registerRecording(recording.recordingId, {
        status: recording.status,
        transcriptId: recording.transcriptId,
        studentId: recording.studentId,
        source: recording.source,
        displayName: recording.displayName,
        durationSec: recording.durationSec,
        channels: recording.channels,
        bytes: recording.bytes,
        createdAt: recording.createdAt,
        updatedAt: recording.updatedAt,
      });
      if (recording.displayName) {
        setSelectedFileName(recording.displayName);
      }
      onRecordingReady(recording);
      toast.success('Recording uploaded');
    } catch (error) {
      if (controller.signal.aborted) {
        setUploadError('Upload canceled.');
        return;
      }
      const message = error instanceof Error ? error.message : 'Unable to upload recording';
      setUploadError(message);
    } finally {
      setUploading(false);
      uploadAbortRef.current = null;
    }
  };

  const handleCancel = () => {
    if (!uploadAbortRef.current) return;
    uploadAbortRef.current.abort();
  };

  const handleFiles = (files: File[]) => {
    const target = files[0];
    if (!target) return;
    void handleUpload(target);
  };

  const helperText = useMemo(() => {
    if (recordingId) {
      return 'Recording ready. Continue to review the transcript.';
    }
    if (uploading) {
      return 'Uploading audio...';
    }
    if (selectedFileName) {
      return `Selected file: ${selectedFileName}`;
    }
    return 'Choose a student and upload an audio file to begin.';
  }, [recordingId, selectedFileName, uploading]);

  const matchSource = selectedFileName ?? '';
  const autoMatchSuggestion = useMemo(
    () =>
      autoMatchEnabled && matchSource
        ? findStudentSuggestion(matchSource, studentOptions)
        : null,
    [autoMatchEnabled, matchSource, studentOptions],
  );

  useEffect(() => {
    if (!autoMatchEnabled) {
      setAutoMatchAppliedId(null);
      setAutoMatchLocked(false);
      return;
    }
    if (autoMatchLocked || selectedStudentId) return;
    if (!autoMatchSuggestion || autoMatchSuggestion.confidence < 0.6) return;

    applyStudentSelection(autoMatchSuggestion.student, 'auto');
    logLedgerEntries([
      {
        type: 'automation_auto_match_applied',
        severity: 'info',
        objectType: 'student',
        objectId: autoMatchSuggestion.student.id,
        message: `Auto-matched student ${autoMatchSuggestion.student.name} based on recording metadata.`,
        source: 'session',
      },
    ]);
  }, [
    applyStudentSelection,
    autoMatchEnabled,
    autoMatchLocked,
    autoMatchSuggestion,
    logLedgerEntries,
    selectedStudentId,
  ]);

  return (
    <WizardStep
      title="Select student and upload"
      subtitle="Assign a student and bring in the audio recording to start the workflow."
      onNext={onNext}
      nextLabel="Continue to transcript"
      isNextDisabled={!recordingId}
      isBusy={uploading}
    >
      <div className="wizard-grid">
        <div className="wizard-panel">
          <h3>Student selection</h3>
          <p>Pick a student profile for this recording.</p>
          <div className="automation-card">
            <div className="automation-header">
              <div>
                <span className="automation-eyebrow">Automation</span>
                <h4>Auto-match student</h4>
                <p>Use recording metadata to suggest the most likely student.</p>
              </div>
              <label className="automation-toggle">
                <input
                  type="checkbox"
                  checked={autoMatchEnabled}
                  onChange={(event) =>
                    onAutomationChange({ autoMatchStudent: event.target.checked })
                  }
                />
                <span className="toggle-track" aria-hidden="true" />
              </label>
            </div>
            {autoMatchEnabled ? (
              autoMatchSuggestion ? (
                <div className="automation-suggestion">
                  <div>
                    <span className="suggestion-label">Suggested</span>
                    <p className="suggestion-name">{autoMatchSuggestion.student.name}</p>
                    <p className="suggestion-meta">
                      Confidence {Math.round(autoMatchSuggestion.confidence * 100)}% · Matched{' '}
                      {autoMatchSuggestion.matchedTokens.join(', ') || 'metadata'}
                    </p>
                  </div>
                  <div className="suggestion-actions">
                    {autoMatchAppliedId === autoMatchSuggestion.student.id &&
                      selectedStudentId === autoMatchSuggestion.student.id ? (
                      <button
                        type="button"
                        className="btn-ghost btn-small"
                        onClick={() => applyStudentSelection(null, 'manual')}
                      >
                        Undo
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        onClick={() => {
                          applyStudentSelection(autoMatchSuggestion.student, 'suggested');
                          logLedgerEntries([
                            {
                              type: 'automation_match_suggestion_applied',
                              severity: 'info',
                              objectType: 'student',
                              objectId: autoMatchSuggestion.student.id,
                              message: `Applied suggested student ${autoMatchSuggestion.student.name}.`,
                              source: 'session',
                            },
                          ]);
                        }}
                      >
                        Apply suggestion
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="automation-muted">Upload a recording to generate a suggestion.</p>
              )
            ) : (
              <p className="automation-muted">Enable to see automated matches.</p>
            )}
          </div>
          {loadingStudents ? (
            <p className="muted">Loading students...</p>
          ) : (
            <div className="student-grid">
              {studentOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`student-card ${selectedStudentId === option.id ? 'active' : ''}`}
                  aria-pressed={selectedStudentId === option.id}
                  onClick={() => handleSelectStudent(option)}
                >
                  <span className="student-name">{option.name}</span>
                  <span className="student-meta">ID: {option.id}</span>
                </button>
              ))}
              <button
                type="button"
                className={`student-card ${selectedStudentId ? '' : 'active'}`}
                aria-pressed={!selectedStudentId}
                onClick={() => handleSelectStudent(null)}
              >
                <span className="student-name">No student yet</span>
                <span className="student-meta">Leave unassigned</span>
              </button>
            </div>
          )}
        </div>

        <div className="wizard-panel upload-panel">
          <h3>Upload audio</h3>
          <p>Supported formats: wav, mp3, m4a, aac, ogg, opus.</p>
          <DropZone
            title={uploading ? 'Uploading audio...' : 'Drop audio file'}
            description="Drag an audio file here or click to browse."
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
              onCancel={handleCancel}
            />
          ) : null}
          {uploadError ? <p className="error-text">{uploadError}</p> : null}
          <p className="muted">{helperText}</p>
          {recordingId ? (
            <div className="recording-pill">Recording ID: {recordingId}</div>
          ) : null}
        </div>
      </div>

      <style>{`
        .wizard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: var(--space-4);
        }

        .wizard-panel {
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .automation-card {
          border-radius: var(--radius-lg);
          border: 1px dashed var(--border-light);
          padding: var(--space-3);
          background: rgba(15, 23, 42, 0.04);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .automation-header {
          display: flex;
          justify-content: space-between;
          gap: var(--space-3);
          align-items: flex-start;
        }

        .automation-eyebrow {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
          font-weight: 600;
        }

        .automation-card h4 {
          margin: var(--space-1) 0 0;
          font-size: var(--text-base);
        }

        .automation-card p {
          margin: 0;
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .automation-toggle {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          cursor: pointer;
        }

        .automation-toggle input {
          position: absolute;
          opacity: 0;
          width: 1px;
          height: 1px;
        }

        .automation-toggle .toggle-track {
          width: 42px;
          height: 24px;
          border-radius: 999px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          position: relative;
          transition: background var(--transition-fast), border-color var(--transition-fast);
        }

        .automation-toggle .toggle-track::after {
          content: '';
          position: absolute;
          top: 3px;
          left: 3px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--text-secondary);
          transition: transform var(--transition-fast), background var(--transition-fast);
        }

        .automation-toggle input:checked + .toggle-track {
          background: rgba(14, 165, 233, 0.2);
          border-color: rgba(14, 165, 233, 0.4);
        }

        .automation-toggle input:checked + .toggle-track::after {
          transform: translateX(18px);
          background: var(--color-primary-600);
        }

        .automation-suggestion {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          background: var(--bg-primary);
          border-radius: var(--radius-lg);
          padding: var(--space-3);
          border: 1px solid var(--border-light);
        }

        .suggestion-label {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
          font-weight: 600;
        }

        .suggestion-name {
          font-size: var(--text-base);
          font-weight: 600;
          color: var(--text-primary);
        }

        .suggestion-meta {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .automation-muted {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        .suggestion-actions {
          display: flex;
          gap: var(--space-2);
          align-items: center;
        }

        .wizard-panel h3 {
          margin: 0;
          font-size: var(--text-lg);
        }

        .wizard-panel p {
          margin: 0;
          color: var(--text-tertiary);
        }

        .student-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: var(--space-3);
        }

        .student-card {
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: var(--space-3);
          text-align: left;
          cursor: pointer;
          transition: border var(--transition-fast), box-shadow var(--transition-fast);
        }

        .student-card.active {
          border-color: rgba(99, 102, 241, 0.4);
          box-shadow: var(--shadow-md);
        }

        .student-name {
          font-weight: 600;
        }

        .student-meta {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .recording-pill {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-full);
          background: rgba(99, 102, 241, 0.12);
          color: var(--color-primary-600);
          font-size: var(--text-sm);
          font-weight: 600;
        }

        .muted {
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }
      `}</style>
    </WizardStep>
  );
};
