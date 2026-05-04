import type { Dispatch, SetStateAction } from 'react';

import type { StudentProfileCandidate } from '../../utils/api';
import {
  type CandidateActionKind,
  formatCandidateSectionLabel,
  formatCandidateStateLabel,
  getApprovedCandidatesReadyForPromotion,
  groupVisibleCandidatesBySection,
  isSelectableForPromotion,
  type ProfileCandidateFilter,
} from './StudentWorkspace.logic';

export interface WorkspaceCandidatesPanelProps {
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

export function WorkspaceCandidatesPanel({
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
  onRefreshCandidates,
  onPromoteProfileCandidates,
  onReviewProfileCandidate,
}: WorkspaceCandidatesPanelProps) {
  const approvedCandidatesReadyForPromotion =
    getApprovedCandidatesReadyForPromotion(profileCandidates);
  const approvedCandidateIdsReadyForPromotion = new Set(
    approvedCandidatesReadyForPromotion.map((candidate) => candidate.id),
  );
  const selectedApprovedCandidateCount = selectedCandidateIds.filter((candidateId) =>
    approvedCandidateIdsReadyForPromotion.has(candidateId),
  ).length;
  const groupedProfileCandidates = groupVisibleCandidatesBySection(
    profileCandidates,
    profileCandidateFilter,
  );

  return (
    <article className={['workspace-card card', className].filter(Boolean).join(' ')}>
      <header>
        <h2>Profile Candidates</h2>
        <p>
          Review candidate profile facts here, then generate a draft revision and activate it
          through the normal profile revision controls.
        </p>
      </header>

      <div className="workspace-inline workspace-filter-row">
        <label className="workspace-field">
          Review bucket
          <select
            aria-label="Profile Candidate Review Bucket"
            value={profileCandidateFilter}
            onChange={(event) =>
              setProfileCandidateFilter(event.target.value as ProfileCandidateFilter)
            }
            disabled={!selectedStudentId}
          >
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </label>

        <button
          type="button"
          className="workspace-secondary-btn"
          onClick={() => void onRefreshCandidates()}
          disabled={!selectedStudentId || profileCandidatesLoading}
        >
          {profileCandidatesLoading ? 'Refreshing...' : 'Refresh Candidates'}
        </button>
      </div>

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

      {profileCandidatesError ? <p className="workspace-error">{profileCandidatesError}</p> : null}

      {selectedStudentId ? (
        profileCandidatesLoading && profileCandidates.length === 0 ? (
          <p className="workspace-muted">Loading profile candidates...</p>
        ) : groupedProfileCandidates.length > 0 ? (
          groupedProfileCandidates.map(([section, candidates]) => (
            <section key={section} className="workspace-candidate-group">
              <div className="workspace-inline workspace-header-row">
                <h3>{formatCandidateSectionLabel(section)}</h3>
                <span className="workspace-muted">
                  {candidates.length} candidate{candidates.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="workspace-list">
                {candidates.map((candidate) => {
                  const draft = profileCandidateDrafts[candidate.id];
                  const approvedFactText =
                    draft?.approvedFactText ?? candidate.approvedFactText ?? candidate.proposedFact;
                  const reviewerNote = draft?.reviewerNote ?? '';
                  const isBusy = profileCandidateAction?.candidateId === candidate.id;
                  const isTerminal =
                    candidate.status === 'promoted' || candidate.status === 'superseded';
                  const isSelected = selectedCandidateIds.includes(candidate.id);

                  return (
                    <details
                      key={candidate.id}
                      className="workspace-list-item workspace-candidate-item workspace-candidate-details"
                    >
                      <summary className="workspace-candidate-summary">
                        <div className="workspace-inline workspace-header-row">
                          <div>
                            <strong>{candidate.proposedFact}</strong>
                            <div className="workspace-muted">
                              {formatCandidateSectionLabel(candidate.targetSection)}
                            </div>
                          </div>
                          <div className="workspace-inline">
                            {isSelectableForPromotion(candidate) ? (
                              <label className="workspace-inline">
                                <input
                                  aria-label={`Select candidate ${candidate.id} for promotion`}
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
                            <span className="workspace-pill">
                              {formatCandidateStateLabel(candidate)}
                            </span>
                          </div>
                        </div>
                      </summary>

                      <div className="workspace-candidate-body">
                        <div className="workspace-meta">
                          <span>
                            <strong>Target section:</strong>{' '}
                            {formatCandidateSectionLabel(candidate.targetSection)}
                          </span>
                          <span>
                            <strong>Authority:</strong> {candidate.authority ?? 'n/a'}
                          </span>
                          <span>
                            <strong>Confidence:</strong> {candidate.confidence ?? 'n/a'}
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
                            <strong>Promoted revision:</strong>{' '}
                            {candidate.promotedRevisionId ?? 'not yet promoted'}
                          </span>
                        </div>

                        <div>
                          <strong>Original proposal</strong>
                          <p>{candidate.proposedFact}</p>
                        </div>

                        <label className="workspace-field">
                          Approved Fact Text
                          <textarea
                            aria-label={`Approved Fact Text ${candidate.id}`}
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
                          Reviewer Note
                          <textarea
                            aria-label={`Reviewer Note ${candidate.id}`}
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

                        <div>
                          <strong>Evidence</strong>
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
                                      {evidence.speakerRole ?? 'unknown'}
                                      {evidence.transcriptSpan
                                        ? ` · ${evidence.transcriptSpan}`
                                        : ''}
                                      {evidence.sourceKind ? ` · ${evidence.sourceKind}` : ''}
                                    </div>
                                    {evidence.evidenceNote ? (
                                      <div className="workspace-muted">{evidence.evidenceNote}</div>
                                    ) : null}
                                  </div>
                                  <span>{evidence.sourceArtifactId ?? 'n/a'}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="workspace-muted">No evidence excerpts provided.</p>
                          )}
                        </div>

                        <div className="workspace-inline">
                          <button
                            type="button"
                            className="workspace-primary-btn"
                            onClick={() => void onReviewProfileCandidate(candidate, 'approve')}
                            disabled={isTerminal || isBusy}
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
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
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
