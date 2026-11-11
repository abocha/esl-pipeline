import { BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  fetchRecordingTranscript,
  type LessonMemoryRecord,
  type RecordingTranscriptResponse,
} from '../../utils/api';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';

type Lesson = Pick<
  LessonMemoryRecord,
  'recordingId' | 'transcriptId' | 'lessonTitle' | 'sourceContentHash'
>;

export function LessonTranscriptDisclosure({
  lesson,
  compact = false,
}: {
  lesson: Lesson;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<RecordingTranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setTranscript(null);
    setError(null);
    void fetchRecordingTranscript(lesson.recordingId)
      .then((result) => {
        if (!current) return;
        if (result.transcriptId !== lesson.transcriptId)
          setError(
            'This transcript has been replaced. Open the lesson work to see the latest version.',
          );
        else setTranscript(result);
      })
      .catch(() => {
        if (current) setError('Transcript unavailable.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, lesson, retry]);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={`learning-latest-transcript${compact ? ' learning-latest-transcript--compact' : ''}`}
    >
      <summary title={compact ? `Read transcript: ${lesson.lessonTitle || 'Lesson'}` : undefined}>
        <BookOpen size={18} aria-hidden="true" />
        <span>
          {compact
            ? `Read transcript: ${lesson.lessonTitle || 'Lesson'}`
            : lesson.lessonTitle || 'Latest lesson transcript'}
        </span>
      </summary>
      {loading && <LoadingPlaceholder label="Loading transcript" kind="lines" />}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry transcript
          </button>
        </p>
      )}
      {transcript && (
        <>
          <p className="learning-transcript-version">
            {lesson.sourceContentHash && transcript.contentHash === lesson.sourceContentHash
              ? 'Lesson transcript'
              : 'Current transcript · may include edits made after the lesson summary'}
          </p>
          <pre>{transcript.text || 'No transcript text is available.'}</pre>
        </>
      )}
    </details>
  );
}
