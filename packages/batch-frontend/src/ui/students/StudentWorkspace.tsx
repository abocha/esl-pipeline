import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type {
  JobListResponse,
  JobProvenanceResponse,
  JobState,
  ProfileRevisionSummaryResponse,
  PromptPackageLineageResponse,
  StudentMemoryOverviewResponse,
  StudentProfile,
  StudentProfileBindingListResponse,
  StudentTimelineResponse,
  StudentTimelineType,
  TemplateRevisionSummaryResponse,
} from '../../utils/api';
import {
  activateProfileRevision,
  activateTemplateRevision,
  createStudentProfile,
  deleteTemplateContent,
  fetchJobProvenance,
  fetchPromptPackageLineage,
  getProfileContent,
  getStudentMemoryOverview,
  getStudentProfile,
  getStudentTimeline,
  getTemplateContent,
  listProfileContents,
  listProfileRevisions,
  listStudentProfileBindings,
  listStudents,
  listTemplateContents,
  listTemplateRevisions,
  listUserJobs,
  restoreProfileRevision,
  restoreTemplateRevision,
  updateStudentProfile,
  upsertProfileContent,
  upsertTemplateContent,
} from '../../utils/api';

const HISTORY_LIMIT = 25;
const BINDING_LIMIT = 20;
const MEMORY_OVERVIEW_LESSON_LIMIT = 3;
const MEMORY_OVERVIEW_HOMEWORK_LIMIT = 2;
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
  'job_action_rerun_audio',
  'job_action_rerun_publish',
  'job_action_cancel',
  'job_action_edit_metadata',
];

function toIsoOrUndefined(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

interface CreateStudentFormState {
  student: string;
  profileId: string;
  dbId: string;
  pageParentId: string;
  colorPreset: string;
  accentPreference: string;
  manifestPreset: string;
}

const INITIAL_CREATE_STUDENT_FORM: CreateStudentFormState = {
  student: '',
  profileId: '',
  dbId: '',
  pageParentId: '',
  colorPreset: '',
  accentPreference: '',
  manifestPreset: '',
};

interface HistoryFilters {
  state: 'all' | JobState;
  from: string;
  to: string;
}

interface TimelineFilters {
  type: 'all' | StudentTimelineType;
  from: string;
  to: string;
}

const INITIAL_HISTORY_FILTERS: HistoryFilters = {
  state: 'all',
  from: '',
  to: '',
};

const INITIAL_TIMELINE_FILTERS: TimelineFilters = {
  type: 'all',
  from: '',
  to: '',
};

function isDefaultStudentName(name: string): boolean {
  return name.trim().toLowerCase() === 'default';
}

function sortStudentsForPicker(items: StudentProfile[]): StudentProfile[] {
  return [...items].sort((left, right) => {
    const leftIsDefault = isDefaultStudentName(left.student);
    const rightIsDefault = isDefaultStudentName(right.student);

    if (leftIsDefault !== rightIsDefault) {
      return leftIsDefault ? -1 : 1;
    }

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

  const [profileEditorText, setProfileEditorText] = useState('');
  const [loadedProfileContent, setLoadedProfileContent] = useState('');
  const [profileBusy, setProfileBusy] = useState<
    'loading' | 'saving' | 'restoring' | 'activating' | null
  >(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
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

  const [selectedJobId, setSelectedJobId] = useState('');
  const [selectedPromptPackageId, setSelectedPromptPackageId] = useState('');
  const [inspectRequestId, setInspectRequestId] = useState(0);

  const [jobProvenance, setJobProvenance] = useState<JobProvenanceResponse | null>(null);
  const [jobProvenanceLoading, setJobProvenanceLoading] = useState(false);
  const [jobProvenanceError, setJobProvenanceError] = useState<string | null>(null);

  const [lineage, setLineage] = useState<PromptPackageLineageResponse | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageError, setLineageError] = useState<string | null>(null);

  const selectedStudentRequestId = useRef(0);
  const historyRequestId = useRef(0);
  const timelineRequestId = useRef(0);
  const bindingsRequestId = useRef(0);
  const memoryOverviewRequestId = useRef(0);

  const historyFiltersAppliedRef = useRef(historyFiltersApplied);
  const timelineFiltersAppliedRef = useRef(timelineFiltersApplied);

  const selectedJob = useMemo(
    () => jobHistory.find((job) => job.jobId === selectedJobId) ?? null,
    [jobHistory, selectedJobId],
  );

  const profileDirty = useMemo(
    () => profileEditorText.trim() !== loadedProfileContent.trim(),
    [loadedProfileContent, profileEditorText],
  );

  const templateDirty = useMemo(
    () => templateEditorText.trim() !== loadedTemplateContent.trim(),
    [loadedTemplateContent, templateEditorText],
  );

  useEffect(() => {
    historyFiltersAppliedRef.current = historyFiltersApplied;
  }, [historyFiltersApplied]);

  useEffect(() => {
    timelineFiltersAppliedRef.current = timelineFiltersApplied;
  }, [timelineFiltersApplied]);

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    setStudentsError(null);
    try {
      const response = await listStudents({ limit: 200, offset: 0, order: 'asc' });
      const items = sortStudentsForPicker(response.items ?? []);
      setStudents(items);
      setSelectedStudentId((current) => {
        if (current && items.some((item) => item.id === current)) return current;
        return items.find((item) => isDefaultStudentName(item.student))?.id ?? items[0]?.id ?? '';
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
      setProfileEditorText('');
      setLoadedProfileContent('');
      setProfileRevisions([]);
      setProfileError(null);
      return;
    }

    setProfileBusy('loading');
    setProfileError(null);
    try {
      const [profile, revisions] = await Promise.all([
        getProfileContent(profileId),
        listProfileRevisions(profileId, { limit: 25, offset: 0, order: 'desc' }),
      ]);
      setProfileEditorText(profile.content ?? '');
      setLoadedProfileContent(profile.content ?? '');
      setProfileRevisions(revisions.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load selected profile.';
      setProfileError(message);
      setProfileEditorText('');
      setLoadedProfileContent('');
      setProfileRevisions([]);
    } finally {
      setProfileBusy(null);
    }
  }, []);

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
    const requestId = ++historyRequestId.current;
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
      if (requestId !== historyRequestId.current) return;
      setJobHistory(response.jobs ?? []);
    } catch (error) {
      if (requestId !== historyRequestId.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load assignment history.';
      setJobsError(message);
      setJobHistory([]);
    } finally {
      if (requestId === historyRequestId.current) {
        setJobsLoading(false);
      }
    }
  }, []);

  const loadTimeline = useCallback(async (studentId: string, filters: TimelineFilters) => {
    const requestId = ++timelineRequestId.current;
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
      if (requestId !== timelineRequestId.current) return;
      setTimeline(response.items ?? []);
    } catch (error) {
      if (requestId !== timelineRequestId.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load student timeline.';
      setTimelineError(message);
      setTimeline([]);
    } finally {
      if (requestId === timelineRequestId.current) {
        setTimelineLoading(false);
      }
    }
  }, []);

  const loadBindings = useCallback(async (studentId: string) => {
    const requestId = ++bindingsRequestId.current;
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
      if (requestId !== bindingsRequestId.current) return;
      setBindingHistory(response.items ?? []);
    } catch (error) {
      if (requestId !== bindingsRequestId.current) return;
      const message =
        error instanceof Error ? error.message : 'Unable to load profile binding history.';
      setBindingHistoryError(message);
      setBindingHistory([]);
    } finally {
      if (requestId === bindingsRequestId.current) {
        setBindingHistoryLoading(false);
      }
    }
  }, []);

  const loadMemoryOverview = useCallback(async (studentId: string) => {
    const requestId = ++memoryOverviewRequestId.current;
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
      if (requestId !== memoryOverviewRequestId.current) return;
      setMemoryOverview(response);
    } catch (error) {
      if (requestId !== memoryOverviewRequestId.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load student memory.';
      setMemoryOverviewError(message);
      setMemoryOverview(null);
    } finally {
      if (requestId === memoryOverviewRequestId.current) {
        setMemoryOverviewLoading(false);
      }
    }
  }, []);

  const loadSelectedStudent = useCallback(
    async (studentId: string) => {
      const requestId = ++selectedStudentRequestId.current;
      if (!studentId) {
        historyRequestId.current += 1;
        timelineRequestId.current += 1;
        bindingsRequestId.current += 1;
        memoryOverviewRequestId.current += 1;
        setSelectedStudent(null);
        setSelectedProfileId('');
        setJobHistory([]);
        setTimeline([]);
        setBindingHistory([]);
        setMemoryOverview(null);
        return;
      }

      setBindingSuccess(null);
      try {
        const profile = await getStudentProfile(studentId);
        if (requestId !== selectedStudentRequestId.current) return;
        setSelectedStudent(profile);
        setSelectedProfileId(profile.profileId ?? '');
      } catch (error) {
        if (requestId !== selectedStudentRequestId.current) return;
        const message = error instanceof Error ? error.message : 'Unable to load selected student.';
        setSelectedStudent(null);
        setProfileError(message);
      }

      await Promise.all([
        loadJobHistory(studentId, historyFiltersAppliedRef.current),
        loadTimeline(studentId, timelineFiltersAppliedRef.current),
        loadBindings(studentId),
        loadMemoryOverview(studentId),
      ]);
    },
    [loadBindings, loadJobHistory, loadMemoryOverview, loadTimeline],
  );

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([loadStudents(), loadProfileOptions(), loadTemplateOptions()]);
  }, [loadProfileOptions, loadStudents, loadTemplateOptions]);

  const resetCreateStudentForm = useCallback(() => {
    setCreateStudentForm(INITIAL_CREATE_STUDENT_FORM);
    setCreateStudentError(null);
  }, []);

  const handleCreateStudent = async () => {
    const student = createStudentForm.student.trim();
    if (!student) {
      setCreateStudentError('Student name is required.');
      return;
    }

    setCreateStudentBusy(true);
    setCreateStudentError(null);
    setCreateStudentSuccess(null);

    try {
      const created = await createStudentProfile({
        student,
        ...(createStudentForm.profileId ? { profileId: createStudentForm.profileId } : {}),
        ...(createStudentForm.dbId ? { dbId: createStudentForm.dbId } : {}),
        ...(createStudentForm.pageParentId ? { pageParentId: createStudentForm.pageParentId } : {}),
        ...(createStudentForm.colorPreset ? { colorPreset: createStudentForm.colorPreset } : {}),
        ...(createStudentForm.accentPreference
          ? { accentPreference: createStudentForm.accentPreference }
          : {}),
        ...(createStudentForm.manifestPreset
          ? { manifestPreset: createStudentForm.manifestPreset }
          : {}),
      });

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
      setProfileError('Select a profile before saving content.');
      return;
    }

    setProfileBusy('saving');
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const saved = await upsertProfileContent(selectedProfileId, profileEditorText);
      setLoadedProfileContent(saved.content ?? '');
      const revisions = await listProfileRevisions(saved.id, {
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile content saved.');
      await loadTimeline(selectedStudentId, timelineFiltersAppliedRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save profile content.';
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
      setProfileEditorText(restored.content ?? '');
      setLoadedProfileContent(restored.content ?? '');
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
      const created = await upsertTemplateContent(
        templateId,
        `## Prompt

INSERT PROFILE HERE

## Transcript
`,
      );
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
          <header>
            <div className="workspace-inline workspace-header-row">
              <h2>Student Context</h2>
              <button
                type="button"
                className="workspace-secondary-btn"
                onClick={() => {
                  setCreateStudentSuccess(null);
                  setIsCreateStudentOpen((current) => !current);
                  if (isCreateStudentOpen) {
                    resetCreateStudentForm();
                  }
                }}
              >
                {isCreateStudentOpen ? 'Close Create Form' : 'Create Student'}
              </button>
            </div>
            <p>Choose the student context for all workspace panels.</p>
          </header>

          {createStudentSuccess ? (
            <p className="workspace-success">{createStudentSuccess}</p>
          ) : null}

          {isCreateStudentOpen ? (
            <div className="workspace-create-panel">
              <label className="workspace-field">
                Student Name
                <input
                  aria-label="Student Name"
                  value={createStudentForm.student}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      student: event.target.value,
                    }))
                  }
                  placeholder="e.g. Alex"
                />
              </label>

              <label className="workspace-field">
                Initial Profile (optional)
                <select
                  aria-label="Initial Profile"
                  value={createStudentForm.profileId}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      profileId: event.target.value,
                    }))
                  }
                >
                  <option value="">No profile binding</option>
                  {profileOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label} ({profile.id})
                    </option>
                  ))}
                </select>
              </label>

              <details className="workspace-advanced">
                <summary>Advanced fields</summary>
                <div className="workspace-grid">
                  <label className="workspace-field">
                    Notion DB ID
                    <input
                      aria-label="Notion DB ID"
                      value={createStudentForm.dbId}
                      onChange={(event) =>
                        setCreateStudentForm((current) => ({
                          ...current,
                          dbId: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="workspace-field">
                    Notion Parent ID
                    <input
                      aria-label="Notion Parent ID"
                      value={createStudentForm.pageParentId}
                      onChange={(event) =>
                        setCreateStudentForm((current) => ({
                          ...current,
                          pageParentId: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="workspace-field">
                    Color Preset
                    <input
                      aria-label="Color Preset"
                      value={createStudentForm.colorPreset}
                      onChange={(event) =>
                        setCreateStudentForm((current) => ({
                          ...current,
                          colorPreset: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="workspace-field">
                    Accent Preference
                    <input
                      aria-label="Accent Preference"
                      value={createStudentForm.accentPreference}
                      onChange={(event) =>
                        setCreateStudentForm((current) => ({
                          ...current,
                          accentPreference: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="workspace-field">
                    Manifest Preset
                    <input
                      aria-label="Manifest Preset"
                      value={createStudentForm.manifestPreset}
                      onChange={(event) =>
                        setCreateStudentForm((current) => ({
                          ...current,
                          manifestPreset: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </details>

              <div className="workspace-inline">
                <button
                  type="button"
                  className="workspace-primary-btn"
                  onClick={() => void handleCreateStudent()}
                  disabled={createStudentBusy}
                >
                  {createStudentBusy ? 'Creating...' : 'Create Student'}
                </button>
                <button
                  type="button"
                  className="workspace-secondary-btn"
                  onClick={() => {
                    resetCreateStudentForm();
                    setIsCreateStudentOpen(false);
                  }}
                  disabled={createStudentBusy}
                >
                  Cancel
                </button>
              </div>

              {createStudentError ? <p className="workspace-error">{createStudentError}</p> : null}
            </div>
          ) : null}

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
            <h2>Profile Binding</h2>
            <p>Bind the selected student to an active profile ID.</p>
          </header>

          <label className="workspace-field">
            Bound profile
            <select
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              disabled={!selectedStudentId || profileOptions.length === 0}
            >
              <option value="">No profile binding</option>
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
            <h2>Profile Editor & Revisions</h2>
            <p>Edit profile content, then restore or activate older revisions.</p>
          </header>

          <textarea
            value={profileEditorText}
            onChange={(event) => setProfileEditorText(event.target.value)}
            rows={14}
            placeholder="Select or bind a profile to start editing..."
            disabled={!selectedProfileId}
          />

          <div className="workspace-inline">
            <button
              type="button"
              className="workspace-primary-btn"
              onClick={() => void handleSaveProfile()}
              disabled={!selectedProfileId || profileBusy !== null || !profileDirty}
            >
              {profileBusy === 'saving' ? 'Saving...' : 'Save Profile Content'}
            </button>
            {profileDirty ? <span className="workspace-muted">Unsaved changes</span> : null}
          </div>

          {profileError ? <p className="workspace-error">{profileError}</p> : null}
          {profileSuccess ? <p className="workspace-success">{profileSuccess}</p> : null}

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
                      <td>
                        {job.notionUrl
                          ? 'Notion'
                          : job.anytypeUrl
                            ? 'Anytype'
                            : job.htmlUrl
                              ? 'HTML'
                              : 'Pending'}
                      </td>
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
        <article className="workspace-card card">
          <header>
            <h2>Lineage & Provenance</h2>
            <p>Inspect selected assignment provenance and pinned prompt lineage.</p>
          </header>

          {selectedJob ? (
            <p className="workspace-muted">
              Inspecting job <code>{selectedJob.jobId}</code>
            </p>
          ) : (
            <p className="workspace-muted">Select an assignment from history first.</p>
          )}

          {jobProvenanceLoading ? (
            <p className="workspace-muted">Loading job provenance...</p>
          ) : null}
          {jobProvenanceError ? <p className="workspace-error">{jobProvenanceError}</p> : null}

          {jobProvenance ? (
            <div className="workspace-meta">
              <span>
                <strong>Source job:</strong> {jobProvenance.job.sourceJobId ?? 'none'}
              </span>
              <span>
                <strong>Recording:</strong> {jobProvenance.recording?.id ?? 'n/a'}
              </span>
              <span>
                <strong>Prompt package:</strong> {jobProvenance.promptPackage?.id ?? 'n/a'}
              </span>
              <span>
                <strong>Draft:</strong> {jobProvenance.draft?.id ?? 'n/a'}
              </span>
              <span>
                <strong>Action audit:</strong> {jobProvenance.actions.length}
              </span>
            </div>
          ) : null}

          {jobProvenance?.actions.length ? (
            <div className="workspace-list">
              {jobProvenance.actions.slice(0, 8).map((action) => (
                <div key={action.id} className="workspace-list-item">
                  <div>
                    <strong>{action.actionType}</strong>
                    <div className="workspace-muted">
                      {new Date(action.requestedAt).toLocaleString()} by{' '}
                      {action.requestedBy ?? 'unknown'}
                    </div>
                  </div>
                  <span>{action.outcome}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <h3>Student Memory</h3>
            <p className="workspace-muted">
              Latest snapshot summary plus the recent lesson and homework memory used to build
              continuity over time.
            </p>

            {memoryOverviewLoading ? (
              <p className="workspace-muted">Loading student memory...</p>
            ) : null}
            {memoryOverviewError ? <p className="workspace-error">{memoryOverviewError}</p> : null}

            {memoryOverview?.latestReadyStudentMemorySnapshot ? (
              <>
                <div className="workspace-meta">
                  <span>
                    <strong>Latest snapshot:</strong>{' '}
                    {memoryOverview.latestReadyStudentMemorySnapshot.id}
                  </span>
                  <span>
                    <strong>Status:</strong>{' '}
                    {memoryOverview.latestReadyStudentMemorySnapshot.status}
                  </span>
                  <span>
                    <strong>Generated:</strong>{' '}
                    {formatDateTime(memoryOverview.latestReadyStudentMemorySnapshot.generatedAt)}
                  </span>
                </div>
                <p>
                  {memoryOverview.latestReadyStudentMemorySnapshot.snapshotSummary ??
                    'No snapshot summary available.'}
                </p>
              </>
            ) : !memoryOverviewLoading && !memoryOverviewError ? (
              <p className="workspace-muted">No ready student-memory snapshot available yet.</p>
            ) : null}

            <div>
              <strong>Unresolved issues</strong>
              {memoryOverview?.unresolvedIssues.length ? (
                <div className="workspace-list">
                  {memoryOverview.unresolvedIssues.map((issue) => (
                    <div key={`${issue.issueType}:${issue.label}`} className="workspace-list-item">
                      <div>
                        <strong>{issue.label}</strong>
                        <div className="workspace-muted">{issue.note}</div>
                      </div>
                      <span>
                        {issue.issueType} · {issue.priority}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="workspace-muted">No unresolved issues recorded in the latest snapshot.</p>
              )}
            </div>

            <div>
              <strong>Recent lesson memory</strong>
              {memoryOverview?.recentReadyLessonMemory.length ? (
                <div className="workspace-list">
                  {memoryOverview.recentReadyLessonMemory.map((entry) => (
                    <div key={entry.id} className="workspace-list-item">
                      <div>
                        <strong>{entry.lessonSummary ?? 'Lesson memory entry'}</strong>
                        <div className="workspace-muted">
                          {entry.topicsDiscussed.slice(0, 2).map((topic) => topic.topic).join(', ') ||
                            'No topics recorded'}
                        </div>
                      </div>
                      <span>{formatDateTime(entry.generatedAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="workspace-muted">No recent lesson-memory entries available.</p>
              )}
            </div>

            <div>
              <strong>Recent homework memory</strong>
              {memoryOverview?.recentReadyHomeworkMemory.length ? (
                <div className="workspace-list">
                  {memoryOverview.recentReadyHomeworkMemory.map((entry) => (
                    <div key={entry.id} className="workspace-list-item">
                      <div>
                        <strong>{entry.topic ?? 'Homework memory entry'}</strong>
                        <div className="workspace-muted">
                          {entry.homeworkSummary ?? entry.communicativeOutcome ?? 'No summary recorded'}
                        </div>
                      </div>
                      <span>{formatDateTime(entry.publishedAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="workspace-muted">No recent homework-memory entries available.</p>
              )}
            </div>
          </div>

          {lineageLoading ? <p className="workspace-muted">Loading prompt lineage...</p> : null}
          {lineageError ? <p className="workspace-error">{lineageError}</p> : null}

          {lineage ? (
            <>
              <div className="workspace-meta">
                <span>
                  <strong>Profile revision:</strong> {lineage.profile.snapshot.revisionId ?? 'n/a'}
                </span>
                <span>
                  <strong>Template revision:</strong> {lineage.template.snapshot.revisionId ?? 'n/a'}
                </span>
                <span>
                  <strong>Profile drift:</strong> {lineage.profile.drift?.reason ?? 'none'}
                </span>
                <span>
                  <strong>Template drift:</strong> {lineage.template.drift?.reason ?? 'none'}
                </span>
                <span>
                  <strong>Binding at creation:</strong>{' '}
                  {lineage.bindingAtCreation?.profileId ?? 'n/a'}
                </span>
              </div>

              <div>
                <h3>Assignment Memory Provenance</h3>
                <div className="workspace-meta">
                  <span>
                    <strong>Snapshot at creation:</strong>{' '}
                    {lineage.memory.studentMemorySnapshotId ?? 'none'}
                  </span>
                  <span>
                    <strong>Snapshot hash:</strong>{' '}
                    {lineage.memory.studentMemorySnapshotHash ?? 'none'}
                  </span>
                  <span>
                    <strong>Retrieval policy:</strong>{' '}
                    {lineage.memory.retrievalPolicyVersion ?? 'none'}
                  </span>
                </div>

                <div className="workspace-meta">
                  <span>
                    <strong>Selected lesson memory IDs:</strong>{' '}
                    {lineage.memory.selectedLessonMemoryIds.length > 0
                      ? lineage.memory.selectedLessonMemoryIds.join(', ')
                      : 'none'}
                  </span>
                  <span>
                    <strong>Selected homework memory IDs:</strong>{' '}
                    {lineage.memory.selectedHomeworkMemoryIds.length > 0
                      ? lineage.memory.selectedHomeworkMemoryIds.join(', ')
                      : 'none'}
                  </span>
                </div>

                <div className="workspace-list">
                  <div className="workspace-list-item">
                    <strong>Layer availability</strong>
                    <span>
                      snapshot {lineage.memory.layerAvailability.studentMemorySnapshot}
                    </span>
                  </div>
                  <div className="workspace-list-item">
                    <strong>Recent lesson memory</strong>
                    <span>{lineage.memory.layerAvailability.recentLessonMemory}</span>
                  </div>
                  <div className="workspace-list-item">
                    <strong>Recent homework memory</strong>
                    <span>{lineage.memory.layerAvailability.recentHomeworkMemory}</span>
                  </div>
                  <div className="workspace-list-item">
                    <strong>Retrieval policy</strong>
                    <span>{lineage.memory.layerAvailability.retrievalPolicy}</span>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </article>

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

      <style>{`
        .workspace-root {
          display: grid;
          gap: var(--space-5);
        }

        .workspace-hero {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-4);
          flex-wrap: wrap;
        }

        .workspace-hero h1 {
          margin-bottom: var(--space-1);
        }

        .workspace-hero p {
          color: var(--text-tertiary);
        }

        .workspace-hero-actions {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-wrap: wrap;
        }

        .workspace-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--space-5);
        }

        .workspace-grid-wide {
          grid-template-columns: 1.3fr 1fr;
        }

        .workspace-card {
          display: grid;
          gap: var(--space-3);
        }

        .workspace-card header {
          display: grid;
          gap: var(--space-1);
        }

        .workspace-field {
          display: grid;
          gap: var(--space-1);
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        .workspace-field select,
        .workspace-field input,
        .workspace-card textarea {
          border: 1px solid var(--border-light);
          background: var(--bg-primary);
          border-radius: var(--radius-md);
          padding: var(--space-2) var(--space-3);
          color: var(--text-primary);
          font-family: var(--font-sans);
          font-size: var(--text-sm);
        }

        .workspace-card textarea {
          resize: vertical;
          min-height: 160px;
          line-height: 1.5;
          font-family: var(--font-mono);
        }

        .workspace-primary-btn,
        .workspace-secondary-btn {
          border-radius: var(--radius-full);
          padding: var(--space-2) var(--space-4);
          border: 1px solid var(--border-medium);
          cursor: pointer;
          font-size: var(--text-sm);
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-1);
        }

        .workspace-primary-btn {
          background: var(--color-primary-600);
          color: white;
          border-color: transparent;
        }

        .workspace-secondary-btn {
          background: var(--bg-secondary);
          color: var(--text-primary);
        }

        .workspace-primary-btn:disabled,
        .workspace-secondary-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .workspace-inline {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-wrap: wrap;
        }

        .workspace-header-row {
          justify-content: space-between;
        }

        .workspace-create-panel {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          padding: var(--space-3);
          display: grid;
          gap: var(--space-3);
        }

        .workspace-advanced {
          display: grid;
          gap: var(--space-2);
        }

        .workspace-advanced summary {
          cursor: pointer;
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        .workspace-filter-row {
          align-items: end;
        }

        .workspace-meta {
          display: grid;
          gap: var(--space-1);
          font-size: var(--text-sm);
        }

        .workspace-list {
          display: grid;
          gap: var(--space-2);
          max-height: 280px;
          overflow: auto;
          padding-right: var(--space-1);
        }

        .workspace-list-item {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: var(--space-2) var(--space-3);
          background: var(--bg-secondary);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2);
        }

        .workspace-table-wrap {
          overflow-x: auto;
        }

        .workspace-table {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--text-sm);
        }

        .workspace-table th,
        .workspace-table td {
          text-align: left;
          padding: var(--space-2);
          border-bottom: 1px solid var(--border-light);
          vertical-align: top;
        }

        .workspace-selected-row {
          background: var(--color-primary-50);
        }

        .workspace-muted {
          color: var(--text-tertiary);
          font-size: var(--text-xs);
        }

        .workspace-success {
          color: var(--color-success-600);
          font-size: var(--text-sm);
        }

        .workspace-error {
          color: var(--color-error-600);
          font-size: var(--text-sm);
        }

        @media (max-width: 1080px) {
          .workspace-grid,
          .workspace-grid-wide {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};
