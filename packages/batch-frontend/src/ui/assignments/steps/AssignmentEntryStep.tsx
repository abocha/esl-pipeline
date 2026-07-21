import { AlertCircle, Check, ChevronDown, ChevronUp, FileCheck2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { StudentOption } from '../../../utils/api';
import type {
  AssignmentEntryView,
  RecentAssignmentItem,
  RecentAssignmentLineage,
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
  recentLineages: RecentAssignmentLineage[];
  recentHasMore: boolean;
  recentLoadingMore: boolean;
  recentLoadMoreError: string | null;
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
  onLoadMoreRecent: () => Promise<void> | void;
  onOpenRecent: () => void;
  onSelectLearner: (id: string) => void;
  onRetryLearners: () => void;
  onStartNew: () => void;
  onChangeAssignment: () => void;
}

const INITIAL_LINEAGE_COUNT = 4;
const LINEAGE_REVEAL_COUNT = 8;

function RecentStateIcon({ item }: { item: RecentAssignmentItem }) {
  const iconProps = { size: 16, strokeWidth: 2 };
  if (item.state === 'published') return <Check {...iconProps} aria-hidden="true" />;
  if (item.state === 'ready-to-share') return <FileCheck2 {...iconProps} aria-hidden="true" />;
  if (item.state === 'in-progress') return <RefreshCw {...iconProps} aria-hidden="true" />;
  if (item.state === 'needs-attention') return <AlertCircle {...iconProps} aria-hidden="true" />;
  const stepNumber = {
    student: '1',
    source: '2',
    context: '3',
    assignment: '4',
    review: '5',
  } satisfies Record<RecentAssignmentItem['destination'], string>;
  return <span aria-hidden="true">{stepNumber[item.destination]}</span>;
}

function RecentState({ item }: { item: RecentAssignmentItem }) {
  return (
    <span className="assignment-entry-step__recent-state">
      <span className="assignment-entry-step__recent-state-icon">
        <RecentStateIcon item={item} />
      </span>
      <span>
        <strong>{item.statusLabel}</strong>
        <span>{item.timeLabel}</span>
      </span>
    </span>
  );
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
  recentLineages,
  recentHasMore,
  recentLoadingMore,
  recentLoadMoreError,
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
  onLoadMoreRecent,
  onOpenRecent,
  onSelectLearner,
  onRetryLearners,
  onStartNew,
  onChangeAssignment,
}: AssignmentEntryStepProps) {
  const [visibleLineageCount, setVisibleLineageCount] = useState(INITIAL_LINEAGE_COUNT);
  const [expandedLineageIds, setExpandedLineageIds] = useState<Set<string>>(() => new Set());
  const recentItems = useMemo(
    () => recentLineages.flatMap((lineage) => [lineage.latest, ...lineage.olderVersions]),
    [recentLineages],
  );
  const selectedRecent = recentItems.find((item) => item.id === selectedRecentId) ?? null;
  const selectedLearner = learners.find((learner) => learner.id === selectedLearnerId) ?? null;
  const routeChangeDisabled = opening || starting;

  useEffect(() => {
    if (view !== 'resume') {
      setVisibleLineageCount(INITIAL_LINEAGE_COUNT);
      setExpandedLineageIds(new Set());
    }
  }, [view]);

  useEffect(() => {
    const selectedLineage = recentLineages.find((lineage) =>
      lineage.olderVersions.some((item) => item.id === selectedRecentId),
    );
    if (!selectedLineage) return;
    setExpandedLineageIds((current) => {
      if (current.has(selectedLineage.id)) return current;
      const next = new Set(current);
      next.add(selectedLineage.id);
      return next;
    });
  }, [recentLineages, selectedRecentId]);

  const revealMoreLineages = async () => {
    const nextCount = visibleLineageCount + LINEAGE_REVEAL_COUNT;
    setVisibleLineageCount(nextCount);
    if (nextCount > recentLineages.length && recentHasMore) await onLoadMoreRecent();
  };

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
          <div
            className="assignment-entry-step__skeleton"
            role="status"
            aria-label="Loading recent work"
          >
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
            <fieldset className="assignment-entry-step__recent-list" aria-busy={recentLoadingMore}>
              <legend>Recent assignments</legend>
              {recentLineages.slice(0, visibleLineageCount).map((lineage) => {
                const { latest, olderVersions } = lineage;
                const expanded = expandedLineageIds.has(lineage.id);
                const versionCount = olderVersions.length + 1;
                const historyId = `assignment-lineage-${lineage.id}`;
                return (
                  <div key={lineage.id} className="assignment-entry-step__recent-lineage">
                    <div
                      className={`assignment-entry-step__recent-row assignment-entry-step__recent-row--${latest.statusTone}${latest.id === selectedRecentId ? ' is-selected' : ''}`}
                    >
                      <input
                        id={`recent-assignment-${latest.id}`}
                        type="radio"
                        name="recent-assignment"
                        aria-label={`${latest.learnerName}, ${latest.recoveryAnchor ?? latest.activityLabel}, ${latest.statusLabel}, ${latest.timeLabel}`}
                        checked={latest.id === selectedRecentId}
                        disabled={opening}
                        onChange={() => onSelectRecent(latest.id)}
                      />
                      <label
                        htmlFor={`recent-assignment-${latest.id}`}
                        className="assignment-entry-step__recent-learner"
                      >
                        {latest.learnerName}
                      </label>
                      <div className="assignment-entry-step__recent-anchor">
                        <label htmlFor={`recent-assignment-${latest.id}`}>
                          {latest.recoveryAnchor ?? latest.activityLabel}
                        </label>
                        {versionCount > 1 ? (
                          <span className="assignment-entry-step__version-disclosure">
                            <span>Latest rerun ·</span>
                            <button
                              type="button"
                              className="assignment-entry-step__version-pill"
                              aria-label={`${versionCount} versions`}
                              aria-expanded={expanded}
                              aria-controls={historyId}
                              onClick={() =>
                                setExpandedLineageIds((current) => {
                                  const next = new Set(current);
                                  if (expanded) next.delete(lineage.id);
                                  else next.add(lineage.id);
                                  return next;
                                })
                              }
                            >
                              {versionCount} versions
                              {expanded ? (
                                <ChevronUp size={15} aria-hidden="true" />
                              ) : (
                                <ChevronDown size={15} aria-hidden="true" />
                              )}
                            </button>
                          </span>
                        ) : latest.sourceJobId ? (
                          <span className="assignment-entry-step__version-note">Rerun</span>
                        ) : null}
                      </div>
                      <label
                        htmlFor={`recent-assignment-${latest.id}`}
                        className="assignment-entry-step__recent-state-cell"
                      >
                        <RecentState item={latest} />
                      </label>
                    </div>
                    {expanded ? (
                      <div
                        id={historyId}
                        className="assignment-entry-step__version-list"
                        role="group"
                        aria-label={`Versions for ${latest.learnerName}`}
                      >
                        {olderVersions.map((version) => {
                          const versionLabel = version.sourceJobId ? 'Previous rerun' : 'Original';
                          return (
                            <div
                              key={version.id}
                              className={`assignment-entry-step__version-row assignment-entry-step__recent-row--${version.statusTone}`}
                            >
                              <input
                                id={`recent-assignment-${version.id}`}
                                type="radio"
                                name="recent-assignment"
                                aria-label={`${versionLabel}, ${version.statusLabel}, ${version.timeLabel}`}
                                checked={version.id === selectedRecentId}
                                disabled={opening}
                                onChange={() => onSelectRecent(version.id)}
                              />
                              <label htmlFor={`recent-assignment-${version.id}`}>
                                {versionLabel}
                              </label>
                              <label
                                htmlFor={`recent-assignment-${version.id}`}
                                className="assignment-entry-step__recent-state-cell"
                              >
                                <RecentState item={version} />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
            {visibleLineageCount < recentLineages.length || recentHasMore ? (
              <button
                type="button"
                className="product-button product-button--quiet assignment-entry-step__show-older"
                disabled={recentLoadingMore}
                onClick={() => void revealMoreLineages()}
              >
                {recentLoadingMore
                  ? 'Loading…'
                  : visibleLineageCount <= INITIAL_LINEAGE_COUNT
                    ? 'Show older assignments'
                    : 'Load more'}
              </button>
            ) : null}
            {recentLoadMoreError ? (
              <div className="assignment-entry-step__load-more-error" role="alert">
                <span>{recentLoadMoreError}</span>
                <button
                  type="button"
                  className="product-button product-button--quiet"
                  onClick={() => void onLoadMoreRecent()}
                >
                  Try again
                </button>
              </div>
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
              <ProductButton
                busy={starting}
                disabled={!selectedLearner || starting}
                onClick={onStartNew}
              >
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
    <section
      className="assignment-entry-step assignment-entry-step__summary"
      aria-label="Current assignment"
    >
      <div>
        <p>{summary.origin === 'new' ? 'Started new assignment' : 'Reopened assignment'}</p>
        <h3>{summary.learnerName}</h3>
        <span>{formatSummaryState(summary.state)}</span>
      </div>
      <button
        type="button"
        className="product-button product-button--quiet"
        onClick={onChangeAssignment}
      >
        Change assignment
      </button>
    </section>
  );
}
