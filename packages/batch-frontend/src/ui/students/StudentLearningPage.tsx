import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ProfileContentResponse,
  ProfileRevisionDetailResponse,
  ProfileRevisionSummaryResponse,
  StudentMemoryHealthResponse,
  StudentMemoryOverviewResponse,
  StudentMemoryStatusCount,
  StudentProfileCandidate,
} from '../../utils/api';
import {
  activateProfileRevision,
  approveStudentProfileCandidate,
  deferStudentProfileCandidate,
  getProfileContent,
  getProfileRevision,
  getStudentLearningSurface,
  getStudentMemoryHealth,
  getStudentMemoryOverview,
  initializeStudentProfileDraft,
  listProfileRevisions,
  listStudentProfileCandidates,
  refreshProfileDraftFromApprovedCandidates,
  rejectStudentProfileCandidate,
  restoreProfileRevision,
  saveProfileDraftRevision,
  upsertProfileContent,
} from '../../utils/api';
import { ProfileCandidatesPanel } from './ProfileCandidatesPanel';
import { useStudentAreaContext } from './StudentAreaContext';
import {
  buildProfileDraftDiff,
  type CandidateActionKind,
  type FoundationalProfileFormState,
  foundationalProfileFormToStructuredContent,
  foundationalProfileToFormState,
  getApprovedCandidatesReadyForPromotion,
  INITIAL_FOUNDATIONAL_PROFILE_FORM,
  isSelectableForPromotion,
  PROFILE_CANDIDATE_PENDING_FILTER,
  type ProfileCandidateFilter,
  type ProfileDraftDiffItem,
} from './StudentProfileUi.logic';
import { formatStudentShortId } from './studentIdentity';
import './StudentLearningPage.css';

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type ProfileFieldKey = keyof FoundationalProfileFormState;

interface LearningFieldConfig {
  key: ProfileFieldKey;
  label: string;
  placeholder: string;
  help: string;
  kind?: 'input' | 'textarea';
  rows?: number;
  span?: 'full';
}

interface LearningSectionConfig {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  fields: readonly LearningFieldConfig[];
}

const PROFILE_SECTION_CONFIGS: readonly LearningSectionConfig[] = [
  {
    id: 'goals',
    eyebrow: 'Goals & Motivation',
    title: 'Level & Durable Goals',
    description:
      'Capture the learner’s current level and the outcomes that should still matter next month.',
    fields: [
      {
        key: 'overallLevel',
        label: 'Current Level',
        placeholder: 'A2, B1, Low B2…',
        help: 'Use the most useful working label, not a perfect exam diagnosis.',
        kind: 'input',
      },
      {
        key: 'primaryGoals',
        label: 'Primary Goals',
        placeholder: 'Lead standups clearly\nHandle travel conversations with confidence…',
        help: 'One durable goal per line.',
        rows: 4,
        span: 'full',
      },
    ],
  },
  {
    id: 'contexts',
    eyebrow: 'Communication Contexts',
    title: 'Contexts & Useful Themes',
    description:
      'Focus on the real settings where English matters and the themes that make practice feel relevant.',
    fields: [
      {
        key: 'communicationContexts',
        label: 'Communication Contexts',
        placeholder: 'Client calls\nTeam updates\nCoffee-shop hospitality…',
        help: 'Keep this to durable contexts rather than one-off lesson topics.',
        rows: 5,
      },
      {
        key: 'interestsAndUsefulThemes',
        label: 'Interests & Useful Themes',
        placeholder: 'Photography\nTravel\nProduct work…',
        help: 'Use this for engagement and personalization, not for random trivia.',
        rows: 5,
      },
    ],
  },
  {
    id: 'strengths',
    eyebrow: 'Strengths & Challenges',
    title: 'What To Lean On & What To Watch',
    description:
      'Balance stable strengths with recurring issues so lessons stay calibrated rather than purely remedial.',
    fields: [
      {
        key: 'stableStrengths',
        label: 'Stable Strengths',
        placeholder: 'High motivation\nFast comprehension\nGood self-correction…',
        help: 'Keep only the patterns you expect to remain useful over time.',
        rows: 5,
      },
      {
        key: 'persistentChallenges',
        label: 'Persistent Challenges',
        placeholder: 'Article usage\nSpoken transitions\nLow confidence under pressure…',
        help: 'Prefer durable patterns over temporary lesson-specific corrections.',
        rows: 5,
      },
    ],
  },
  {
    id: 'preferences',
    eyebrow: 'Study Preferences & Constraints',
    title: 'How This Learner Works Best',
    description:
      'Store the preferences and constraints that should keep shaping homework format and task difficulty.',
    fields: [
      {
        key: 'studyPreferences',
        label: 'Study Preferences',
        placeholder: 'Short practical review loops\nLikes explicit correction…',
        help: 'Mention habits, correction style, and assignment preferences.',
        rows: 5,
      },
      {
        key: 'durableConstraints',
        label: 'Durable Constraints',
        placeholder: 'Limited evening time\nMostly mobile device use…',
        help: 'Include time, device, confidence, or context constraints that recur.',
        rows: 5,
      },
    ],
  },
  {
    id: 'notes',
    eyebrow: 'Teacher Notes',
    title: 'Durable Teacher Context',
    description:
      'Reserve this for pedagogical context that is worth preserving but does not fit the structured lists above.',
    fields: [
      {
        key: 'teacherNotes',
        label: 'Teacher Notes',
        placeholder: 'Keep balancing confidence with systematic repair…',
        help: 'Avoid recent-lesson clutter here. This should still matter in future revisions.',
        rows: 5,
        span: 'full',
      },
    ],
  },
] as const;

interface LearningMetricCardProps {
  eyebrow: string;
  value: string;
  detail: string;
  tone?: 'default' | 'success' | 'accent';
}

interface LearningFieldProps {
  config: LearningFieldConfig;
  value: string;
  onChange: (key: ProfileFieldKey, value: string) => void;
}

interface LearningSectionCardProps {
  config: LearningSectionConfig;
  values: FoundationalProfileFormState;
  onChange: (key: ProfileFieldKey, value: string) => void;
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return DATE_TIME_FORMATTER.format(date);
}

function getLegacyProfileNotice(profile: {
  content?: string | null;
  structuredContent?: ProfileContentResponse['structuredContent'];
}): string | null {
  if (profile.structuredContent) return null;
  return profile.content?.trim()
    ? 'This revision is still markdown-only. Saving a draft here will create the structured learner profile.'
    : null;
}

function getProfileSnapshot(form: FoundationalProfileFormState): string {
  return JSON.stringify(foundationalProfileFormToStructuredContent(form));
}

function buildRevisionDetailFromProfile(
  profileStudentId: string,
  profile: ProfileContentResponse,
  summary?: ProfileRevisionSummaryResponse | null,
): ProfileRevisionDetailResponse | null {
  if (!profile.currentRevisionId) return null;
  return {
    id: profile.currentRevisionId,
    studentId: profileStudentId,
    contentHash: summary?.contentHash ?? '',
    source: summary?.source ?? 'update',
    status: summary?.status ?? 'active',
    versionNumber: summary?.versionNumber,
    versionLabel: summary?.versionLabel,
    activatedAt: summary?.activatedAt ?? profile.updatedAt ?? null,
    deprecatedAt: summary?.deprecatedAt ?? null,
    createdAt: summary?.createdAt ?? profile.updatedAt ?? new Date().toISOString(),
    createdBy: summary?.createdBy ?? null,
    restoredFromRevisionId: summary?.restoredFromRevisionId ?? null,
    content: profile.content,
    structuredContent: profile.structuredContent,
  };
}

function findCurrentProfileRevisionSummary(
  profile: ProfileContentResponse,
  revisions: readonly ProfileRevisionSummaryResponse[],
): ProfileRevisionSummaryResponse | null {
  if (profile.currentRevisionId?.trim()) {
    const matchingRevision = revisions.find(
      (revision) => revision.id === profile.currentRevisionId,
    );
    if (matchingRevision) return matchingRevision;
  }
  return revisions.find((revision) => revision.status === 'active') ?? null;
}

function formatHealthValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'not available';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function formatMemoryStatusCount(statusCount: StudentMemoryStatusCount): string {
  return statusCount.capped ? `${statusCount.count}+` : String(statusCount.count);
}

function formatCandidateRefresh(refresh: Record<string, unknown> | null): string {
  if (!refresh) return 'not recorded';
  const requested = refresh.requested === true ? 'requested' : 'not requested';
  const factCount =
    typeof refresh.triggerProfileWorthyStudentFactCount === 'number'
      ? refresh.triggerProfileWorthyStudentFactCount
      : 0;
  const skipped =
    typeof refresh.skippedNoProfileWorthyDeltaCount === 'number'
      ? refresh.skippedNoProfileWorthyDeltaCount
      : 0;
  return `${requested}; profile-worthy facts ${factCount}; skipped no-delta ${skipped}`;
}

function formatBudgetDecision(decision: Record<string, unknown> | null): string {
  if (!decision) return 'not recorded';
  return formatHealthValue(decision.action as string | undefined);
}

function MemoryHealthDetails({
  health,
  readySnapshot,
  open,
  onToggle,
}: {
  health: StudentMemoryHealthResponse | null;
  readySnapshot: StudentMemoryOverviewResponse['latestReadyStudentMemorySnapshot'];
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const snapshot = health?.latestSnapshot ?? null;
  return (
    <section className="student-learning-memory-support">
      <button
        type="button"
        className="workspace-secondary-btn student-learning-memory-support-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        Memory support details
      </button>
      {open ? (
        <div className="student-learning-memory-support-body">
          {readySnapshot ? (
            <section>
              <h3>Selected ready snapshot</h3>
              <p>{readySnapshot.id}</p>
              <p>
                Referenced sources: {readySnapshot.lessonMemoryEntryIds.length} lesson /{' '}
                {readySnapshot.homeworkMemoryEntryIds.length} homework
              </p>
            </section>
          ) : null}
          {health ? (
            <div className="student-learning-memory-support-grid">
              <section>
                <h3>Latest Snapshot</h3>
                <p>Availability: {health.availability?.state ?? 'not reported'}</p>
                {snapshot ? (
                  <dl>
                    <dt>Stored status</dt>
                    <dd>{snapshot.status}</dd>
                    <dt>Strategy</dt>
                    <dd>{formatHealthValue(snapshot.strategy)}</dd>
                    <dt>Trigger</dt>
                    <dd>{formatHealthValue(snapshot.trigger)}</dd>
                    <dt>Parent snapshot</dt>
                    <dd>{formatHealthValue(snapshot.parentSnapshotId)}</dd>
                    <dt>Input tokens</dt>
                    <dd>{formatHealthValue(snapshot.inputTokenEstimate)}</dd>
                    <dt>Prompt bytes</dt>
                    <dd>{formatHealthValue(snapshot.promptByteLength)}</dd>
                    <dt>Included sources</dt>
                    <dd>
                      {formatHealthValue(snapshot.includedLessonMemoryCount)} lesson /{' '}
                      {formatHealthValue(snapshot.includedHomeworkMemoryCount)} homework
                    </dd>
                    <dt>Covered sources</dt>
                    <dd>
                      {formatHealthValue(snapshot.coveredLessonMemoryCount)} lesson /{' '}
                      {formatHealthValue(snapshot.coveredHomeworkMemoryCount)} homework
                    </dd>
                    <dt>Content hash</dt>
                    <dd>{formatHealthValue(snapshot.contentHash)}</dd>
                    <dt>Material change</dt>
                    <dd>{formatHealthValue(snapshot.materialChange)}</dd>
                    <dt>Budget decision</dt>
                    <dd>{formatBudgetDecision(snapshot.budgetDecision)}</dd>
                    <dt>Candidate refresh</dt>
                    <dd>{formatCandidateRefresh(snapshot.candidateRefresh)}</dd>
                  </dl>
                ) : (
                  <p className="workspace-muted">No snapshot has been recorded yet.</p>
                )}
              </section>

              <section>
                <h3>Memory Entries</h3>
                <dl>
                  <dt>Lesson memory</dt>
                  <dd>
                    ready {formatMemoryStatusCount(health.memoryCounts.lesson.ready)}; pending{' '}
                    {formatMemoryStatusCount(health.memoryCounts.lesson.pending)}; failed{' '}
                    {formatMemoryStatusCount(health.memoryCounts.lesson.failed)}
                  </dd>
                  <dt>Homework memory</dt>
                  <dd>
                    ready {formatMemoryStatusCount(health.memoryCounts.homework.ready)}; pending{' '}
                    {formatMemoryStatusCount(health.memoryCounts.homework.pending)}; failed{' '}
                    {formatMemoryStatusCount(health.memoryCounts.homework.failed)}
                  </dd>
                  <dt>Latest failed reason</dt>
                  <dd>
                    {health.latestFailedReason
                      ? `${health.latestFailedReason.source}: ${health.latestFailedReason.message}`
                      : 'none recorded'}
                  </dd>
                </dl>
              </section>

              <section>
                <h3>Profile Candidates</h3>
                <dl>
                  <dt>Pending</dt>
                  <dd>{health.profileCandidateCounts.pending}</dd>
                  <dt>Approved</dt>
                  <dd>{health.profileCandidateCounts.approved}</dd>
                  <dt>Rejected</dt>
                  <dd>{health.profileCandidateCounts.rejected}</dd>
                  <dt>Deferred</dt>
                  <dd>{health.profileCandidateCounts.deferred}</dd>
                </dl>
              </section>
            </div>
          ) : (
            <p className="workspace-muted">Memory support details unavailable.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function LearningMetricCard({
  eyebrow,
  value,
  detail,
  tone = 'default',
}: LearningMetricCardProps): React.JSX.Element {
  return (
    <article
      className={`student-area-metric-card student-learning-metric student-learning-metric-${tone}`}
    >
      <span className="student-area-section-label student-learning-card-eyebrow">{eyebrow}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function LearningField({ config, value, onChange }: LearningFieldProps): React.JSX.Element {
  const inputId = `learning-${config.key}`;
  const fieldClassName =
    config.span === 'full'
      ? 'student-learning-field student-learning-field-full'
      : 'student-learning-field';

  return (
    <div className={fieldClassName}>
      <label htmlFor={inputId}>{config.label}</label>
      {config.kind === 'input' ? (
        <input
          id={inputId}
          name={config.key}
          type="text"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(config.key, event.target.value)}
          placeholder={config.placeholder}
        />
      ) : (
        <textarea
          id={inputId}
          name={config.key}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(config.key, event.target.value)}
          rows={config.rows ?? 4}
          placeholder={config.placeholder}
        />
      )}
    </div>
  );
}

function LearningSectionCard({
  config,
  values,
  onChange,
}: LearningSectionCardProps): React.JSX.Element {
  return (
    <section className="student-learning-section-card">
      <header className="student-learning-section-header">
        <span className="student-learning-card-eyebrow">{config.eyebrow}</span>
        <h3>{config.title}</h3>
        <p>{config.description}</p>
      </header>
      <div className="student-learning-section-fields">
        {config.fields.map((field) => (
          <LearningField
            key={field.key}
            config={field}
            value={values[field.key]}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
}

function ProfileDraftDiffPanel({ items }: { items: ProfileDraftDiffItem[] }): React.JSX.Element {
  const changeCountLabel = `${items.length} ${items.length === 1 ? 'field' : 'fields'} changed`;

  return (
    <article className="student-area-panel workspace-card student-learning-draft-diff">
      <header className="student-learning-draft-diff-header">
        <div>
          <span className="student-learning-card-eyebrow">Draft Review</span>
          <h3>Profile Draft Changes</h3>
        </div>
        <div className="student-learning-draft-diff-summary" aria-label={changeCountLabel}>
          <span>{changeCountLabel}</span>
          <strong>Review before activating or edit below</strong>
        </div>
      </header>
      {items.length > 0 ? (
        <div className="student-learning-draft-diff-list">
          <div className="student-learning-draft-diff-table-header">
            <span aria-hidden="true" />
            <span>Current active profile</span>
            <span>Proposed draft</span>
          </div>
          {items.map((item) => (
            <article
              key={item.key}
              className={`student-learning-draft-diff-item student-learning-draft-diff-item-${item.changeType}`}
            >
              <div className="student-learning-draft-diff-item-header">
                <strong>{item.label}</strong>
                <span
                  className={`student-learning-draft-diff-pill student-learning-draft-diff-pill-${item.changeType}`}
                >
                  {formatDraftDiffChangeType(item.changeType)}
                </span>
              </div>
              <div className="student-learning-draft-diff-values">
                <div
                  className="student-learning-draft-diff-value"
                  aria-label="Current active profile"
                >
                  <DraftDiffValueLines
                    lines={item.beforeLines}
                    empty={!item.before}
                    emptyLabel="empty"
                  />
                </div>
                <div className="student-learning-draft-diff-value" aria-label="Proposed draft">
                  <DraftDiffValueLines
                    lines={item.afterLines}
                    empty={!item.after}
                    emptyLabel="empty"
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="workspace-muted">No structured field changes detected.</p>
      )}
    </article>
  );
}

function DraftDiffValueLines({
  lines,
  empty,
  emptyLabel,
}: {
  lines: ProfileDraftDiffItem['beforeLines'];
  empty: boolean;
  emptyLabel: string;
}): React.JSX.Element {
  if (empty) {
    return <p className="student-learning-draft-diff-empty">{emptyLabel}</p>;
  }

  return (
    <p>
      {lines.map((line, index) => (
        <span
          key={`${line.text}-${index}`}
          className={`student-learning-draft-diff-line student-learning-draft-diff-line-${line.changeType}`}
        >
          {line.text}
        </span>
      ))}
    </p>
  );
}

function formatDraftDiffChangeType(changeType: ProfileDraftDiffItem['changeType']): string {
  if (changeType === 'added') return 'Added';
  if (changeType === 'removed') return 'Removed';
  return 'Changed';
}

function describeCandidateOmissions(omissions: Array<{ reason: string }>): string {
  const reasons: Record<string, string> = {
    empty_approved_fact: 'Approved wording was empty.',
    provider_omitted: 'The candidate was omitted from the proposed patch.',
    fact_not_represented: 'Approved wording is absent or changed in its target field.',
    not_approved: 'The candidate is no longer approved.',
    promoted_elsewhere: 'The candidate was already promoted in another revision.',
    revision_changed: 'The active revision changed before promotion could be verified.',
  };
  return [
    ...new Set(
      omissions.map(({ reason }) => reasons[reason] ?? 'Application could not be verified.'),
    ),
  ]
    .map((reason) => ` ${reason}`)
    .join('');
}

export const StudentLearningPage: React.FC = () => {
  const { student, studentId, studentLoading, studentError, refreshStudent } =
    useStudentAreaContext();
  const latestPageLoadRequestRef = useRef(0);
  const profileStudentId = studentId;

  const [profileForm, setProfileForm] = useState<FoundationalProfileFormState>(
    INITIAL_FOUNDATIONAL_PROFILE_FORM,
  );
  const [loadedProfileForm, setLoadedProfileForm] = useState<FoundationalProfileFormState>(
    INITIAL_FOUNDATIONAL_PROFILE_FORM,
  );
  const [profileDraftDiffBase, setProfileDraftDiffBase] =
    useState<FoundationalProfileFormState | null>(null);
  const [profileAvailable, setProfileAvailable] = useState<boolean | null>(null);
  const [learningRetryCount, setLearningRetryCount] = useState(0);
  const [currentRevision, setCurrentRevision] = useState<ProfileRevisionDetailResponse | null>(
    null,
  );
  const [profileRevisions, setProfileRevisions] = useState<ProfileRevisionSummaryResponse[]>([]);
  const [showAllProfileVersions, setShowAllProfileVersions] = useState(false);
  const [profileBusy, setProfileBusy] = useState<
    'loading' | 'saving' | 'restoring' | 'activating' | 'populating' | 'promoting' | null
  >(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileLegacyNotice, setProfileLegacyNotice] = useState<string | null>(null);

  const [memoryOverview, setMemoryOverview] = useState<StudentMemoryOverviewResponse | null>(null);
  const [memoryHealth, setMemoryHealth] = useState<StudentMemoryHealthResponse | null>(null);
  const [memoryHealthDetailsOpen, setMemoryHealthDetailsOpen] = useState(false);
  const [memoryOverviewLoading, setMemoryOverviewLoading] = useState(false);
  const [memoryOverviewError, setMemoryOverviewError] = useState<string | null>(null);

  const [profileCandidates, setProfileCandidates] = useState<StudentProfileCandidate[]>([]);
  const [profileCandidatesLoading, setProfileCandidatesLoading] = useState(false);
  const [profileCandidatesError, setProfileCandidatesError] = useState<string | null>(null);
  const [profileCandidateFilter, setProfileCandidateFilter] = useState<ProfileCandidateFilter>(
    PROFILE_CANDIDATE_PENDING_FILTER,
  );
  const [profileCandidateAction, setProfileCandidateAction] = useState<{
    candidateId: string;
    action: CandidateActionKind;
  } | null>(null);
  const [profileCandidateDrafts, setProfileCandidateDrafts] = useState<
    Record<string, { approvedFactText: string; reviewerNote: string }>
  >({});
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [profileCandidatePromotionNote, setProfileCandidatePromotionNote] = useState('');
  const [profileCandidatePromotionBusy, setProfileCandidatePromotionBusy] = useState(false);
  const [profileCandidatePromotionError, setProfileCandidatePromotionError] = useState<
    string | null
  >(null);
  const [profileCandidatePromotionSuccess, setProfileCandidatePromotionSuccess] = useState<
    string | null
  >(null);

  const profileDirty = useMemo(
    () => getProfileSnapshot(profileForm) !== getProfileSnapshot(loadedProfileForm),
    [profileForm, loadedProfileForm],
  );
  const profileDraftDiffItems = useMemo(
    () =>
      currentRevision?.status === 'draft' && profileDraftDiffBase
        ? buildProfileDraftDiff({
            base: profileDraftDiffBase,
            draft: profileForm,
          })
        : [],
    [currentRevision?.status, profileDraftDiffBase, profileForm],
  );

  const approvedCandidatesReadyForPromotion = useMemo(
    () => getApprovedCandidatesReadyForPromotion(profileCandidates),
    [profileCandidates],
  );
  const approvedCandidateIdsReadyForPromotion = useMemo(
    () => new Set(approvedCandidatesReadyForPromotion.map((candidate) => candidate.id)),
    [approvedCandidatesReadyForPromotion],
  );

  const profileVersionDisplay = useMemo(() => {
    const currentRevisionId = currentRevision?.id ?? null;
    const nonCurrentRevisions = profileRevisions.filter(
      (revision) => revision.id !== currentRevisionId,
    );
    const activeRevision = nonCurrentRevisions.find(
      (revision) => revision.status === 'active' && revision.id !== currentRevisionId,
    );
    const olderRevisions = nonCurrentRevisions.filter(
      (revision) => revision.id !== activeRevision?.id,
    );
    const cappedRevisions = showAllProfileVersions ? olderRevisions : olderRevisions.slice(0, 3);

    return {
      visibleRevisions: activeRevision ? [activeRevision, ...cappedRevisions] : cappedRevisions,
      hiddenCount: showAllProfileVersions ? 0 : Math.max(0, olderRevisions.length - 3),
    };
  }, [currentRevision?.id, profileRevisions, showAllProfileVersions]);
  const visibleProfileRevisions = profileVersionDisplay.visibleRevisions;
  const hiddenProfileRevisionCount = profileVersionDisplay.hiddenCount;

  const clearLoadedLearningSurface = useCallback(() => {
    setProfileAvailable(null);
    setCurrentRevision(null);
    setProfileRevisions([]);
    setShowAllProfileVersions(false);
    setProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
    setLoadedProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
    setProfileDraftDiffBase(null);
    setProfileLegacyNotice(null);
    setMemoryOverview(null);
    setMemoryHealth(null);
    setMemoryHealthDetailsOpen(false);
    setProfileCandidates([]);
    setProfileCandidateDrafts({});
    setSelectedCandidateIds([]);
    setProfileCandidatePromotionNote('');
    setProfileCandidatePromotionError(null);
    setProfileCandidatePromotionSuccess(null);
  }, []);

  useEffect(() => {
    clearLoadedLearningSurface();
  }, [clearLoadedLearningSurface, studentId]);

  useEffect(() => {
    setShowAllProfileVersions(false);
  }, [profileStudentId, studentId]);

  useEffect(() => {
    setSelectedCandidateIds((current) =>
      current.filter((candidateId) => approvedCandidateIdsReadyForPromotion.has(candidateId)),
    );
  }, [approvedCandidateIdsReadyForPromotion]);

  useEffect(() => {
    if (!profileDirty) return undefined;

    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', beforeUnloadHandler);
    return () => window.removeEventListener('beforeunload', beforeUnloadHandler);
  }, [profileDirty]);

  const isCurrentPageLoadRequest = useCallback(
    (requestId: number) => latestPageLoadRequestRef.current === requestId,
    [],
  );

  const loadProfileRevisionIntoEditor = useCallback(
    async (targetStudentId: string, revisionId: string) => {
      const requestId = latestPageLoadRequestRef.current;
      const revision = await getProfileRevision(targetStudentId, revisionId);
      if (!isCurrentPageLoadRequest(requestId)) {
        return revision;
      }
      const form = foundationalProfileToFormState(revision.structuredContent);
      setCurrentRevision(revision);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileDraftDiffBase(null);
      setProfileLegacyNotice(getLegacyProfileNotice(revision));
      return revision;
    },
    [isCurrentPageLoadRequest],
  );

  const loadProfileSurface = useCallback(
    async (requestId: number) => {
      if (!profileStudentId) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setCurrentRevision(null);
        setProfileRevisions([]);
        setProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
        setLoadedProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
        setProfileDraftDiffBase(null);
        setProfileLegacyNotice(null);
        return;
      }

      setProfileBusy('loading');
      setProfileError(null);
      try {
        const [profile, revisions] = await Promise.all([
          getProfileContent(profileStudentId),
          listProfileRevisions(profileStudentId, { limit: 25, offset: 0, order: 'desc' }),
        ]);
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        const revision =
          profile.currentRevisionId && profile.currentRevisionId.trim()
            ? await getProfileRevision(profileStudentId, profile.currentRevisionId).catch(() =>
                buildRevisionDetailFromProfile(
                  profileStudentId,
                  profile,
                  findCurrentProfileRevisionSummary(profile, revisions.items ?? []),
                ),
              )
            : buildRevisionDetailFromProfile(
                profileStudentId,
                profile,
                findCurrentProfileRevisionSummary(profile, revisions.items ?? []),
              );
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        const form = foundationalProfileToFormState(
          revision?.structuredContent ?? profile.structuredContent,
        );
        setProfileAvailable(true);
        setCurrentRevision(revision);
        setProfileForm(form);
        setLoadedProfileForm(form);
        setProfileDraftDiffBase(null);
        setProfileRevisions(revisions.items ?? []);
        setProfileLegacyNotice(getLegacyProfileNotice(revision ?? profile));
      } catch (error) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'Unable to load the learner profile.';
        setProfileError(message);
      } finally {
        if (isCurrentPageLoadRequest(requestId)) {
          setProfileBusy(null);
        }
      }
    },
    [isCurrentPageLoadRequest, profileStudentId],
  );

  const loadMemoryOverview = useCallback(
    async (requestId: number) => {
      if (!studentId) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setMemoryOverview(null);
        setMemoryHealth(null);
        setMemoryHealthDetailsOpen(false);
        return;
      }
      setMemoryOverviewLoading(true);
      setMemoryOverviewError(null);
      try {
        const [nextMemoryOverview, nextMemoryHealth] = await Promise.all([
          getStudentMemoryOverview(studentId, {
            lessonLimit: 3,
            homeworkLimit: 2,
          }),
          getStudentMemoryHealth(studentId).catch(() => null),
        ]);
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setMemoryOverview(nextMemoryOverview);
        setMemoryHealth(nextMemoryHealth);
      } catch (error) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unable to load student memory.';
        setMemoryOverviewError(message);
      } finally {
        if (isCurrentPageLoadRequest(requestId)) {
          setMemoryOverviewLoading(false);
        }
      }
    },
    [isCurrentPageLoadRequest, studentId],
  );

  const loadProfileCandidates = useCallback(
    async (requestId: number) => {
      if (!studentId) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setProfileCandidates([]);
        return;
      }
      setProfileCandidatesLoading(true);
      setProfileCandidatesError(null);
      try {
        const response = await listStudentProfileCandidates(studentId, {
          limit: 200,
          offset: 0,
          order: 'desc',
        });
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setProfileCandidates(response.items ?? []);
      } catch (error) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'Unable to load profile candidates.';
        setProfileCandidatesError(message);
      } finally {
        if (isCurrentPageLoadRequest(requestId)) {
          setProfileCandidatesLoading(false);
        }
      }
    },
    [isCurrentPageLoadRequest, studentId],
  );

  const reloadCurrentLearningSurface = useCallback(async () => {
    const requestId = latestPageLoadRequestRef.current;
    await Promise.all([
      loadProfileSurface(requestId),
      loadMemoryOverview(requestId),
      loadProfileCandidates(requestId),
    ]);
  }, [loadMemoryOverview, loadProfileCandidates, loadProfileSurface]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry deliberately reloads the same learner.
  useEffect(() => {
    const requestId = latestPageLoadRequestRef.current + 1;
    latestPageLoadRequestRef.current = requestId;

    if (!studentId) return undefined;

    setProfileBusy('loading');
    setMemoryOverviewLoading(true);
    setProfileCandidatesLoading(true);
    setProfileError(null);
    setMemoryOverviewError(null);
    setProfileCandidatesError(null);
    clearLoadedLearningSurface();

    const loadLearningSurface = async () => {
      try {
        const surface = await getStudentLearningSurface(studentId);
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }

        setProfileAvailable(Boolean(surface.profile));
        if (surface.profile) {
          const currentSummary = findCurrentProfileRevisionSummary(
            surface.profile,
            surface.revisions.items ?? [],
          );
          const revision =
            surface.profile.currentRevisionId && surface.profile.currentRevisionId.trim()
              ? buildRevisionDetailFromProfile(studentId, surface.profile, currentSummary)
              : null;
          const form = foundationalProfileToFormState(
            revision?.structuredContent ?? surface.profile.structuredContent,
          );
          setProfileAvailable(true);
          setCurrentRevision(revision);
          setProfileForm(form);
          setLoadedProfileForm(form);
          setProfileRevisions(surface.revisions.items ?? []);
          setProfileLegacyNotice(getLegacyProfileNotice(revision ?? surface.profile));
        } else {
          setCurrentRevision(null);
          setProfileRevisions([]);
          setProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
          setLoadedProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
          setProfileLegacyNotice(null);
        }

        setMemoryOverview(surface.memory);
        setMemoryHealth(surface.memoryHealth ?? null);
        setMemoryHealthDetailsOpen(false);
        setProfileCandidates(surface.candidates.items ?? []);
      } catch (error: unknown) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'Unable to load the learning surface.';
        clearLoadedLearningSurface();
        setProfileError(message);
        setMemoryOverviewError(message);
        setProfileCandidatesError(message);
      } finally {
        if (isCurrentPageLoadRequest(requestId)) {
          setProfileBusy(null);
          setMemoryOverviewLoading(false);
          setProfileCandidatesLoading(false);
        }
      }
    };

    void loadLearningSurface();

    return () => {
      latestPageLoadRequestRef.current += 1;
    };
  }, [clearLoadedLearningSurface, isCurrentPageLoadRequest, studentId, learningRetryCount]);

  const handleProfileFieldChange = useCallback(
    (field: keyof FoundationalProfileFormState, value: string) => {
      setProfileForm((current) => ({
        ...current,
        [field]: value,
      }));
    },
    [],
  );

  const handleSaveDraft = async () => {
    if (!profileStudentId) {
      setProfileError('Select a student before saving a draft.');
      return;
    }

    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const saved = await saveProfileDraftRevision(profileStudentId, {
        structuredContent: foundationalProfileFormToStructuredContent(profileForm),
        inheritCandidateLinksFromRevisionId:
          currentRevision?.status === 'draft' ? currentRevision.id : null,
      });
      const form = foundationalProfileToFormState(saved.structuredContent);
      setCurrentRevision(saved);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileLegacyNotice(null);
      const revisions = await listProfileRevisions(profileStudentId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile draft saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save profile draft.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleSaveProfile = async () => {
    if (!profileStudentId) return;
    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      await upsertProfileContent(
        profileStudentId,
        null,
        foundationalProfileFormToStructuredContent(profileForm),
      );
      await reloadCurrentLearningSurface();
      setProfileSuccess('Learner profile saved.');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Unable to save learner profile.');
    } finally {
      setProfileBusy(null);
    }
  };

  const handleStartEmptyProfile = async () => {
    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const response = await initializeStudentProfileDraft(studentId);
      const activated = await activateProfileRevision(studentId, response.draftRevision.id);
      const form = foundationalProfileToFormState(activated.structuredContent);
      setProfileAvailable(true);
      setCurrentRevision(activated);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileDraftDiffBase(null);
      setProfileLegacyNotice(null);
      setProfileRevisions([{ ...activated }]);
      await refreshStudent();
      setProfileSuccess('Learner profile created. Add context and save when ready.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start the learner profile.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleActivateDraft = async () => {
    if (!profileStudentId || !currentRevision?.id) {
      setProfileError('Open a draft revision before activating it.');
      return;
    }

    setProfileBusy('activating');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const activated = await activateProfileRevision(profileStudentId, currentRevision.id);
      await Promise.all([reloadCurrentLearningSurface(), refreshStudent()]);
      setProfileDraftDiffBase(null);
      setProfileError(null);
      const promotion = activated.candidatePromotion;
      setProfileSuccess(
        promotion
          ? `Draft activated. ${promotion.promotedCandidateIds.length} of ${promotion.linkedCandidateCount} linked facts promoted; ${promotion.omittedCandidates.length} omitted.${describeCandidateOmissions(promotion.omittedCandidates)}`
          : 'Draft activated. Candidate promotion was not reported by the server.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to activate the draft.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!profileStudentId) return;

    setProfileBusy('restoring');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const restored = await restoreProfileRevision(profileStudentId, revisionId);
      const restoredRevision = restored.currentRevisionId
        ? await getProfileRevision(profileStudentId, restored.currentRevisionId).catch(() =>
            buildRevisionDetailFromProfile(profileStudentId, restored),
          )
        : buildRevisionDetailFromProfile(profileStudentId, restored);
      const form = foundationalProfileToFormState(
        restoredRevision?.structuredContent ?? restored.structuredContent,
      );
      setCurrentRevision(restoredRevision);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileDraftDiffBase(null);
      setProfileLegacyNotice(getLegacyProfileNotice(restoredRevision ?? restored));
      const revisions = await listProfileRevisions(profileStudentId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Revision restored into the editor.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to restore the revision.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleRefreshDraftFromCandidates = async (candidateIds: string[]) => {
    if (candidateIds.length === 0) {
      setProfileCandidatePromotionError('No approved candidates are ready to promote yet.');
      return;
    }

    setProfileBusy('promoting');
    setProfileCandidatePromotionBusy(true);
    setProfileCandidatePromotionError(null);
    setProfileCandidatePromotionSuccess(null);
    const draftDiffBase = loadedProfileForm;
    try {
      const response = await refreshProfileDraftFromApprovedCandidates(studentId, {
        candidateIds,
        ...(profileCandidatePromotionNote.trim()
          ? { reviewerNote: profileCandidatePromotionNote.trim() }
          : {}),
      });
      const revision =
        response.draftRevision ??
        (await loadProfileRevisionIntoEditor(studentId, response.draftRevisionId));
      if (response.draftRevision) {
        const form = foundationalProfileToFormState(revision.structuredContent);
        setProfileAvailable(true);
        setCurrentRevision(revision);
        setProfileForm(form);
        setLoadedProfileForm(form);
        setProfileDraftDiffBase(draftDiffBase);
        setProfileLegacyNotice(getLegacyProfileNotice(revision));
      }
      const revisions = await listProfileRevisions(studentId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setSelectedCandidateIds([]);
      const excludedCount = candidateIds.filter(
        (id) => !response.includedCandidateIds.includes(id),
      ).length;
      setProfileCandidatePromotionSuccess(
        `Draft refreshed. ${response.includedCandidateIds.length} of ${candidateIds.length} selected facts applied; ${excludedCount} omitted.${describeCandidateOmissions(response.omittedCandidates ?? (excludedCount > 0 ? [{ reason: 'fact_not_represented' }] : []))} Review the changes and repeated wording before activating.`,
      );
      setProfileSuccess('Draft revision opened in the editor.');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to refresh the draft from approved candidates.';
      setProfileCandidatePromotionError(message);
      setProfileError(message);
    } finally {
      setProfileBusy(null);
      setProfileCandidatePromotionBusy(false);
    }
  };

  const handleReviewProfileCandidate = async (
    candidate: StudentProfileCandidate,
    action: CandidateActionKind,
  ) => {
    const draft = profileCandidateDrafts[candidate.id];
    const reviewerNote = draft?.reviewerNote.trim();
    const approvedFactText = draft?.approvedFactText.trim();

    setProfileCandidateAction({ candidateId: candidate.id, action });
    setProfileCandidatesError(null);
    try {
      const updated =
        action === 'approve'
          ? await approveStudentProfileCandidate(studentId, candidate.id, {
              ...(approvedFactText ? { approvedFactText } : {}),
              ...(reviewerNote ? { reviewerNote } : {}),
            })
          : action === 'reject'
            ? await rejectStudentProfileCandidate(studentId, candidate.id, {
                ...(reviewerNote ? { reviewerNote } : {}),
              })
            : await deferStudentProfileCandidate(studentId, candidate.id, {
                ...(reviewerNote ? { reviewerNote } : {}),
              });
      setProfileCandidates((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      if (!isSelectableForPromotion(updated)) {
        setSelectedCandidateIds((current) => current.filter((item) => item !== updated.id));
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to update the candidate review.';
      setProfileCandidatesError(message);
    } finally {
      setProfileCandidateAction(null);
    }
  };

  const updateProfileCandidateDraft = useCallback(
    (candidateId: string, patch: Partial<{ approvedFactText: string; reviewerNote: string }>) => {
      setProfileCandidateDrafts((current) => ({
        ...current,
        [candidateId]: {
          approvedFactText: patch.approvedFactText ?? current[candidateId]?.approvedFactText ?? '',
          reviewerNote: patch.reviewerNote ?? current[candidateId]?.reviewerNote ?? '',
        },
      }));
    },
    [],
  );

  if (studentLoading) {
    return (
      <section
        className="student-learning-layout student-area-theme student-learning-standalone-state"
        aria-live="polite"
      >
        <span className="student-learning-eyebrow">Learning</span>
        <h2>Loading learning workspace…</h2>
        <p>Restoring the learner profile, revision history, and student memory.</p>
      </section>
    );
  }

  if (studentError) {
    return (
      <section
        className="student-learning-layout student-area-theme student-learning-standalone-state"
        aria-live="polite"
      >
        <span className="student-learning-eyebrow">Learning</span>
        <h2>We couldn’t load this student.</h2>
        <p>{studentError}</p>
      </section>
    );
  }

  if (!student) {
    return (
      <section
        className="student-learning-layout student-area-theme student-learning-standalone-state"
        aria-live="polite"
      >
        <span className="student-learning-eyebrow">Learning</span>
        <h2>Student not found.</h2>
        <p>This student record could not be resolved from the current route.</p>
      </section>
    );
  }

  if (profileAvailable === null) {
    return (
      <section
        className="student-learning-layout student-area-theme student-learning-standalone-state"
        aria-busy={profileBusy === 'loading'}
      >
        <h2>{profileError ? 'Learning unavailable' : 'Loading learning workspace…'}</h2>
        {profileError ? (
          <>
            <p role="alert">{profileError}</p>
            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => setLearningRetryCount((count) => count + 1)}
            >
              Retry
            </button>
          </>
        ) : (
          <p>Loading the learner profile, revision history, and memory.</p>
        )}
      </section>
    );
  }

  const availability = memoryOverview?.availability ?? memoryHealth?.availability;
  const latestSnapshot =
    availability?.state === 'repair_required' || availability?.state === 'repository_unavailable'
      ? null
      : (memoryOverview?.latestReadyStudentMemorySnapshot ?? null);
  const memoryRequestFailed = Boolean(memoryOverviewError && !memoryOverview);
  const candidatesUnavailable = profileCandidatesLoading || Boolean(profileCandidatesError);
  const memoryUnavailableCopy =
    availability?.state === 'repair_required'
      ? 'Stored memory history requires explicit repair. Recent observations do not restore established history.'
      : availability?.state === 'repository_unavailable'
        ? 'Memory retrieval is unavailable. Existing history is unknown.'
        : 'No established student-memory snapshot is available yet.';
  const canActivateDraft = currentRevision?.status === 'draft';
  const unresolvedIssues = latestSnapshot?.unresolvedIssues ?? [];
  const recentLessons = memoryOverview?.recentReadyLessonMemory ?? [];
  const recentHomework = memoryOverview?.recentReadyHomeworkMemory ?? [];
  if (profileAvailable === false) {
    return (
      <section className="student-learning-layout student-area-theme student-learning-bootstrap">
        <div className="student-learning-bootstrap-copy">
          <span className="student-learning-eyebrow">Learning</span>
          <h2>Create a learner profile</h2>
          <p>
            {student.student} does not have a learner profile yet. Create one to add what you
            already know about the learner.
          </p>
        </div>

        <div className="student-learning-bootstrap-grid">
          <article className="student-learning-bootstrap-card">
            <span className="student-learning-card-eyebrow">Learner profile</span>
            <h3>Create learner profile</h3>
            <p>Begin with an empty profile and add learner context when you have it.</p>
            <button
              type="button"
              className="workspace-primary-btn"
              onClick={() => void handleStartEmptyProfile()}
              disabled={profileBusy !== null}
            >
              {profileBusy === 'saving' ? 'Creating…' : 'Create learner profile'}
            </button>
          </article>
        </div>

        {profileError ? (
          <p className="workspace-error" aria-live="polite">
            {profileError}
          </p>
        ) : null}
        {profileSuccess ? (
          <p className="workspace-success" aria-live="polite">
            {profileSuccess}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="student-learning-layout student-area-theme">
      <article className="student-area-panel student-learning-hero">
        <div className="student-learning-status-grid">
          <LearningMetricCard
            eyebrow="Memory Snapshot"
            value={
              memoryOverviewLoading && !memoryOverview
                ? 'Loading…'
                : memoryRequestFailed
                  ? 'Unavailable'
                  : latestSnapshot
                    ? 'Ready'
                    : availability?.state === 'repair_required'
                      ? 'Repair required'
                      : availability?.state === 'repository_unavailable'
                        ? 'Unavailable'
                        : 'No Snapshot Yet'
            }
            detail={
              memoryRequestFailed
                ? 'Memory could not be loaded. Existing history is unknown.'
                : memoryOverviewLoading && !memoryOverview
                  ? 'Loading student memory…'
                  : latestSnapshot
                    ? `Updated ${formatDateTime(latestSnapshot.generatedAt)}`
                    : memoryUnavailableCopy
            }
          />
        </div>

        <div className="student-learning-action-row student-learning-action-row-main">
          <button
            type="button"
            className="workspace-secondary-btn"
            onClick={() =>
              void handleRefreshDraftFromCandidates(
                approvedCandidatesReadyForPromotion.map((candidate) => candidate.id),
              )
            }
            disabled={
              profileBusy !== null ||
              candidatesUnavailable ||
              approvedCandidatesReadyForPromotion.length === 0
            }
          >
            {profileBusy === 'promoting'
              ? 'Refreshing…'
              : candidatesUnavailable
                ? 'Refresh Draft From Approved Candidates'
                : `Refresh Draft From Approved Candidates (${approvedCandidatesReadyForPromotion.length})`}
          </button>
          {canActivateDraft ? (
            <>
              <button
                type="button"
                className="workspace-primary-btn"
                onClick={() => void handleSaveDraft()}
                disabled={profileBusy !== null || !profileDirty}
              >
                {profileBusy === 'saving' ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                type="button"
                className="workspace-primary-btn"
                onClick={() => void handleActivateDraft()}
                disabled={profileBusy !== null}
              >
                {profileBusy === 'activating' ? 'Activating…' : 'Activate Draft'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="workspace-primary-btn"
              onClick={() => void handleSaveProfile()}
              disabled={profileBusy !== null || !profileDirty}
            >
              {profileBusy === 'saving' ? 'Saving…' : 'Save learner profile'}
            </button>
          )}
        </div>

        {profileError ? (
          <p className="workspace-error" aria-live="polite">
            {profileError}
          </p>
        ) : null}
        {profileSuccess ? (
          <p className="workspace-success" aria-live="polite">
            {profileSuccess}
          </p>
        ) : null}
      </article>

      <div className="student-learning-main">
        <div className="student-learning-primary-column">
          {currentRevision?.status === 'draft' && profileDraftDiffBase ? (
            <ProfileDraftDiffPanel items={profileDraftDiffItems} />
          ) : null}

          <article className="student-area-panel workspace-card student-learning-profile-card">
            <header className="student-learning-block-header">
              <h2>Foundational Profile</h2>
            </header>

            <div className="student-learning-section-grid">
              {PROFILE_SECTION_CONFIGS.map((section) => (
                <LearningSectionCard
                  key={section.id}
                  config={section}
                  values={profileForm}
                  onChange={handleProfileFieldChange}
                />
              ))}
            </div>

            <footer className="student-learning-editor-footer">
              <div>
                <strong>{profileDirty ? 'Unsaved structured edits' : 'No unsaved changes'}</strong>
              </div>
              {profileLegacyNotice ? (
                <p className="workspace-muted">{profileLegacyNotice}</p>
              ) : null}
            </footer>
          </article>

          <article className="student-area-panel workspace-card student-learning-memory-card">
            <header className="student-learning-block-header">
              <h2>Student Memory</h2>
            </header>

            {memoryOverviewError ? (
              <p className="workspace-error" aria-live="polite">
                {memoryOverviewError}
                {memoryOverview ? ' Showing previously loaded memory.' : ''}
              </p>
            ) : null}

            {memoryOverviewLoading && !memoryOverview ? (
              <p className="workspace-muted">Loading memory summary…</p>
            ) : memoryRequestFailed ? (
              <p className="workspace-muted">
                Memory could not be loaded. Existing history is unknown.
              </p>
            ) : latestSnapshot ? (
              <>
                <p className="workspace-muted">
                  Snapshot generated {formatDateTime(latestSnapshot.generatedAt)}
                </p>

                <div className="student-learning-memory-highlight">
                  <strong>Snapshot Summary</strong>
                  <p>{latestSnapshot.snapshotSummary ?? 'No snapshot summary yet.'}</p>
                </div>

                <div className="student-learning-memory-columns">
                  <section className="student-learning-memory-column">
                    <h3>Recent Lesson Memory</h3>
                    {recentLessons.length > 0 ? (
                      <ul>
                        {recentLessons.map((entry) => (
                          <li key={entry.id}>{entry.lessonSummary ?? entry.id}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="workspace-muted">No ready lesson-memory entries yet.</p>
                    )}
                  </section>

                  <section className="student-learning-memory-column">
                    <h3>Recent Homework Memory</h3>
                    {recentHomework.length > 0 ? (
                      <ul>
                        {recentHomework.map((entry) => (
                          <li key={entry.id}>{entry.homeworkSummary ?? entry.topic ?? entry.id}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="workspace-muted">No ready homework-memory entries yet.</p>
                    )}
                  </section>

                  <section className="student-learning-memory-column">
                    <h3>Current Open Threads</h3>
                    {unresolvedIssues.length > 0 ? (
                      <ul>
                        {unresolvedIssues.map((issue) => (
                          <li key={`${issue.label}-${issue.note}`}>
                            <strong>{issue.label}</strong>: {issue.note}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="workspace-muted">
                        No open threads in the latest memory snapshot.
                      </p>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <div className="student-learning-empty-block">
                <strong>{memoryUnavailableCopy}</strong>
                <p>
                  {availability?.state === 'repair_required'
                    ? 'Existing observations remain retained. A separately authorized rebuild is required before using the established summary.'
                    : availability?.state === 'repository_unavailable'
                      ? 'Try again when memory retrieval is restored. The profile can still be edited manually.'
                      : 'The profile can still be edited manually, and this area will become more useful as lesson and homework memory accumulates.'}
                </p>
              </div>
            )}
            {memoryHealth || latestSnapshot ? (
              <MemoryHealthDetails
                health={memoryHealth}
                readySnapshot={latestSnapshot}
                open={memoryHealthDetailsOpen}
                onToggle={() => setMemoryHealthDetailsOpen((current) => !current)}
              />
            ) : null}
          </article>

          <ProfileCandidatesPanel
            className="student-area-panel student-learning-candidates-card"
            selectedStudentId={studentId}
            profileCandidates={profileCandidates}
            profileCandidatesLoading={profileCandidatesLoading}
            profileCandidatesError={profileCandidatesError}
            profileCandidateFilter={profileCandidateFilter}
            setProfileCandidateFilter={setProfileCandidateFilter}
            profileCandidateAction={profileCandidateAction}
            profileCandidateDrafts={profileCandidateDrafts}
            updateProfileCandidateDraft={updateProfileCandidateDraft}
            selectedCandidateIds={selectedCandidateIds}
            setSelectedCandidateIds={setSelectedCandidateIds}
            profileCandidatePromotionNote={profileCandidatePromotionNote}
            setProfileCandidatePromotionNote={setProfileCandidatePromotionNote}
            profileCandidatePromotionBusy={profileCandidatePromotionBusy}
            profileCandidatePromotionError={profileCandidatePromotionError}
            profileCandidatePromotionSuccess={profileCandidatePromotionSuccess}
            onRefreshCandidates={() => reloadCurrentLearningSurface()}
            onPromoteProfileCandidates={() =>
              handleRefreshDraftFromCandidates(selectedCandidateIds)
            }
            onReviewProfileCandidate={handleReviewProfileCandidate}
          />
        </div>

        <aside className="student-area-panel workspace-card student-learning-sidebar">
          <header className="student-learning-block-header">
            <h2>Profile Versions</h2>
          </header>

          <div className="student-learning-rail-summary">
            <LearningMetricCard
              eyebrow="Current Revision"
              value={currentRevision?.versionLabel ?? currentRevision?.id ?? 'n/a'}
              detail={currentRevision?.status ?? 'no current revision'}
              tone={currentRevision?.status === 'draft' ? 'accent' : 'success'}
            />
            <LearningMetricCard
              eyebrow="Support ID"
              value={formatStudentShortId(studentId)}
              detail={
                currentRevision?.activatedAt
                  ? `Profile active since ${formatDateTime(currentRevision.activatedAt)}`
                  : 'Profile activation history is not available yet'
              }
            />
          </div>

          <div className="workspace-list student-learning-revision-list">
            {visibleProfileRevisions.map((revision) => (
              <div key={revision.id} className="workspace-list-item workspace-list-item-stack">
                <div>
                  <strong>{revision.versionLabel ?? revision.id}</strong>
                  <div className="workspace-muted">
                    {revision.status ?? 'unknown'} • {formatDateTime(revision.createdAt)}
                  </div>
                </div>
                <div className="student-learning-inline">
                  <button
                    type="button"
                    className="workspace-secondary-btn"
                    onClick={() =>
                      void loadProfileRevisionIntoEditor(profileStudentId, revision.id)
                    }
                    disabled={profileBusy !== null}
                  >
                    Open
                  </button>
                  {revision.status !== 'active' ? (
                    <button
                      type="button"
                      className="workspace-secondary-btn"
                      onClick={() => void handleRestoreRevision(revision.id)}
                      disabled={profileBusy !== null}
                    >
                      Restore
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {hiddenProfileRevisionCount > 0 || showAllProfileVersions ? (
            <button
              type="button"
              className="workspace-secondary-btn student-learning-version-toggle"
              onClick={() => setShowAllProfileVersions((current) => !current)}
            >
              {showAllProfileVersions ? 'Hide older versions' : 'View all versions'}
            </button>
          ) : null}
        </aside>
      </div>
    </section>
  );
};
