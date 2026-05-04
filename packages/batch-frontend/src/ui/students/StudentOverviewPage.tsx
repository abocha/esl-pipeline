import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  type FoundationalProfile,
  getStudentOverviewSurface,
  type ProfileContentResponse,
  type ProfileRevisionSummaryResponse,
  type StudentMemoryOverviewResponse,
  type StudentProfileCandidate,
  type StudentTimelineItem,
} from '../../utils/api';
import { useStudentAreaContext } from './StudentAreaContext';
import './StudentOverviewPage.css';

interface OverviewData {
  profile: ProfileContentResponse | null;
  revisions: ProfileRevisionSummaryResponse[];
  memory: StudentMemoryOverviewResponse | null;
  pendingCandidates: StudentProfileCandidate[];
  timeline: StudentTimelineItem[];
}

const EMPTY_OVERVIEW_DATA: OverviewData = {
  profile: null,
  revisions: [],
  memory: null,
  pendingCandidates: [],
  timeline: [],
};

function createOverviewKey(studentId: string, profileId?: string | null): string {
  return `${studentId}:${profileId?.trim() ?? ''}`;
}

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatDate(value?: string | null): string {
  if (!value) return 'Not recorded yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded yet';
  return DATE_FORMATTER.format(date);
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Not recorded yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded yet';
  return DATE_TIME_FORMATTER.format(date);
}

function compactList(values: readonly string[], limit = 2): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const candidate = trimmed.slice(0, maxLength - 3);
  const lastSpaceIndex = candidate.lastIndexOf(' ');
  const truncated =
    lastSpaceIndex > Math.floor(maxLength * 0.55) ? candidate.slice(0, lastSpaceIndex) : candidate;
  return `${truncated.trimEnd()}...`;
}

function compactDisplayText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  const firstSentenceMatch = trimmed.match(/^(.+?[.!?])(?:\s|$)/);
  const firstSentence = firstSentenceMatch?.[1]?.trim();
  if (firstSentence && firstSentence.length >= 36 && firstSentence.length <= maxLength) {
    return firstSentence;
  }
  return truncateText(trimmed, maxLength);
}

function countProfileCoverage(profile: FoundationalProfile | null | undefined): number {
  if (!profile) return 0;

  return [
    profile.overallLevel,
    ...profile.primaryGoals,
    ...profile.communicationContexts,
    ...profile.interestsAndUsefulThemes,
    ...profile.stableStrengths,
    ...profile.persistentChallenges,
    ...profile.studyPreferences,
    ...profile.durableConstraints,
    profile.teacherNotes,
  ].filter((value) => value?.trim()).length;
}

function getStudentSummary(profile: FoundationalProfile | null | undefined): string {
  const goal = compactList(profile?.primaryGoals ?? [], 1)[0];
  const context = compactList(profile?.communicationContexts ?? [], 1)[0];
  if (goal) return compactDisplayText(goal, 145);
  if (context) return compactDisplayText(`Practicing English for ${context.toLowerCase()}.`, 130);
  return 'Learner context is ready to be shaped into a clearer teaching picture.';
}

function getProfileStatus(args: {
  profile: ProfileContentResponse | null;
  revisions: readonly ProfileRevisionSummaryResponse[];
  pendingCandidates: readonly StudentProfileCandidate[];
}): {
  label: string;
  detail: string;
  tone: 'good' | 'attention' | 'quiet';
} {
  if (!args.profile) {
    return {
      label: 'Needs first profile',
      detail: 'Create the canonical learner profile in Learning.',
      tone: 'attention',
    };
  }

  const draftCount = args.revisions.filter((revision) => revision.status === 'draft').length;
  if (draftCount > 0) {
    return {
      label: 'Draft waiting',
      detail: `${draftCount} profile draft${draftCount === 1 ? '' : 's'} ready for review.`,
      tone: 'attention',
    };
  }

  if (args.pendingCandidates.length > 0) {
    return {
      label: 'Profile has suggestions',
      detail: `${args.pendingCandidates.length} candidate fact${
        args.pendingCandidates.length === 1 ? '' : 's'
      } waiting.`,
      tone: 'attention',
    };
  }

  const coverage = countProfileCoverage(args.profile.structuredContent);
  if (coverage >= 5) {
    return {
      label: 'On track',
      detail: 'Keep building fluency and precision.',
      tone: 'good',
    };
  }

  return {
    label: 'Starter profile',
    detail: 'A few more durable details will strengthen lesson generation.',
    tone: 'quiet',
  };
}

function getCurrentFocus(memory: StudentMemoryOverviewResponse | null): {
  title: string;
  detail: string;
  badge: string;
} {
  const snapshot = memory?.latestReadyStudentMemorySnapshot;
  const assignmentDirection = snapshot?.recommendedAssignmentDirections[0];
  if (assignmentDirection) {
    return {
      title: assignmentDirection.direction,
      detail: assignmentDirection.rationale,
      badge: 'Memory-backed focus',
    };
  }

  const unresolvedIssue = snapshot?.unresolvedIssues[0] ?? memory?.unresolvedIssues[0];
  if (unresolvedIssue) {
    return {
      title: unresolvedIssue.label,
      detail: unresolvedIssue.note,
      badge: `${unresolvedIssue.priority} priority`,
    };
  }

  const progressSignal = snapshot?.recentProgress[0];
  if (progressSignal) {
    return {
      title: progressSignal.label,
      detail: progressSignal.note,
      badge: 'Recent progress',
    };
  }

  return {
    title: 'Choose the next teaching focus',
    detail: 'Memory summaries will appear here after lessons produce ready long-term signals.',
    badge: 'Waiting for memory',
  };
}

function getAttentionItem(args: {
  profile: ProfileContentResponse | null;
  revisions: readonly ProfileRevisionSummaryResponse[];
  pendingCandidates: readonly StudentProfileCandidate[];
  memory: StudentMemoryOverviewResponse | null;
}): { label: string; detail: string; target: 'learning' | 'history' | 'schedule-billing' } {
  if (!args.profile) {
    return {
      label: 'Profile needed',
      detail: 'Create the first learner profile before relying on generated lesson context.',
      target: 'learning',
    };
  }

  const draft = args.revisions.find((revision) => revision.status === 'draft');
  if (draft) {
    return {
      label: 'Profile draft waiting',
      detail: `${draft.versionLabel ?? 'Draft revision'} is ready for teacher review.`,
      target: 'learning',
    };
  }

  if (args.pendingCandidates.length > 0) {
    return {
      label: 'Learning facts need review',
      detail: `${args.pendingCandidates.length} candidate profile update${
        args.pendingCandidates.length === 1 ? '' : 's'
      } waiting.`,
      target: 'learning',
    };
  }

  if (!args.memory?.latestReadyStudentMemorySnapshot) {
    return {
      label: 'Memory snapshot pending',
      detail: 'Recent lesson memory will make this overview more useful after the next rollup.',
      target: 'history',
    };
  }

  return {
    label: 'No urgent review',
    detail: 'Learning context is calm. Use the next lesson to keep the signal fresh.',
    target: 'learning',
  };
}

function getActivityLabel(item: StudentTimelineItem): string {
  if (item.displayName.trim()) return item.displayName;
  return item.type.replaceAll('_', ' ');
}

function StudentOverviewPendingCanvas({
  errorMessage,
}: {
  errorMessage: string | null;
}): React.JSX.Element {
  return (
    <section className="student-overview-page student-area-theme" aria-busy="true">
      <div
        className="student-area-frame student-overview-frame"
        data-testid="student-overview-pending-canvas"
      >
        <span className="student-overview-sr-only" role="status">
          Loading student overview
        </span>

        {errorMessage ? (
          <p className="student-overview-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="student-overview-control-row" aria-hidden="true">
          <div className="student-overview-status-panel">
            <span className="student-overview-skeleton skeleton-kicker" />
            <span className="student-overview-skeleton skeleton-copy skeleton-copy-wide" />
            <span className="student-overview-skeleton skeleton-copy" />
            <div className="student-overview-pending-status">
              <span className="student-overview-skeleton skeleton-dot" />
              <span className="student-overview-skeleton skeleton-copy skeleton-copy-status" />
            </div>
          </div>

          <aside className="student-overview-operations student-overview-pending-operations">
            <span className="student-overview-skeleton skeleton-kicker" />
            {['one', 'two', 'three', 'four'].map((row) => (
              <div key={row} className="student-overview-pending-operation-row">
                <span className="student-overview-skeleton skeleton-operation-icon" />
                <span>
                  <span className="student-overview-skeleton skeleton-copy skeleton-copy-short" />
                  <span className="student-overview-skeleton skeleton-copy skeleton-copy-tiny" />
                </span>
              </div>
            ))}
          </aside>
        </div>

        <div className="student-overview-body student-overview-pending-body" aria-hidden="true">
          <div className="student-area-panel student-overview-panel student-overview-pending-panel pending-large">
            <span className="student-overview-skeleton skeleton-kicker" />
            <span className="student-overview-skeleton skeleton-copy skeleton-copy-wide" />
            <span className="student-overview-skeleton skeleton-copy" />
            <span className="student-overview-skeleton skeleton-copy skeleton-copy-short" />
          </div>
          <div className="student-area-panel student-overview-panel student-overview-pending-panel">
            <span className="student-overview-skeleton skeleton-kicker" />
            <span className="student-overview-skeleton skeleton-heading" />
            <span className="student-overview-skeleton skeleton-copy skeleton-copy-wide" />
            <span className="student-overview-skeleton skeleton-copy" />
          </div>
          <div className="student-overview-side-stack">
            <div className="student-overview-attention student-overview-pending-attention">
              <span className="student-overview-skeleton skeleton-dot" />
              <span className="student-overview-skeleton skeleton-copy skeleton-copy-wide" />
            </div>
            <div className="student-area-panel student-overview-panel student-overview-pending-panel">
              <span className="student-overview-skeleton skeleton-kicker" />
              <span className="student-overview-skeleton skeleton-copy skeleton-copy-wide" />
              <span className="student-overview-skeleton skeleton-copy" />
              <span className="student-overview-skeleton skeleton-copy skeleton-copy-short" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export const StudentOverviewPage: React.FC = () => {
  const { student, studentId, studentLoading, studentError } = useStudentAreaContext();
  const [overviewData, setOverviewData] = useState<OverviewData>(EMPTY_OVERVIEW_DATA);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadedOverviewKey, setLoadedOverviewKey] = useState<string | null>(null);
  const latestOverviewRequestRef = useRef(0);
  const currentOverviewKey = createOverviewKey(studentId, student?.profileId);

  useEffect(() => {
    const requestId = latestOverviewRequestRef.current + 1;
    latestOverviewRequestRef.current = requestId;

    if (studentLoading) {
      setOverviewLoading(true);
      setOverviewError(null);
      return undefined;
    }

    if (!studentId) {
      setOverviewData(EMPTY_OVERVIEW_DATA);
      setOverviewLoading(false);
      setOverviewError('Student ID is required.');
      setLoadedOverviewKey(null);
      return undefined;
    }

    const requestOverviewKey = createOverviewKey(studentId, student?.profileId);
    setOverviewLoading(true);
    setOverviewError(null);

    const loadOverview = async () => {
      try {
        const surface = await getStudentOverviewSurface(studentId);

        if (latestOverviewRequestRef.current !== requestId) {
          return;
        }

        setOverviewData({
          profile: surface.profile,
          revisions: surface.revisions.items,
          memory: surface.memory,
          pendingCandidates: surface.pendingCandidates.items,
          timeline: surface.recentTimeline.items,
        });
        setLoadedOverviewKey(requestOverviewKey);
        setOverviewError(null);
      } catch (error: unknown) {
        if (latestOverviewRequestRef.current !== requestId) {
          return;
        }
        setOverviewData(EMPTY_OVERVIEW_DATA);
        setLoadedOverviewKey(requestOverviewKey);
        setOverviewError(
          error instanceof Error ? error.message : 'Some overview context could not be loaded.',
        );
      } finally {
        if (latestOverviewRequestRef.current === requestId) {
          setOverviewLoading(false);
        }
      }
    };

    void loadOverview();

    return () => {
      latestOverviewRequestRef.current += 1;
    };
  }, [student?.profileId, studentId, studentLoading]);

  const overviewReady = loadedOverviewKey === currentOverviewKey && !overviewLoading;
  const shellLoading = studentLoading || !overviewReady;
  const studentAreaPath = (section: 'learning' | 'history' | 'schedule-billing'): string =>
    `/students/${encodeURIComponent(studentId)}/${section}`;

  if (!overviewReady) {
    return <StudentOverviewPendingCanvas errorMessage={studentError} />;
  }

  const renderedOverviewData = overviewData;
  const profile = renderedOverviewData.profile?.structuredContent ?? null;
  const profileStatus = getProfileStatus({
    profile: renderedOverviewData.profile,
    revisions: renderedOverviewData.revisions,
    pendingCandidates: renderedOverviewData.pendingCandidates,
  });
  const currentFocus = getCurrentFocus(renderedOverviewData.memory);
  const attentionItem = getAttentionItem({
    profile: renderedOverviewData.profile,
    revisions: renderedOverviewData.revisions,
    pendingCandidates: renderedOverviewData.pendingCandidates,
    memory: renderedOverviewData.memory,
  });
  const goals = compactList(profile?.primaryGoals ?? [], 1);
  const contexts = compactList(profile?.communicationContexts ?? [], 1);
  const strengths = compactList(profile?.stableStrengths ?? [], 2);
  const challenges = compactList(profile?.persistentChallenges ?? [], 2);
  const profileUpdatedAt = formatDate(renderedOverviewData.profile?.updatedAt);

  return (
    <section className="student-overview-page student-area-theme" aria-busy={shellLoading}>
      <div className="student-area-frame student-overview-frame">
        {studentError || overviewError ? (
          <p className="student-overview-error" role="alert">
            {studentError ?? overviewError}
          </p>
        ) : null}

        <div className="student-overview-control-row">
          <article
            className="student-overview-status-panel"
            role="region"
            aria-label="Learning State"
          >
            <p className="student-overview-section-label">Learning State</p>
            <p>{getStudentSummary(profile)}</p>
            <Link
              className={`student-overview-status status-${profileStatus.tone}`}
              to={studentAreaPath('learning')}
            >
              <span className="student-overview-status-mark" aria-hidden="true" />
              <strong>{profileStatus.label}</strong>
              <span>{profileStatus.detail}</span>
            </Link>
          </article>

          <aside className="student-overview-operations" role="region" aria-label="Operations">
            <p className="student-overview-section-label">Operations</p>
            <Link
              to={studentAreaPath('schedule-billing')}
              className="student-overview-operation-row"
            >
              <span className="student-overview-operation-icon">Cal</span>
              <span>
                <strong>Next lesson</strong>
                <small>Not scheduled yet</small>
              </span>
            </Link>
            <Link
              to={studentAreaPath('schedule-billing')}
              className="student-overview-operation-row"
            >
              <span className="student-overview-operation-icon">Cr</span>
              <span>
                <strong>Lesson credits</strong>
                <small>Not configured yet</small>
              </span>
            </Link>
            <Link
              to={studentAreaPath('schedule-billing')}
              className="student-overview-operation-row"
            >
              <span className="student-overview-operation-icon">Msg</span>
              <span>
                <strong>Reminders</strong>
                <small>Telegram and email pending</small>
              </span>
            </Link>
            <Link
              to={studentAreaPath('schedule-billing')}
              className="student-overview-operation-row"
            >
              <span className="student-overview-operation-icon">Inv</span>
              <span>
                <strong>Latest invoice</strong>
                <small>Not tracked yet</small>
              </span>
            </Link>
          </aside>
        </div>

        <div className="student-overview-body">
          <article
            className="student-area-panel student-overview-panel learner-snapshot"
            role="region"
            aria-label="Learner Snapshot"
          >
            <header>
              <p className="student-overview-section-label">Learner Snapshot</p>
              <Link to={studentAreaPath('learning')}>View full profile</Link>
            </header>
            <div className="student-overview-profile-grid">
              <div>
                <span>Level</span>
                <strong>{profile?.overallLevel ?? 'Not set'}</strong>
              </div>
              <div>
                <span>Main goal</span>
                <p>
                  {goals[0]
                    ? compactDisplayText(goals[0], 92)
                    : contexts[0]
                      ? compactDisplayText(contexts[0], 92)
                      : 'Add the durable learning goal in Learning.'}
                </p>
              </div>
            </div>
            <div className="student-overview-signal-grid">
              <div>
                <span>Strengths</span>
                <ul>
                  {(strengths.length > 0 ? strengths : ['Add stable strengths']).map((item) => (
                    <li key={item}>{truncateText(item, 88)}</li>
                  ))}
                </ul>
              </div>
              <div>
                <span>Challenges</span>
                <ul>
                  {(challenges.length > 0 ? challenges : ['Add persistent challenges']).map(
                    (item) => (
                      <li key={item}>{truncateText(item, 88)}</li>
                    ),
                  )}
                </ul>
              </div>
            </div>
            <p className="student-overview-meta">Profile updated {profileUpdatedAt}</p>
          </article>

          <article
            className="student-area-panel student-overview-panel current-focus"
            role="region"
            aria-label="Current Focus"
          >
            <header>
              <p className="student-overview-section-label">Current Focus</p>
              <span>{currentFocus.badge}</span>
            </header>
            <h3>{currentFocus.title}</h3>
            <p>{currentFocus.detail}</p>
            <Link to={studentAreaPath('learning')}>Open Learning</Link>
          </article>

          <aside className="student-overview-side-stack">
            <Link
              to={studentAreaPath(attentionItem.target)}
              className={`student-overview-attention ${
                attentionItem.label === 'No urgent review' ? 'attention-calm' : ''
              }`}
            >
              <span aria-hidden="true">!</span>
              <span>
                <strong>{attentionItem.label}</strong>
                <small>{attentionItem.detail}</small>
              </span>
            </Link>

            <article
              className="student-area-panel student-overview-panel recent-activity"
              role="region"
              aria-label="Recent Activity"
            >
              <header>
                <p className="student-overview-section-label">Recent Activity</p>
                <Link to={studentAreaPath('history')}>View history</Link>
              </header>
              {renderedOverviewData.timeline.length > 0 ? (
                <ol>
                  {renderedOverviewData.timeline.slice(0, 3).map((item) => (
                    <li key={`${item.type}-${item.createdAt}-${item.displayName}`}>
                      <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                      <span>{getActivityLabel(item)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="student-overview-muted">
                  Lesson and profile events will collect here as this student works through the new
                  flow.
                </p>
              )}
            </article>
          </aside>
        </div>

        <p className="student-overview-note">Small, regular steps create real progress.</p>
      </div>
    </section>
  );
};
