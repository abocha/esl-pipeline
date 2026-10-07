import type { AssignmentSession, StudentScheduleBillingSurface } from '../../utils/api';
import { ProductButton } from '../system/ProductButton';
import { getTranscriptUnexpectedCharacterWarnings } from './MinimalAssignment.transcript-warnings';

export function TranscriptReviewResult({
  session,
  transcriptText,
  studentName,
  lesson,
  lessonLoadingError,
  roles,
  completed,
  busy,
  error,
  onEdit,
  onChoiceChange,
  onStartHomework,
}: {
  session: AssignmentSession | null;
  transcriptText: string;
  studentName: string | null;
  lesson: StudentScheduleBillingSurface['lessons'][number] | null;
  lessonLoadingError: string | null;
  roles: { speaker: number; role: 'teacher' | 'student' | '' }[];
  completed: boolean;
  busy: boolean;
  error: string | null;
  onEdit: () => void;
  onChoiceChange: (checked: boolean) => void;
  onStartHomework: () => void;
}) {
  const warnings = getTranscriptUnexpectedCharacterWarnings(transcriptText);
  return (
    <section
      className="minimal-section minimal-transcript-result"
      aria-label={completed ? 'Transcript result' : 'Review transcript'}
    >
      <h2>{completed ? 'Transcript confirmed — no homework planned' : 'Review & finish'}</h2>
      <p>Lesson for {studentName ?? 'selected student'}</p>
      {session?.lessonId ? (
        <div>
          <p>
            {lesson?.title ?? 'Linked lesson'} ·{' '}
            {lesson ? new Date(lesson.startsAt).toLocaleString() : session.lessonId}
          </p>
          {lesson ? (
            <p>
              Lesson status: {lesson.status.replaceAll('_', ' ')}. Credit:{' '}
              {lesson.creditEventId
                ? 'consumed'
                : lesson.consumesCredit
                  ? 'not consumed'
                  : 'non-credit lesson'}
              .
            </p>
          ) : (
            <p role="status">
              {lessonLoadingError
                ? 'Lesson and credit status could not be loaded.'
                : 'Loading lesson and credit status…'}
            </p>
          )}
        </div>
      ) : (
        <p>No scheduled lesson linked. No lesson credit is recorded by this workflow.</p>
      )}
      {!completed ? (
        <p>
          Review the saved transcript and speaker roles. Finish confirms this exact source; lesson
          and credit status stay as shown.
        </p>
      ) : null}
      <h3>Transcript</h3>
      <textarea aria-label="Reviewed transcript" value={transcriptText} readOnly rows={12} />
      {roles.length ? (
        <div>
          <h3>Speaker roles</h3>
          <ul>
            {roles.map((item) => (
              <li key={item.speaker}>
                Speaker {item.speaker + 1}: {item.role || 'unassigned'}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>No speaker-role mapping is required for this source.</p>
      )}
      {warnings.length ? (
        <p role="status">
          Transcript contains characters outside expected English/Russian text: {warnings.join(' ')}
          . Check these spots before confirming.
        </p>
      ) : null}
      {completed ? (
        <>
          <dl className="minimal-transcript-processing">
            <dt>Lesson memory extraction</dt>
            <dd>
              {session?.transcriptProcessing?.lessonMemory?.replaceAll('_', ' ') ??
                'Status unavailable'}
            </dd>
            <dt>Student memory snapshot refresh</dt>
            <dd>
              {session?.transcriptProcessing?.snapshot?.replaceAll('_', ' ') ??
                'Status unavailable'}
            </dd>
            <dt>Initial profile enrichment</dt>
            <dd>
              {session?.transcriptProcessing?.enrichment?.replaceAll('_', ' ') ??
                'Status unavailable'}
            </dd>
          </dl>
          <p>
            Background processing does not change transcript confirmation or lesson credits. Profile
            candidates remain subject to review.
          </p>
          <ProductButton disabled={busy} onClick={onStartHomework}>
            Create homework
          </ProductButton>
        </>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              checked
              disabled={busy}
              onChange={(event) => onChoiceChange(event.target.checked)}
            />{' '}
            No homework for this lesson
          </label>
          <ProductButton variant="quiet" disabled={busy} onClick={onEdit}>
            Edit transcript
          </ProductButton>
        </>
      )}
      {error ? (
        <p role="alert" className="minimal-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
