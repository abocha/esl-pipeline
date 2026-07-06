import type {
  FoundationalProfile,
  StarterProfileInput,
  StudentProfileCandidate,
  StudentProfileInput,
} from '../../utils/api';

export interface FoundationalProfileFormState {
  overallLevel: string;
  primaryGoals: string;
  communicationContexts: string;
  interestsAndUsefulThemes: string;
  stableStrengths: string;
  persistentChallenges: string;
  studyPreferences: string;
  durableConstraints: string;
  teacherNotes: string;
}

export interface CreateStudentFormState extends FoundationalProfileFormState {
  student: string;
}

export interface ProfileDraftDiffItem {
  key: keyof FoundationalProfileFormState;
  label: string;
  before: string;
  after: string;
  changeType: 'added' | 'removed' | 'changed';
  beforeLines: ProfileDraftDiffLine[];
  afterLines: ProfileDraftDiffLine[];
}

export interface ProfileDraftDiffLine {
  text: string;
  changeType: 'unchanged' | 'added' | 'removed';
}

export const INITIAL_CREATE_STUDENT_FORM: CreateStudentFormState = {
  student: '',
  overallLevel: '',
  primaryGoals: '',
  communicationContexts: '',
  interestsAndUsefulThemes: '',
  stableStrengths: '',
  persistentChallenges: '',
  studyPreferences: '',
  durableConstraints: '',
  teacherNotes: '',
};

export const INITIAL_FOUNDATIONAL_PROFILE_FORM: FoundationalProfileFormState = {
  overallLevel: '',
  primaryGoals: '',
  communicationContexts: '',
  interestsAndUsefulThemes: '',
  stableStrengths: '',
  persistentChallenges: '',
  studyPreferences: '',
  durableConstraints: '',
  teacherNotes: '',
};

export const CREATE_STUDENT_NAME_REQUIRED_MESSAGE = 'Student name is required.';

const PROFILE_FORM_FIELD_LABELS: Record<keyof FoundationalProfileFormState, string> = {
  overallLevel: 'Current Level',
  primaryGoals: 'Primary Goals',
  communicationContexts: 'Communication Contexts',
  interestsAndUsefulThemes: 'Interests & Useful Themes',
  stableStrengths: 'Stable Strengths',
  persistentChallenges: 'Persistent Challenges',
  studyPreferences: 'Study Preferences',
  durableConstraints: 'Durable Constraints',
  teacherNotes: 'Teacher Notes',
};

const PROFILE_FORM_DIFF_KEYS: (keyof FoundationalProfileFormState)[] = [
  'overallLevel',
  'primaryGoals',
  'communicationContexts',
  'interestsAndUsefulThemes',
  'stableStrengths',
  'persistentChallenges',
  'studyPreferences',
  'durableConstraints',
  'teacherNotes',
];

export interface StarterProfileBuildResult {
  starterProfile?: StarterProfileInput;
  hasAnyValue: boolean;
}

export interface CreateStudentPayloadBuildResult {
  payload?: StudentProfileInput;
  validationError?: string;
  starterProfile: StarterProfileBuildResult;
}

export const PROFILE_CANDIDATE_ALL_FILTER = 'all';
export const PROFILE_CANDIDATE_PENDING_FILTER = 'pending';
export const PROFILE_CANDIDATE_REVIEWED_FILTER = 'reviewed';
export const PROFILE_CANDIDATE_APPROVED_FILTER = 'approved';
export const PROFILE_CANDIDATE_DEFERRED_FILTER = 'deferred';
export const PROFILE_CANDIDATE_REJECTED_FILTER = 'rejected';
export const PROFILE_CANDIDATE_PROMOTED_FILTER = 'promoted';
export type ProfileCandidateFilter =
  | typeof PROFILE_CANDIDATE_ALL_FILTER
  | typeof PROFILE_CANDIDATE_PENDING_FILTER
  | typeof PROFILE_CANDIDATE_REVIEWED_FILTER
  | typeof PROFILE_CANDIDATE_APPROVED_FILTER
  | typeof PROFILE_CANDIDATE_DEFERRED_FILTER
  | typeof PROFILE_CANDIDATE_REJECTED_FILTER
  | typeof PROFILE_CANDIDATE_PROMOTED_FILTER;
export const PROFILE_CANDIDATE_FILTER_OPTIONS: {
  filter: ProfileCandidateFilter;
  label: string;
}[] = [
  { filter: PROFILE_CANDIDATE_ALL_FILTER, label: 'All' },
  { filter: PROFILE_CANDIDATE_PENDING_FILTER, label: 'Pending' },
  { filter: PROFILE_CANDIDATE_REVIEWED_FILTER, label: 'Reviewed' },
  { filter: PROFILE_CANDIDATE_APPROVED_FILTER, label: 'Approved' },
  { filter: PROFILE_CANDIDATE_DEFERRED_FILTER, label: 'Deferred' },
  { filter: PROFILE_CANDIDATE_REJECTED_FILTER, label: 'Rejected' },
  { filter: PROFILE_CANDIDATE_PROMOTED_FILTER, label: 'Promoted' },
];
export type CandidateActionKind = 'approve' | 'reject' | 'defer';

function splitProfileListField(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0);
}

function joinProfileListField(values: readonly string[]): string {
  return values.join('\n');
}

export function foundationalProfileToFormState(
  profile: FoundationalProfile | null | undefined,
): FoundationalProfileFormState {
  if (!profile) {
    return INITIAL_FOUNDATIONAL_PROFILE_FORM;
  }

  return {
    overallLevel: profile.overallLevel ?? '',
    primaryGoals: joinProfileListField(profile.primaryGoals),
    communicationContexts: joinProfileListField(profile.communicationContexts),
    interestsAndUsefulThemes: joinProfileListField(profile.interestsAndUsefulThemes),
    stableStrengths: joinProfileListField(profile.stableStrengths),
    persistentChallenges: joinProfileListField(profile.persistentChallenges),
    studyPreferences: joinProfileListField(profile.studyPreferences),
    durableConstraints: joinProfileListField(profile.durableConstraints),
    teacherNotes: profile.teacherNotes ?? '',
  };
}

export function foundationalProfileFormToStructuredContent(
  form: FoundationalProfileFormState,
): FoundationalProfile {
  const overallLevel = form.overallLevel.trim();
  const teacherNotes = form.teacherNotes.trim();

  return {
    schemaVersion: 'foundational_profile_v1',
    overallLevel: overallLevel.length > 0 ? overallLevel : null,
    primaryGoals: splitProfileListField(form.primaryGoals),
    communicationContexts: splitProfileListField(form.communicationContexts),
    interestsAndUsefulThemes: splitProfileListField(form.interestsAndUsefulThemes),
    stableStrengths: splitProfileListField(form.stableStrengths),
    persistentChallenges: splitProfileListField(form.persistentChallenges),
    studyPreferences: splitProfileListField(form.studyPreferences),
    durableConstraints: splitProfileListField(form.durableConstraints),
    teacherNotes: teacherNotes.length > 0 ? teacherNotes : null,
  };
}

export function buildProfileDraftDiff(args: {
  base: FoundationalProfileFormState;
  draft: FoundationalProfileFormState;
}): ProfileDraftDiffItem[] {
  const diff: ProfileDraftDiffItem[] = [];

  for (const key of PROFILE_FORM_DIFF_KEYS) {
    const before = normalizeProfileDiffValue(args.base[key]);
    const after = normalizeProfileDiffValue(args.draft[key]);
    if (before === after) {
      continue;
    }

    diff.push({
      key,
      label: PROFILE_FORM_FIELD_LABELS[key],
      before,
      after,
      changeType: before ? (after ? 'changed' : 'removed') : 'added',
      ...buildProfileDraftDiffLines({ before, after }),
    });
  }

  return diff;
}

function buildProfileDraftDiffLines(args: {
  before: string;
  after: string;
}): Pick<ProfileDraftDiffItem, 'beforeLines' | 'afterLines'> {
  const beforeLines = splitProfileDiffLines(args.before);
  const afterLines = splitProfileDiffLines(args.after);
  const afterLineCounts = countProfileDiffLines(afterLines);
  const beforeLineCounts = countProfileDiffLines(beforeLines);

  return {
    beforeLines: beforeLines.map((line) => ({
      text: line,
      changeType: consumeProfileDiffLine(afterLineCounts, line) ? 'unchanged' : 'removed',
    })),
    afterLines: afterLines.map((line) => ({
      text: line,
      changeType: consumeProfileDiffLine(beforeLineCounts, line) ? 'unchanged' : 'added',
    })),
  };
}

function splitProfileDiffLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function countProfileDiffLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

function consumeProfileDiffLine(counts: Map<string, number>, line: string): boolean {
  const count = counts.get(line) ?? 0;
  if (count <= 0) {
    return false;
  }
  if (count === 1) {
    counts.delete(line);
    return true;
  }
  counts.set(line, count - 1);
  return true;
}

function normalizeProfileDiffValue(value: string): string {
  return splitProfileDiffLines(value).join('\n');
}

export function isPendingCandidate(candidate: StudentProfileCandidate): boolean {
  return candidate.status === 'pending_review' && candidate.reviewState === 'unreviewed';
}

export function isReviewedCandidate(candidate: StudentProfileCandidate): boolean {
  return !isPendingCandidate(candidate);
}

function isVisibleForCandidateFilter(
  candidate: StudentProfileCandidate,
  filter: ProfileCandidateFilter,
): boolean {
  switch (filter) {
    case PROFILE_CANDIDATE_ALL_FILTER: {
      return true;
    }
    case PROFILE_CANDIDATE_PENDING_FILTER: {
      return isPendingCandidate(candidate);
    }
    case PROFILE_CANDIDATE_REVIEWED_FILTER: {
      return isReviewedCandidate(candidate);
    }
    case PROFILE_CANDIDATE_APPROVED_FILTER: {
      return candidate.status === 'approved';
    }
    case PROFILE_CANDIDATE_DEFERRED_FILTER: {
      return candidate.reviewState === 'deferred';
    }
    case PROFILE_CANDIDATE_REJECTED_FILTER: {
      return candidate.status === 'rejected' || candidate.reviewState === 'rejected';
    }
    case PROFILE_CANDIDATE_PROMOTED_FILTER: {
      return candidate.status === 'promoted';
    }
    default: {
      return false;
    }
  }
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
  const visible = candidates.filter((candidate) => isVisibleForCandidateFilter(candidate, filter));
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

function assignTrimmedStarterField(
  target: StarterProfileInput,
  key: keyof StarterProfileInput,
  value: string,
): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    target[key] = trimmed;
  }
}

export function buildStarterProfileInput(form: CreateStudentFormState): StarterProfileBuildResult {
  const starterProfile: StarterProfileInput = {};
  assignTrimmedStarterField(starterProfile, 'overallLevel', form.overallLevel);
  assignTrimmedStarterField(starterProfile, 'primaryGoals', form.primaryGoals);
  assignTrimmedStarterField(starterProfile, 'communicationContexts', form.communicationContexts);
  assignTrimmedStarterField(
    starterProfile,
    'interestsAndUsefulThemes',
    form.interestsAndUsefulThemes,
  );
  assignTrimmedStarterField(starterProfile, 'stableStrengths', form.stableStrengths);
  assignTrimmedStarterField(starterProfile, 'persistentChallenges', form.persistentChallenges);
  assignTrimmedStarterField(starterProfile, 'studyPreferences', form.studyPreferences);
  assignTrimmedStarterField(starterProfile, 'durableConstraints', form.durableConstraints);
  assignTrimmedStarterField(starterProfile, 'teacherNotes', form.teacherNotes);

  const hasAnyValue = Object.values(starterProfile).some((value) => value && value.length > 0);

  return {
    starterProfile: hasAnyValue ? starterProfile : undefined,
    hasAnyValue,
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
  const payload: StudentProfileInput = {
    student,
    ...(starterProfile.starterProfile ? { starterProfile: starterProfile.starterProfile } : {}),
  };

  return { payload, starterProfile };
}
