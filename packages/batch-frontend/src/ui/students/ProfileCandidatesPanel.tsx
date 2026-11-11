import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from 'react';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import type { StudentProfileCandidate } from '../../utils/api';
import { formatTutorTime } from '../../utils/tutor-time';
import { useStudioV2 } from '../studio-v2/StudioV2Context';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';
import {
  type CandidateActionKind,
  formatCandidateSectionLabel,
  formatCandidateStateLabel,
  getApprovedCandidatesReadyForPromotion,
  groupVisibleCandidatesBySection,
  isPendingCandidate,
  isSelectableForPromotion,
  PROFILE_CANDIDATE_APPROVED_FILTER,
  PROFILE_CANDIDATE_FILTER_OPTIONS,
  type ProfileCandidateFilter,
} from './StudentProfileUi.logic';

export interface ProfileCandidatesPanelProps {
  className?: string;
  selectedStudentId: string;
  profileCandidates: StudentProfileCandidate[];
  profileCandidatesLoading: boolean;
  profileCandidatesError: string | null;
  profileCandidateFilter: ProfileCandidateFilter;
  setProfileCandidateFilter: Dispatch<SetStateAction<ProfileCandidateFilter>>;
  profileCandidateAction: { candidateId: string; action: CandidateActionKind } | null;
  profileCandidateDrafts: Record<string, { approvedFactText: string; reviewerNote: string }>;
  updateProfileCandidateDraft: (
    candidateId: string,
    patch: Partial<{ approvedFactText: string; reviewerNote: string }>,
  ) => void;
  selectedCandidateIds: string[];
  setSelectedCandidateIds: Dispatch<SetStateAction<string[]>>;
  profileCandidatePromotionNote: string;
  setProfileCandidatePromotionNote: Dispatch<SetStateAction<string>>;
  profileCandidatePromotionBusy: boolean;
  profileCandidatePromotionError: string | null;
  profileCandidatePromotionSuccess: string | null;
  onRefreshCandidates: () => void | Promise<void>;
  onPromoteProfileCandidates: () => void | Promise<void>;
  onReviewProfileCandidate: (
    candidate: StudentProfileCandidate,
    action: CandidateActionKind,
  ) => void | Promise<void>;
}

function candidateDecisionLabel(candidate: StudentProfileCandidate): string | null {
  const decision = candidate.dedupDecision?.decision;
  return typeof decision === 'string' && decision !== 'created' ? decision : null;
}

export function ProfileCandidatesPanel({
  className,
  selectedStudentId,
  profileCandidates,
  profileCandidatesLoading,
  profileCandidatesError,
  profileCandidateFilter,
  setProfileCandidateFilter,
  profileCandidateAction,
  profileCandidateDrafts,
  updateProfileCandidateDraft,
  selectedCandidateIds,
  setSelectedCandidateIds,
  profileCandidatePromotionNote,
  setProfileCandidatePromotionNote,
  profileCandidatePromotionBusy,
  profileCandidatePromotionError,
  profileCandidatePromotionSuccess,
  onPromoteProfileCandidates,
  onReviewProfileCandidate,
}: ProfileCandidatesPanelProps) {
  const studioV2 = useStudioV2();
  const timezone = useWorkspaceTimezone();
  const formatCandidateDate = (value?: string | null) => formatTutorTime(value, timezone);
  const [openCandidateIds, setOpenCandidateIds] = useState<string[]>([]);
  const approvedCandidatesReadyForPromotion = useMemo(
    () => getApprovedCandidatesReadyForPromotion(profileCandidates),
    [profileCandidates],
  );
  const approvedCandidateIdsReadyForPromotion = useMemo(
    () => new Set(approvedCandidatesReadyForPromotion.map((candidate) => candidate.id)),
    [approvedCandidatesReadyForPromotion],
  );
  const selectedApprovedCandidateCount = useMemo(
    () =>
      selectedCandidateIds.filter((candidateId) =>
        approvedCandidateIdsReadyForPromotion.has(candidateId),
      ).length,
    [approvedCandidateIdsReadyForPromotion, selectedCandidateIds],
  );
  const groupedProfileCandidates = useMemo(
    () => groupVisibleCandidatesBySection(profileCandidates, profileCandidateFilter),
    [profileCandidateFilter, profileCandidates],
  );
  const showingPromotionQueue = profileCandidateFilter === PROFILE_CANDIDATE_APPROVED_FILTER;
  const toggleCandidateDetails = useCallback((candidateId: string) => {
    setOpenCandidateIds((current) =>
      current.includes(candidateId)
        ? current.filter((item) => item !== candidateId)
        : [...current, candidateId],
    );
  }, []);

  return (
    <article className={['workspace-card workspace-panel', className].filter(Boolean).join(' ')}>
      <header>
        <h2>Profile Candidates</h2>
        {!profileCandidatesLoading && !profileCandidatesError ? (
          <span className="workspace-muted">
            {profileCandidates.filter(isPendingCandidate).length} awaiting review
          </span>
        ) : null}
      </header>

      <div className="student-history-filters" role="group" aria-label="Candidate filter">
        <span>Show</span>
        {PROFILE_CANDIDATE_FILTER_OPTIONS.map((option) => (
          <button
            key={option.filter}
            type="button"
            className={profileCandidateFilter === option.filter ? 'active' : ''}
            aria-pressed={profileCandidateFilter === option.filter}
            onClick={() => setProfileCandidateFilter(option.filter)}
            disabled={!selectedStudentId}
          >
            {option.label}
          </button>
        ))}
      </div>

      {showingPromotionQueue && !profileCandidatesLoading && !profileCandidatesError ? (
        <div className="workspace-create-panel">
          <div className="workspace-inline workspace-header-row">
            <div>
              <strong>Promotion queue</strong>
              <div className="workspace-muted">
                {approvedCandidatesReadyForPromotion.length} approved candidate
                {approvedCandidatesReadyForPromotion.length === 1 ? '' : 's'} ready for promotion.
              </div>
            </div>

            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() =>
                setSelectedCandidateIds(
                  approvedCandidatesReadyForPromotion.map((candidate) => candidate.id),
                )
              }
              disabled={approvedCandidatesReadyForPromotion.length === 0}
            >
              Select All Approved
            </button>
          </div>

          <label className="workspace-field">
            Promotion Note
            <textarea
              aria-label="Promotion Note"
              value={profileCandidatePromotionNote}
              onChange={(event) => setProfileCandidatePromotionNote(event.target.value)}
              rows={2}
              placeholder="Optional note explaining this promotion batch"
              disabled={!selectedStudentId || profileCandidatePromotionBusy}
            />
          </label>

          <div className="workspace-inline">
            <span className="workspace-muted">
              {selectedApprovedCandidateCount} selected for draft revision generation
            </span>
            <button
              type="button"
              className="workspace-primary-btn"
              onClick={() => void onPromoteProfileCandidates()}
              disabled={
                !selectedStudentId ||
                profileCandidatePromotionBusy ||
                selectedApprovedCandidateCount === 0
              }
            >
              {profileCandidatePromotionBusy ? 'Generating Draft...' : 'Generate Draft Revision'}
            </button>
          </div>

          {profileCandidatePromotionError ? (
            <p className="workspace-error">{profileCandidatePromotionError}</p>
          ) : null}
          {profileCandidatePromotionSuccess ? (
            <p className="workspace-success">{profileCandidatePromotionSuccess}</p>
          ) : null}
        </div>
      ) : null}

      {profileCandidatesError ? <p className="workspace-error">{profileCandidatesError}</p> : null}

      {selectedStudentId ? (
        profileCandidatesLoading && profileCandidates.length === 0 ? (
          <LoadingPlaceholder label="Loading profile suggestions" />
        ) : groupedProfileCandidates.length > 0 ? (
          groupedProfileCandidates.map(([section, candidates]) => (
            <section key={section} className="workspace-candidate-group">
              <h3>{formatCandidateSectionLabel(section)}</h3>

              <div className="workspace-list workspace-candidate-list">
                {candidates.map((candidate) => {
                  const draft = profileCandidateDrafts[candidate.id];
                  const savedFactText = candidate.approvedFactText ?? candidate.proposedFact;
                  const approvedFactText = draft?.approvedFactText ?? savedFactText;
                  const reviewerNote =
                    draft?.reviewerNote ?? (studioV2 ? candidate.reviewerNote : null) ?? '';
                  const hasDraft = Boolean(
                    draft &&
                      (draft.approvedFactText !== savedFactText ||
                        draft.reviewerNote !== (candidate.reviewerNote ?? '')),
                  );
                  const isBusy = profileCandidateAction?.candidateId === candidate.id;
                  const isTerminal =
                    candidate.status === 'promoted' || candidate.status === 'superseded';
                  const isSelected = selectedCandidateIds.includes(candidate.id);
                  const isDetailsOpen = openCandidateIds.includes(candidate.id);
                  const decisionLabel = candidateDecisionLabel(candidate);

                  return (
                    <article
                      key={candidate.id}
                      className="workspace-list-item workspace-candidate-item workspace-candidate-details"
                      data-testid={`profile-candidate-card-${candidate.id}`}
                    >
                      <div className="workspace-candidate-summary">
                        <div className="workspace-candidate-copy">
                          <strong>{studioV2 ? savedFactText : approvedFactText}</strong>
                          {studioV2 && hasDraft ? (
                            <p className="workspace-candidate-source">Unsaved edit</p>
                          ) : null}
                          {!studioV2 && decisionLabel ? (
                            <p className="workspace-candidate-source">
                              Dedup decision: {decisionLabel}
                            </p>
                          ) : null}
                        </div>

                        <div className="workspace-candidate-status">
                          <span className="workspace-pill">
                            {formatCandidateStateLabel(candidate)}
                          </span>
                          {isSelectableForPromotion(candidate) ? (
                            <label className="workspace-inline workspace-candidate-select">
                              <input
                                aria-label={
                                  studioV2
                                    ? `Use in draft: ${savedFactText}`
                                    : `Select candidate ${candidate.id} for promotion`
                                }
                                type="checkbox"
                                checked={isSelected}
                                onChange={(event) =>
                                  setSelectedCandidateIds((current) => {
                                    if (event.target.checked) {
                                      return current.includes(candidate.id)
                                        ? current
                                        : [...current, candidate.id];
                                    }
                                    return current.filter((item) => item !== candidate.id);
                                  })
                                }
                              />
                              Use in draft
                            </label>
                          ) : null}
                        </div>
                      </div>

                      <div className="workspace-inline workspace-candidate-actions">
                        <button
                          type="button"
                          className="workspace-secondary-btn"
                          onClick={() => toggleCandidateDetails(candidate.id)}
                          aria-expanded={isDetailsOpen}
                        >
                          {isDetailsOpen ? 'Hide details' : 'Details'}
                        </button>
                        <button
                          type="button"
                          className="workspace-primary-btn"
                          onClick={() => void onReviewProfileCandidate(candidate, 'approve')}
                          disabled={isTerminal || isBusy || (studioV2 && !approvedFactText.trim())}
                        >
                          {isBusy && profileCandidateAction?.action === 'approve'
                            ? 'Saving...'
                            : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className="workspace-secondary-btn"
                          onClick={() => void onReviewProfileCandidate(candidate, 'defer')}
                          disabled={isTerminal || isBusy}
                        >
                          {isBusy && profileCandidateAction?.action === 'defer'
                            ? 'Saving...'
                            : 'Defer'}
                        </button>
                        <button
                          type="button"
                          className="workspace-secondary-btn"
                          onClick={() => void onReviewProfileCandidate(candidate, 'reject')}
                          disabled={isTerminal || isBusy}
                        >
                          {isBusy && profileCandidateAction?.action === 'reject'
                            ? 'Saving...'
                            : 'Reject'}
                        </button>
                      </div>

                      {isDetailsOpen ? (
                        <div className="workspace-candidate-body">
                          {studioV2 ? (
                            <>
                              {candidate.sourceLessonTitle || candidate.sourceLessonStartedAt ? (
                                <p className="workspace-candidate-source">
                                  {[
                                    candidate.sourceLessonTitle,
                                    candidate.sourceLessonStartedAt
                                      ? formatCandidateDate(candidate.sourceLessonStartedAt)
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              ) : null}
                              {candidate.sourceSummary ? <p>{candidate.sourceSummary}</p> : null}
                            </>
                          ) : (
                            <div className="workspace-meta">
                              <span>
                                <strong>Target section:</strong>{' '}
                                {formatCandidateSectionLabel(candidate.targetSection)}
                              </span>
                              <span>
                                <strong>Authority:</strong> {candidate.authority ?? 'n/a'}
                              </span>
                              <span>
                                <strong>Source summary:</strong> {candidate.sourceSummary ?? 'n/a'}
                              </span>
                              <span>
                                <strong>Snapshot:</strong> {candidate.sourceSnapshotId ?? 'none'}
                              </span>
                              <span>
                                <strong>Lesson memory IDs:</strong>{' '}
                                {candidate.sourceLessonMemoryIds.length > 0
                                  ? candidate.sourceLessonMemoryIds.join(', ')
                                  : 'none'}
                              </span>
                              <span>
                                <strong>Source lesson:</strong>{' '}
                                {candidate.sourceLessonTitle ?? candidate.sourceLessonId ?? 'none'}
                              </span>
                              <span>
                                <strong>Source lesson date:</strong>{' '}
                                {formatCandidateDate(candidate.sourceLessonStartedAt)}
                              </span>
                              {!candidate.sourceLessonStartedAt &&
                              typeof candidate.provenance?.sourceLessonGeneratedAt === 'string' ? (
                                <span>
                                  <strong>Extraction date (lesson date unknown):</strong>{' '}
                                  {formatCandidateDate(
                                    candidate.provenance.sourceLessonGeneratedAt,
                                  )}
                                </span>
                              ) : null}
                              <span>
                                <strong>Source memory IDs:</strong>{' '}
                                {candidate.sourceMemoryIds && candidate.sourceMemoryIds.length > 0
                                  ? candidate.sourceMemoryIds.join(', ')
                                  : 'none'}
                              </span>
                              <span>
                                <strong>Dedup decision:</strong>{' '}
                                {candidate.dedupDecision?.decision
                                  ? `${candidate.dedupDecision.decision}`
                                  : 'none'}
                              </span>
                              {typeof candidate.dedupDecision?.reason === 'string' ? (
                                <span>
                                  <strong>Dedup reason:</strong> {candidate.dedupDecision.reason}
                                </span>
                              ) : null}
                              <span>
                                <strong>Promoted revision:</strong>{' '}
                                {candidate.promotedRevisionId ?? 'not yet promoted'}
                              </span>
                            </div>
                          )}

                          {!studioV2 || savedFactText !== candidate.proposedFact ? (
                            <div>
                              <strong>
                                {studioV2 ? 'Original suggestion' : 'Original proposal'}
                              </strong>
                              <p>{candidate.proposedFact}</p>
                            </div>
                          ) : null}

                          <label className="workspace-field">
                            {studioV2 ? 'Wording to approve' : 'Approved Fact Text'}
                            <textarea
                              aria-label={
                                studioV2 ? undefined : `Approved Fact Text ${candidate.id}`
                              }
                              value={approvedFactText}
                              onChange={(event) =>
                                updateProfileCandidateDraft(candidate.id, {
                                  approvedFactText: event.target.value,
                                })
                              }
                              rows={3}
                              disabled={isTerminal || isBusy}
                            />
                          </label>

                          <label className="workspace-field">
                            {studioV2 ? 'Note (optional)' : 'Reviewer Note'}
                            <textarea
                              aria-label={studioV2 ? undefined : `Reviewer Note ${candidate.id}`}
                              value={reviewerNote}
                              onChange={(event) =>
                                updateProfileCandidateDraft(candidate.id, {
                                  reviewerNote: event.target.value,
                                })
                              }
                              rows={2}
                              disabled={isTerminal || isBusy}
                            />
                          </label>

                          {!studioV2 || candidate.evidence.length > 0 ? (
                            <div>
                              <strong>{studioV2 ? 'Supporting excerpts' : 'Evidence'}</strong>
                              {candidate.evidence.length > 0 ? (
                                <div className="workspace-list">
                                  {candidate.evidence.map((evidence, index) => (
                                    <div
                                      key={`${candidate.id}-evidence-${index}`}
                                      className="workspace-list-item workspace-list-item-stack"
                                    >
                                      <div>
                                        <strong>{evidence.quote}</strong>
                                        <div className="workspace-muted">
                                          {studioV2
                                            ? evidence.speakerRole === 'student'
                                              ? 'Student'
                                              : evidence.speakerRole === 'teacher'
                                                ? 'Tutor'
                                                : null
                                            : (evidence.speakerRole ?? 'unknown')}
                                          {evidence.transcriptSpan
                                            ? ` · ${evidence.transcriptSpan}`
                                            : ''}
                                          {!studioV2 && evidence.sourceKind
                                            ? ` · ${evidence.sourceKind}`
                                            : ''}
                                        </div>
                                        {evidence.evidenceNote ? (
                                          <div className="workspace-muted">
                                            {evidence.evidenceNote}
                                          </div>
                                        ) : null}
                                      </div>
                                      {!studioV2 && (
                                        <span>{evidence.sourceArtifactId ?? 'n/a'}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="workspace-muted">No evidence excerpts provided.</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        ) : profileCandidatesError ? null : (
          <p className="workspace-muted">
            No {profileCandidateFilter} profile candidates visible for this student.
          </p>
        )
      ) : (
        <p className="workspace-muted">Select a student to inspect profile candidates.</p>
      )}
    </article>
  );
}
