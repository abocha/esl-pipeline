import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getProfileContent,
  getStudentMemoryOverview,
  getStudentTimeline,
  listProfileRevisions,
  listStudentProfileCandidates,
  type FoundationalProfile,
  type ProfileContentResponse,
  type ProfileRevisionSummaryResponse,
  type StudentMemoryOverviewResponse,
  type StudentProfileCandidate,
  type StudentTimelineItem,
} from '../../utils/api';
import { useStudentAreaContext } from './StudentAreaContext';

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
  return values.map((value) => value.trim()).filter(Boolean).slice(0, limit);
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
  const operationRows = ['one', 'two', 'three', 'four'];

  return (
    <section className="student-overview-page" aria-busy="true">
      <div className="student-overview-frame" data-testid="student-overview-pending-canvas">
        <span className="student-overview-sr-only" role="status">
          Loading student overview
        </span>
        <div className="student-overview-back">
          <Link to="/students">Back to all students</Link>
        </div>

        {errorMessage ? (
          <p className="student-overview-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="student-overview-hero student-overview-pending-hero" aria-hidden="true">
          <div className="student-overview-portrait student-overview-pending-portrait" />
          <div className="student-overview-pending-identity">
            <span className="student-overview-skeleton skeleton-kicker" />
            <span className="student-overview-skeleton skeleton-title" />
            <span className="student-overview-skeleton skeleton-copy skeleton-copy-wide" />
            <span className="student-overview-skeleton skeleton-copy" />
            <div className="student-overview-pending-status">
              <span className="student-overview-skeleton skeleton-dot" />
              <span className="student-overview-skeleton skeleton-copy skeleton-copy-status" />
            </div>
          </div>

          <aside className="student-overview-operations student-overview-pending-operations">
            <span className="student-overview-skeleton skeleton-kicker" />
            {operationRows.map((row) => (
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
          <div className="student-overview-panel student-overview-pending-panel pending-large">
            <span className="student-overview-skeleton skeleton-kicker" />
            <span className="student-overview-skeleton skeleton-copy skeleton-copy-wide" />
            <span className="student-overview-skeleton skeleton-copy" />
            <span className="student-overview-skeleton skeleton-copy skeleton-copy-short" />
          </div>
          <div className="student-overview-panel student-overview-pending-panel">
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
            <div className="student-overview-panel student-overview-pending-panel">
              <span className="student-overview-skeleton skeleton-kicker" />
              <span className="student-overview-skeleton skeleton-copy skeleton-copy-wide" />
              <span className="student-overview-skeleton skeleton-copy" />
              <span className="student-overview-skeleton skeleton-copy skeleton-copy-short" />
            </div>
          </div>
        </div>
      </div>

      <style>{studentOverviewStyles}</style>
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
      const profileId = student?.profileId?.trim() ?? '';
      const [profileResult, revisionsResult, memoryResult, candidatesResult, timelineResult] =
        await Promise.allSettled([
          profileId ? getProfileContent(profileId) : Promise.resolve(null),
          profileId ? listProfileRevisions(profileId, { limit: 8, offset: 0, order: 'desc' }) : Promise.resolve(null),
          getStudentMemoryOverview(studentId, { lessonLimit: 1, homeworkLimit: 1 }),
          listStudentProfileCandidates(studentId, {
            status: 'pending_review',
            limit: 12,
            offset: 0,
            order: 'desc',
          }),
          getStudentTimeline(studentId, { limit: 4, offset: 0, order: 'desc' }),
        ]);

      if (latestOverviewRequestRef.current !== requestId) {
        return;
      }

      setOverviewData({
        profile: profileResult.status === 'fulfilled' ? profileResult.value : null,
        revisions:
          revisionsResult.status === 'fulfilled' && revisionsResult.value
            ? revisionsResult.value.items
            : [],
        memory: memoryResult.status === 'fulfilled' ? memoryResult.value : null,
        pendingCandidates:
          candidatesResult.status === 'fulfilled' ? candidatesResult.value.items : [],
        timeline: timelineResult.status === 'fulfilled' ? timelineResult.value.items : [],
      });
      setLoadedOverviewKey(requestOverviewKey);

      const firstRejected = [
        profileResult,
        revisionsResult,
        memoryResult,
        candidatesResult,
        timelineResult,
      ].find((result) => result.status === 'rejected');
      setOverviewError(
        firstRejected?.status === 'rejected'
          ? firstRejected.reason instanceof Error
            ? firstRejected.reason.message
            : 'Some overview context could not be loaded.'
          : null,
      );
      setOverviewLoading(false);
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
    <section className="student-overview-page" aria-busy={shellLoading}>
      <div className="student-overview-frame">
        {studentError || overviewError ? (
          <p className="student-overview-error" role="alert">
            {studentError ?? overviewError}
          </p>
        ) : null}

        <div className="student-overview-control-row">
          <article className="student-overview-status-panel">
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

          <aside className="student-overview-operations" aria-label="Operations snapshot">
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
          <article className="student-overview-panel learner-snapshot">
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

          <article className="student-overview-panel current-focus">
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

            <article className="student-overview-panel recent-activity">
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

        <p className="student-overview-note">
          Small, regular steps create real progress.
        </p>
      </div>

      <style>{studentOverviewStyles}</style>
    </section>
  );
};

const studentOverviewStyles = `
  .student-overview-page {
    --overview-paper: #fbf7ee;
    --overview-paper-deep: #f4eadb;
    --overview-ink: #151412;
    --overview-muted: #6f665a;
    --overview-blue: #143f73;
    --overview-blue-soft: #e8eef7;
    --overview-sage: #315c3a;
    --overview-sage-soft: #edf4e7;
    --overview-amber: #91620c;
    --overview-amber-soft: #fff5dd;
    --overview-rose: #8f3f32;
    --overview-line: rgba(42, 36, 26, 0.13);
    color: var(--overview-ink);
  }

  .student-overview-frame {
    position: relative;
    display: grid;
    gap: 1.6rem;
    padding: clamp(1.25rem, 3vw, 2.4rem);
    overflow: hidden;
    border: 1px solid var(--overview-line);
    border-radius: 30px;
    background:
      radial-gradient(circle at 10% 0%, rgba(20, 63, 115, 0.07), transparent 34%),
      radial-gradient(circle at 88% 28%, rgba(49, 92, 58, 0.08), transparent 30%),
      linear-gradient(135deg, rgba(255, 252, 245, 0.98), rgba(247, 239, 226, 0.92));
    box-shadow: 0 18px 48px rgba(42, 36, 26, 0.08);
  }

  .student-overview-frame::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.34;
    background-image:
      linear-gradient(rgba(42, 36, 26, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(42, 36, 26, 0.025) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: linear-gradient(180deg, black, transparent 85%);
  }

  .student-overview-frame > * {
    position: relative;
  }

  .student-overview-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .student-overview-skeleton {
    display: block;
    min-width: 0;
    border-radius: 999px;
    background:
      linear-gradient(90deg, rgba(20, 63, 115, 0.045), rgba(49, 92, 58, 0.075), rgba(20, 63, 115, 0.045)),
      rgba(42, 36, 26, 0.055);
    background-size: 180% 100%;
    animation: overview-skeleton-breathe 1900ms ease-in-out infinite;
  }

  .student-overview-pending-portrait {
    opacity: 0.78;
  }

  .student-overview-pending-identity {
    display: grid;
    gap: 1rem;
    max-width: 36rem;
  }

  .skeleton-kicker {
    width: 8.5rem;
    height: 0.8rem;
  }

  .skeleton-title {
    width: min(100%, 24rem);
    height: clamp(3rem, 6vw, 6rem);
    border-radius: 26px;
  }

  .skeleton-heading {
    width: min(100%, 20rem);
    height: 2.55rem;
    border-radius: 18px;
  }

  .skeleton-copy {
    width: min(100%, 20rem);
    height: 0.92rem;
  }

  .skeleton-copy-wide {
    width: min(100%, 30rem);
  }

  .skeleton-copy-status {
    width: min(100%, 22rem);
  }

  .skeleton-copy-short {
    width: 12rem;
  }

  .skeleton-copy-tiny {
    width: 8rem;
    height: 0.72rem;
    margin-top: 0.45rem;
    opacity: 0.72;
  }

  .skeleton-dot,
  .skeleton-operation-icon {
    width: 3rem;
    height: 3rem;
    border-radius: 999px;
  }

  .student-overview-pending-status {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.85rem;
    align-items: center;
    width: min(100%, 32rem);
    padding: 1rem 1.15rem;
    border: 1px solid rgba(49, 92, 58, 0.1);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.38);
  }

  .student-overview-pending-operations {
    min-height: 19rem;
  }

  .student-overview-pending-operation-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 1rem;
    align-items: center;
    padding: 1rem 0;
    border-bottom: 1px solid var(--overview-line);
  }

  .student-overview-pending-panel {
    min-height: 12rem;
  }

  .student-overview-pending-panel.pending-large {
    min-height: 18rem;
  }

  .student-overview-pending-attention {
    min-height: 6.5rem;
    grid-template-columns: auto minmax(0, 1fr);
    background: rgba(255, 253, 248, 0.66);
  }

  .student-overview-back a,
  .student-overview-panel a,
  .student-overview-status,
  .student-overview-operation-row,
  .student-overview-attention {
    color: var(--overview-blue);
    text-decoration: none;
  }

  .student-overview-back a {
    font-weight: 650;
    font-size: 0.94rem;
  }

  .student-overview-hero {
    display: grid;
    gap: clamp(1.5rem, 4vw, 3rem);
    grid-template-columns: minmax(120px, 0.42fr) minmax(0, 0.84fr) minmax(280px, 0.72fr);
    align-items: start;
  }

  .student-overview-portrait {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    width: min(100%, 260px);
    margin-top: clamp(2.4rem, 4vw, 3.2rem);
    border-radius: 50%;
    justify-self: center;
    background:
      radial-gradient(circle at 36% 26%, rgba(255, 255, 255, 0.92), transparent 24%),
      linear-gradient(145deg, rgba(20, 63, 115, 0.18), rgba(49, 92, 58, 0.16)),
      var(--overview-paper-deep);
    border: 1px solid rgba(42, 36, 26, 0.1);
    box-shadow: inset 0 0 0 12px rgba(255, 255, 255, 0.32);
  }

  .student-overview-portrait span {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(2.3rem, 6vw, 5.8rem);
    color: rgba(20, 63, 115, 0.82);
    letter-spacing: 0.04em;
  }

  .student-overview-identity {
    display: grid;
    gap: 1rem;
    max-width: 36rem;
  }

  .student-overview-kicker,
  .student-overview-section-label {
    margin: 0;
    color: var(--overview-blue);
    font-size: 0.78rem;
    font-weight: 750;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .student-overview-identity h2 {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(3rem, 6vw, 6.2rem);
    font-weight: 500;
    line-height: 0.95;
    letter-spacing: -0.06em;
  }

  .student-overview-identity > p:not(.student-overview-kicker) {
    max-width: 30rem;
    margin: 0;
    color: #2c2923;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1.05rem, 2vw, 1.42rem);
    line-height: 1.45;
  }

  .student-overview-control-row {
    display: grid;
    gap: clamp(1rem, 3vw, 2rem);
    grid-template-columns: minmax(280px, 0.95fr) minmax(280px, 0.72fr);
    align-items: start;
    padding-bottom: 0.35rem;
  }

  .student-overview-status-panel {
    display: grid;
    gap: 1rem;
    min-height: 100%;
    padding-right: clamp(1rem, 3vw, 2.2rem);
    border-right: 1px solid var(--overview-line);
  }

  .student-overview-status-panel > p:not(.student-overview-section-label) {
    max-width: 36rem;
    margin: 0;
    color: #2c2923;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1.05rem, 2vw, 1.38rem);
    line-height: 1.48;
  }

  .student-overview-status {
    display: grid;
    grid-template-columns: auto minmax(0, auto);
    align-items: center;
    gap: 0.2rem 0.85rem;
    width: min(100%, 32rem);
    padding: 1rem 1.15rem;
    border: 1px solid rgba(49, 92, 58, 0.14);
    border-radius: 18px;
    background: var(--overview-sage-soft);
    transition: transform 160ms ease, box-shadow 160ms ease;
  }

  .student-overview-status:hover,
  .student-overview-operation-row:hover,
  .student-overview-attention:hover,
  .student-overview-panel a:hover {
    transform: translateY(-1px);
  }

  .student-overview-status-mark {
    grid-row: span 2;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 999px;
    background:
      linear-gradient(90deg, transparent 48%, currentColor 48% 54%, transparent 54%),
      linear-gradient(currentColor 0 0) center / 46% 2px no-repeat;
    color: var(--overview-sage);
    opacity: 0.72;
  }

  .student-overview-status strong,
  .student-overview-status span:last-child {
    min-width: 0;
  }

  .student-overview-status span:last-child {
    color: #344332;
  }

  .student-overview-status.status-attention {
    background: var(--overview-amber-soft);
    border-color: rgba(145, 98, 12, 0.18);
  }

  .student-overview-status.status-attention .student-overview-status-mark {
    color: var(--overview-amber);
  }

  .student-overview-status.status-quiet {
    background: var(--overview-blue-soft);
    border-color: rgba(20, 63, 115, 0.14);
  }

  .student-overview-status.status-quiet .student-overview-status-mark {
    color: var(--overview-blue);
  }

  .student-overview-operations {
    display: grid;
    gap: 0.35rem;
    padding-left: clamp(1rem, 3vw, 2.2rem);
    border-left: 1px solid var(--overview-line);
  }

  .student-overview-operation-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 1rem;
    align-items: center;
    padding: 1rem 0;
    border-bottom: 1px solid var(--overview-line);
    color: inherit;
    transition: transform 160ms ease, color 160ms ease;
  }

  .student-overview-operation-row:hover {
    color: var(--overview-blue);
  }

  .student-overview-operation-icon {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 999px;
    background: var(--overview-blue-soft);
    color: var(--overview-blue);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .student-overview-operation-row:nth-of-type(3) .student-overview-operation-icon {
    background: var(--overview-sage-soft);
    color: var(--overview-sage);
  }

  .student-overview-operation-row:nth-of-type(4) .student-overview-operation-icon {
    background: var(--overview-amber-soft);
    color: var(--overview-amber);
  }

  .student-overview-operation-row:nth-of-type(5) .student-overview-operation-icon {
    background: #f8e6df;
    color: var(--overview-rose);
  }

  .student-overview-operation-row strong,
  .student-overview-operation-row small {
    display: block;
  }

  .student-overview-operation-row strong {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.08rem;
    font-weight: 500;
  }

  .student-overview-operation-row small {
    margin-top: 0.15rem;
    color: var(--overview-muted);
    font-size: 0.96rem;
  }

  .student-overview-error {
    margin: 0;
    padding: 1rem 1.1rem;
    border: 1px solid rgba(143, 63, 50, 0.22);
    border-radius: 18px;
    background: rgba(255, 241, 238, 0.8);
    color: var(--overview-rose);
  }

  .student-overview-body {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(260px, 1.05fr) minmax(260px, 0.85fr) minmax(300px, 1fr);
    align-items: start;
  }

  .student-overview-panel,
  .student-overview-attention {
    border: 1px solid var(--overview-line);
    border-radius: 22px;
    background: rgba(255, 253, 248, 0.72);
    box-shadow: 0 14px 30px rgba(42, 36, 26, 0.05);
  }

  .student-overview-panel {
    display: grid;
    gap: 1.1rem;
    padding: 1.35rem;
  }

  .student-overview-panel header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
  }

  .student-overview-panel header a,
  .current-focus > a {
    width: fit-content;
    padding: 0.58rem 0.8rem;
    border: 1px solid rgba(20, 63, 115, 0.14);
    border-radius: 12px;
    background: var(--overview-blue-soft);
    color: var(--overview-blue);
    font-weight: 650;
    transition: transform 160ms ease, background-color 160ms ease;
  }

  .student-overview-profile-grid,
  .student-overview-signal-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .student-overview-profile-grid > div + div,
  .student-overview-signal-grid > div + div {
    padding-left: 1rem;
    border-left: 1px solid var(--overview-line);
  }

  .student-overview-profile-grid span,
  .student-overview-signal-grid span {
    display: block;
    margin-bottom: 0.35rem;
    color: var(--overview-muted);
    font-size: 0.86rem;
  }

  .student-overview-profile-grid strong {
    display: block;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 2.2rem;
    font-weight: 500;
    line-height: 1;
  }

  .student-overview-profile-grid p {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.05rem;
    line-height: 1.4;
  }

  .student-overview-signal-grid ul {
    display: grid;
    gap: 0.35rem;
    margin: 0;
    padding-left: 1rem;
  }

  .student-overview-signal-grid div:first-child span {
    color: var(--overview-sage);
  }

  .student-overview-signal-grid div:last-child span {
    color: var(--overview-rose);
  }

  .student-overview-meta,
  .student-overview-muted {
    margin: 0;
    color: var(--overview-muted);
    font-size: 0.94rem;
  }

  .current-focus h3 {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1.8rem, 3vw, 2.5rem);
    font-weight: 500;
    line-height: 1.12;
    letter-spacing: -0.035em;
  }

  .current-focus p {
    margin: 0;
    color: #3e382f;
    font-size: 1.02rem;
    line-height: 1.55;
  }

  .current-focus header span {
    color: var(--overview-sage);
    font-size: 0.86rem;
  }

  .student-overview-side-stack {
    display: grid;
    gap: 1rem;
  }

  .student-overview-attention {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 1rem;
    padding: 1.1rem 1.25rem;
    color: var(--overview-amber);
    background: linear-gradient(135deg, rgba(255, 248, 229, 0.96), rgba(255, 242, 207, 0.76));
    transition: transform 160ms ease, box-shadow 160ms ease;
  }

  .student-overview-attention > span:first-child {
    display: grid;
    place-items: center;
    width: 2.6rem;
    height: 2.6rem;
    border: 1px solid rgba(145, 98, 12, 0.32);
    border-radius: 999px;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.6rem;
  }

  .student-overview-attention strong,
  .student-overview-attention small {
    display: block;
  }

  .student-overview-attention strong {
    color: #4d3410;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.18rem;
    font-weight: 500;
  }

  .student-overview-attention small {
    margin-top: 0.2rem;
    color: #77551b;
    line-height: 1.45;
  }

  .student-overview-attention.attention-calm {
    color: var(--overview-sage);
    background: linear-gradient(135deg, rgba(240, 247, 236, 0.96), rgba(235, 244, 229, 0.78));
  }

  .student-overview-attention.attention-calm > span:first-child {
    border-color: rgba(49, 92, 58, 0.28);
  }

  .recent-activity ol {
    display: grid;
    gap: 0.9rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .recent-activity li {
    display: grid;
    grid-template-columns: 6.8rem minmax(0, 1fr);
    gap: 0.75rem;
    align-items: baseline;
  }

  .recent-activity time {
    color: var(--overview-muted);
    font-size: 0.86rem;
  }

  .recent-activity li span {
    min-width: 0;
  }

  .student-overview-note {
    justify-self: center;
    margin: 0.2rem 0 0;
    color: var(--overview-blue);
    font-family: Georgia, 'Times New Roman', serif;
    font-style: italic;
    font-size: clamp(1rem, 2vw, 1.25rem);
    letter-spacing: 0.03em;
  }

  @keyframes overview-skeleton-breathe {
    0%,
    100% {
      background-position: 0% 50%;
      opacity: 0.74;
    }
    50% {
      background-position: 100% 50%;
      opacity: 1;
    }
  }

  @media (max-width: 1120px) {
    .student-overview-hero,
    .student-overview-control-row,
    .student-overview-body {
      grid-template-columns: 1fr;
    }

    .student-overview-portrait {
      display: none;
    }

    .student-overview-operations {
      padding-left: 0;
      border-left: 0;
      border-top: 1px solid var(--overview-line);
      padding-top: 1rem;
    }

    .student-overview-status-panel {
      padding-right: 0;
      padding-bottom: 1rem;
      border-right: 0;
      border-bottom: 1px solid var(--overview-line);
    }
  }

  @media (max-width: 720px) {
    .student-overview-frame {
      border-radius: 22px;
      padding: 1rem;
    }

    .student-overview-identity h2 {
      font-size: clamp(2.6rem, 18vw, 4rem);
    }

    .student-overview-profile-grid,
    .student-overview-signal-grid {
      grid-template-columns: 1fr;
    }

    .student-overview-profile-grid > div + div,
    .student-overview-signal-grid > div + div {
      padding-left: 0;
      padding-top: 1rem;
      border-left: 0;
      border-top: 1px solid var(--overview-line);
    }

    .recent-activity li {
      grid-template-columns: 1fr;
      gap: 0.2rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .student-overview-skeleton,
    .student-overview-status,
    .student-overview-operation-row,
    .student-overview-attention,
    .student-overview-panel a {
      animation: none;
      transition: none;
    }
  }
`;
