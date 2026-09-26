import { AudioLines, FileText, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ProductButton } from '../../system/ProductButton';
import type { LessonSourceStepProps } from '../assignment-step-props';

type LessonSourceMode = 'audio' | 'transcript';

export function LessonSourceStep({
  children,
  studentSelected,
  manualSaving,
  manualError,
  sourcePrepared = false,
  preparedSourceKey,
  onCreateManualTranscript,
}: LessonSourceStepProps) {
  const [mode, setMode] = useState<LessonSourceMode>('audio');
  const [text, setText] = useState('');
  const [changingSource, setChangingSource] = useState(false);
  useEffect(() => {
    if (sourcePrepared && preparedSourceKey !== undefined) setChangingSource(false);
  }, [preparedSourceKey, sourcePrepared]);
  const showChooser = !sourcePrepared || changingSource;

  return (
    <div className="assignment-step assignment-step--source">
      {sourcePrepared && !changingSource ? (
        <button type="button" className="minimal-secondary" onClick={() => setChangingSource(true)}>
          Change lesson source
        </button>
      ) : null}
      {sourcePrepared && changingSource ? (
        <button
          type="button"
          className="minimal-secondary"
          onClick={() => setChangingSource(false)}
        >
          Keep current source
        </button>
      ) : null}
      {showChooser ? (
        <fieldset className="assignment-source-choice">
          <legend>Choose the lesson source</legend>
          <div className="assignment-source-choice__options">
            <button
              type="button"
              className={mode === 'audio' ? 'is-selected' : ''}
              aria-pressed={mode === 'audio'}
              onClick={() => setMode('audio')}
            >
              <AudioLines aria-hidden="true" />
              <span className="assignment-source-choice__copy">
                <strong>Upload lesson recording</strong>
                <small>Audio or video recording</small>
              </span>
            </button>
            <button
              type="button"
              className={mode === 'transcript' ? 'is-selected' : ''}
              aria-pressed={mode === 'transcript'}
              onClick={() => setMode('transcript')}
            >
              <FileText aria-hidden="true" />
              <span className="assignment-source-choice__copy">
                <strong>Use an existing transcript</strong>
                <small>Paste text you already have</small>
              </span>
            </button>
          </div>
        </fieldset>
      ) : null}

      {showChooser && mode === 'audio' ? (
        <div className="assignment-source-pane">{children}</div>
      ) : showChooser ? (
        <div className="assignment-source-pane assignment-source-pane--manual">
          <label htmlFor="manual-lesson-transcript">Existing lesson transcript</label>
          <textarea
            id="manual-lesson-transcript"
            rows={14}
            value={text}
            placeholder="Paste the lesson transcript here…"
            onChange={(event) => setText(event.target.value)}
          />
          <p className="assignment-source-pane__hint">
            This becomes the durable lesson source. No audio transcription is started.
          </p>
          {manualError ? <p className="assignment-source-pane__error">{manualError}</p> : null}
          <ProductButton
            busy={manualSaving}
            disabled={!studentSelected || !text.trim()}
            icon={manualError ? <RotateCcw /> : <FileText />}
            onClick={() => void onCreateManualTranscript(text, 'Pasted lesson transcript')}
          >
            {manualError ? 'Retry transcript' : 'Use transcript'}
          </ProductButton>
          {!studentSelected ? (
            <p className="assignment-source-pane__error">Select a student first.</p>
          ) : null}
        </div>
      ) : null}
      {sourcePrepared && !changingSource ? children : null}
    </div>
  );
}
