import type { StudentOption } from '../../../utils/api';
import type {
  AssignmentEntryView,
  RecentAssignmentItem,
  RecentAssignmentState,
} from '../../minimal/MinimalAssignment.entry-state';
import { ProductButton } from '../../system/ProductButton';
import { StudentStep } from './StudentStep';

export interface AssignmentEntrySummary {
  learnerName: string;
  state: RecentAssignmentState;
  origin: 'new' | 'resume';
}

interface AssignmentEntryStepProps {
  view: AssignmentEntryView;
  recentLoading: boolean;
  recentError: string | null;
  recentItems: RecentAssignmentItem[];
  selectedRecentId: string;
  learners: StudentOption[];
  learnerLoading: boolean;
  learnerError: string | null;
  selectedLearnerId: string;
  opening: boolean;
  starting: boolean;
  summary: AssignmentEntrySummary | null;
  onEnterResume: () => void;
  onEnterNew: () => void;
  onChangeChoice: () => void;
  onSelectRecent: (id: string) => void;
  onRetryRecent: () => void;
  onOpenRecent: () => void;
  onSelectLearner: (id: string) => void;
  onRetryLearners: () => void;
  onStartNew: () => void;
  onChangeAssignment: () => void;
}

function formatSummaryState(state: RecentAssignmentState): string {
  if (state === 'in-progress') return 'In progress';
  if (state === 'ready-to-share') return 'Ready to share';
  if (state === 'needs-attention') return 'Needs attention';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function AssignmentEntryStep({
  view,
  recentLoading,
  recentError,
  recentItems,
  selectedRecentId,
  learners,
  learnerLoading,
  learnerError,
  selectedLearnerId,
  opening,
  starting,
  summary,
  onEnterResume,
  onEnterNew,
  onChangeChoice,
  onSelectRecent,
  onRetryRecent,
  onOpenRecent,
  onSelectLearner,
  onRetryLearners,
  onStartNew,
  onChangeAssignment,
}: AssignmentEntryStepProps) {
  const selectedRecent = recentItems.find((item) => item.id === selectedRecentId) ?? null;
  const selectedLearner = learners.find((learner) => learner.id === selectedLearnerId) ?? null;
  const routeChangeDisabled = opening || starting;

  if (view === 'choice') {
    return (
      <section className="assignment-entry-step" aria-label="Assignment entry">
        <div className="assignment-entry-step__choices">
          <ProductButton
            variant="secondary"
            disabled={recentLoading || recentItems.length === 0}
            onClick={onEnterResume}
          >
            Resume recent work
          </ProductButton>
          <ProductButton variant="primary" disabled={recentLoading} onClick={onEnterNew}>
            Start new assignment
          </ProductButton>
        </div>
      </section>
    );
  }

  if (view === 'resume') {
    return (
      <section className="assignment-entry-step" aria-label="Resume recent work">
        <button
          type="button"
          className="product-button product-button--quiet"
          disabled={routeChangeDisabled}
          onClick={onChangeChoice}
        >
          Change choice
        </button>
        {recentLoading ? (
          <div className="assignment-entry-step__skeleton" role="status" aria-label="Loading recent work">
            Loading recent work…
          </div>
        ) : recentError ? (
          <div className="assignment-entry-step__error" role="alert">
            <p>{recentError}</p>
            <ProductButton variant="secondary" onClick={onRetryRecent}>
              Try again
            </ProductButton>
          </div>
        ) : (
          <>
            <fieldset className="assignment-entry-step__recent-list">
              <legend>Recent assignments</legend>
              {recentItems.map((item) => (
                <label key={item.id} className="assignment-entry-step__recent-row">
                  <input
                    type="radio"
                    name="recent-assignment"
                    checked={item.id === selectedRecentId}
                    disabled={opening}
                    onChange={() => onSelectRecent(item.id)}
                  />
                  <span>
                    <strong>{item.learnerName}</strong>
                    <span>{item.activityLabel}</span>
                    <span>{item.outcomeLabel}</span>
                    <span>{item.statusLabel}</span>
                    <span>{item.timeLabel}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {selectedRecent ? (
              <p className="assignment-entry-step__consequence">
                Opens {selectedRecent.learnerName}'s {selectedRecent.statusLabel.toLowerCase()}{' '}
                assignment. Existing work is preserved.
              </p>
            ) : null}
            <ProductButton
              busy={opening}
              disabled={!selectedRecent || opening}
              onClick={onOpenRecent}
            >
              {opening ? 'Opening…' : (selectedRecent?.actionLabel ?? 'Continue assignment')}
            </ProductButton>
          </>
        )}
      </section>
    );
  }

  if (view === 'new') {
    const hasLearners = learners.length > 0;
    return (
      <section className="assignment-entry-step" aria-label="Start new assignment">
        <button
          type="button"
          className="product-button product-button--quiet"
          disabled={routeChangeDisabled}
          onClick={onChangeChoice}
        >
          Change choice
        </button>
        {learnerLoading ? (
          <StudentStep
            students={learners}
            selectedStudentId={selectedLearnerId}
            selectionLocked={starting}
            loading
            error={null}
            onSelect={onSelectLearner}
          />
        ) : !hasLearners ? (
          <div className="assignment-entry-step__empty">
            <p>No learners are available yet.</p>
            <a href="/students">Manage learners</a>
          </div>
        ) : (
          <>
            <StudentStep
              students={learners}
              selectedStudentId={selectedLearnerId}
              selectionLocked={starting}
              error={learnerError}
              onSelect={onSelectLearner}
            />
            {learnerError ? (
              <ProductButton variant="secondary" onClick={onRetryLearners}>
                Try again
              </ProductButton>
            ) : (
              <ProductButton busy={starting} disabled={!selectedLearner || starting} onClick={onStartNew}>
                {starting ? 'Starting…' : 'Continue'}
              </ProductButton>
            )}
          </>
        )}
      </section>
    );
  }

  if (!summary) return null;
  return (
    <section className="assignment-entry-step assignment-entry-step__summary" aria-label="Current assignment">
      <div>
        <p>{summary.origin === 'new' ? 'Started new assignment' : 'Reopened assignment'}</p>
        <h3>{summary.learnerName}</h3>
        <span>{formatSummaryState(summary.state)}</span>
      </div>
      <button type="button" className="product-button product-button--quiet" onClick={onChangeAssignment}>
        Change assignment
      </button>
    </section>
  );
}
