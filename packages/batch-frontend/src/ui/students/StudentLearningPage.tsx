import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ProfileContentResponse,
  ProfileRevisionDetailResponse,
  ProfileRevisionSummaryResponse,
  StudentMemoryOverviewResponse,
  StudentProfileCandidate,
  StudentProfileBindingListResponse,
} from '../../utils/api';
import {
  activateProfileRevision,
  approveStudentProfileCandidate,
  deferStudentProfileCandidate,
  getProfileContent,
  getProfileRevision,
  getStudentMemoryOverview,
  initializeStudentProfileDraft,
  listProfileRevisions,
  listStudentProfileBindings,
  listStudentProfileCandidates,
  populateFirstProfileFromLesson,
  promoteStudentProfileCandidates,
  rejectStudentProfileCandidate,
  restoreProfileRevision,
  saveProfileDraftRevision,
} from '../../utils/api';
import { useStudentAreaContext } from './StudentAreaContext';
import {
  foundationalProfileFormToStructuredContent,
  foundationalProfileToFormState,
  getApprovedCandidatesReadyForPromotion,
  INITIAL_FOUNDATIONAL_PROFILE_FORM,
  PROFILE_CANDIDATE_PENDING_FILTER,
  type CandidateActionKind,
  type FoundationalProfileFormState,
  type ProfileCandidateFilter,
} from './StudentWorkspace.logic';
import { WorkspaceCandidatesPanel } from './WorkspaceCandidatesPanel';
import { formatStudentShortId } from './studentIdentity';

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
    ? 'This revision is still markdown-only. Saving a draft here will create the canonical structured revision.'
    : null;
}

function getProfileSnapshot(form: FoundationalProfileFormState): string {
  return JSON.stringify(foundationalProfileFormToStructuredContent(form));
}

function buildRevisionDetailFromProfile(
  profileId: string,
  profile: ProfileContentResponse,
): ProfileRevisionDetailResponse | null {
  if (!profile.currentRevisionId) return null;
  return {
    id: profile.currentRevisionId,
    profileId,
    contentHash: '',
    source: 'update',
    status: 'active',
    versionNumber: 0,
    versionLabel: 'Current',
    activatedAt: profile.updatedAt ?? null,
    deprecatedAt: null,
    createdAt: profile.updatedAt ?? new Date().toISOString(),
    createdBy: null,
    restoredFromRevisionId: null,
    content: profile.content,
    structuredContent: profile.structuredContent,
  };
}

function countListItems(value: string): number {
  return value
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean).length;
}

function countFilledProfileSections(form: FoundationalProfileFormState): number {
  return [
    form.overallLevel,
    form.primaryGoals,
    form.communicationContexts,
    form.interestsAndUsefulThemes,
    form.stableStrengths,
    form.persistentChallenges,
    form.studyPreferences,
    form.durableConstraints,
    form.teacherNotes,
  ].filter((value) => value.trim().length > 0).length;
}

function getRevisionStateLabel(revision: ProfileRevisionDetailResponse | null): string {
  if (!revision) return 'No Revision Yet';
  if (revision.status === 'draft') return 'Draft In Progress';
  if (revision.status === 'deprecated') return 'Deprecated Revision';
  return 'Active Revision';
}

function getProfileReadinessLabel(populatedFields: number): string {
  if (populatedFields >= 7) return 'Strong Coverage';
  if (populatedFields >= 4) return 'Good Working Draft';
  if (populatedFields >= 1) return 'Starter Profile';
  return 'Needs First Pass';
}

function getProfileReadinessDetail(form: FoundationalProfileFormState): string {
  const populatedFields = countFilledProfileSections(form);
  return `${populatedFields}/9 durable fields populated`;
}

function getSnapshotLabel(snapshot: StudentMemoryOverviewResponse['latestReadyStudentMemorySnapshot']): string {
  if (!snapshot) return 'No Snapshot Yet';
  return `Ready • ${snapshot.lessonMemoryEntryIds.length} lesson signal${
    snapshot.lessonMemoryEntryIds.length === 1 ? '' : 's'
  }`;
}

function getDraftSourceLabel(revision: ProfileRevisionDetailResponse | null): string {
  if (!revision) return 'Start the first profile draft to make this page actionable.';
  if (revision.status === 'draft') {
    return 'This draft is editable but not yet shaping prompt packages until activation.';
  }
  return 'This active revision is the canonical pedagogical truth for downstream generation.';
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
}: LearningFieldProps): React.JSX.Element {
  const inputId = `learning-${config.key}`;
  const helpId = `${inputId}-help`;
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
          aria-describedby={helpId}
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
          aria-describedby={helpId}
        />
      )}
      <p id={helpId}>{config.help}</p>
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

export const StudentLearningPage: React.FC = () => {
  const { student, studentId, studentLoading, studentError, refreshStudent } = useStudentAreaContext();
  const latestPageLoadRequestRef = useRef(0);
  const [bootstrapProfileId, setBootstrapProfileId] = useState<string | null>(null);
  const profileId = student?.profileId ?? bootstrapProfileId ?? '';

  const [profileForm, setProfileForm] = useState<FoundationalProfileFormState>(
    INITIAL_FOUNDATIONAL_PROFILE_FORM,
  );
  const [loadedProfileForm, setLoadedProfileForm] = useState<FoundationalProfileFormState>(
    INITIAL_FOUNDATIONAL_PROFILE_FORM,
  );
  const [currentRevision, setCurrentRevision] = useState<ProfileRevisionDetailResponse | null>(null);
  const [profileRevisions, setProfileRevisions] = useState<ProfileRevisionSummaryResponse[]>([]);
  const [profileBusy, setProfileBusy] = useState<
    'loading' | 'saving' | 'restoring' | 'activating' | 'populating' | 'promoting' | null
  >(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileLegacyNotice, setProfileLegacyNotice] = useState<string | null>(null);

  const [memoryOverview, setMemoryOverview] = useState<StudentMemoryOverviewResponse | null>(null);
  const [memoryOverviewLoading, setMemoryOverviewLoading] = useState(false);
  const [memoryOverviewError, setMemoryOverviewError] = useState<string | null>(null);

  const [bindingHistory, setBindingHistory] = useState<StudentProfileBindingListResponse['items']>([]);
  const [bindingHistoryLoading, setBindingHistoryLoading] = useState(false);
  const [bindingHistoryError, setBindingHistoryError] = useState<string | null>(null);

  const [profileCandidates, setProfileCandidates] = useState<StudentProfileCandidate[]>([]);
  const [profileCandidatesLoading, setProfileCandidatesLoading] = useState(false);
  const [profileCandidatesError, setProfileCandidatesError] = useState<string | null>(null);
  const [profileCandidateFilter, setProfileCandidateFilter] =
    useState<ProfileCandidateFilter>(PROFILE_CANDIDATE_PENDING_FILTER);
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

  const approvedCandidatesReadyForPromotion = useMemo(
    () => getApprovedCandidatesReadyForPromotion(profileCandidates),
    [profileCandidates],
  );

  const populatedProfileFields = useMemo(
    () => countFilledProfileSections(profileForm),
    [profileForm],
  );

  const profileHealthDetail = useMemo(
    () => getProfileReadinessDetail(profileForm),
    [profileForm],
  );

  useEffect(() => {
    setBootstrapProfileId(null);
  }, [studentId]);

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
    async (targetProfileId: string, revisionId: string) => {
      const requestId = latestPageLoadRequestRef.current;
      const revision = await getProfileRevision(targetProfileId, revisionId);
      if (!isCurrentPageLoadRequest(requestId)) {
        return revision;
      }
      const form = foundationalProfileToFormState(revision.structuredContent);
      setCurrentRevision(revision);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileLegacyNotice(getLegacyProfileNotice(revision));
      return revision;
    },
    [isCurrentPageLoadRequest],
  );

  const loadProfileSurface = useCallback(
    async (requestId: number) => {
      if (!profileId) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setCurrentRevision(null);
        setProfileRevisions([]);
        setProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
        setLoadedProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
        setProfileLegacyNotice(null);
        return;
      }

      setProfileBusy('loading');
      setProfileError(null);
      try {
        const [profile, revisions] = await Promise.all([
          getProfileContent(profileId),
          listProfileRevisions(profileId, { limit: 25, offset: 0, order: 'desc' }),
        ]);
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        const revision =
          profile.currentRevisionId && profile.currentRevisionId.trim()
            ? await getProfileRevision(profileId, profile.currentRevisionId).catch(() =>
                buildRevisionDetailFromProfile(profileId, profile),
              )
            : buildRevisionDetailFromProfile(profileId, profile);
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        const form = foundationalProfileToFormState(
          revision?.structuredContent ?? profile.structuredContent,
        );
        setCurrentRevision(revision);
        setProfileForm(form);
        setLoadedProfileForm(form);
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
    [isCurrentPageLoadRequest, profileId],
  );

  const loadMemoryOverview = useCallback(
    async (requestId: number) => {
      if (!studentId) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setMemoryOverview(null);
        return;
      }
      setMemoryOverviewLoading(true);
      setMemoryOverviewError(null);
      try {
        const nextMemoryOverview = await getStudentMemoryOverview(studentId, {
          lessonLimit: 3,
          homeworkLimit: 2,
        });
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setMemoryOverview(nextMemoryOverview);
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

  const loadBindingHistory = useCallback(
    async (requestId: number) => {
      if (!studentId) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setBindingHistory([]);
        return;
      }
      setBindingHistoryLoading(true);
      setBindingHistoryError(null);
      try {
        const response = await listStudentProfileBindings(studentId, {
          limit: 5,
          offset: 0,
          order: 'desc',
        });
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        setBindingHistory(response.items ?? []);
      } catch (error) {
        if (!isCurrentPageLoadRequest(requestId)) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unable to load binding history.';
        setBindingHistoryError(message);
      } finally {
        if (isCurrentPageLoadRequest(requestId)) {
          setBindingHistoryLoading(false);
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
      loadBindingHistory(requestId),
      loadProfileCandidates(requestId),
    ]);
  }, [loadBindingHistory, loadMemoryOverview, loadProfileCandidates, loadProfileSurface]);

  useEffect(() => {
    const requestId = latestPageLoadRequestRef.current + 1;
    latestPageLoadRequestRef.current = requestId;

    if (!studentId) return undefined;
    void Promise.all([
      loadProfileSurface(requestId),
      loadMemoryOverview(requestId),
      loadBindingHistory(requestId),
      loadProfileCandidates(requestId),
    ]);

    return () => {
      latestPageLoadRequestRef.current += 1;
    };
  }, [
    loadBindingHistory,
    loadMemoryOverview,
    loadProfileCandidates,
    loadProfileSurface,
    studentId,
  ]);

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
    if (!profileId) {
      setProfileError('Bind a learner profile before saving a draft.');
      return;
    }

    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const saved = await saveProfileDraftRevision(profileId, {
        structuredContent: foundationalProfileFormToStructuredContent(profileForm),
      });
      const form = foundationalProfileToFormState(saved.structuredContent);
      setCurrentRevision(saved);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileLegacyNotice(null);
      const revisions = await listProfileRevisions(profileId, {
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

  const handleStartEmptyProfile = async () => {
    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const response = await initializeStudentProfileDraft(studentId);
      setBootstrapProfileId(response.profileId);
      const form = foundationalProfileToFormState(response.draftRevision.structuredContent);
      setCurrentRevision(response.draftRevision);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileLegacyNotice(null);
      setProfileRevisions([
        {
          id: response.draftRevision.id,
          profileId: response.draftRevision.profileId,
          contentHash: response.draftRevision.contentHash,
          source: response.draftRevision.source,
          status: response.draftRevision.status,
          versionNumber: response.draftRevision.versionNumber,
          versionLabel: response.draftRevision.versionLabel,
          activatedAt: response.draftRevision.activatedAt,
          deprecatedAt: response.draftRevision.deprecatedAt,
          createdAt: response.draftRevision.createdAt,
          createdBy: response.draftRevision.createdBy,
          restoredFromRevisionId: response.draftRevision.restoredFromRevisionId,
        },
      ]);
      await refreshStudent();
      setProfileSuccess('Empty draft created. Add the durable learner context, then save when ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start the learner profile.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleActivateDraft = async () => {
    if (!profileId || !currentRevision?.id) {
      setProfileError('Open a draft revision before activating it.');
      return;
    }

    setProfileBusy('activating');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      await activateProfileRevision(profileId, currentRevision.id);
      await Promise.all([reloadCurrentLearningSurface(), refreshStudent()]);
      setProfileSuccess('Draft activated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to activate the draft.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!profileId) return;

    setProfileBusy('restoring');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const restored = await restoreProfileRevision(profileId, revisionId);
      const restoredRevision = restored.currentRevisionId
        ? await getProfileRevision(profileId, restored.currentRevisionId).catch(() =>
            buildRevisionDetailFromProfile(profileId, restored),
          )
        : buildRevisionDetailFromProfile(profileId, restored);
      const form = foundationalProfileToFormState(
        restoredRevision?.structuredContent ?? restored.structuredContent,
      );
      setCurrentRevision(restoredRevision);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileLegacyNotice(getLegacyProfileNotice(restoredRevision ?? restored));
      const revisions = await listProfileRevisions(profileId, {
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

  const handlePopulateFirstProfile = async () => {
    setProfileBusy('populating');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const response = await populateFirstProfileFromLesson(studentId);
      setBootstrapProfileId(response.profileId);
      const revision =
        response.draftRevision ??
        (await loadProfileRevisionIntoEditor(response.profileId, response.draftRevisionId));
      if (response.draftRevision) {
        const form = foundationalProfileToFormState(revision.structuredContent);
        setCurrentRevision(revision);
        setProfileForm(form);
        setLoadedProfileForm(form);
        setProfileLegacyNotice(getLegacyProfileNotice(revision));
      }
      const revisions = await listProfileRevisions(response.profileId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      await refreshStudent();
      setProfileSuccess('Draft profile populated from the latest lesson memory.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to populate the first profile draft.';
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
    try {
      const response = await promoteStudentProfileCandidates(studentId, {
        candidateIds,
        ...(profileCandidatePromotionNote.trim()
          ? { reviewerNote: profileCandidatePromotionNote.trim() }
          : {}),
      });
      const revision =
        response.draftRevision ??
        (await loadProfileRevisionIntoEditor(response.profileId, response.draftRevisionId));
      if (response.draftRevision) {
        const form = foundationalProfileToFormState(revision.structuredContent);
        setCurrentRevision(revision);
        setProfileForm(form);
        setLoadedProfileForm(form);
        setProfileLegacyNotice(getLegacyProfileNotice(revision));
      }
      const revisions = await listProfileRevisions(response.profileId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setSelectedCandidateIds([]);
      setProfileCandidatePromotionSuccess(
        'Structured draft revision refreshed from approved candidates.',
      );
      setProfileSuccess('Draft revision opened in the editor.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh the draft from approved candidates.';
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
        <p>Restoring the canonical learner profile, revision history, and teaching signals.</p>
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

  if (!profileId) {
    return (
      <section className="student-learning-layout student-area-theme student-learning-bootstrap">
        <div className="student-learning-bootstrap-copy">
          <span className="student-learning-eyebrow">Learning</span>
          <h2>Build the first foundational profile</h2>
          <p>
            {student.student} does not have a canonical learner profile yet. Start an empty
            structured profile or bootstrap one from lesson evidence here.
          </p>
        </div>

        <div className="student-learning-bootstrap-grid">
          <article className="student-learning-bootstrap-card">
            <span className="student-learning-card-eyebrow">Manual Start</span>
            <h3>Start Empty Profile</h3>
            <p>
              Open a clean structured draft when you already know the learner well and want direct
              control.
            </p>
            <button
              type="button"
              className="workspace-primary-btn"
              onClick={() => void handleStartEmptyProfile()}
              disabled={profileBusy !== null}
            >
              {profileBusy === 'saving' ? 'Starting…' : 'Start Empty Profile'}
            </button>
          </article>

          <article className="student-learning-bootstrap-card">
            <span className="student-learning-card-eyebrow">Guided Start</span>
            <h3>Populate First Profile From Lesson</h3>
            <p>
              Draft a first profile from lesson evidence and student memory, then review it before
              activation.
            </p>
            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => void handlePopulateFirstProfile()}
              disabled={profileBusy !== null}
            >
              {profileBusy === 'populating'
                ? 'Populating…'
                : 'Populate First Profile From Lesson'}
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

        <style>{learningPageStyles}</style>
      </section>
    );
  }

  const latestSnapshot = memoryOverview?.latestReadyStudentMemorySnapshot ?? null;
  const activeBinding = bindingHistory[0] ?? null;
  const canActivateDraft = currentRevision?.status === 'draft';
  const unresolvedIssues = memoryOverview?.unresolvedIssues ?? [];
  const recentLessons = memoryOverview?.recentReadyLessonMemory ?? [];
  const recentHomework = memoryOverview?.recentReadyHomeworkMemory ?? [];

  return (
    <section className="student-learning-layout student-area-theme">
      <article className="student-area-panel card student-learning-hero">
        <div className="student-learning-hero-copy">
          <span className="student-learning-eyebrow">Learning</span>
          <p>
            Review durable truth, memory signals, and candidate facts in one calm editing surface.
          </p>
        </div>

        <div className="student-learning-status-grid">
          <LearningMetricCard
            eyebrow="Revision State"
            value={getRevisionStateLabel(currentRevision)}
            detail={`${
              currentRevision?.versionLabel ?? currentRevision?.id ?? 'No revision yet'
            } • ${formatDateTime(currentRevision?.createdAt ?? activeBinding?.createdAt)}`}
            tone={currentRevision?.status === 'draft' ? 'accent' : 'success'}
          />
          <LearningMetricCard
            eyebrow="Profile Readiness"
            value={getProfileReadinessLabel(populatedProfileFields)}
            detail={profileHealthDetail}
          />
          <LearningMetricCard
            eyebrow="Memory Snapshot"
            value={getSnapshotLabel(latestSnapshot)}
            detail={
              latestSnapshot
                ? `${formatDateTime(latestSnapshot.generatedAt)} • ${
                    unresolvedIssues.length
                  } open thread${unresolvedIssues.length === 1 ? '' : 's'}`
                : 'Generate student memory to strengthen this teaching view.'
            }
          />
          <LearningMetricCard
            eyebrow="Promotion Queue"
            value={`${approvedCandidatesReadyForPromotion.length} Ready`}
            detail="Approved profile candidates that can become the next draft revision."
          />
        </div>

        <div className="student-learning-action-grid">
          <div className="student-learning-action-cluster">
            <span className="student-learning-card-eyebrow">Generated Helpers</span>
            <div className="student-learning-action-row">
              <button
                type="button"
                className="workspace-secondary-btn"
                onClick={() => void handlePopulateFirstProfile()}
                disabled={profileBusy !== null}
              >
                {profileBusy === 'populating'
                  ? 'Populating…'
                  : 'Populate First Profile From Lesson'}
              </button>
              <button
                type="button"
                className="workspace-secondary-btn"
                onClick={() =>
                  void handleRefreshDraftFromCandidates(
                    approvedCandidatesReadyForPromotion.map((candidate) => candidate.id),
                  )
                }
                disabled={profileBusy !== null || approvedCandidatesReadyForPromotion.length === 0}
              >
                {profileBusy === 'promoting'
                  ? 'Refreshing…'
                  : 'Refresh Draft From Approved Candidates'}
              </button>
            </div>
          </div>

          <div className="student-learning-action-cluster">
            <span className="student-learning-card-eyebrow">Revision Controls</span>
            <div className="student-learning-action-row">
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
                disabled={profileBusy !== null || !canActivateDraft}
              >
                {profileBusy === 'activating' ? 'Activating…' : 'Activate Draft'}
              </button>
            </div>
          </div>
        </div>

        <div className="student-learning-system-note">
          <p>
            <strong>{formatStudentShortId(studentId)}</strong>
          </p>
          <p>{getDraftSourceLabel(currentRevision)}</p>
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
          <article className="student-area-panel workspace-card card student-learning-profile-card">
            <header className="student-learning-block-header">
              <div>
                <span className="student-learning-card-eyebrow">Foundational Profile</span>
                <h2>Foundational Profile</h2>
              </div>
              <p>
                Structured edits here drive the rendered prompt-package profile block and should stay
                focused on durable pedagogical truth.
              </p>
            </header>

            <div className="student-learning-profile-summary">
              <LearningMetricCard
                eyebrow="Goals"
                value={`${countListItems(profileForm.primaryGoals)}`}
                detail="durable targets"
              />
              <LearningMetricCard
                eyebrow="Contexts"
                value={`${countListItems(profileForm.communicationContexts)}`}
                detail="real-world use cases"
              />
              <LearningMetricCard
                eyebrow="Strengths"
                value={`${countListItems(profileForm.stableStrengths)}`}
                detail="stable assets to lean on"
              />
              <LearningMetricCard
                eyebrow="Challenges"
                value={`${countListItems(profileForm.persistentChallenges)}`}
                detail="recurring issues to track"
              />
            </div>

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
                <p>
                  Save the whole profile as one draft revision, then activate explicitly when the
                  canonical truth looks right.
                </p>
              </div>
              {profileLegacyNotice ? <p className="workspace-muted">{profileLegacyNotice}</p> : null}
            </footer>
          </article>

          <article className="student-area-panel workspace-card card student-learning-memory-card">
            <header className="student-learning-block-header">
              <div>
                <span className="student-learning-card-eyebrow">Memory & Signals</span>
                <h2>Memory & Signals</h2>
              </div>
              <p>
                Use recent memory to update the profile and plan lessons without turning this page
                into a chronology dump.
              </p>
            </header>

            {memoryOverviewError ? (
              <p className="workspace-error" aria-live="polite">
                {memoryOverviewError}
              </p>
            ) : null}

            {memoryOverviewLoading ? (
              <p className="workspace-muted">Loading memory summary…</p>
            ) : latestSnapshot ? (
              <>
                <div className="student-learning-memory-summary">
                  <LearningMetricCard
                    eyebrow="Snapshot"
                    value={latestSnapshot.id}
                    detail={`Generated ${formatDateTime(latestSnapshot.generatedAt)}`}
                  />
                  <LearningMetricCard
                    eyebrow="Recent Lessons"
                    value={`${recentLessons.length}`}
                    detail="memory entries in view"
                  />
                  <LearningMetricCard
                    eyebrow="Recent Homework"
                    value={`${recentHomework.length}`}
                    detail="published assignment traces"
                  />
                  <LearningMetricCard
                    eyebrow="Open Threads"
                    value={`${unresolvedIssues.length}`}
                    detail="issues still worth carrying forward"
                  />
                </div>

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
                      <p className="workspace-muted">No unresolved teaching threads surfaced.</p>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <div className="student-learning-empty-block">
                <strong>No ready student-memory snapshot is available yet.</strong>
                <p>
                  The profile can still be edited manually, and this area will become more useful as
                  lesson and homework memory accumulates.
                </p>
              </div>
            )}
          </article>

          <WorkspaceCandidatesPanel
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
            onPromoteProfileCandidates={() => handleRefreshDraftFromCandidates(selectedCandidateIds)}
            onReviewProfileCandidate={handleReviewProfileCandidate}
          />
        </div>

        <aside className="student-area-panel workspace-card card student-learning-sidebar">
          <header className="student-learning-block-header">
            <div>
              <span className="student-learning-card-eyebrow">Revision Rail</span>
              <h2>Revision History</h2>
            </div>
            <p>
              Keep revision mechanics close at hand without letting chronology dominate the editing
              experience.
            </p>
          </header>

          <div className="student-learning-rail-summary">
            <LearningMetricCard
              eyebrow="Current Revision"
              value={currentRevision?.versionLabel ?? currentRevision?.id ?? 'n/a'}
              detail={currentRevision?.status ?? 'no current revision'}
              tone={currentRevision?.status === 'draft' ? 'accent' : 'success'}
            />
            <LearningMetricCard
              eyebrow="Student Identifier"
              value={formatStudentShortId(studentId)}
              detail={
                activeBinding
                  ? `Profile active since ${formatDateTime(activeBinding.effectiveFrom)}`
                  : 'Profile activation history is not available yet'
              }
            />
          </div>

          {bindingHistoryError ? (
            <p className="workspace-error" aria-live="polite">
              {bindingHistoryError}
            </p>
          ) : null}
          {bindingHistoryLoading ? (
            <p className="workspace-muted">Loading binding history…</p>
          ) : null}

          <div className="workspace-list student-learning-revision-list">
            {profileRevisions.map((revision) => (
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
                    onClick={() => void loadProfileRevisionIntoEditor(profileId, revision.id)}
                    disabled={profileBusy !== null}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="workspace-secondary-btn"
                    onClick={() => void handleRestoreRevision(revision.id)}
                    disabled={profileBusy !== null}
                  >
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="student-learning-binding">
            <strong>Student Identifier</strong>
            {activeBinding ? (
              <p className="workspace-muted">
                {formatStudentShortId(studentId)} • profile active since{' '}
                {formatDateTime(activeBinding.effectiveFrom)}.
              </p>
            ) : (
              <p className="workspace-muted">Profile activation history is not available yet.</p>
            )}
            <p className="workspace-muted">
              Learning now owns the canonical learner profile workflow.
            </p>
          </div>
        </aside>
      </div>

      <style>{learningPageStyles}</style>
    </section>
  );
};

const learningPageStyles = `
  .student-learning-layout {
    display: grid;
    gap: clamp(1rem, 2vw, 1.35rem);
  }

  .student-learning-main {
    display: grid;
    gap: 1rem;
  }

  .student-learning-layout .card,
  .student-learning-layout .workspace-card {
    border: 1px solid var(--student-area-line);
    border-radius: var(--student-area-radius-md);
    background:
      radial-gradient(circle at top right, rgba(20, 63, 115, 0.06), transparent 34%),
      var(--student-area-panel);
    box-shadow: var(--student-area-shadow-soft);
  }

  .student-learning-primary-column {
    display: grid;
    gap: 1rem;
    min-width: 0;
  }

  .student-learning-hero,
  .workspace-card,
  .student-learning-bootstrap,
  .student-learning-status-panel,
  .student-learning-standalone-state {
    display: grid;
    gap: 1rem;
  }

  .student-learning-hero,
  .student-learning-bootstrap,
  .student-learning-status-panel,
  .student-learning-standalone-state {
    padding: clamp(1.25rem, 3vw, 1.8rem);
    border: 1px solid var(--student-area-line);
    border-radius: var(--student-area-radius-md);
    background:
      radial-gradient(circle at top right, rgba(20, 63, 115, 0.09), transparent 32%),
      linear-gradient(180deg, rgba(255, 253, 248, 0.96), rgba(244, 234, 219, 0.76));
    box-shadow: var(--student-area-shadow-soft);
  }

  .student-learning-hero-copy h2,
  .student-learning-block-header h2,
  .student-learning-bootstrap h2,
  .student-learning-section-header h3,
  .student-learning-memory-column h3,
  .workspace-card h2,
  .workspace-card h3 {
    margin: 0;
    text-wrap: balance;
  }

  .student-learning-hero-copy p,
  .student-learning-block-header p,
  .student-learning-bootstrap p,
  .student-learning-section-header p,
  .student-learning-system-note p,
  .workspace-card p {
    margin: 0;
  }

  .student-learning-eyebrow,
  .student-learning-card-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-tertiary, #6b7280);
  }

  .student-learning-card-eyebrow {
    color: var(--student-area-blue);
  }

  .student-learning-status-grid,
  .student-learning-profile-summary,
  .student-learning-memory-summary,
  .student-learning-rail-summary {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .student-learning-metric {
    min-width: 0;
    display: grid;
    gap: 0.3rem;
    padding: 1rem;
    border-radius: 18px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
  }

  .student-learning-metric strong {
    font-size: 1.05rem;
    line-height: 1.25;
    min-width: 0;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }

  .student-learning-metric p {
    color: var(--student-area-muted);
    font-size: 0.92rem;
    line-height: 1.45;
  }

  .student-learning-metric-success {
    background: var(--student-area-sage-soft);
  }

  .student-learning-metric-accent {
    border-color: rgba(145, 98, 12, 0.18);
    background: var(--student-area-amber-soft);
  }

  .student-learning-action-grid {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .student-learning-action-cluster {
    display: grid;
    gap: 0.65rem;
    padding: 1rem;
    border: 1px solid var(--student-area-line);
    border-radius: 18px;
    background: rgba(255, 253, 248, 0.72);
  }

  .student-learning-action-row,
  .student-learning-inline,
  .workspace-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .student-learning-system-note {
    display: grid;
    gap: 0.35rem;
    padding: 0.95rem 1rem;
    border-radius: 18px;
    background: rgba(42, 36, 26, 0.045);
    color: var(--student-area-muted);
  }

  .student-learning-system-note code,
  .student-learning-binding code {
    font-size: 0.92rem;
    background: rgba(255, 255, 255, 0.7);
    padding: 0.2rem 0.45rem;
    border-radius: 8px;
  }

  .student-learning-block-header {
    display: grid;
    gap: 0.5rem;
  }

  .student-learning-profile-card,
  .student-learning-memory-card,
  .student-learning-sidebar {
    gap: 1.25rem;
  }

  .student-learning-section-grid {
    display: grid;
    gap: 1rem;
  }

  .student-learning-section-card {
    display: grid;
    gap: 0.9rem;
    padding: 1.1rem;
    border-radius: 22px;
    border: 1px solid var(--student-area-line);
    background:
      radial-gradient(circle at top right, rgba(20, 63, 115, 0.055), transparent 28%),
      rgba(255, 253, 248, 0.82);
    min-width: 0;
  }

  .student-learning-section-header {
    display: grid;
    gap: 0.35rem;
  }

  .student-learning-section-fields {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .student-learning-field {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
  }

  .student-learning-field-full {
    grid-column: 1 / -1;
  }

  .student-learning-field label {
    font-weight: 600;
    color: var(--text-primary, #0f172a);
  }

  .student-learning-field p {
    color: var(--text-secondary, #52606d);
    font-size: 0.92rem;
    line-height: 1.4;
  }

  .workspace-field input,
  .workspace-field textarea,
  .workspace-field select,
  .student-learning-field input,
  .student-learning-field textarea {
    width: 100%;
    min-width: 0;
    border: 1px solid rgba(15, 23, 42, 0.12);
    border-radius: 16px;
    padding: 0.85rem 0.95rem;
    font: inherit;
    color: inherit;
    background: rgba(255, 255, 255, 0.92);
    transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
  }

  .workspace-field textarea,
  .student-learning-field textarea {
    resize: vertical;
  }

  .workspace-field input:focus-visible,
  .workspace-field textarea:focus-visible,
  .workspace-field select:focus-visible,
  .student-learning-field input:focus-visible,
  .student-learning-field textarea:focus-visible,
  .workspace-primary-btn:focus-visible,
  .workspace-secondary-btn:focus-visible,
  .student-learning-binding a:focus-visible {
    outline: 2px solid transparent;
    border-color: rgba(20, 63, 115, 0.45);
    box-shadow: 0 0 0 4px rgba(20, 63, 115, 0.14);
  }

  .workspace-primary-btn,
  .workspace-secondary-btn,
  .student-learning-empty a,
  .student-learning-binding a {
    width: fit-content;
    border: 0;
    border-radius: 999px;
    padding: 0.8rem 1.05rem;
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition:
      transform 160ms ease,
      box-shadow 160ms ease,
      background-color 160ms ease,
      color 160ms ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .workspace-primary-btn:hover:not(:disabled),
  .workspace-secondary-btn:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .workspace-primary-btn:disabled,
  .workspace-secondary-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    transform: none;
    box-shadow: none;
  }

  .workspace-primary-btn {
    background: linear-gradient(135deg, var(--student-area-blue), #245a97);
    color: white;
    box-shadow: 0 12px 24px rgba(20, 63, 115, 0.18);
  }

  .workspace-primary-btn:hover:not(:disabled) {
    box-shadow: 0 14px 28px rgba(20, 63, 115, 0.24);
  }

  .workspace-secondary-btn,
  .student-learning-empty a,
  .student-learning-binding a {
    background: var(--student-area-blue-soft);
    color: var(--student-area-blue);
  }

  .workspace-secondary-btn:hover:not(:disabled) {
    background: rgba(20, 63, 115, 0.14);
  }

  .workspace-muted {
    color: var(--text-secondary, #52606d);
  }

  .workspace-error,
  .workspace-success {
    margin: 0;
    padding: 0.95rem 1rem;
    border-radius: 18px;
    line-height: 1.5;
  }

  .workspace-error {
    color: #991b1b;
    background: rgba(254, 242, 242, 0.92);
    border: 1px solid rgba(248, 113, 113, 0.2);
  }

  .workspace-success {
    color: #065f46;
    background: rgba(236, 253, 245, 0.94);
    border: 1px solid rgba(16, 185, 129, 0.18);
  }

  .workspace-list {
    display: grid;
    gap: 0.75rem;
  }

  .workspace-list-item {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.9rem 1rem;
    border-radius: 18px;
    background: rgba(15, 23, 42, 0.03);
    min-width: 0;
  }

  .workspace-list-item-stack {
    flex-direction: column;
  }

  .workspace-create-panel,
  .workspace-candidate-group,
  .workspace-candidate-body,
  .workspace-candidate-details {
    display: grid;
    gap: 0.85rem;
  }

  .workspace-header-row {
    justify-content: space-between;
  }

  .workspace-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.08);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .workspace-candidate-summary {
    cursor: pointer;
    list-style: none;
  }

  .workspace-candidate-summary::-webkit-details-marker {
    display: none;
  }

  .student-learning-editor-footer,
  .student-learning-empty-block,
  .student-learning-binding,
  .student-learning-memory-highlight {
    display: grid;
    gap: 0.45rem;
    padding: 1rem;
    border-radius: 18px;
    background: rgba(42, 36, 26, 0.045);
  }

  .student-learning-memory-highlight strong,
  .student-learning-editor-footer strong,
  .student-learning-binding strong {
    font-size: 0.98rem;
  }

  .student-learning-memory-columns {
    display: grid;
    gap: 0.9rem;
  }

  .student-learning-memory-column {
    display: grid;
    gap: 0.6rem;
    min-width: 0;
    padding: 1rem;
    border: 1px solid var(--student-area-line);
    border-radius: 18px;
    background: rgba(255, 253, 248, 0.76);
  }

  .student-learning-memory-column ul {
    margin: 0;
    padding-left: 1.15rem;
    display: grid;
    gap: 0.5rem;
  }

  .student-learning-revision-list {
    max-height: 720px;
    overflow: auto;
    padding-right: 0.25rem;
  }

  .student-learning-sidebar {
    align-self: start;
    position: sticky;
    top: 1rem;
  }

  .student-learning-bootstrap-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .student-learning-bootstrap-card {
    display: grid;
    gap: 0.75rem;
    padding: 1.1rem;
    border-radius: 22px;
    border: 1px solid var(--student-area-line);
    background: rgba(255, 253, 248, 0.88);
  }

  .student-learning-bootstrap-card h3,
  .student-learning-bootstrap-card p {
    margin: 0;
  }

  .student-learning-status-panel h2,
  .student-learning-status-panel p {
    margin: 0;
  }

  @media (min-width: 1120px) {
    .student-learning-main {
      grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.95fr);
      align-items: start;
    }
  }

  @media (max-width: 920px) {
    .student-learning-sidebar {
      position: static;
    }
  }

  @media (max-width: 720px) {
    .student-learning-layout {
      gap: 0.85rem;
    }

    .student-learning-hero,
    .workspace-card,
    .student-learning-bootstrap,
    .student-learning-status-panel,
    .student-learning-standalone-state {
      padding: 1.1rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .workspace-primary-btn,
    .workspace-secondary-btn,
    .workspace-field input,
    .workspace-field textarea,
    .workspace-field select,
    .student-learning-field input,
    .student-learning-field textarea {
      transition: none;
    }
  }
`;
