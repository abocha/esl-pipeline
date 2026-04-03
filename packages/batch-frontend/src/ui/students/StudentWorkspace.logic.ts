import type {
  StarterProfileInput,
  StudentProfileCandidate,
  StudentProfileInput,
} from '../../utils/api';

export interface CreateStudentFormState {
  student: string;
  profileId: string;
  dbId: string;
  pageParentId: string;
  colorPreset: string;
  accentPreference: string;
  manifestPreset: string;
  starterLevel: string;
  starterGoals: string;
  starterProfessionOrContext: string;
  starterInterests: string;
  starterLongRunningChallenges: string;
  starterStudyPreferencesOrConstraints: string;
  starterTeacherNotes: string;
}

export const INITIAL_CREATE_STUDENT_FORM: CreateStudentFormState = {
  student: '',
  profileId: '',
  dbId: '',
  pageParentId: '',
  colorPreset: '',
  accentPreference: '',
  manifestPreset: '',
  starterLevel: '',
  starterGoals: '',
  starterProfessionOrContext: '',
  starterInterests: '',
  starterLongRunningChallenges: '',
  starterStudyPreferencesOrConstraints: '',
  starterTeacherNotes: '',
};

export const CREATE_STUDENT_NAME_REQUIRED_MESSAGE = 'Student name is required.';
export const CREATE_STUDENT_STARTER_PROFILE_REQUIRED_MESSAGE =
  'Complete all required starter profile fields or clear the starter profile section before creating the student.';

export interface StarterProfileBuildResult {
  starterProfile?: StarterProfileInput;
  hasAnyValue: boolean;
  hasMissingRequired: boolean;
}

export interface CreateStudentPayloadBuildResult {
  payload?: StudentProfileInput;
  validationError?: string;
  starterProfile: StarterProfileBuildResult;
}

export type HistoryFilterState =
  | 'all'
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed';

export interface HistoryFilters {
  state: HistoryFilterState;
  from: string;
  to: string;
}

export type TimelineFilterState =
  | 'all'
  | 'recording_ingested'
  | 'transcript_ready'
  | 'prompt_package_created'
  | 'draft_saved'
  | 'job_awaiting_approval'
  | 'job_completed'
  | 'student_profile_binding_changed'
  | 'profile_revision_saved'
  | 'profile_revision_restored'
  | 'profile_revision_activated'
  | 'template_revision_saved'
  | 'template_revision_restored'
  | 'template_revision_activated'
  | 'job_action_rerun'
  | 'job_action_cancel'
  | 'job_action_edit_metadata';

export interface TimelineFilters {
  type: TimelineFilterState;
  from: string;
  to: string;
}

export const INITIAL_HISTORY_FILTERS: HistoryFilters = {
  state: 'all',
  from: '',
  to: '',
};

export const INITIAL_TIMELINE_FILTERS: TimelineFilters = {
  type: 'all',
  from: '',
  to: '',
};

export const PROFILE_CANDIDATE_PENDING_FILTER = 'pending';
export const PROFILE_CANDIDATE_REVIEWED_FILTER = 'reviewed';
export type ProfileCandidateFilter =
  | typeof PROFILE_CANDIDATE_PENDING_FILTER
  | typeof PROFILE_CANDIDATE_REVIEWED_FILTER;
export type CandidateActionKind = 'approve' | 'reject' | 'defer';

export function isPendingCandidate(candidate: StudentProfileCandidate): boolean {
  return candidate.status === 'pending_review' && candidate.reviewState === 'unreviewed';
}

export function isReviewedCandidate(candidate: StudentProfileCandidate): boolean {
  return !isPendingCandidate(candidate);
}

export function isSelectableForPromotion(candidate: StudentProfileCandidate): boolean {
  return candidate.status === 'approved';
}

function toTitleCaseLabel(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatCandidateSectionLabel(section: string): string {
  switch (section) {
    case 'goals_motivation': {
      return 'Goals and motivation';
    }
    case 'work_communication_context': {
      return 'Work and communication context';
    }
    case 'interests_personal_context': {
      return 'Interests and personal context';
    }
    case 'learning_preferences_study_habits': {
      return 'Learning preferences and study habits';
    }
    case 'long_running_strengths': {
      return 'Long-running strengths';
    }
    case 'persistent_challenges_constraints': {
      return 'Persistent challenges or constraints';
    }
    default: {
      return toTitleCaseLabel(section);
    }
  }
}

export function formatCandidateStateLabel(candidate: StudentProfileCandidate): string {
  if (candidate.status === 'promoted') {
    return 'Promoted';
  }
  if (candidate.status === 'approved') {
    return 'Approved, not yet promoted';
  }
  if (candidate.status === 'rejected') {
    return 'Rejected';
  }
  if (candidate.reviewState === 'deferred') {
    return 'Deferred';
  }
  if (candidate.status === 'superseded') {
    return 'Superseded';
  }
  return 'Pending review';
}

export function groupVisibleCandidatesBySection(
  candidates: StudentProfileCandidate[],
  filter: ProfileCandidateFilter,
): [string, StudentProfileCandidate[]][] {
  const visible = candidates.filter((candidate) =>
    filter === 'pending' ? isPendingCandidate(candidate) : isReviewedCandidate(candidate),
  );
  const groups = new Map<string, StudentProfileCandidate[]>();
  for (const candidate of visible) {
    const key = candidate.targetSection || 'other';
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(candidate);
    } else {
      groups.set(key, [candidate]);
    }
  }
  return [...groups.entries()].sort(([left], [right]) =>
    formatCandidateSectionLabel(left).localeCompare(formatCandidateSectionLabel(right)),
  );
}

export function getApprovedCandidatesReadyForPromotion(
  candidates: StudentProfileCandidate[],
): StudentProfileCandidate[] {
  return candidates.filter((candidate) => isSelectableForPromotion(candidate));
}

export function buildStarterProfileInput(form: CreateStudentFormState): StarterProfileBuildResult {
  const starterProfile: StarterProfileInput = {
    level: form.starterLevel.trim() || undefined,
    goals: form.starterGoals.trim() || undefined,
    professionOrContext: form.starterProfessionOrContext.trim() || undefined,
    interests: form.starterInterests.trim() || undefined,
    longRunningChallenges: form.starterLongRunningChallenges.trim() || undefined,
    studyPreferencesOrConstraints: form.starterStudyPreferencesOrConstraints.trim() || undefined,
    teacherNotes: form.starterTeacherNotes.trim() || undefined,
  };

  const requiredFields = [
    starterProfile.goals,
    starterProfile.professionOrContext,
    starterProfile.interests,
    starterProfile.longRunningChallenges,
    starterProfile.studyPreferencesOrConstraints,
  ];
  const hasAnyValue = Object.values(starterProfile).some((value) => value && value.length > 0);
  const hasMissingRequired =
    hasAnyValue && requiredFields.some((value) => !value || value.trim().length === 0);

  return {
    starterProfile: hasAnyValue && !hasMissingRequired ? starterProfile : undefined,
    hasAnyValue,
    hasMissingRequired,
  };
}

export function buildCreateStudentPayload(
  form: CreateStudentFormState,
): CreateStudentPayloadBuildResult {
  const student = form.student.trim();
  if (!student) {
    return {
      validationError: CREATE_STUDENT_NAME_REQUIRED_MESSAGE,
      starterProfile: buildStarterProfileInput(form),
    };
  }

  const starterProfile = buildStarterProfileInput(form);
  if (starterProfile.hasMissingRequired) {
    return {
      validationError: CREATE_STUDENT_STARTER_PROFILE_REQUIRED_MESSAGE,
      starterProfile,
    };
  }

  const payload: StudentProfileInput = {
    student,
    ...(!starterProfile.starterProfile && form.profileId ? { profileId: form.profileId } : {}),
    ...(form.dbId ? { dbId: form.dbId } : {}),
    ...(form.pageParentId ? { pageParentId: form.pageParentId } : {}),
    ...(form.colorPreset ? { colorPreset: form.colorPreset } : {}),
    ...(form.accentPreference ? { accentPreference: form.accentPreference } : {}),
    ...(form.manifestPreset ? { manifestPreset: form.manifestPreset } : {}),
    ...(starterProfile.starterProfile ? { starterProfile: starterProfile.starterProfile } : {}),
  };

  return { payload, starterProfile };
}
