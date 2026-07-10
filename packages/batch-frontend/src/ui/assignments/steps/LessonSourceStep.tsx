import { useState } from 'react';
import { AudioLines, FileText, RotateCcw } from 'lucide-react';

import { ProductButton } from '../../system/ProductButton';
import { ProductNotice } from '../../system/ProductNotice';
import type { LessonSourceStepProps } from '../assignment-step-props';

type LessonSourceMode = 'audio' | 'transcript';

export function LessonSourceStep({
  children,
  studentSelected,
  manualSaving,
  manualError,
  transcriptReady,
  onCreateManualTranscript,
}: LessonSourceStepProps) {
  const [mode, setMode] = useState<LessonSourceMode>('audio');
  const [text, setText] = useState('');

  return (
    <div className="assignment-step assignment-step--source">
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
            <span><strong>Upload lesson audio</strong><small>OPUS audio only during the alpha</small></span>
          </button>
          <button
            type="button"
            className={mode === 'transcript' ? 'is-selected' : ''}
            aria-pressed={mode === 'transcript'}
            onClick={() => setMode('transcript')}
          >
            <FileText aria-hidden="true" />
            <span><strong>Use an existing transcript</strong><small>Paste text you already have</small></span>
          </button>
        </div>
      </fieldset>

      {mode === 'audio' ? (
        <div className="assignment-source-pane">
          <ProductNotice tone="info" title="OPUS audio only during the alpha">
            Other audio formats are coming later. Your recording and transcript stay attached to
            this assignment as you move between steps.
          </ProductNotice>
          {children}
        </div>
      ) : (
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
          {manualError ? (
            <ProductNotice tone="error" title="Transcript not saved">
              {manualError}
            </ProductNotice>
          ) : null}
          {transcriptReady ? (
            <ProductNotice tone="success" title="Existing transcript saved">
              You can continue to teaching context or return here to review it.
            </ProductNotice>
          ) : null}
          <ProductButton
            busy={manualSaving}
            disabled={!studentSelected || !text.trim()}
            icon={manualError ? <RotateCcw /> : <FileText />}
            onClick={() => void onCreateManualTranscript(text, 'Pasted lesson transcript')}
          >
            {manualError ? 'Retry saving transcript' : 'Save existing transcript'}
          </ProductButton>
          {!studentSelected ? <p className="assignment-source-pane__error">Select a student first.</p> : null}
        </div>
      )}
    </div>
  );
}
