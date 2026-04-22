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
  formatCandidateStateLabel,
  getApprovedCandidatesReadyForPromotion,
  type CandidateActionKind,
  type FoundationalProfileFormState,
  INITIAL_FOUNDATIONAL_PROFILE_FORM,
  PROFILE_CANDIDATE_PENDING_FILTER,
  type ProfileCandidateFilter,
} from './StudentWorkspace.logic';
import { WorkspaceCandidatesPanel } from './WorkspaceCandidatesPanel';

function formatDateTime(value?: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString();
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

  useEffect(() => {
    setBootstrapProfileId(null);
  }, [studentId]);

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

  const loadProfileSurface = useCallback(async (requestId: number) => {
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
      const form = foundationalProfileToFormState(revision?.structuredContent ?? profile.structuredContent);
      setCurrentRevision(revision);
      setProfileForm(form);
      setLoadedProfileForm(form);
      setProfileRevisions(revisions.items ?? []);
      setProfileLegacyNotice(getLegacyProfileNotice(revision ?? profile));
    } catch (error) {
      if (!isCurrentPageLoadRequest(requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unable to load the learner profile.';
      setProfileError(message);
    } finally {
      if (isCurrentPageLoadRequest(requestId)) {
        setProfileBusy(null);
      }
    }
  }, [isCurrentPageLoadRequest, profileId]);

  const loadMemoryOverview = useCallback(async (requestId: number) => {
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
  }, [isCurrentPageLoadRequest, studentId]);

  const loadBindingHistory = useCallback(async (requestId: number) => {
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
  }, [isCurrentPageLoadRequest, studentId]);

  const loadProfileCandidates = useCallback(async (requestId: number) => {
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
      const response = await listStudentProfileCandidates(studentId, { limit: 200, offset: 0, order: 'desc' });
      if (!isCurrentPageLoadRequest(requestId)) {
        return;
      }
      setProfileCandidates(response.items ?? []);
    } catch (error) {
      if (!isCurrentPageLoadRequest(requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unable to load profile candidates.';
      setProfileCandidatesError(message);
    } finally {
      if (isCurrentPageLoadRequest(requestId)) {
        setProfileCandidatesLoading(false);
      }
    }
  }, [isCurrentPageLoadRequest, studentId]);

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

    if (!studentId) return;
    void Promise.all([
      loadProfileSurface(requestId),
      loadMemoryOverview(requestId),
      loadBindingHistory(requestId),
      loadProfileCandidates(requestId),
    ]);

    return () => {
      latestPageLoadRequestRef.current += 1;
    };
  }, [loadBindingHistory, loadMemoryOverview, loadProfileCandidates, loadProfileSurface, studentId]);

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
      const revisions = await listProfileRevisions(profileId, { limit: 25, offset: 0, order: 'desc' });
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
      const restoredRevision =
        restored.currentRevisionId
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
      const revisions = await listProfileRevisions(profileId, { limit: 25, offset: 0, order: 'desc' });
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
      }
      const revisions = await listProfileRevisions(response.profileId, { limit: 25, offset: 0, order: 'desc' });
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
      const revisions = await listProfileRevisions(response.profileId, { limit: 25, offset: 0, order: 'desc' });
      setProfileRevisions(revisions.items ?? []);
      setSelectedCandidateIds([]);
      setProfileCandidatePromotionSuccess('Structured draft revision refreshed from approved candidates.');
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
          approvedFactText:
            patch.approvedFactText ?? current[candidateId]?.approvedFactText ?? '',
          reviewerNote: patch.reviewerNote ?? current[candidateId]?.reviewerNote ?? '',
        },
      }));
    },
    [],
  );

  if (studentLoading) {
    return <section className="card"><h2>Student learning</h2><p>Loading learning workspace...</p></section>;
  }

  if (studentError) {
    return <section className="card"><h2>Student learning</h2><p>{studentError}</p></section>;
  }

  if (!student) {
    return <section className="card"><h2>Student learning</h2><p>Student not found.</p></section>;
  }

  if (!profileId) {
    return (
      <section className="card student-learning-empty">
        <h2>Student learning</h2>
        <p>
          {student.student} does not have a bound learner profile yet. Start an empty canonical
          profile or bootstrap one from lesson evidence here.
        </p>
        <div className="student-learning-inline">
          <button
            type="button"
            className="workspace-primary-btn"
            onClick={() => void handleStartEmptyProfile()}
            disabled={profileBusy !== null}
          >
            {profileBusy === 'saving' ? 'Starting...' : 'Start Empty Profile'}
          </button>
          <button
            type="button"
            className="workspace-secondary-btn"
            onClick={() => void handlePopulateFirstProfile()}
            disabled={profileBusy !== null}
          >
            {profileBusy === 'populating' ? 'Populating...' : 'Populate First Profile From Lesson'}
          </button>
        </div>
        {profileError ? <p className="workspace-error">{profileError}</p> : null}
        {profileSuccess ? <p className="workspace-success">{profileSuccess}</p> : null}
      </section>
    );
  }

  const latestSnapshot = memoryOverview?.latestReadyStudentMemorySnapshot ?? null;
  const activeBinding = bindingHistory[0] ?? null;
  const canActivateDraft = currentRevision?.status === 'draft';

  return (
    <section className="student-learning-layout">
      <article className="card student-learning-hero">
        <div>
          <span className="student-learning-eyebrow">Learning</span>
          <h2>{student.student}</h2>
          <p>{profileId}</p>
        </div>
        <div className="student-learning-meta">
          <span>
            <strong>Profile state:</strong> {currentRevision?.status ?? 'active'}
          </span>
          <span>
            <strong>Revision:</strong> {currentRevision?.versionLabel ?? currentRevision?.id ?? 'n/a'}
          </span>
          <span>
            <strong>Last updated:</strong> {formatDateTime(currentRevision?.createdAt ?? activeBinding?.createdAt)}
          </span>
        </div>
        <div className="student-learning-actions">
          <button
            type="button"
            className="workspace-secondary-btn"
            onClick={() => void handlePopulateFirstProfile()}
            disabled={profileBusy !== null}
          >
            {profileBusy === 'populating' ? 'Populating...' : 'Populate First Profile From Lesson'}
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
              ? 'Refreshing...'
              : 'Refresh Draft From Approved Candidates'}
          </button>
          <button
            type="button"
            className="workspace-primary-btn"
            onClick={() => void handleSaveDraft()}
            disabled={profileBusy !== null || !profileDirty}
          >
            {profileBusy === 'saving' ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            type="button"
            className="workspace-primary-btn"
            onClick={() => void handleActivateDraft()}
            disabled={profileBusy !== null || !canActivateDraft}
          >
            {profileBusy === 'activating' ? 'Activating...' : 'Activate Draft'}
          </button>
        </div>
        {profileError ? <p className="workspace-error">{profileError}</p> : null}
        {profileSuccess ? <p className="workspace-success">{profileSuccess}</p> : null}
      </article>

      <div className="student-learning-main">
        <article className="workspace-card card">
          <header>
            <h2>Foundational Profile</h2>
            <p>
              This is the canonical pedagogical profile. Structured edits here drive the rendered
              prompt-package profile block.
            </p>
          </header>

          <div className="student-learning-form-grid">
            <label className="workspace-field">
              <span>Current level</span>
              <input
                type="text"
                value={profileForm.overallLevel}
                onChange={(event) => handleProfileFieldChange('overallLevel', event.target.value)}
                placeholder="B1, B2, C1..."
              />
            </label>

            <label className="workspace-field student-learning-span-2">
              <span>Primary goals</span>
              <textarea
                value={profileForm.primaryGoals}
                onChange={(event) => handleProfileFieldChange('primaryGoals', event.target.value)}
                rows={4}
                placeholder="One durable goal per line"
              />
            </label>

            <label className="workspace-field">
              <span>Communication contexts</span>
              <textarea
                value={profileForm.communicationContexts}
                onChange={(event) =>
                  handleProfileFieldChange('communicationContexts', event.target.value)
                }
                rows={4}
                placeholder="Client calls, demos, standups..."
              />
            </label>

            <label className="workspace-field">
              <span>Interests and useful themes</span>
              <textarea
                value={profileForm.interestsAndUsefulThemes}
                onChange={(event) =>
                  handleProfileFieldChange('interestsAndUsefulThemes', event.target.value)
                }
                rows={4}
                placeholder="Travel, films, design systems..."
              />
            </label>

            <label className="workspace-field">
              <span>Stable strengths</span>
              <textarea
                value={profileForm.stableStrengths}
                onChange={(event) => handleProfileFieldChange('stableStrengths', event.target.value)}
                rows={4}
                placeholder="Strong listening, high motivation..."
              />
            </label>

            <label className="workspace-field">
              <span>Persistent challenges</span>
              <textarea
                value={profileForm.persistentChallenges}
                onChange={(event) =>
                  handleProfileFieldChange('persistentChallenges', event.target.value)
                }
                rows={4}
                placeholder="Article usage, spoken transitions..."
              />
            </label>

            <label className="workspace-field">
              <span>Study preferences</span>
              <textarea
                value={profileForm.studyPreferences}
                onChange={(event) => handleProfileFieldChange('studyPreferences', event.target.value)}
                rows={4}
                placeholder="Practical homework, short review loops..."
              />
            </label>

            <label className="workspace-field">
              <span>Durable constraints</span>
              <textarea
                value={profileForm.durableConstraints}
                onChange={(event) =>
                  handleProfileFieldChange('durableConstraints', event.target.value)
                }
                rows={4}
                placeholder="Limited homework window, device constraints..."
              />
            </label>

            <label className="workspace-field student-learning-span-2">
              <span>Teacher notes</span>
              <textarea
                value={profileForm.teacherNotes}
                onChange={(event) => handleProfileFieldChange('teacherNotes', event.target.value)}
                rows={4}
                placeholder="Durable notes worth preserving in future lessons"
              />
            </label>
          </div>

          <div className="student-learning-inline">
            <span className="workspace-muted">
              {profileDirty ? 'Unsaved structured edits' : `Editor state: ${formatCandidateStateLabel({
                id: '',
                studentId,
                proposedFact: '',
                category: '',
                targetSection: '',
                sourceSummary: null,
                evidence: [],
                sourceLessonMemoryIds: [],
                status: currentRevision?.status === 'draft' ? 'approved' : 'promoted',
                reviewState: currentRevision?.status === 'draft' ? 'approved' : 'approved',
                createdAt: '',
                updatedAt: '',
              } as StudentProfileCandidate)}`}
            </span>
          </div>

          {profileLegacyNotice ? <p className="workspace-muted">{profileLegacyNotice}</p> : null}
        </article>

        <article className="workspace-card card">
          <header>
            <h2>Memory & Signals</h2>
            <p>Snapshot the canonical learner memory without reopening the legacy workspace.</p>
          </header>

          {memoryOverviewError ? <p className="workspace-error">{memoryOverviewError}</p> : null}
          {memoryOverviewLoading ? (
            <p className="workspace-muted">Loading memory summary...</p>
          ) : latestSnapshot ? (
            <>
              <div className="workspace-meta">
                <span>
                  <strong>Snapshot:</strong> {latestSnapshot.id}
                </span>
                <span>
                  <strong>Generated:</strong> {formatDateTime(latestSnapshot.generatedAt)}
                </span>
              </div>
              <p>{latestSnapshot.snapshotSummary ?? 'No snapshot summary yet.'}</p>
              <div className="student-learning-memory-grid">
                <div>
                  <strong>Recent lesson memory</strong>
                  <ul>
                    {memoryOverview?.recentReadyLessonMemory.map((entry) => (
                      <li key={entry.id}>{entry.lessonSummary ?? entry.id}</li>
                    )) ?? []}
                  </ul>
                </div>
                <div>
                  <strong>Recent homework memory</strong>
                  <ul>
                    {memoryOverview?.recentReadyHomeworkMemory.map((entry) => (
                      <li key={entry.id}>{entry.homeworkSummary ?? entry.topic ?? entry.id}</li>
                    )) ?? []}
                  </ul>
                </div>
              </div>
            </>
          ) : (
            <p className="workspace-muted">No ready student-memory snapshot is available yet.</p>
          )}
        </article>

        <WorkspaceCandidatesPanel
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

      <aside className="workspace-card card student-learning-sidebar">
        <header>
          <h2>Revision History</h2>
          <p>Review draft lineage, restore earlier revisions, and keep an eye on binding changes.</p>
        </header>

        {bindingHistoryError ? <p className="workspace-error">{bindingHistoryError}</p> : null}
        {bindingHistoryLoading ? <p className="workspace-muted">Loading binding history...</p> : null}

        <div className="workspace-list">
          {profileRevisions.map((revision) => (
            <div key={revision.id} className="workspace-list-item workspace-list-item-stack">
              <div>
                <strong>{revision.versionLabel ?? revision.id}</strong>
                <div className="workspace-muted">
                  {revision.status ?? 'unknown'} · {formatDateTime(revision.createdAt)}
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
          <strong>Binding footer</strong>
          {activeBinding ? (
            <p className="workspace-muted">
              Active binding to <code>{activeBinding.profileId}</code> since{' '}
              {formatDateTime(activeBinding.effectiveFrom)}.
            </p>
          ) : (
            <p className="workspace-muted">No binding history available yet.</p>
          )}
          <p className="workspace-muted">Learning now owns the canonical learner profile workflow.</p>
        </div>
      </aside>

      <style>{`
        .student-learning-layout {
          display: grid;
          gap: 1rem;
          grid-template-columns: minmax(0, 1fr);
        }

        .student-learning-hero,
        .workspace-card {
          display: grid;
          gap: 1rem;
        }

        .student-learning-eyebrow {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary, #6b7280);
        }

        .student-learning-hero h2,
        .workspace-card h2,
        .workspace-card h3,
        .workspace-card p {
          margin: 0;
        }

        .student-learning-main {
          display: grid;
          gap: 1rem;
        }

        .student-learning-meta,
        .workspace-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem 1rem;
          color: var(--text-secondary, #52606d);
        }

        .student-learning-actions,
        .student-learning-inline,
        .workspace-inline {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          align-items: center;
        }

        .workspace-field,
        .workspace-field span {
          display: grid;
          gap: 0.35rem;
        }

        .student-learning-form-grid {
          display: grid;
          gap: 0.85rem;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .student-learning-span-2 {
          grid-column: span 2;
        }

        .workspace-field input,
        .workspace-field textarea,
        .workspace-field select {
          width: 100%;
          border: 1px solid rgba(15, 23, 42, 0.12);
          border-radius: 12px;
          padding: 0.8rem 0.9rem;
          font: inherit;
          background: white;
        }

        .workspace-primary-btn,
        .workspace-secondary-btn,
        .student-learning-empty a,
        .student-learning-binding a {
          width: fit-content;
          border: 0;
          border-radius: 999px;
          padding: 0.75rem 1rem;
          font: inherit;
          font-weight: 600;
          text-decoration: none;
          cursor: pointer;
        }

        .workspace-primary-btn {
          background: var(--color-primary-500, #2563eb);
          color: white;
        }

        .workspace-secondary-btn,
        .student-learning-empty a,
        .student-learning-binding a {
          background: rgba(37, 99, 235, 0.1);
          color: var(--color-primary-600, #1d4ed8);
        }

        .workspace-muted {
          color: var(--text-secondary, #52606d);
        }

        .workspace-error {
          color: #b91c1c;
        }

        .workspace-success {
          color: #047857;
        }

        .workspace-list {
          display: grid;
          gap: 0.75rem;
        }

        .workspace-list-item {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.85rem 1rem;
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.03);
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

        .student-learning-memory-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .student-learning-memory-grid ul {
          margin: 0.5rem 0 0;
          padding-left: 1rem;
        }

        .student-learning-sidebar {
          align-self: start;
        }

        .student-learning-binding {
          display: grid;
          gap: 0.5rem;
        }

        @media (min-width: 1100px) {
          .student-learning-layout {
            grid-template-columns: minmax(0, 2fr) minmax(280px, 0.95fr);
            align-items: start;
          }

          .student-learning-hero {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 720px) {
          .student-learning-span-2 {
            grid-column: span 1;
          }
        }
      `}</style>
    </section>
  );
};
