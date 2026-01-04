import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useStudentSelection } from '../../context/StudentSelectionContext';
import type { RecordingListItem, StudentOption } from '../../utils/api';
import { fetchStudentOptions, uploadRecording } from '../../utils/api';
import { WizardStep } from './WizardStep';

interface Step1SelectStudentProps {
  recordingId: string | null;
  onRecordingReady: (recording: RecordingListItem) => void;
  onNext: () => void;
}

const ACCEPTED_AUDIO = '.wav,.mp3,.m4a,.aac,.ogg,.opus,audio/*';

export const Step1SelectStudent: React.FC<Step1SelectStudentProps> = ({
  recordingId,
  onRecordingReady,
  onNext,
}) => {
  const { registerRecording } = useJobMonitor();
  const { selectedStudent, setSelectedStudent } = useStudentSelection();
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

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

  const handleSelectStudent = (option: StudentOption | null) => {
    if (!option) {
      setSelectedStudent(null);
      return;
    }

    setSelectedStudent({
      id: option.id,
      student: option.name,
      profileId: option.profileId ?? null,
    });
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setSelectedFileName(file.name);
    setUploading(true);
    setUploadError(null);
    try {
      const recording = await uploadRecording(file, {
        studentId: selectedStudentId ?? undefined,
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
      onRecordingReady(recording);
      toast.success('Recording uploaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to upload recording';
      setUploadError(message);
    } finally {
      setUploading(false);
    }
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
          {loadingStudents ? (
            <p className="muted">Loading students...</p>
          ) : (
            <div className="student-grid">
              {studentOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`student-card ${selectedStudentId === option.id ? 'active' : ''}`}
                  onClick={() => handleSelectStudent(option)}
                >
                  <span className="student-name">{option.name}</span>
                  <span className="student-meta">ID: {option.id}</span>
                </button>
              ))}
              <button
                type="button"
                className={`student-card ${selectedStudentId ? '' : 'active'}`}
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
          <label className="upload-box">
            <input
              type="file"
              accept={ACCEPTED_AUDIO}
              onChange={(event) => handleUpload(event.target.files?.[0] ?? null)}
              disabled={uploading}
            />
            <span>{uploading ? 'Uploading...' : 'Choose file'}</span>
          </label>
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

        .upload-panel input {
          display: none;
        }

        .upload-box {
          border: 1px dashed var(--border-medium);
          border-radius: var(--radius-xl);
          padding: var(--space-5);
          text-align: center;
          cursor: pointer;
          background: var(--bg-primary);
          font-weight: 600;
        }

        .upload-box:hover {
          border-color: var(--color-primary-400);
          color: var(--color-primary-500);
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
