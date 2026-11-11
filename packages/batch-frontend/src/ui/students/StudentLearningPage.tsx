import { BookOpen, ChevronRight, History, Pencil, Plus, Sparkles } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
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
import { formatTutorTime } from '../../utils/tutor-time';
import { useStudioV2 } from '../studio-v2/StudioV2Context';
import { StudioV2Dialog } from '../studio-v2/StudioV2Dialog';
import { LoadingPlaceholder, PageLoading } from '../system/LoadingPlaceholder';
import { LearningLessonContext } from './LearningLessonContext';
import { LessonTranscriptDisclosure } from './LessonTranscriptDisclosure';
import { ProfileCandidatesPanel } from './ProfileCandidatesPanel';
import { ProfileUpdatesDialog } from './ProfileUpdatesDialog';
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
import { useStudentPageEdits } from './StudentWorkspaceContext';
import { formatStudentShortId } from './studentIdentity';
import './StudentLearningPage.css';

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
  disabled?: boolean;
}

interface LearningSectionCardProps {
  config: LearningSectionConfig;
  values: FoundationalProfileFormState;
  onChange: (key: ProfileFieldKey, value: string) => void;
  disabled?: boolean;
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
    baseActiveRevisionId: summary?.baseActiveRevisionId ?? null,
    baseActiveRevisionKnown: summary?.baseActiveRevisionKnown ?? false,
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
  const studioV2 = useStudioV2();
  return (
    <section className="student-learning-memory-support">
      <button
        type="button"
        className={
          studioV2
            ? 'product-button product-button--quiet student-learning-memory-support-toggle'
            : 'workspace-secondary-btn student-learning-memory-support-toggle'
        }
        aria-expanded={open}
        onClick={onToggle}
      >
        {studioV2 ? 'Memory details' : 'Memory support details'}
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

function LearningField({
  config,
  value,
  onChange,
  disabled,
}: LearningFieldProps): React.JSX.Element {
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
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(config.key, event.target.value)}
          placeholder={config.placeholder}
        />
      ) : (
        <textarea
          id={inputId}
          name={config.key}
          autoComplete="off"
          disabled={disabled}
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
  disabled,
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
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}

function MemoryEntriesSection({
  collapsible,
  title,
  count,
  children,
}: {
  collapsible: boolean;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return collapsible ? (
    <details className="student-learning-memory-column">
      <summary>
        <span>
          {title}
          {count !== undefined && <span className="student-v2-memory-count">{count}</span>}
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </summary>
      {children}
    </details>
  ) : (
    <section className="student-learning-memory-column">
      <h3>{title}</h3>
      {children}
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
  const studioV2 = useStudioV2();
  const [editing, setEditing] = useState(false);
  const [profilePanel, setProfilePanel] = useState<'versions' | 'suggestions' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const profileHeadingRef = useRef<HTMLHeadingElement>(null);
  const profileEditorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (studioV2 && editing)
      profileEditorRef.current?.querySelector<HTMLInputElement>('input, textarea')?.focus();
  }, [studioV2, editing]);
  const timezone = useWorkspaceTimezone();
  const formatDateTime = (value?: string | null) => formatTutorTime(value, timezone);
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
  const [bufferActiveRevisionId, setBufferActiveRevisionId] = useState<string | null | undefined>(
    undefined,
  );
  const [latestProfile, setLatestProfile] = useState<ProfileContentResponse | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [draftNeedsSave, setDraftNeedsSave] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const profileRefreshRequestRef = useRef(0);

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
  const reviewDirty =
    Object.entries(profileCandidateDrafts).some(([id, draft]) => {
      const candidate = profileCandidates.find((item) => item.id === id);
      return (
        candidate &&
        (draft.reviewerNote !== (candidate.reviewerNote ?? '') ||
          draft.approvedFactText !== (candidate.approvedFactText ?? candidate.proposedFact))
      );
    }) || profileCandidatePromotionNote.trim() !== '';

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
    const current = studioV2
      ? profileRevisions.find((revision) => revision.id === currentRevisionId)
      : undefined;
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
      visibleRevisions: [
        ...(current ? [current] : []),
        ...(activeRevision ? [activeRevision] : []),
        ...cappedRevisions,
      ],
      hiddenCount: showAllProfileVersions ? 0 : Math.max(0, olderRevisions.length - 3),
    };
  }, [currentRevision?.id, profileRevisions, showAllProfileVersions, studioV2]);
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
    setBufferActiveRevisionId(undefined);
    setLatestProfile(null);
    setComparisonOpen(false);
    setComparisonError(null);
    setComparisonBusy(false);
    setDraftNeedsSave(false);
    setUpdatesOpen(false);
    setEditing(false);
    setProfilePanel(null);
    setConfirmDiscard(false);
    profileRefreshRequestRef.current += 1;
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
    if (!profileDirty && !draftNeedsSave) return undefined;

    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', beforeUnloadHandler);
    return () => window.removeEventListener('beforeunload', beforeUnloadHandler);
  }, [profileDirty, draftNeedsSave]);

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
      if (revision.status === 'draft') {
        setBufferActiveRevisionId(
          revision.baseActiveRevisionKnown ? revision.baseActiveRevisionId : undefined,
        );
        setComparisonOpen(
          !revision.baseActiveRevisionKnown ||
            revision.baseActiveRevisionId !== latestProfile?.activeRevisionId,
        );
      } else {
        setBufferActiveRevisionId(latestProfile?.activeRevisionId);
        setComparisonOpen(false);
      }
      setDraftNeedsSave(false);
      return revision;
    },
    [isCurrentPageLoadRequest, latestProfile?.activeRevisionId],
  );

  const loadProfileSurface = useCallback(
    async (requestId: number) => {
      profileRefreshRequestRef.current += 1;
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
        setBufferActiveRevisionId(
          revision?.status === 'draft'
            ? revision.baseActiveRevisionKnown
              ? revision.baseActiveRevisionId
              : undefined
            : profile.activeRevisionId,
        );
        setLatestProfile(profile);
        setComparisonOpen(
          revision?.status === 'draft' &&
            (!revision.baseActiveRevisionKnown ||
              revision.baseActiveRevisionId !== profile.activeRevisionId),
        );
        setDraftNeedsSave(false);
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
        setBufferActiveRevisionId(surface.profile?.activeRevisionId ?? null);
        setLatestProfile(surface.profile);
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
          if (revision?.status === 'draft') {
            setBufferActiveRevisionId(
              revision.baseActiveRevisionKnown ? revision.baseActiveRevisionId : undefined,
            );
            setComparisonOpen(
              !revision.baseActiveRevisionKnown ||
                revision.baseActiveRevisionId !== surface.profile.activeRevisionId,
            );
          }
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

  const refreshLatestProfile = useCallback(async () => {
    const page = latestPageLoadRequestRef.current;
    const request = ++profileRefreshRequestRef.current;
    setComparisonBusy(true);
    setComparisonError(null);
    try {
      const profile = await getProfileContent(profileStudentId);
      if (!isCurrentPageLoadRequest(page) || request !== profileRefreshRequestRef.current) return;
      setLatestProfile(profile);
    } catch {
      if (isCurrentPageLoadRequest(page) && request === profileRefreshRequestRef.current)
        setComparisonError('Current profile unavailable. Your edits are kept.');
    } finally {
      if (isCurrentPageLoadRequest(page) && request === profileRefreshRequestRef.current)
        setComparisonBusy(false);
    }
  }, [isCurrentPageLoadRequest, profileStudentId]);

  useEffect(() => {
    if (!profileAvailable) return;
    const refresh = () => {
      if (!document.hidden && profileBusy === null) void refreshLatestProfile();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [profileAvailable, profileBusy, refreshLatestProfile]);

  const reportProfileWriteError = (error: unknown, fallback: string) => {
    setProfileError(error instanceof Error ? error.message : fallback);
    if (error instanceof Error && error.name === 'ProfileRevisionConflictApiError') {
      setComparisonOpen(true);
      void refreshLatestProfile();
    }
  };
  const profileUpdated = latestProfile && latestProfile.activeRevisionId !== bufferActiveRevisionId;
  const comparisonItems = useMemo(
    () =>
      latestProfile
        ? buildProfileDraftDiff({
            base: foundationalProfileToFormState(latestProfile.structuredContent),
            draft: profileForm,
          })
        : [],
    [latestProfile, profileForm],
  );

  const handleAutomaticProfileChange = async () => {
    if (profileDirty || editing || currentRevision?.status === 'draft')
      await refreshLatestProfile();
    else await reloadCurrentLearningSurface();
  };

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

    if (bufferActiveRevisionId === undefined) {
      setComparisonOpen(true);
      return false;
    }
    const page = latestPageLoadRequestRef.current;
    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const saved = await saveProfileDraftRevision(profileStudentId, {
        expectedActiveRevisionId: bufferActiveRevisionId,
        structuredContent: foundationalProfileFormToStructuredContent(profileForm),
        inheritCandidateLinksFromRevisionId:
          currentRevision?.status === 'draft' ? currentRevision.id : null,
      });
      if (!isCurrentPageLoadRequest(page)) return false;
      const form = foundationalProfileToFormState(saved.structuredContent);
      setCurrentRevision(saved);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileLegacyNotice(null);
      setDraftNeedsSave(false);
      setComparisonOpen(false);
      const revisions = await listProfileRevisions(profileStudentId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      if (!isCurrentPageLoadRequest(page)) return false;
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile draft saved.');
      if (studioV2) setEditing(false);
      return true;
    } catch (error) {
      if (!isCurrentPageLoadRequest(page)) return false;
      reportProfileWriteError(error, 'Unable to save profile draft.');
      return false;
    } finally {
      if (isCurrentPageLoadRequest(page)) setProfileBusy(null);
    }
  };

  const handleSaveProfile = async () => {
    if (!profileStudentId) return;
    if (bufferActiveRevisionId === undefined) {
      setComparisonOpen(true);
      return false;
    }
    const page = latestPageLoadRequestRef.current;
    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      await upsertProfileContent(
        profileStudentId,
        null,
        foundationalProfileFormToStructuredContent(profileForm),
        { expectedActiveRevisionId: bufferActiveRevisionId },
      );
      if (!isCurrentPageLoadRequest(page)) return false;
      await reloadCurrentLearningSurface();
      if (!isCurrentPageLoadRequest(page)) return false;
      setProfileSuccess('Learner profile saved.');
      if (studioV2) setEditing(false);
      return true;
    } catch (error) {
      if (!isCurrentPageLoadRequest(page)) return false;
      reportProfileWriteError(error, 'Unable to save learner profile.');
      return false;
    } finally {
      if (isCurrentPageLoadRequest(page)) setProfileBusy(null);
    }
  };

  useStudentPageEdits({
    dirty: profileDirty || draftNeedsSave || reviewDirty,
    busy:
      (profileBusy !== null && profileBusy !== 'loading') ||
      profileCandidateAction !== null ||
      profileCandidatePromotionBusy,
    save:
      (profileDirty || draftNeedsSave) && !reviewDirty && profileBusy === null
        ? async () =>
            Boolean(
              await (currentRevision?.status === 'draft' ? handleSaveDraft() : handleSaveProfile()),
            )
        : undefined,
    discard: () => {
      setProfileForm(loadedProfileForm);
      setDraftNeedsSave(false);
      setProfileCandidateDrafts({});
      setProfileCandidatePromotionNote('');
    },
  });

  const handleStartEmptyProfile = async () => {
    if (profileDirty || draftNeedsSave || reviewDirty || profileBusy !== null) return;
    const page = latestPageLoadRequestRef.current;
    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const response = await initializeStudentProfileDraft(studentId, {
        expectedActiveRevisionId: null,
      });
      if (!isCurrentPageLoadRequest(page)) return;
      const activated = await activateProfileRevision(studentId, response.draftRevision.id, {
        expectedActiveRevisionId: null,
      });
      if (!isCurrentPageLoadRequest(page)) return;
      profileRefreshRequestRef.current += 1;
      const form = foundationalProfileToFormState(activated.structuredContent);
      setProfileAvailable(true);
      setCurrentRevision(activated);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileDraftDiffBase(null);
      setProfileLegacyNotice(null);
      setProfileRevisions([{ ...activated }]);
      setBufferActiveRevisionId(activated.id);
      setLatestProfile({
        studentId,
        content: activated.content,
        structuredContent: activated.structuredContent,
        currentRevisionId: activated.id,
        activeRevisionId: activated.id,
        updatedAt: activated.activatedAt ?? activated.createdAt,
      });
      await refreshStudent();
      if (!isCurrentPageLoadRequest(page)) return;
      setProfileSuccess('Learner profile created. Add context and save when ready.');
      if (studioV2) setEditing(true);
    } catch (error) {
      if (!isCurrentPageLoadRequest(page)) return;
      reportProfileWriteError(error, 'Unable to start the learner profile.');
    } finally {
      if (isCurrentPageLoadRequest(page)) setProfileBusy(null);
    }
  };

  const handleActivateDraft = async () => {
    if (!profileStudentId || !currentRevision?.id) {
      setProfileError('Open a draft revision before activating it.');
      return;
    }

    if (
      bufferActiveRevisionId === undefined ||
      !currentRevision.baseActiveRevisionKnown ||
      draftNeedsSave ||
      profileDirty
    ) {
      setComparisonOpen(true);
      setProfileError('Compare the current profile and save a new draft before activating.');
      return;
    }
    const page = latestPageLoadRequestRef.current;

    setProfileBusy('activating');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const activated = await activateProfileRevision(profileStudentId, currentRevision.id, {
        expectedActiveRevisionId: bufferActiveRevisionId,
      });
      if (!isCurrentPageLoadRequest(page)) return;
      await Promise.all([reloadCurrentLearningSurface(), refreshStudent()]);
      if (!isCurrentPageLoadRequest(page)) return;
      setProfileDraftDiffBase(null);
      setProfileError(null);
      const promotion = activated.candidatePromotion;
      setProfileSuccess(
        promotion
          ? `Draft activated. ${promotion.promotedCandidateIds.length} of ${promotion.linkedCandidateCount} linked facts promoted; ${promotion.omittedCandidates.length} omitted.${describeCandidateOmissions(promotion.omittedCandidates)}`
          : 'Draft activated. Candidate promotion was not reported by the server.',
      );
    } catch (error) {
      if (!isCurrentPageLoadRequest(page)) return;
      reportProfileWriteError(error, 'Unable to activate the draft.');
    } finally {
      if (isCurrentPageLoadRequest(page)) setProfileBusy(null);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!profileStudentId) return;
    if (profileDirty || draftNeedsSave || reviewDirty || profileBusy !== null) return;
    if (bufferActiveRevisionId === undefined) {
      setComparisonOpen(true);
      return;
    }
    const page = latestPageLoadRequestRef.current;

    setProfileBusy('restoring');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const restored = await restoreProfileRevision(profileStudentId, revisionId, {
        expectedActiveRevisionId: bufferActiveRevisionId,
      });
      if (!isCurrentPageLoadRequest(page)) return;
      profileRefreshRequestRef.current += 1;
      const restoredRevision = restored.currentRevisionId
        ? await getProfileRevision(profileStudentId, restored.currentRevisionId).catch(() =>
            buildRevisionDetailFromProfile(profileStudentId, restored),
          )
        : buildRevisionDetailFromProfile(profileStudentId, restored);
      const form = foundationalProfileToFormState(
        restoredRevision?.structuredContent ?? restored.structuredContent,
      );
      if (!isCurrentPageLoadRequest(page)) return;
      setCurrentRevision(restoredRevision);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileDraftDiffBase(null);
      setProfileLegacyNotice(getLegacyProfileNotice(restoredRevision ?? restored));
      setBufferActiveRevisionId(restored.activeRevisionId);
      setLatestProfile(restored);
      setComparisonOpen(false);
      setDraftNeedsSave(false);
      const revisions = await listProfileRevisions(profileStudentId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      if (!isCurrentPageLoadRequest(page)) return;
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile version restored.');
    } catch (error) {
      if (!isCurrentPageLoadRequest(page)) return;
      reportProfileWriteError(error, 'Unable to restore the revision.');
    } finally {
      if (isCurrentPageLoadRequest(page)) setProfileBusy(null);
    }
  };

  const handleOpenRevision = async (revisionId: string) => {
    if (profileDirty || draftNeedsSave || reviewDirty || profileBusy !== null) return;
    const page = latestPageLoadRequestRef.current;
    setProfileBusy('loading');
    setProfileError(null);
    try {
      const revision = await loadProfileRevisionIntoEditor(profileStudentId, revisionId);
      if (studioV2 && isCurrentPageLoadRequest(page)) {
        setProfilePanel(null);
        if (revision.status === 'draft') setEditing(true);
        else requestAnimationFrame(() => profileHeadingRef.current?.focus());
      }
    } catch (error) {
      if (isCurrentPageLoadRequest(page))
        setProfileError(error instanceof Error ? error.message : 'Profile version unavailable.');
    } finally {
      if (isCurrentPageLoadRequest(page)) setProfileBusy(null);
    }
  };

  const handleRefreshDraftFromCandidates = async (candidateIds: string[]) => {
    if (profileDirty || draftNeedsSave || reviewDirty || profileBusy !== null) {
      setProfileCandidatePromotionError('Save or cancel your edits before opening a new draft.');
      return;
    }
    if (candidateIds.length === 0) {
      setProfileCandidatePromotionError('No approved candidates are ready to promote yet.');
      return;
    }

    if (bufferActiveRevisionId === undefined) {
      setComparisonOpen(true);
      return;
    }
    const page = latestPageLoadRequestRef.current;

    setProfileBusy('promoting');
    setProfileCandidatePromotionBusy(true);
    setProfileCandidatePromotionError(null);
    setProfileCandidatePromotionSuccess(null);
    const draftDiffBase = loadedProfileForm;
    try {
      const response = await refreshProfileDraftFromApprovedCandidates(studentId, {
        expectedActiveRevisionId: bufferActiveRevisionId,
        ...(currentRevision?.id ? { baseRevisionId: currentRevision.id } : {}),
        candidateIds,
        ...(profileCandidatePromotionNote.trim()
          ? { reviewerNote: profileCandidatePromotionNote.trim() }
          : {}),
      });
      if (!isCurrentPageLoadRequest(page)) return;
      const revision =
        response.draftRevision ??
        (await loadProfileRevisionIntoEditor(studentId, response.draftRevisionId));
      if (!isCurrentPageLoadRequest(page)) return;
      if (response.draftRevision) {
        const form = foundationalProfileToFormState(revision.structuredContent);
        setProfileAvailable(true);
        setCurrentRevision(revision);
        setProfileForm(form);
        setLoadedProfileForm(form);
        setProfileDraftDiffBase(draftDiffBase);
        setProfileLegacyNotice(getLegacyProfileNotice(revision));
        setBufferActiveRevisionId(
          revision.baseActiveRevisionKnown ? revision.baseActiveRevisionId : undefined,
        );
        setDraftNeedsSave(false);
      }
      const revisions = await listProfileRevisions(studentId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      if (!isCurrentPageLoadRequest(page)) return;
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
      if (!isCurrentPageLoadRequest(page)) return;
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to refresh the draft from approved candidates.';
      setProfileCandidatePromotionError(message);
      reportProfileWriteError(error, message);
    } finally {
      if (isCurrentPageLoadRequest(page)) {
        setProfileBusy(null);
        setProfileCandidatePromotionBusy(false);
      }
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
      setProfileCandidateDrafts((current) => {
        if (!current[updated.id]) return current;
        const next = { ...current };
        delete next[updated.id];
        return next;
      });
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
      const candidate = profileCandidates.find((item) => item.id === candidateId);
      if (!candidate) return;
      setProfileCandidateDrafts((current) => ({
        ...current,
        [candidateId]: {
          approvedFactText:
            patch.approvedFactText ??
            current[candidateId]?.approvedFactText ??
            candidate.approvedFactText ??
            candidate.proposedFact,
          reviewerNote:
            patch.reviewerNote ??
            current[candidateId]?.reviewerNote ??
            candidate.reviewerNote ??
            '',
        },
      }));
    },
    [profileCandidates],
  );

  if (studentLoading && (!studioV2 || !student)) {
    if (studioV2) return <PageLoading page="learning" />;
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
    if (studioV2 && !profileError) return <PageLoading page="learning" />;
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
        : studioV2
          ? 'No learning summary yet.'
          : 'No established student-memory snapshot is available yet.';
  const canActivateDraft = currentRevision?.status === 'draft';
  const discardEditorChanges = () => {
    setProfileForm(loadedProfileForm);
    setConfirmDiscard(false);
    setEditing(false);
    setProfileError(null);
  };
  const closeEditor = () => {
    if (profileDirty) setConfirmDiscard(true);
    else discardEditorChanges();
  };
  const unresolvedIssues = latestSnapshot?.unresolvedIssues ?? [];
  const recentLessons = memoryOverview?.recentReadyLessonMemory ?? [];
  const recentHomework = memoryOverview?.recentReadyHomeworkMemory ?? [];
  if (profileAvailable === false && !studioV2) {
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

  const profileActions = (
    <div className="student-learning-action-row student-learning-action-row-main">
      {!studioV2 && (
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
      )}
      {(!studioV2 || editing) &&
        (canActivateDraft ? (
          <>
            <button
              type="button"
              className={studioV2 ? 'workspace-secondary-btn' : 'workspace-primary-btn'}
              onClick={() => void handleSaveDraft()}
              disabled={profileBusy !== null || (!profileDirty && !draftNeedsSave)}
            >
              {profileBusy === 'saving' ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              type="button"
              className="workspace-primary-btn"
              onClick={() => void handleActivateDraft()}
              disabled={
                profileBusy !== null ||
                profileDirty ||
                draftNeedsSave ||
                Boolean(profileUpdated) ||
                !currentRevision?.baseActiveRevisionKnown
              }
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
        ))}
      {studioV2 && editing && (
        <button
          type="button"
          className="workspace-secondary-btn"
          disabled={profileBusy !== null}
          onClick={closeEditor}
        >
          Cancel editing
        </button>
      )}
    </div>
  );

  const profileFields = (
    <div className="student-learning-section-grid" ref={profileEditorRef}>
      {PROFILE_SECTION_CONFIGS.map((section) => (
        <LearningSectionCard
          key={section.id}
          config={section}
          values={profileForm}
          onChange={handleProfileFieldChange}
          disabled={profileBusy !== null}
        />
      ))}
    </div>
  );

  const profileCard = (
    <article
      id="learning-profile"
      className="student-area-panel workspace-card student-learning-profile-card"
    >
      <header className="student-learning-block-header">
        <div>
          <h2 ref={profileHeadingRef} tabIndex={-1}>
            {studioV2 ? 'Learning profile' : 'Foundational Profile'}
          </h2>
          {studioV2 && (
            <p className="student-v2-profile-provenance">
              {currentRevision?.versionLabel ?? 'Profile revision'} ·{' '}
              {currentRevision?.status === 'deprecated'
                ? 'Earlier version'
                : (currentRevision?.status ?? 'Status unavailable')}
              {currentRevision ? ` · ${formatDateTime(currentRevision.createdAt)}` : ''}
            </p>
          )}
        </div>
        <div className={studioV2 ? 'student-v2-profile-actions' : undefined}>
          <button
            type="button"
            className={
              studioV2 ? 'product-button product-button--quiet' : 'workspace-secondary-btn'
            }
            disabled={profileBusy !== null}
            onClick={() => setUpdatesOpen(true)}
          >
            Profile updates
          </button>
          {studioV2 && (
            <button
              type="button"
              className="product-button product-button--secondary"
              disabled={profileBusy !== null}
              onClick={() => {
                setConfirmDiscard(false);
                if (profileAvailable) setEditing(true);
                else void handleStartEmptyProfile();
              }}
            >
              <Pencil aria-hidden="true" />
              {profileAvailable
                ? canActivateDraft
                  ? 'Edit draft'
                  : 'Edit profile'
                : 'Create learner profile'}
            </button>
          )}
        </div>
      </header>
      {studioV2 ? (
        <div className="student-v2-profile-reading">
          <section className="student-v2-profile-goals">
            <div>
              <h3>Learning goals</h3>
              {loadedProfileForm.overallLevel ? (
                <span className="student-v2-level">{loadedProfileForm.overallLevel}</span>
              ) : null}
            </div>
            <p>{loadedProfileForm.primaryGoals || 'No learning goals recorded yet.'}</p>
          </section>
          {PROFILE_SECTION_CONFIGS.slice(1).map((section) => {
            const fields = section.fields.filter((field) => loadedProfileForm[field.key].trim());
            if (!fields.length) return null;
            return (
              <details className="student-v2-profile-group" key={section.id}>
                <summary>
                  {section.eyebrow === 'Teacher Notes' ? 'Teacher notes' : section.eyebrow}
                  <ChevronRight size={16} aria-hidden="true" />
                </summary>
                <dl>
                  {fields.map((field) => (
                    <div key={field.key}>
                      <dt>{field.label}</dt>
                      <dd>{loadedProfileForm[field.key]}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            );
          })}
          {profileLegacyNotice && <p className="workspace-muted">{profileLegacyNotice}</p>}
        </div>
      ) : (
        <>
          {profileFields}
          <footer className="student-learning-editor-footer">
            <div>
              <strong>{profileDirty ? 'Unsaved structured edits' : 'No unsaved changes'}</strong>
            </div>
            {profileLegacyNotice ? <p className="workspace-muted">{profileLegacyNotice}</p> : null}
          </footer>
        </>
      )}
    </article>
  );
  const memoryCard = (
    <article
      id="learning-current"
      className="student-area-panel workspace-card student-learning-memory-card"
    >
      <header className="student-learning-block-header">
        <h2>{studioV2 ? 'Current learning' : 'Student Memory'}</h2>
        {studioV2 &&
          memoryHealth &&
          (memoryHealth.memoryCounts.lesson.pending.count > 0 ||
            memoryHealth.memoryCounts.homework.pending.count > 0 ||
            memoryHealth.latestSnapshot?.status === 'pending') && (
            <span className="student-learning-background-status" role="status">
              Updating learning summary…
            </span>
          )}
      </header>

      {memoryOverviewError ? (
        <p className="workspace-error" aria-live="polite">
          {memoryOverviewError}
          {memoryOverview ? ' Showing previously loaded memory.' : ''}
        </p>
      ) : null}

      {memoryOverviewLoading && !memoryOverview ? (
        <LoadingPlaceholder label="Loading memory summary" kind="lines" />
      ) : memoryRequestFailed ? (
        <p className="workspace-muted">Memory could not be loaded. Existing history is unknown.</p>
      ) : latestSnapshot ? (
        <>
          {studioV2 && unresolvedIssues.length > 0 && (
            <section className="student-v2-open-threads">
              <h3>
                Open threads <span>{unresolvedIssues.length}</span>
              </h3>
              <ul>
                {unresolvedIssues.map((issue) => (
                  <li key={`${issue.label}-${issue.note}`}>
                    <strong>{issue.label}</strong>
                    <p>{issue.note}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!studioV2 && (
            <p className="workspace-muted">
              Snapshot generated {formatDateTime(latestSnapshot.generatedAt)}
            </p>
          )}

          <div className="student-learning-memory-highlight">
            {studioV2 ? (
              <header>
                <h3>Memory summary</h3>
                <time dateTime={latestSnapshot.generatedAt}>
                  {formatDateTime(latestSnapshot.generatedAt)}
                </time>
              </header>
            ) : (
              <strong>Snapshot Summary</strong>
            )}
            <p>{latestSnapshot.snapshotSummary ?? 'No snapshot summary yet.'}</p>
          </div>

          <div className="student-learning-memory-columns">
            <MemoryEntriesSection
              collapsible={studioV2}
              title={studioV2 ? 'Recent lessons' : 'Recent Lesson Memory'}
              count={recentLessons.length}
            >
              {recentLessons.length > 0 ? (
                <ul>
                  {recentLessons.map((entry) => (
                    <li key={entry.id}>
                      {studioV2 && (
                        <header>
                          <strong>{entry.lessonTitle || 'Lesson'}</strong>
                          <time dateTime={entry.generatedAt}>
                            {formatDateTime(entry.generatedAt)}
                          </time>
                        </header>
                      )}
                      {entry.lessonSummary ?? 'Summary unavailable'}
                      {studioV2 && <LessonTranscriptDisclosure lesson={entry} compact />}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="workspace-muted">No ready lesson-memory entries yet.</p>
              )}
            </MemoryEntriesSection>

            <MemoryEntriesSection
              collapsible={studioV2}
              title={studioV2 ? 'Recent homework' : 'Recent Homework Memory'}
              count={recentHomework.length}
            >
              {recentHomework.length > 0 ? (
                <ul>
                  {recentHomework.map((entry) => (
                    <li key={entry.id}>
                      {studioV2 && (
                        <header>
                          <strong>{entry.topic || 'Homework'}</strong>
                          <time dateTime={entry.generatedAt}>
                            {formatDateTime(entry.generatedAt)}
                          </time>
                        </header>
                      )}
                      {entry.homeworkSummary ?? entry.topic ?? 'Summary unavailable'}
                      {studioV2 && (
                        <Link
                          className="student-memory-assignment-link"
                          to={`/?jobId=${encodeURIComponent(entry.jobId)}`}
                          aria-label={`Open assignment: ${entry.topic || 'Homework'}`}
                          title={`Open assignment: ${entry.topic || 'Homework'}`}
                        >
                          <BookOpen size={18} aria-hidden="true" />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="workspace-muted">No ready homework-memory entries yet.</p>
              )}
            </MemoryEntriesSection>

            {!studioV2 && (
              <section className="student-learning-memory-column">
                <h3>{studioV2 ? 'Open threads' : 'Current Open Threads'}</h3>
                {unresolvedIssues.length > 0 ? (
                  <ul>
                    {unresolvedIssues.map((issue) => (
                      <li key={`${issue.label}-${issue.note}`}>
                        <strong>{issue.label}</strong>
                        {studioV2 ? <p>{issue.note}</p> : `: ${issue.note}`}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-muted">No open threads in the latest memory snapshot.</p>
                )}
              </section>
            )}
          </div>
        </>
      ) : (
        <div className="student-learning-empty-block">
          <strong>{memoryUnavailableCopy}</strong>
          {studioV2 && (
            <Link
              className="learning-latest-work"
              to={`/?studentId=${encodeURIComponent(studentId)}`}
            >
              <Plus size={18} aria-hidden="true" />
              Start assignment
            </Link>
          )}
          {!studioV2 && (
            <p>
              {availability?.state === 'repair_required'
                ? 'Existing observations remain retained. A separately authorized rebuild is required before using the established summary.'
                : availability?.state === 'repository_unavailable'
                  ? 'Try again when memory retrieval is restored. The profile can still be edited manually.'
                  : 'The profile can still be edited manually, and this area will become more useful as lesson and homework memory accumulates.'}
            </p>
          )}
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
  );
  const candidatesPanel = (
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
      onRefreshCandidates={() =>
        profileDirty || draftNeedsSave || reviewDirty || profileBusy !== null
          ? Promise.resolve()
          : reloadCurrentLearningSurface()
      }
      onPromoteProfileCandidates={() => handleRefreshDraftFromCandidates(selectedCandidateIds)}
      onReviewProfileCandidate={handleReviewProfileCandidate}
    />
  );

  const profileFeedback = (
    <>
      {profileUpdated && !comparisonOpen ? (
        <div className="student-profile-updated" role="status">
          <span>Profile updated</span>
          <button
            type="button"
            className="workspace-secondary-btn"
            onClick={() => {
              setComparisonOpen(true);
              void refreshLatestProfile();
            }}
          >
            Review changes
          </button>
        </div>
      ) : null}
      {comparisonOpen ? (
        <section className="student-profile-comparison" aria-label="Compare profile versions">
          <h3>Profile updated</h3>
          <p>Your edits are kept. Compare before saving.</p>
          {comparisonBusy ? (
            <LoadingPlaceholder label="Loading current profile" kind="lines" />
          ) : null}
          {comparisonError ? <p role="alert">{comparisonError}</p> : null}
          {latestProfile && !comparisonBusy ? (
            <>
              <div className="student-profile-comparison-list">
                {comparisonItems.map((item) => (
                  <article key={item.key}>
                    <h4>{item.label}</h4>
                    <div>
                      <section aria-label="Current profile">
                        <h5>Current profile</h5>
                        <p>{item.before || 'Not recorded'}</p>
                      </section>
                      <section aria-label="Your edits">
                        <h5>Your edits</h5>
                        <p>{item.after || 'Not recorded'}</p>
                      </section>
                    </div>
                  </article>
                ))}
              </div>
              {!comparisonItems.length ? <p>The profile values match.</p> : null}
              <div className="student-learning-action-row">
                <button
                  type="button"
                  className="workspace-secondary-btn"
                  disabled={profileBusy !== null}
                  onClick={() => {
                    setBufferActiveRevisionId(latestProfile.activeRevisionId);
                    setDraftNeedsSave(currentRevision?.status === 'draft');
                    setComparisonOpen(false);
                    setProfileError(null);
                  }}
                >
                  Keep my edits
                </button>
                <button
                  type="button"
                  className="workspace-secondary-btn"
                  disabled={profileBusy !== null}
                  onClick={() => {
                    const form = foundationalProfileToFormState(latestProfile.structuredContent);
                    setProfileForm(form);
                    setLoadedProfileForm(form);
                    setCurrentRevision(
                      buildRevisionDetailFromProfile(
                        studentId,
                        latestProfile,
                        findCurrentProfileRevisionSummary(latestProfile, profileRevisions),
                      ),
                    );
                    setBufferActiveRevisionId(latestProfile.activeRevisionId);
                    setDraftNeedsSave(false);
                    setComparisonOpen(false);
                    setProfileDraftDiffBase(null);
                    setProfileError(null);
                  }}
                >
                  Use current profile
                </button>
              </div>
              {currentRevision?.status === 'draft' ? (
                <p>Save a new draft before activating.</p>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="workspace-secondary-btn"
              disabled={comparisonBusy}
              onClick={() => void refreshLatestProfile()}
            >
              Retry current profile
            </button>
          )}
        </section>
      ) : null}
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
    </>
  );

  const profileVersions = (
    <>
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
              {(!studioV2 || revision.id !== currentRevision?.id) && (
                <button
                  type="button"
                  className="workspace-secondary-btn"
                  onClick={() => void handleOpenRevision(revision.id)}
                  disabled={profileBusy !== null || profileDirty || draftNeedsSave || reviewDirty}
                  title={
                    profileDirty || draftNeedsSave || reviewDirty
                      ? 'Save or cancel your edits first'
                      : undefined
                  }
                >
                  Open
                </button>
              )}
              {revision.status !== 'active' ? (
                <button
                  type="button"
                  className="workspace-secondary-btn"
                  onClick={() => void handleRestoreRevision(revision.id)}
                  disabled={profileBusy !== null || profileDirty || draftNeedsSave || reviewDirty}
                  title={
                    profileDirty || draftNeedsSave || reviewDirty
                      ? 'Save or cancel your edits first'
                      : 'Restore this version as the active profile'
                  }
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
    </>
  );

  return (
    <section
      className={`student-learning-layout student-area-theme${studioV2 ? ' student-v2' : ''}`}
    >
      {updatesOpen ? (
        <ProfileUpdatesDialog
          key={studentId}
          studentId={studentId}
          onClose={() => setUpdatesOpen(false)}
          onProfileChanged={handleAutomaticProfileChange}
        />
      ) : null}
      {studioV2 && (
        <header className="student-v2-learning-heading">
          <div className="student-v2-learning-title">
            <h2>Learning</h2>
            <div className="student-v2-profile-actions">
              <button
                type="button"
                className="product-button product-button--quiet"
                onClick={() => setProfilePanel('versions')}
              >
                <History aria-hidden="true" />
                Profile versions
              </button>
              <button
                type="button"
                className="product-button product-button--quiet"
                onClick={() => setProfilePanel('suggestions')}
              >
                <Sparkles aria-hidden="true" />
                Profile suggestions
              </button>
            </div>
          </div>
          <nav aria-label="Learning sections">
            <a href="#learning-current">Current learning</a>
            <a href="#learning-profile">Learner profile</a>
          </nav>
        </header>
      )}
      {studioV2 && (
        <LearningLessonContext
          key={`${studentId}:${recentLessons[0]?.id ?? 'none'}`}
          studentId={studentId}
          latestLesson={recentLessons[0] ?? null}
        />
      )}
      {(!studioV2 ||
        (!editing &&
          !profilePanel &&
          (profileUpdated || comparisonOpen || profileError || profileSuccess))) && (
        <article className="student-area-panel student-learning-hero">
          {profileFeedback}
          {!studioV2 && (
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
          )}

          {!studioV2 && profileActions}
        </article>
      )}

      <div className="student-learning-main">
        <div className="student-learning-primary-column">
          {!studioV2 && currentRevision?.status === 'draft' && profileDraftDiffBase ? (
            <ProfileDraftDiffPanel items={profileDraftDiffItems} />
          ) : null}

          {studioV2 ? memoryCard : profileCard}

          {studioV2 ? profileCard : memoryCard}

          {!studioV2 && candidatesPanel}
        </div>

        {!studioV2 && (
          <aside
            id="learning-versions"
            className="student-area-panel workspace-card student-learning-sidebar"
          >
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

            {profileVersions}
          </aside>
        )}
      </div>
      {studioV2 && editing && (
        <StudioV2Dialog
          title={canActivateDraft ? 'Edit profile draft' : 'Edit profile'}
          drawer
          wide
          onClose={closeEditor}
          closeDisabled={profileBusy !== null}
        >
          <div className="studio-v2-dialog__body student-v2-profile-editor">
            {profileFeedback}
            {canActivateDraft && profileDraftDiffBase && (
              <ProfileDraftDiffPanel items={profileDraftDiffItems} />
            )}
            {profileFields}
            <footer className="student-learning-editor-footer">
              {confirmDiscard ? (
                <div
                  className="student-v2-discard"
                  role="group"
                  aria-label="Unsaved profile changes"
                >
                  <strong>Discard unsaved changes?</strong>
                  <div className="studio-v2-dialog__actions">
                    <button
                      type="button"
                      className="product-button product-button--secondary"
                      onClick={() => setConfirmDiscard(false)}
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      className="product-button product-button--danger"
                      onClick={discardEditorChanges}
                    >
                      Discard changes
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {profileDirty && <strong>Unsaved profile changes</strong>}
                  {profileLegacyNotice && <p className="workspace-muted">{profileLegacyNotice}</p>}
                  {profileActions}
                </>
              )}
            </footer>
          </div>
        </StudioV2Dialog>
      )}
      {studioV2 && profilePanel === 'versions' && (
        <StudioV2Dialog
          title="Profile versions"
          wide
          onClose={() => setProfilePanel(null)}
          closeDisabled={profileBusy !== null}
        >
          <div className="studio-v2-dialog__body student-v2-profile-versions">
            {profileFeedback}
            {visibleProfileRevisions.length ? profileVersions : <p>No saved versions yet.</p>}
          </div>
        </StudioV2Dialog>
      )}
      {studioV2 && profilePanel === 'suggestions' && (
        <StudioV2Dialog
          title="Profile suggestions"
          drawer
          wide
          onClose={() => setProfilePanel(null)}
          closeDisabled={profileCandidateAction !== null || profileCandidatePromotionBusy}
        >
          <div className="studio-v2-dialog__body student-v2-profile-suggestions">
            {profileFeedback}
            {candidatesUnavailable || profileCandidates.length > 0 ? (
              candidatesPanel
            ) : (
              <p className="workspace-muted">No profile suggestions yet.</p>
            )}
          </div>
        </StudioV2Dialog>
      )}
    </section>
  );
};
