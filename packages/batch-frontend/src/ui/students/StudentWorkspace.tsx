import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type {
  FoundationalProfile,
  JobListResponse,
  JobProvenanceResponse,
  JobState,
  ProfileRevisionSummaryResponse,
  PromptPackageLineageResponse,
  StudentMemoryOverviewResponse,
  StudentProfile,
  StudentProfileBindingListResponse,
  StudentProfileCandidate,
  StudentTimelineResponse,
  StudentTimelineType,
  TemplateRevisionSummaryResponse,
} from '../../utils/api';
import {
  activateProfileRevision,
  activateTemplateRevision,
  approveStudentProfileCandidate,
  createStudentProfile,
  deferStudentProfileCandidate,
  deleteTemplateContent,
  fetchJobProvenance,
  fetchPromptPackageLineage,
  getProfileContent,
  getProfileRevision,
  getStudentMemoryOverview,
  getStudentProfile,
  getStudentTimeline,
  getTemplateContent,
  listProfileContents,
  listProfileRevisions,
  listStudentProfileBindings,
  listStudentProfileCandidates,
  listStudents,
  listTemplateContents,
  listTemplateRevisions,
  listUserJobs,
  promoteStudentProfileCandidates,
  rejectStudentProfileCandidate,
  restoreProfileRevision,
  restoreTemplateRevision,
  saveProfileDraftRevision,
  updateStudentProfile,
  upsertTemplateContent,
} from '../../utils/api';
import { CreateStudentDialog } from './CreateStudentDialog';
import {
  buildCreateStudentPayload,
  type CandidateActionKind,
  type CreateStudentFormState,
  type FoundationalProfileFormState,
  formatCandidateSectionLabel,
  formatCandidateStateLabel,
  foundationalProfileFormToStructuredContent,
  foundationalProfileToFormState,
  type HistoryFilters,
  INITIAL_CREATE_STUDENT_FORM,
  INITIAL_FOUNDATIONAL_PROFILE_FORM,
  INITIAL_HISTORY_FILTERS,
  INITIAL_TIMELINE_FILTERS,
  isPendingCandidate,
  isReviewedCandidate,
  isSelectableForPromotion,
  PROFILE_CANDIDATE_PENDING_FILTER,
  PROFILE_CANDIDATE_REVIEWED_FILTER,
  type ProfileCandidateFilter,
  type TimelineFilters,
} from './StudentWorkspace.logic';
import { WorkspaceInspectionPanel } from './WorkspaceInspectionPanel';
import './StudentWorkspace.css';

const HISTORY_LIMIT = 25;
const BINDING_LIMIT = 20;
const MEMORY_OVERVIEW_LESSON_LIMIT = 3;
const MEMORY_OVERVIEW_HOMEWORK_LIMIT = 2;
const PROFILE_CANDIDATE_LIMIT = 200;
const CLEAN_TEMPLATE_STARTER_CONTENT = String.raw`## **System Prompt: ESL Homework Generator**

**Role & Scope**
You are an Expert ESL Content Assistant operating in a stateless backend runtime. Produce one complete homework assignment for one adult ESL student.

**Working Context Contract**
Treat the labeled context blocks appended after these instructions as the complete runtime context for this request.

**Context Priority Rules**
Use the runtime blocks in this order:
1. **[LATEST_TRANSCRIPT]**
2. **[TEACHER_NOTES]**
3. **[UNRESOLVED_ISSUES]**, **[RECENT_LESSON_MEMORY]**, **[RECENT_HOMEWORK_MEMORY]**
4. **[STUDENT_MEMORY_SNAPSHOT]**
5. **[FOUNDATIONAL_PROFILE]**

**Task-Specific Generation Rules**
1. Produce one coherent homework mission.
2. Use one primary input source.
3. If no input type is specified, default to \`generate\`.

**Output Formatting Rules**
- Return one Markdown code block with YAML front matter.
- Use the required section structure.
`;
const TIMELINE_TYPES: StudentTimelineType[] = [
  'recording_ingested',
  'transcript_ready',
  'prompt_package_created',
  'draft_saved',
  'job_awaiting_approval',
  'job_completed',
  'student_profile_binding_changed',
  'profile_revision_saved',
  'profile_revision_restored',
  'profile_revision_activated',
  'template_revision_saved',
  'template_revision_restored',
  'template_revision_activated',
  'job_action_rerun',
  'job_action_cancel',
  'job_action_edit_metadata',
  'lesson_created',
  'lesson_updated',
  'lesson_completed',
  'lesson_canceled',
  'lesson_no_show',
  'lesson_plan_updated',
  'lesson_recurrence_updated',
  'credit_event_recorded',
  'payment_recorded',
  'reminder_hidden',
  'business_settings_updated',
];

function toIsoOrUndefined(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function toTitleCaseLabel(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function sortStudentsForPicker(items: StudentProfile[]): StudentProfile[] {
  return [...items].sort((left, right) => {
    const byName = left.student.localeCompare(right.student, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;

    return left.id.localeCompare(right.id);
  });
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString();
}

function getFoundationalProfileSnapshot(form: FoundationalProfileFormState): string {
  return JSON.stringify(foundationalProfileFormToStructuredContent(form));
}

function getLegacyProfileNotice(profile: {
  content?: string | null;
  structuredContent?: FoundationalProfile | null;
}): string | null {
  if (profile.structuredContent) {
    return null;
  }

  return profile.content?.trim()
    ? 'This profile is still legacy markdown-only. Saving a draft from this form will create the new structured revision.'
    : null;
}

export const StudentWorkspace: React.FC = () => {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile | null>(null);
  const [profileBindingSaving, setProfileBindingSaving] = useState(false);
  const [bindingSuccess, setBindingSuccess] = useState<string | null>(null);
  const [isCreateStudentOpen, setIsCreateStudentOpen] = useState(false);
  const [createStudentBusy, setCreateStudentBusy] = useState(false);
  const [createStudentError, setCreateStudentError] = useState<string | null>(null);
  const [createStudentSuccess, setCreateStudentSuccess] = useState<string | null>(null);
  const [createStudentForm, setCreateStudentForm] = useState<CreateStudentFormState>(
    INITIAL_CREATE_STUDENT_FORM,
  );

  const [profileOptions, setProfileOptions] = useState<{ id: string; label: string }[]>([]);
  const [profileOptionsError, setProfileOptionsError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  const [profileForm, setProfileForm] = useState<FoundationalProfileFormState>(
    INITIAL_FOUNDATIONAL_PROFILE_FORM,
  );
  const [loadedProfileForm, setLoadedProfileForm] = useState<FoundationalProfileFormState>(
    INITIAL_FOUNDATIONAL_PROFILE_FORM,
  );
  const [profileBusy, setProfileBusy] = useState<
    'loading' | 'saving' | 'restoring' | 'activating' | null
  >(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileLegacyNotice, setProfileLegacyNotice] = useState<string | null>(null);
  const [profileRevisions, setProfileRevisions] = useState<ProfileRevisionSummaryResponse[]>([]);

  const [templateOptions, setTemplateOptions] = useState<{ id: string; label: string }[]>([]);
  const [templateOptionsError, setTemplateOptionsError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [templateEditorText, setTemplateEditorText] = useState('');
  const [loadedTemplateContent, setLoadedTemplateContent] = useState('');
  const [templateBusy, setTemplateBusy] = useState<
    'loading' | 'saving' | 'restoring' | 'activating' | 'archiving' | null
  >(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateSuccess, setTemplateSuccess] = useState<string | null>(null);
  const [templateRevisions, setTemplateRevisions] = useState<TemplateRevisionSummaryResponse[]>([]);

  const [jobHistory, setJobHistory] = useState<JobListResponse['jobs']>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [historyFiltersDraft, setHistoryFiltersDraft] =
    useState<HistoryFilters>(INITIAL_HISTORY_FILTERS);
  const [historyFiltersApplied, setHistoryFiltersApplied] =
    useState<HistoryFilters>(INITIAL_HISTORY_FILTERS);

  const [timeline, setTimeline] = useState<StudentTimelineResponse['items']>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineFiltersDraft, setTimelineFiltersDraft] =
    useState<TimelineFilters>(INITIAL_TIMELINE_FILTERS);
  const [timelineFiltersApplied, setTimelineFiltersApplied] =
    useState<TimelineFilters>(INITIAL_TIMELINE_FILTERS);

  const [bindingHistory, setBindingHistory] = useState<StudentProfileBindingListResponse['items']>(
    [],
  );
  const [bindingHistoryLoading, setBindingHistoryLoading] = useState(false);
  const [bindingHistoryError, setBindingHistoryError] = useState<string | null>(null);

  const [memoryOverview, setMemoryOverview] = useState<StudentMemoryOverviewResponse | null>(null);
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

  const [selectedJobId, setSelectedJobId] = useState('');
  const [selectedPromptPackageId, setSelectedPromptPackageId] = useState('');
  const [inspectRequestId, setInspectRequestId] = useState(0);

  const [jobProvenance, setJobProvenance] = useState<JobProvenanceResponse | null>(null);
  const [jobProvenanceLoading, setJobProvenanceLoading] = useState(false);
  const [jobProvenanceError, setJobProvenanceError] = useState<string | null>(null);

  const [lineage, setLineage] = useState<PromptPackageLineageResponse | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageError, setLineageError] = useState<string | null>(null);

  const selectedStudentRequestIdRef = useRef(0);
  const historyRequestIdRef = useRef(0);
  const timelineRequestIdRef = useRef(0);
  const bindingsRequestIdRef = useRef(0);
  const memoryOverviewRequestIdRef = useRef(0);
  const profileCandidatesRequestIdRef = useRef(0);

  const historyFiltersAppliedRef = useRef(historyFiltersApplied);
  const timelineFiltersAppliedRef = useRef(timelineFiltersApplied);

  const selectedJob = useMemo(
    () => jobHistory.find((job) => job.jobId === selectedJobId) ?? null,
    [jobHistory, selectedJobId],
  );

  const profileDirty = useMemo(
    () =>
      getFoundationalProfileSnapshot(profileForm) !==
      getFoundationalProfileSnapshot(loadedProfileForm),
    [loadedProfileForm, profileForm],
  );

  const templateDirty = useMemo(
    () => templateEditorText.trim() !== loadedTemplateContent.trim(),
    [loadedTemplateContent, templateEditorText],
  );

  const visibleProfileCandidates = useMemo(
    () =>
      profileCandidates.filter((candidate) =>
        profileCandidateFilter === PROFILE_CANDIDATE_PENDING_FILTER
          ? isPendingCandidate(candidate)
          : isReviewedCandidate(candidate),
      ),
    [profileCandidateFilter, profileCandidates],
  );

  const groupedProfileCandidates = useMemo(() => {
    const groups = new Map<string, StudentProfileCandidate[]>();
    for (const candidate of visibleProfileCandidates) {
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
  }, [visibleProfileCandidates]);

  const approvedCandidatesReadyForPromotion = useMemo(
    () => profileCandidates.filter((candidate) => isSelectableForPromotion(candidate)),
    [profileCandidates],
  );

  useEffect(() => {
    historyFiltersAppliedRef.current = historyFiltersApplied;
  }, [historyFiltersApplied]);

  useEffect(() => {
    timelineFiltersAppliedRef.current = timelineFiltersApplied;
  }, [timelineFiltersApplied]);

  useEffect(() => {
    setProfileCandidateDrafts({});
    setSelectedCandidateIds([]);
    setProfileCandidatePromotionNote('');
    setProfileCandidatePromotionError(null);
    setProfileCandidatePromotionSuccess(null);
  }, [selectedStudentId]);

  const mergeProfileCandidate = useCallback((candidate: StudentProfileCandidate) => {
    setProfileCandidates((current) =>
      current.map((item) => (item.id === candidate.id ? candidate : item)),
    );
    if (!isSelectableForPromotion(candidate)) {
      setSelectedCandidateIds((current) => current.filter((item) => item !== candidate.id));
    }
  }, []);

  const updateProfileCandidateDraft = useCallback(
    (candidateId: string, patch: Partial<{ approvedFactText: string; reviewerNote: string }>) => {
      setProfileCandidateDrafts((current) => {
        const existing = current[candidateId] ?? { approvedFactText: '', reviewerNote: '' };
        return {
          ...current,
          [candidateId]: {
            approvedFactText: patch.approvedFactText ?? existing.approvedFactText,
            reviewerNote: patch.reviewerNote ?? existing.reviewerNote,
          },
        };
      });
    },
    [],
  );

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    setStudentsError(null);
    try {
      const response = await listStudents({ limit: 200, offset: 0, order: 'asc' });
      const items = sortStudentsForPicker(response.items ?? []);
      setStudents(items);
      setSelectedStudentId((current) => {
        if (current && items.some((item) => item.id === current)) return current;
        return items[0]?.id ?? '';
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load students.';
      setStudentsError(message);
      setStudents([]);
      setSelectedStudentId('');
    } finally {
      setStudentsLoading(false);
    }
  }, []);

  const loadProfileOptions = useCallback(async () => {
    setProfileOptionsError(null);
    try {
      const response = await listProfileContents();
      setProfileOptions(response.profiles ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load profile options.';
      setProfileOptionsError(message);
      setProfileOptions([]);
    }
  }, []);

  const loadTemplateOptions = useCallback(async () => {
    setTemplateOptionsError(null);
    try {
      const response = await listTemplateContents();
      const templates = response.templates ?? [];
      setTemplateOptions(templates);
      setSelectedTemplateId((current) => {
        if (current && templates.some((template) => template.id === current)) return current;
        return templates[0]?.id ?? '';
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load template options.';
      setTemplateOptionsError(message);
      setTemplateOptions([]);
      setSelectedTemplateId('');
    }
  }, []);

  const loadSelectedProfile = useCallback(async (profileId: string) => {
    if (!profileId) {
      setProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
      setLoadedProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
      setProfileRevisions([]);
      setProfileError(null);
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
      const nextProfileForm = foundationalProfileToFormState(profile.structuredContent);
      setProfileForm(nextProfileForm);
      setLoadedProfileForm(nextProfileForm);
      setProfileLegacyNotice(getLegacyProfileNotice(profile));
      setProfileRevisions(revisions.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load selected profile.';
      setProfileError(message);
      setProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
      setLoadedProfileForm(INITIAL_FOUNDATIONAL_PROFILE_FORM);
      setProfileRevisions([]);
      setProfileLegacyNotice(null);
    } finally {
      setProfileBusy(null);
    }
  }, []);

  const loadProfileRevisionIntoEditor = useCallback(
    async (profileId: string, revisionId: string) => {
      const revision = await getProfileRevision(profileId, revisionId);
      const nextProfileForm = foundationalProfileToFormState(revision.structuredContent);
      setProfileForm(nextProfileForm);
      setLoadedProfileForm(nextProfileForm);
      setProfileLegacyNotice(getLegacyProfileNotice(revision));
    },
    [],
  );

  const loadSelectedTemplate = useCallback(async (templateId: string) => {
    if (!templateId) {
      setTemplateEditorText('');
      setLoadedTemplateContent('');
      setTemplateRevisions([]);
      setTemplateError(null);
      return;
    }

    setTemplateBusy('loading');
    setTemplateError(null);
    try {
      const [template, revisions] = await Promise.all([
        getTemplateContent(templateId),
        listTemplateRevisions(templateId, { limit: 25, offset: 0, order: 'desc' }),
      ]);
      setTemplateEditorText(template.content ?? '');
      setLoadedTemplateContent(template.content ?? '');
      setTemplateRevisions(revisions.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load selected template.';
      setTemplateError(message);
      setTemplateEditorText('');
      setLoadedTemplateContent('');
      setTemplateRevisions([]);
    } finally {
      setTemplateBusy(null);
    }
  }, []);

  const loadJobHistory = useCallback(async (studentId: string, filters: HistoryFilters) => {
    const requestId = ++historyRequestIdRef.current;
    if (!studentId) {
      setJobHistory([]);
      return;
    }
    setJobsLoading(true);
    setJobsError(null);
    try {
      const response = await listUserJobs({
        studentId,
        state: filters.state === 'all' ? undefined : filters.state,
        from: toIsoOrUndefined(filters.from),
        to: toIsoOrUndefined(filters.to),
        limit: HISTORY_LIMIT,
        offset: 0,
        order: 'desc',
      });
      if (requestId !== historyRequestIdRef.current) return;
      setJobHistory(response.jobs ?? []);
    } catch (error) {
      if (requestId !== historyRequestIdRef.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load assignment history.';
      setJobsError(message);
      setJobHistory([]);
    } finally {
      if (requestId === historyRequestIdRef.current) {
        setJobsLoading(false);
      }
    }
  }, []);

  const loadTimeline = useCallback(async (studentId: string, filters: TimelineFilters) => {
    const requestId = ++timelineRequestIdRef.current;
    if (!studentId) {
      setTimeline([]);
      return;
    }
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const response = await getStudentTimeline(studentId, {
        type: filters.type === 'all' ? undefined : filters.type,
        from: toIsoOrUndefined(filters.from),
        to: toIsoOrUndefined(filters.to),
        limit: HISTORY_LIMIT,
        offset: 0,
        order: 'desc',
      });
      if (requestId !== timelineRequestIdRef.current) return;
      setTimeline(response.items ?? []);
    } catch (error) {
      if (requestId !== timelineRequestIdRef.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load student timeline.';
      setTimelineError(message);
      setTimeline([]);
    } finally {
      if (requestId === timelineRequestIdRef.current) {
        setTimelineLoading(false);
      }
    }
  }, []);

  const loadBindings = useCallback(async (studentId: string) => {
    const requestId = ++bindingsRequestIdRef.current;
    if (!studentId) {
      setBindingHistory([]);
      return;
    }
    setBindingHistoryLoading(true);
    setBindingHistoryError(null);
    try {
      const response = await listStudentProfileBindings(studentId, {
        limit: BINDING_LIMIT,
        offset: 0,
        order: 'desc',
      });
      if (requestId !== bindingsRequestIdRef.current) return;
      setBindingHistory(response.items ?? []);
    } catch (error) {
      if (requestId !== bindingsRequestIdRef.current) return;
      const message =
        error instanceof Error ? error.message : 'Unable to load profile binding history.';
      setBindingHistoryError(message);
      setBindingHistory([]);
    } finally {
      if (requestId === bindingsRequestIdRef.current) {
        setBindingHistoryLoading(false);
      }
    }
  }, []);

  const loadMemoryOverview = useCallback(async (studentId: string) => {
    const requestId = ++memoryOverviewRequestIdRef.current;
    if (!studentId) {
      setMemoryOverview(null);
      return;
    }

    setMemoryOverviewLoading(true);
    setMemoryOverviewError(null);
    try {
      const response = await getStudentMemoryOverview(studentId, {
        lessonLimit: MEMORY_OVERVIEW_LESSON_LIMIT,
        homeworkLimit: MEMORY_OVERVIEW_HOMEWORK_LIMIT,
      });
      if (requestId !== memoryOverviewRequestIdRef.current) return;
      setMemoryOverview(response);
    } catch (error) {
      if (requestId !== memoryOverviewRequestIdRef.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load student memory.';
      setMemoryOverviewError(message);
      setMemoryOverview(null);
    } finally {
      if (requestId === memoryOverviewRequestIdRef.current) {
        setMemoryOverviewLoading(false);
      }
    }
  }, []);

  const loadProfileCandidates = useCallback(async (studentId: string) => {
    const requestId = ++profileCandidatesRequestIdRef.current;
    if (!studentId) {
      setProfileCandidates([]);
      setSelectedCandidateIds([]);
      setProfileCandidatePromotionError(null);
      setProfileCandidatePromotionSuccess(null);
      return;
    }

    setProfileCandidatesLoading(true);
    setProfileCandidatesError(null);
    try {
      const response = await listStudentProfileCandidates(studentId, {
        limit: PROFILE_CANDIDATE_LIMIT,
        offset: 0,
        order: 'desc',
      });
      if (requestId !== profileCandidatesRequestIdRef.current) return;
      setProfileCandidates(response.items ?? []);
      setSelectedCandidateIds((current) =>
        current.filter((candidateId) =>
          (response.items ?? []).some(
            (candidate) => candidate.id === candidateId && isSelectableForPromotion(candidate),
          ),
        ),
      );
    } catch (error) {
      if (requestId !== profileCandidatesRequestIdRef.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load profile candidates.';
      setProfileCandidatesError(message);
      setProfileCandidates([]);
      setSelectedCandidateIds([]);
    } finally {
      if (requestId === profileCandidatesRequestIdRef.current) {
        setProfileCandidatesLoading(false);
      }
    }
  }, []);

  const loadSelectedStudent = useCallback(
    async (studentId: string) => {
      const requestId = ++selectedStudentRequestIdRef.current;
      if (!studentId) {
        historyRequestIdRef.current += 1;
        timelineRequestIdRef.current += 1;
        bindingsRequestIdRef.current += 1;
        memoryOverviewRequestIdRef.current += 1;
        profileCandidatesRequestIdRef.current += 1;
        setSelectedStudent(null);
        setSelectedProfileId('');
        setJobHistory([]);
        setTimeline([]);
        setBindingHistory([]);
        setMemoryOverview(null);
        setProfileCandidates([]);
        setSelectedCandidateIds([]);
        setProfileCandidatePromotionError(null);
        setProfileCandidatePromotionSuccess(null);
        return;
      }

      setBindingSuccess(null);
      try {
        const profile = await getStudentProfile(studentId);
        if (requestId !== selectedStudentRequestIdRef.current) return;
        setSelectedStudent(profile);
        setSelectedProfileId(profile.profileId ?? '');
      } catch (error) {
        if (requestId !== selectedStudentRequestIdRef.current) return;
        const message = error instanceof Error ? error.message : 'Unable to load selected student.';
        setSelectedStudent(null);
        setProfileError(message);
      }

      await Promise.all([
        loadJobHistory(studentId, historyFiltersAppliedRef.current),
        loadTimeline(studentId, timelineFiltersAppliedRef.current),
        loadBindings(studentId),
        loadMemoryOverview(studentId),
        loadProfileCandidates(studentId),
      ]);
    },
    [loadBindings, loadJobHistory, loadMemoryOverview, loadProfileCandidates, loadTimeline],
  );

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([loadStudents(), loadProfileOptions(), loadTemplateOptions()]);
  }, [loadProfileOptions, loadStudents, loadTemplateOptions]);

  const resetCreateStudentForm = useCallback(() => {
    setCreateStudentForm(INITIAL_CREATE_STUDENT_FORM);
    setCreateStudentError(null);
  }, []);

  const handleCreateStudent = async () => {
    const built = buildCreateStudentPayload(createStudentForm);
    if (built.validationError) {
      setCreateStudentError(built.validationError);
      return;
    }

    setCreateStudentBusy(true);
    setCreateStudentError(null);
    setCreateStudentSuccess(null);

    try {
      if (!built.payload) {
        throw new Error('Expected create-student payload to be available.');
      }
      const created = await createStudentProfile(built.payload);

      await Promise.all([loadStudents(), loadProfileOptions()]);
      setSelectedStudentId(created.id);
      setSelectedProfileId(created.profileId ?? '');
      setSelectedStudent(created);
      setCreateStudentSuccess(`Created student ${created.student}.`);
      resetCreateStudentForm();
      setIsCreateStudentOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create student.';
      setCreateStudentError(message);
    } finally {
      setCreateStudentBusy(false);
    }
  };

  const handleSaveBinding = async () => {
    if (!selectedStudentId) return;
    setProfileBindingSaving(true);
    setProfileError(null);
    setBindingSuccess(null);
    try {
      const updated = await updateStudentProfile(selectedStudentId, {
        profileId: selectedProfileId || null,
      });
      setSelectedStudent(updated);
      setBindingSuccess('Student profile binding updated.');
      await Promise.all([
        loadStudents(),
        loadBindings(selectedStudentId),
        loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current),
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to update student profile binding.';
      setProfileError(message);
    } finally {
      setProfileBindingSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedProfileId) {
      setProfileError('Select a profile before saving a draft.');
      return;
    }

    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const saved = await saveProfileDraftRevision(selectedProfileId, {
        structuredContent: foundationalProfileFormToStructuredContent(profileForm),
      });
      const savedForm = foundationalProfileToFormState(saved.structuredContent);
      setProfileForm(savedForm);
      setLoadedProfileForm(savedForm);
      setProfileLegacyNotice(null);
      const revisions = await listProfileRevisions(saved.profileId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile draft saved.');
      await loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save profile draft.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!selectedProfileId) return;
    setProfileBusy('restoring');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const restored = await restoreProfileRevision(selectedProfileId, revisionId);
      const restoredForm = foundationalProfileToFormState(restored.structuredContent);
      setProfileForm(restoredForm);
      setLoadedProfileForm(restoredForm);
      setProfileLegacyNotice(getLegacyProfileNotice(restored));
      const revisions = await listProfileRevisions(restored.id, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile revision restored.');
      await loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to restore profile revision.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleActivateRevision = async (revisionId: string) => {
    if (!selectedProfileId) return;
    setProfileBusy('activating');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      await activateProfileRevision(selectedProfileId, revisionId);
      await loadSelectedProfile(selectedProfileId);
      setProfileSuccess('Profile revision activated.');
      await loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to activate profile revision.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleProfileFormFieldChange = useCallback(
    (field: keyof FoundationalProfileFormState, value: string) => {
      setProfileForm((current) => ({
        ...current,
        [field]: value,
      }));
    },
    [],
  );

  const handleReviewProfileCandidate = async (
    candidate: StudentProfileCandidate,
    action: CandidateActionKind,
  ) => {
    if (!selectedStudentId) return;

    const draft = profileCandidateDrafts[candidate.id];
    const reviewerNote = draft?.reviewerNote.trim();
    const approvedFactText = draft?.approvedFactText.trim();

    setProfileCandidateAction({ candidateId: candidate.id, action });
    setProfileCandidatesError(null);
    setProfileCandidatePromotionError(null);
    setProfileCandidatePromotionSuccess(null);
    try {
      if (action === 'approve') {
        const updated = await approveStudentProfileCandidate(selectedStudentId, candidate.id, {
          ...(approvedFactText ? { approvedFactText } : {}),
          ...(reviewerNote ? { reviewerNote } : {}),
        });
        mergeProfileCandidate(updated);
      } else if (action === 'reject') {
        const updated = await rejectStudentProfileCandidate(selectedStudentId, candidate.id, {
          ...(reviewerNote ? { reviewerNote } : {}),
        });
        mergeProfileCandidate(updated);
      } else {
        const updated = await deferStudentProfileCandidate(selectedStudentId, candidate.id, {
          ...(reviewerNote ? { reviewerNote } : {}),
        });
        mergeProfileCandidate(updated);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to update profile candidate review.';
      setProfileCandidatesError(message);
    } finally {
      setProfileCandidateAction(null);
    }
  };

  const handleToggleCandidateSelection = (candidateId: string, checked: boolean) => {
    setSelectedCandidateIds((current) => {
      if (checked) {
        return current.includes(candidateId) ? current : [...current, candidateId];
      }
      return current.filter((item) => item !== candidateId);
    });
  };

  const handleSelectAllApprovedCandidates = () => {
    setSelectedCandidateIds(approvedCandidatesReadyForPromotion.map((candidate) => candidate.id));
  };

  const handlePromoteProfileCandidates = async () => {
    if (!selectedStudentId) return;
    if (selectedCandidateIds.length === 0) {
      setProfileCandidatePromotionError('Select at least one approved candidate to promote.');
      return;
    }

    setProfileCandidatePromotionBusy(true);
    setProfileCandidatePromotionError(null);
    setProfileCandidatePromotionSuccess(null);
    try {
      const response = await promoteStudentProfileCandidates(selectedStudentId, {
        candidateIds: selectedCandidateIds,
        ...(profileCandidatePromotionNote.trim()
          ? { reviewerNote: profileCandidatePromotionNote.trim() }
          : {}),
      });
      setProfileCandidatePromotionSuccess(
        `Draft revision ${response.draftRevisionId} created. Review it below, then activate when ready.`,
      );
      setSelectedCandidateIds([]);
      setProfileCandidatePromotionNote('');
      await Promise.all([
        loadProfileCandidates(selectedStudentId),
        selectedProfileId || response.profileId
          ? loadProfileRevisionIntoEditor(
              selectedProfileId || response.profileId,
              response.draftRevisionId,
            )
          : Promise.resolve(),
        loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current),
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to promote approved profile candidates.';
      setProfileCandidatePromotionError(message);
    } finally {
      setProfileCandidatePromotionBusy(false);
    }
  };

  const handleCreateTemplate = async () => {
    const templateId = newTemplateId.trim();
    if (!templateId) {
      setTemplateError('Template ID is required.');
      return;
    }

    setTemplateBusy('saving');
    setTemplateError(null);
    setTemplateSuccess(null);
    try {
      const created = await upsertTemplateContent(templateId, CLEAN_TEMPLATE_STARTER_CONTENT);
      setTemplateSuccess(`Template ${created.id} created.`);
      setSelectedTemplateId(created.id);
      setNewTemplateId('');
      await loadTemplateOptions();
      await loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create template.';
      setTemplateError(message);
    } finally {
      setTemplateBusy(null);
    }
  };

  const handleSaveTemplate = async () => {
    if (!selectedTemplateId) {
      setTemplateError('Select a template before saving content.');
      return;
    }

    setTemplateBusy('saving');
    setTemplateError(null);
    setTemplateSuccess(null);
    try {
      const saved = await upsertTemplateContent(selectedTemplateId, templateEditorText);
      setTemplateEditorText(saved.content ?? '');
      setLoadedTemplateContent(saved.content ?? '');
      const revisions = await listTemplateRevisions(saved.id, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setTemplateRevisions(revisions.items ?? []);
      setTemplateSuccess('Template content saved.');
      await loadTemplateOptions();
      await loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save template content.';
      setTemplateError(message);
    } finally {
      setTemplateBusy(null);
    }
  };

  const handleRestoreTemplateRevision = async (revisionId: string) => {
    if (!selectedTemplateId) return;
    setTemplateBusy('restoring');
    setTemplateError(null);
    setTemplateSuccess(null);
    try {
      const restored = await restoreTemplateRevision(selectedTemplateId, revisionId);
      setTemplateEditorText(restored.content ?? '');
      setLoadedTemplateContent(restored.content ?? '');
      const revisions = await listTemplateRevisions(restored.id, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setTemplateRevisions(revisions.items ?? []);
      setTemplateSuccess('Template revision restored.');
      await loadTemplateOptions();
      await loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to restore template revision.';
      setTemplateError(message);
    } finally {
      setTemplateBusy(null);
    }
  };

  const handleActivateTemplateRevision = async (revisionId: string) => {
    if (!selectedTemplateId) return;
    setTemplateBusy('activating');
    setTemplateError(null);
    setTemplateSuccess(null);
    try {
      await activateTemplateRevision(selectedTemplateId, revisionId);
      await loadSelectedTemplate(selectedTemplateId);
      setTemplateSuccess('Template revision activated.');
      await loadTemplateOptions();
      await loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to activate template revision.';
      setTemplateError(message);
    } finally {
      setTemplateBusy(null);
    }
  };

  const handleArchiveTemplate = async () => {
    if (!selectedTemplateId) return;
    setTemplateBusy('archiving');
    setTemplateError(null);
    setTemplateSuccess(null);
    try {
      await deleteTemplateContent(selectedTemplateId);
      const archivedId = selectedTemplateId;
      await loadTemplateOptions();
      setSelectedTemplateId((current) => (current === archivedId ? '' : current));
      setTemplateEditorText('');
      setLoadedTemplateContent('');
      setTemplateRevisions([]);
      setTemplateSuccess(`Template ${archivedId} archived.`);
      await loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to archive template.';
      setTemplateError(message);
    } finally {
      setTemplateBusy(null);
    }
  };

  const handleInspectJob = (jobId: string, promptPackageId: string | null) => {
    setSelectedJobId(jobId);
    setSelectedPromptPackageId(promptPackageId ?? '');
    setInspectRequestId((current) => current + 1);
    setJobProvenance(null);
    setLineage(null);
  };

  useEffect(() => {
    void handleRefreshAll();
  }, [handleRefreshAll]);

  useEffect(() => {
    void loadSelectedStudent(selectedStudentId);
  }, [loadSelectedStudent, selectedStudentId]);

  useEffect(() => {
    void loadSelectedProfile(selectedProfileId);
  }, [loadSelectedProfile, selectedProfileId]);

  useEffect(() => {
    void loadSelectedTemplate(selectedTemplateId);
  }, [loadSelectedTemplate, selectedTemplateId]);

  useEffect(() => {
    if (!selectedJobId) {
      setJobProvenance(null);
      setJobProvenanceError(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setJobProvenanceLoading(true);
      setJobProvenanceError(null);
      try {
        const provenance = await fetchJobProvenance(selectedJobId);
        if (cancelled) return;
        setJobProvenance(provenance);
        if (provenance.promptPackage?.id) {
          setSelectedPromptPackageId((current) => current || provenance.promptPackage?.id || '');
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Unable to load job provenance.';
        setJobProvenanceError(message);
        setJobProvenance(null);
      } finally {
        if (!cancelled) setJobProvenanceLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [inspectRequestId, selectedJobId]);

  useEffect(() => {
    if (!selectedPromptPackageId) {
      setLineage(null);
      setLineageError(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLineageLoading(true);
      setLineageError(null);
      try {
        const response = await fetchPromptPackageLineage(selectedPromptPackageId);
        if (cancelled) return;
        setLineage(response);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Unable to load prompt lineage.';
        setLineageError(message);
        setLineage(null);
      } finally {
        if (!cancelled) setLineageLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [inspectRequestId, selectedPromptPackageId]);

  return (
    <div className="workspace-root">
      <section className="workspace-hero card">
        <div>
          <h1>Student Workspace</h1>
          <p>
            Unified profile editing, assignment history, lineage, and timeline diagnostics for one
            student at a time.
          </p>
        </div>
        <div className="workspace-hero-actions">
          <Link to="/" className="workspace-secondary-btn">
            Open Minimal Workflow
          </Link>
          <button
            type="button"
            className="workspace-primary-btn"
            onClick={() => void handleRefreshAll()}
            disabled={studentsLoading}
          >
            {studentsLoading ? 'Refreshing...' : 'Refresh Workspace'}
          </button>
        </div>
      </section>

      <section className="workspace-grid">
        <article className="workspace-card card">
          <CreateStudentDialog
            isOpen={isCreateStudentOpen}
            isBusy={createStudentBusy}
            error={createStudentError}
            success={createStudentSuccess}
            profileOptions={profileOptions}
            createStudentForm={createStudentForm}
            onToggleOpen={() => {
              setCreateStudentSuccess(null);
              if (isCreateStudentOpen) {
                resetCreateStudentForm();
              }
              setIsCreateStudentOpen((current) => !current);
            }}
            onCancel={() => {
              resetCreateStudentForm();
              setIsCreateStudentOpen(false);
            }}
            onSubmit={() => void handleCreateStudent()}
            setCreateStudentForm={setCreateStudentForm}
          />

          <label className="workspace-field">
            Student
            <select
              value={selectedStudentId}
              onChange={(event) => setSelectedStudentId(event.target.value)}
              disabled={studentsLoading || students.length === 0}
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.student} ({student.id})
                </option>
              ))}
            </select>
          </label>

          {studentsError ? <p className="workspace-error">{studentsError}</p> : null}

          {selectedStudent ? (
            <div className="workspace-meta">
              <span>
                <strong>Name:</strong> {selectedStudent.student}
              </span>
              <span>
                <strong>ID:</strong> {selectedStudent.id}
              </span>
              <span>
                <strong>Current profile:</strong> {selectedStudent.profileId ?? 'none'}
              </span>
            </div>
          ) : (
            <p className="workspace-muted">Select a student to load profile and history data.</p>
          )}
        </article>

        <article className="workspace-card card">
          <header>
            <h2>Profile Selection</h2>
            <p>Select the learner profile used by the legacy workspace.</p>
          </header>

          <label className="workspace-field">
            Learner profile
            <select
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              disabled={!selectedStudentId || profileOptions.length === 0}
            >
              <option value="">No learner profile selected</option>
              {profileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label} ({profile.id})
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="workspace-primary-btn"
            onClick={() => void handleSaveBinding()}
            disabled={!selectedStudentId || profileBindingSaving}
          >
            {profileBindingSaving ? 'Saving...' : 'Save Student Binding'}
          </button>

          {profileOptionsError ? <p className="workspace-error">{profileOptionsError}</p> : null}
          {bindingSuccess ? <p className="workspace-success">{bindingSuccess}</p> : null}
          {bindingHistoryError ? <p className="workspace-error">{bindingHistoryError}</p> : null}

          {bindingHistoryLoading ? (
            <p className="workspace-muted">Loading binding history...</p>
          ) : bindingHistory.length > 0 ? (
            <div className="workspace-list">
              {bindingHistory.map((binding) => (
                <div key={binding.id} className="workspace-list-item">
                  <span>{binding.profileId}</span>
                  <span className="workspace-muted">
                    {new Date(binding.effectiveFrom).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-muted">No binding history available.</p>
          )}
        </article>
      </section>

      <section className="workspace-grid workspace-grid-wide">
        <article className="workspace-card card">
          <header>
            <h2>Foundational Profile & Revisions</h2>
            <p>
              Update the learner&apos;s structured teaching context here, then restore or activate
              older revisions when needed.
            </p>
          </header>

          <div className="workspace-grid">
            <label className="workspace-field">
              <span>Current level</span>
              <input
                type="text"
                value={profileForm.overallLevel}
                onChange={(event) =>
                  handleProfileFormFieldChange('overallLevel', event.target.value)
                }
                placeholder="B1, B2, C1..."
                disabled={!selectedProfileId}
              />
            </label>

            <label className="workspace-field workspace-field-span-2">
              <span>Primary goals</span>
              <textarea
                value={profileForm.primaryGoals}
                onChange={(event) =>
                  handleProfileFormFieldChange('primaryGoals', event.target.value)
                }
                rows={4}
                placeholder="One durable goal per line"
                disabled={!selectedProfileId}
              />
            </label>

            <label className="workspace-field">
              <span>Communication contexts</span>
              <textarea
                value={profileForm.communicationContexts}
                onChange={(event) =>
                  handleProfileFormFieldChange('communicationContexts', event.target.value)
                }
                rows={4}
                placeholder="Client calls, demos, presentations..."
                disabled={!selectedProfileId}
              />
            </label>

            <label className="workspace-field">
              <span>Interests and useful themes</span>
              <textarea
                value={profileForm.interestsAndUsefulThemes}
                onChange={(event) =>
                  handleProfileFormFieldChange('interestsAndUsefulThemes', event.target.value)
                }
                rows={4}
                placeholder="Travel, design systems, films..."
                disabled={!selectedProfileId}
              />
            </label>

            <label className="workspace-field">
              <span>Stable strengths</span>
              <textarea
                value={profileForm.stableStrengths}
                onChange={(event) =>
                  handleProfileFormFieldChange('stableStrengths', event.target.value)
                }
                rows={4}
                placeholder="Strong listening, high motivation..."
                disabled={!selectedProfileId}
              />
            </label>

            <label className="workspace-field">
              <span>Persistent challenges</span>
              <textarea
                value={profileForm.persistentChallenges}
                onChange={(event) =>
                  handleProfileFormFieldChange('persistentChallenges', event.target.value)
                }
                rows={4}
                placeholder="Article usage, sentence rhythm..."
                disabled={!selectedProfileId}
              />
            </label>

            <label className="workspace-field">
              <span>Study preferences</span>
              <textarea
                value={profileForm.studyPreferences}
                onChange={(event) =>
                  handleProfileFormFieldChange('studyPreferences', event.target.value)
                }
                rows={4}
                placeholder="One preference or constraint per line"
                disabled={!selectedProfileId}
              />
            </label>

            <label className="workspace-field">
              <span>Durable constraints</span>
              <textarea
                value={profileForm.durableConstraints}
                onChange={(event) =>
                  handleProfileFormFieldChange('durableConstraints', event.target.value)
                }
                rows={4}
                placeholder="Short homework windows, device limitations..."
                disabled={!selectedProfileId}
              />
            </label>

            <label className="workspace-field workspace-field-span-2">
              <span>Teacher notes</span>
              <textarea
                value={profileForm.teacherNotes}
                onChange={(event) =>
                  handleProfileFormFieldChange('teacherNotes', event.target.value)
                }
                rows={4}
                placeholder="Durable notes that help shape future lessons"
                disabled={!selectedProfileId}
              />
            </label>
          </div>

          <div className="workspace-inline">
            <button
              type="button"
              className="workspace-primary-btn"
              onClick={() => void handleSaveProfile()}
              disabled={!selectedProfileId || profileBusy !== null || !profileDirty}
            >
              {profileBusy === 'saving' ? 'Saving...' : 'Save Profile Draft'}
            </button>
            {profileDirty ? <span className="workspace-muted">Unsaved changes</span> : null}
          </div>

          {profileError ? <p className="workspace-error">{profileError}</p> : null}
          {profileSuccess ? <p className="workspace-success">{profileSuccess}</p> : null}
          {profileLegacyNotice ? <p className="workspace-muted">{profileLegacyNotice}</p> : null}

          {profileRevisions.length > 0 ? (
            <div className="workspace-list">
              {profileRevisions.map((revision) => (
                <div key={revision.id} className="workspace-list-item">
                  <div>
                    <div>
                      <strong>{revision.versionLabel ?? revision.id}</strong>
                      <span className="workspace-muted"> {revision.status ?? 'unknown'}</span>
                    </div>
                    <div className="workspace-muted">
                      {new Date(revision.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="workspace-inline">
                    <button
                      type="button"
                      className="workspace-secondary-btn"
                      onClick={() => void handleRestoreRevision(revision.id)}
                      disabled={profileBusy !== null}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className="workspace-secondary-btn"
                      onClick={() => void handleActivateRevision(revision.id)}
                      disabled={profileBusy !== null}
                    >
                      Activate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-muted">No profile revisions to show.</p>
          )}
        </article>

        <article className="workspace-card card">
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
                <option value={PROFILE_CANDIDATE_PENDING_FILTER}>Pending</option>
                <option value={PROFILE_CANDIDATE_REVIEWED_FILTER}>Reviewed</option>
              </select>
            </label>

            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => void loadProfileCandidates(selectedStudentId)}
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
                onClick={handleSelectAllApprovedCandidates}
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
                {selectedCandidateIds.length} selected for draft revision generation
              </span>
              <button
                type="button"
                className="workspace-primary-btn"
                onClick={() => void handlePromoteProfileCandidates()}
                disabled={!selectedStudentId || profileCandidatePromotionBusy}
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

          {profileCandidatesError ? (
            <p className="workspace-error">{profileCandidatesError}</p>
          ) : null}

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
                        draft?.approvedFactText ??
                        candidate.approvedFactText ??
                        candidate.proposedFact;
                      const reviewerNote = draft?.reviewerNote ?? '';
                      const isBusy = profileCandidateAction?.candidateId === candidate.id;
                      const isTerminal =
                        candidate.status === 'promoted' || candidate.status === 'superseded';
                      const isSelected = selectedCandidateIds.includes(candidate.id);

                      return (
                        <details key={candidate.id} className="workspace-candidate-details">
                          <summary className="workspace-candidate-summary">
                            <div>
                              <strong>
                                {candidate.approvedFactText ?? candidate.proposedFact}
                              </strong>
                              <div className="workspace-muted">
                                {toTitleCaseLabel(candidate.category)} ·{' '}
                                {formatCandidateStateLabel(candidate)}
                              </div>
                            </div>

                            <div className="workspace-inline">
                              {isSelectableForPromotion(candidate) ? (
                                <label
                                  className="workspace-inline workspace-muted"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    aria-label={`Select candidate ${candidate.id} for promotion`}
                                    checked={isSelected}
                                    onChange={(event) =>
                                      handleToggleCandidateSelection(
                                        candidate.id,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                  Select
                                </label>
                              ) : null}
                              <span className="workspace-pill">
                                {formatCandidateStateLabel(candidate)}
                              </span>
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
                                          <div className="workspace-muted">
                                            {evidence.evidenceNote}
                                          </div>
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
                                onClick={() =>
                                  void handleReviewProfileCandidate(candidate, 'approve')
                                }
                                disabled={isTerminal || isBusy}
                              >
                                {isBusy && profileCandidateAction?.action === 'approve'
                                  ? 'Saving...'
                                  : 'Approve'}
                              </button>
                              <button
                                type="button"
                                className="workspace-secondary-btn"
                                onClick={() =>
                                  void handleReviewProfileCandidate(candidate, 'defer')
                                }
                                disabled={isTerminal || isBusy}
                              >
                                {isBusy && profileCandidateAction?.action === 'defer'
                                  ? 'Saving...'
                                  : 'Defer'}
                              </button>
                              <button
                                type="button"
                                className="workspace-secondary-btn"
                                onClick={() =>
                                  void handleReviewProfileCandidate(candidate, 'reject')
                                }
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

        <article className="workspace-card card">
          <header>
            <h2>Template Gallery & Revisions</h2>
            <p>Edit templates, restore prior revisions, and archive deprecated entries.</p>
          </header>

          <div className="workspace-grid">
            <label className="workspace-field">
              Template
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                disabled={templateOptions.length === 0 || templateBusy !== null}
              >
                <option value="">Select template</option>
                {templateOptions.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label} ({template.id})
                  </option>
                ))}
              </select>
            </label>

            <label className="workspace-field">
              New template ID
              <input
                value={newTemplateId}
                onChange={(event) => setNewTemplateId(event.target.value)}
                placeholder="e.g. hw/custom-template.md"
                disabled={templateBusy !== null}
              />
            </label>
          </div>

          <div className="workspace-inline">
            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => void handleCreateTemplate()}
              disabled={templateBusy !== null || !newTemplateId.trim()}
            >
              {templateBusy === 'saving' ? 'Creating...' : 'Create Template'}
            </button>
          </div>

          <textarea
            value={templateEditorText}
            onChange={(event) => setTemplateEditorText(event.target.value)}
            rows={14}
            placeholder="Select a template to edit..."
            disabled={!selectedTemplateId}
          />

          <div className="workspace-inline">
            <button
              type="button"
              className="workspace-primary-btn"
              onClick={() => void handleSaveTemplate()}
              disabled={!selectedTemplateId || templateBusy !== null || !templateDirty}
            >
              {templateBusy === 'saving' ? 'Saving...' : 'Save Template Content'}
            </button>
            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => void handleArchiveTemplate()}
              disabled={!selectedTemplateId || templateBusy !== null}
            >
              {templateBusy === 'archiving' ? 'Archiving...' : 'Archive Template'}
            </button>
            {templateDirty ? <span className="workspace-muted">Unsaved changes</span> : null}
          </div>

          {templateOptionsError ? <p className="workspace-error">{templateOptionsError}</p> : null}
          {templateError ? <p className="workspace-error">{templateError}</p> : null}
          {templateSuccess ? <p className="workspace-success">{templateSuccess}</p> : null}

          {templateRevisions.length > 0 ? (
            <div className="workspace-list">
              {templateRevisions.map((revision) => (
                <div key={revision.id} className="workspace-list-item">
                  <div>
                    <div>
                      <strong>{revision.versionLabel ?? revision.id}</strong>
                      <span className="workspace-muted"> {revision.status ?? 'unknown'}</span>
                    </div>
                    <div className="workspace-muted">
                      {new Date(revision.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="workspace-inline">
                    <button
                      type="button"
                      className="workspace-secondary-btn"
                      onClick={() => void handleRestoreTemplateRevision(revision.id)}
                      disabled={templateBusy !== null}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className="workspace-secondary-btn"
                      onClick={() => void handleActivateTemplateRevision(revision.id)}
                      disabled={templateBusy !== null}
                    >
                      Activate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-muted">No template revisions to show.</p>
          )}
        </article>

        <article className="workspace-card card">
          <header>
            <h2>Assignment History</h2>
            <p>Recent assignments for this student with outcome visibility.</p>
          </header>

          <div className="workspace-inline workspace-filter-row">
            <label className="workspace-field">
              State
              <select
                value={historyFiltersDraft.state}
                onChange={(event) =>
                  setHistoryFiltersDraft((current) => ({
                    ...current,
                    state: event.target.value as 'all' | JobState,
                  }))
                }
              >
                <option value="all">All states</option>
                <option value="queued">queued</option>
                <option value="running">running</option>
                <option value="awaiting_approval">awaiting_approval</option>
                <option value="succeeded">succeeded</option>
                <option value="failed">failed</option>
              </select>
            </label>

            <label className="workspace-field">
              From
              <input
                type="datetime-local"
                value={historyFiltersDraft.from}
                onChange={(event) =>
                  setHistoryFiltersDraft((current) => ({ ...current, from: event.target.value }))
                }
              />
            </label>

            <label className="workspace-field">
              To
              <input
                type="datetime-local"
                value={historyFiltersDraft.to}
                onChange={(event) =>
                  setHistoryFiltersDraft((current) => ({ ...current, to: event.target.value }))
                }
              />
            </label>

            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => {
                const nextFilters = { ...historyFiltersDraft };
                historyFiltersAppliedRef.current = nextFilters;
                setHistoryFiltersApplied(nextFilters);
                void loadJobHistory(selectedStudentId, nextFilters);
              }}
              disabled={!selectedStudentId || jobsLoading}
            >
              Apply
            </button>
          </div>

          {jobsError ? <p className="workspace-error">{jobsError}</p> : null}

          {jobsLoading ? (
            <p className="workspace-muted">Loading assignment history...</p>
          ) : jobHistory.length > 0 ? (
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>State</th>
                    <th>Created</th>
                    <th>Publish</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {jobHistory.map((job) => (
                    <tr
                      key={job.jobId}
                      className={selectedJobId === job.jobId ? 'workspace-selected-row' : ''}
                    >
                      <td>
                        <code>{job.jobId.slice(0, 8)}</code>
                        <div className="workspace-muted">prompt {job.promptPackageId ?? 'n/a'}</div>
                      </td>
                      <td>{job.state}</td>
                      <td>{new Date(job.createdAt).toLocaleString()}</td>
                      <td>{job.htmlUrl ? 'HTML' : 'Pending'}</td>
                      <td>
                        <div className="workspace-inline">
                          <Link
                            className="workspace-secondary-btn"
                            to={`/?jobId=${encodeURIComponent(job.jobId)}`}
                          >
                            Resume
                          </Link>
                          <button
                            type="button"
                            className="workspace-secondary-btn"
                            onClick={() => handleInspectJob(job.jobId, job.promptPackageId)}
                          >
                            Inspect
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="workspace-muted">No assignments found for this student yet.</p>
          )}
        </article>
      </section>

      <section className="workspace-grid workspace-grid-wide">
        <WorkspaceInspectionPanel
          selectedJob={selectedJob}
          jobProvenanceLoading={jobProvenanceLoading}
          jobProvenanceError={jobProvenanceError}
          jobProvenance={jobProvenance}
          memoryOverviewLoading={memoryOverviewLoading}
          memoryOverviewError={memoryOverviewError}
          memoryOverview={memoryOverview}
          lineageLoading={lineageLoading}
          lineageError={lineageError}
          lineage={lineage}
          formatDateTime={formatDateTime}
        />

        <article className="workspace-card card">
          <header>
            <h2>Student Timeline</h2>
            <p>Chronological student events for governance and diagnostics.</p>
          </header>

          <div className="workspace-inline workspace-filter-row">
            <label className="workspace-field">
              Event type
              <select
                value={timelineFiltersDraft.type}
                onChange={(event) =>
                  setTimelineFiltersDraft((current) => ({
                    ...current,
                    type: event.target.value as 'all' | StudentTimelineType,
                  }))
                }
              >
                <option value="all">All events</option>
                {TIMELINE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="workspace-field">
              From
              <input
                type="datetime-local"
                value={timelineFiltersDraft.from}
                onChange={(event) =>
                  setTimelineFiltersDraft((current) => ({ ...current, from: event.target.value }))
                }
              />
            </label>

            <label className="workspace-field">
              To
              <input
                type="datetime-local"
                value={timelineFiltersDraft.to}
                onChange={(event) =>
                  setTimelineFiltersDraft((current) => ({ ...current, to: event.target.value }))
                }
              />
            </label>

            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => {
                const nextFilters = { ...timelineFiltersDraft };
                timelineFiltersAppliedRef.current = nextFilters;
                setTimelineFiltersApplied(nextFilters);
                void loadTimeline(selectedStudentId, nextFilters);
              }}
              disabled={!selectedStudentId || timelineLoading}
            >
              Apply
            </button>
          </div>

          {timelineError ? <p className="workspace-error">{timelineError}</p> : null}

          {timelineLoading ? (
            <p className="workspace-muted">Loading timeline...</p>
          ) : timeline.length > 0 ? (
            <div className="workspace-list">
              {timeline.map((event, index) => (
                <div
                  key={`${event.type}-${event.createdAt}-${index}`}
                  className="workspace-list-item"
                >
                  <div>
                    <strong>{event.type}</strong>
                    <div className="workspace-muted">
                      {new Date(event.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span>{event.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-muted">No timeline events for this student yet.</p>
          )}
        </article>
      </section>
    </div>
  );
};
