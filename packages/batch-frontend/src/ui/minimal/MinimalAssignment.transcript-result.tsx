import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import type { AssignmentSession, StudentScheduleBillingSurface } from '../../utils/api';
import { formatTutorTime } from '../../utils/tutor-time';
import { ProductButton } from '../system/ProductButton';
import { getTranscriptUnexpectedCharacterWarnings } from './MinimalAssignment.transcript-warnings';

type ProcessingStatus = NonNullable<AssignmentSession['transcriptProcessing']>[
  | 'lessonMemory'
  | 'snapshot'
  | 'enrichment'];

const processingLabels: Record<ProcessingStatus, string> = {
  not_requested: 'Not started',
  pending: 'In progress',
  ready: 'Ready',
  failed: 'Failed',
  superseded: 'Replaced by a newer source',
  not_eligible: 'Not applicable',
  uncertain: 'Status needs checking',
};

function processingLabel(status: ProcessingStatus | undefined): string {
  return status ? processingLabels[status] : 'Status unavailable';
}

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
  const timezone = useWorkspaceTimezone();
  const warnings = getTranscriptUnexpectedCharacterWarnings(transcriptText);
  const processing = session?.transcriptProcessing;
  const processingNeedsAttention =
    Object.values(processing ?? {}).some(
      (status) => status === 'failed' || status === 'uncertain',
    ) ||
    processing?.availability?.state === 'repair_required' ||
    processing?.availability?.state === 'repository_unavailable';
  return (
    <section
      className="minimal-section minimal-transcript-result"
      aria-label={completed ? 'Transcript result' : 'Review transcript'}
    >
      <h2>{completed ? 'Transcript confirmed — no homework planned' : 'Review & finish'}</h2>
      <div className="minimal-transcript-identity">
        <p>Lesson for {studentName ?? 'selected student'}</p>
        {session?.lessonId ? (
          lesson ? (
            <>
              <p>
                {lesson.title} · {formatTutorTime(lesson.startsAt, timezone)}
              </p>
              <p className="minimal-muted">
                {lesson.status.replaceAll('_', ' ')} ·{' '}
                {lesson.creditEventId
                  ? 'Credit used'
                  : lesson.consumesCredit
                    ? 'Credit not used'
                    : 'Non-credit lesson'}
              </p>
            </>
          ) : (
            <p role={lessonLoadingError ? 'alert' : 'status'}>
              {lessonLoadingError
                ? 'Lesson and credit status could not be loaded.'
                : 'Loading lesson details…'}
            </p>
          )
        ) : (
          <p className="minimal-muted">No scheduled lesson linked</p>
        )}
      </div>
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
      ) : null}
      {warnings.length ? (
        <p role="status">
          Transcript contains characters outside expected English/Russian text: {warnings.join(' ')}
          .{!completed ? ' Check these spots before confirming.' : ''}
        </p>
      ) : null}
      {completed ? (
        <>
          <ProductButton disabled={busy} onClick={onStartHomework}>
            Create homework
          </ProductButton>
          <details className="minimal-transcript-details">
            <summary>
              Processing details{processingNeedsAttention ? ' · Needs attention' : ''}
            </summary>
            <dl className="minimal-transcript-processing">
              <dt>Lesson notes</dt>
              <dd>{processingLabel(processing?.lessonMemory)}</dd>
              <dt>Student summary</dt>
              <dd>{processingLabel(processing?.snapshot)}</dd>
              {processing?.availability ? (
                <>
                  <dt>Summary availability</dt>
                  <dd>
                    {processing.availability.state === 'repair_required'
                      ? 'Established history requires explicit repair'
                      : processing.availability.state === 'repository_unavailable'
                        ? 'Memory retrieval unavailable'
                        : processing.availability.state === 'available'
                          ? 'Available'
                          : 'No established summary yet'}
                  </dd>
                </>
              ) : null}
              <dt>Profile suggestions</dt>
              <dd>{processingLabel(processing?.enrichment)}</dd>
            </dl>
          </details>
        </>
      ) : (
        <>
          <label className="minimal-homework-choice-label">
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
