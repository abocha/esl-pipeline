import React, { useEffect, useMemo, useState } from 'react';

import type { RecordingTranscriptResponse } from '../../utils/api';
import {
  buildRecordingAudioUrl,
  fetchRecordingTranscript,
  updateRecordingTranscript,
} from '../../utils/api';
import { WizardStep } from './WizardStep';

interface Step2ReviewTranscriptProps {
  recordingId: string | null;
  transcriptId: string | null;
  transcriptText: string;
  onTranscriptReady: (response: RecordingTranscriptResponse, text: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export const Step2ReviewTranscript: React.FC<Step2ReviewTranscriptProps> = ({
  recordingId,
  transcriptId,
  transcriptText,
  onTranscriptReady,
  onNext,
  onBack,
  onSkip,
}) => {
  const [text, setText] = useState(transcriptText);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(transcriptText);
  }, [transcriptText]);

  useEffect(() => {
    let active = true;
    if (!recordingId) return;
    if (transcriptId && transcriptText.trim()) return;

    const loadTranscript = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchRecordingTranscript(recordingId);
        if (!active) return;
        setText(response.text ?? '');
        onTranscriptReady(response, response.text ?? '');
      } catch (loadError) {
        if (!active) return;
        const message = loadError instanceof Error ? loadError.message : 'Unable to load transcript';
        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadTranscript();

    return () => {
      active = false;
    };
  }, [recordingId, transcriptId, transcriptText, onTranscriptReady]);

  const hasChanges = useMemo(() => {
    return text.trim() !== transcriptText.trim();
  }, [text, transcriptText]);

  const handleSave = async (): Promise<boolean> => {
    if (!recordingId) return false;
    setSaving(true);
    setError(null);
    try {
      const response = await updateRecordingTranscript(recordingId, text.trim());
      onTranscriptReady(response, response.text ?? text.trim());
      return true;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to update transcript';
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleContinue = async () => {
    if (hasChanges) {
      const saved = await handleSave();
      if (!saved) return;
    }
    onNext();
  };

  const hasRecording = Boolean(recordingId);
  const audioUrl = recordingId ? buildRecordingAudioUrl(recordingId) : null;

  return (
    <WizardStep
      title="Review transcript"
      subtitle="Listen to the recording, make quick transcript edits, or skip ahead."
      onBack={onBack}
      onSkip={onSkip}
      onNext={handleContinue}
      nextLabel="Continue to notes"
      isNextDisabled={loading || hasRecording === false}
      isBusy={saving}
    >
      {hasRecording ? (
        <div className="transcript-layout">
          <div className="transcript-panel">
            <h3>Audio playback</h3>
            {audioUrl ? <audio controls src={audioUrl} /> : null}
            <p className="muted">Recording ID: {recordingId}</p>
          </div>

          <div className="transcript-panel">
            <div className="transcript-header">
              <h3>Transcript text</h3>
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={() => void handleSave()}
                disabled={!hasChanges || saving}
              >
                {saving ? 'Saving...' : 'Save edits'}
              </button>
            </div>
            {loading ? (
              <p className="muted">Loading transcript...</p>
            ) : (
              <textarea
                className="transcript-input"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={12}
              />
            )}
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        </div>
      ) : (
        <p className="error-text">Upload a recording first.</p>
      )}

      <style>{`
        .transcript-layout {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: var(--space-4);
        }

        .transcript-panel {
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .transcript-panel h3 {
          margin: 0;
        }

        .transcript-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2);
        }

        .transcript-input {
          width: 100%;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          padding: var(--space-3);
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          background: var(--bg-primary);
          min-height: 220px;
        }

        .muted {
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }
      `}</style>
    </WizardStep>
  );
};
