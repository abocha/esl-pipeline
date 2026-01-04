import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import copy from 'copy-to-clipboard';
import toast from 'react-hot-toast';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useStudentSelection } from '../../context/StudentSelectionContext';
import {
  createStudentProfile,
  deleteProfileContent,
  deleteStudentProfile,
  fetchDraft,
  getProfileContent,
  getStudentProfile,
  getStudentTimeline,
  listProfileContents,
  listStudents,
  type ProfileContentOption,
  type StudentProfile,
  type StudentProfileInput,
  type StudentProfileUpdate,
  type StudentTimelineItem,
  type StudentTimelineType,
  upsertProfileContent,
  updateStudentProfile,
} from '../../utils/api';

const StudentIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const formatTimestamp = (value?: string | null) => {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const defaultStudentForm: StudentProfileInput = {
  student: '',
  dbId: null,
  pageParentId: null,
  colorPreset: null,
  accentPreference: null,
  voices: {},
  manifestPreset: null,
  profileId: null,
};

interface StudentMetrics {
  lastActivityLabel: string;
  lastActivityAt: string | null;
  pendingDrafts: number;
  recentErrors: number;
}

const timelineTypeOptions: { value: StudentTimelineType; label: string }[] = [
  { value: 'recording_ingested', label: 'Recording' },
  { value: 'transcript_ready', label: 'Transcript' },
  { value: 'prompt_package_created', label: 'Prompt package' },
  { value: 'draft_saved', label: 'Draft' },
  { value: 'job_awaiting_approval', label: 'Awaiting approval' },
  { value: 'job_completed', label: 'Job' },
];

export const StudentWorkspace: React.FC = () => {
  const { selectedStudent, setSelectedStudent, updateSelectedStudent } = useStudentSelection();
  const { recordings, trackJob } = useJobMonitor();
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [metricsById, setMetricsById] = useState<Record<string, StudentMetrics>>({});
  const [isCreating, setIsCreating] = useState(false);

  const [studentForm, setStudentForm] = useState<StudentProfileInput>(defaultStudentForm);
  const [voicesText, setVoicesText] = useState('{}');
  const [studentSaveError, setStudentSaveError] = useState<string | null>(null);
  const [studentSaving, setStudentSaving] = useState(false);

  const [profileOptions, setProfileOptions] = useState<ProfileContentOption[]>([]);
  const [profileOptionsError, setProfileOptionsError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState('');
  const [profileContent, setProfileContent] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [timelineItems, setTimelineItems] = useState<StudentTimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<'all' | StudentTimelineType>('all');
  const [timelineStatusFilter, setTimelineStatusFilter] = useState('all');
  const [timelineLimit, setTimelineLimit] = useState(20);
  const [timelineOffset, setTimelineOffset] = useState(0);
  const [timelineTotal, setTimelineTotal] = useState(0);

  const [draftPreview, setDraftPreview] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);

  const metricsRefreshRef = useRef(0);
  const lastTimelineRefreshRef = useRef<string | null>(null);

  const loadStudents = useCallback(async (query?: string) => {
    setLoadingStudents(true);
    setStudentsError(null);
    try {
      const result = await listStudents({ q: query?.trim() || undefined, limit: 200 });
      setStudents(result.items);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load students';
      setStudentsError(message);
    } finally {
      setLoadingStudents(false);
    }
  }, []);

  const loadMetrics = useCallback(
    async (targetStudents: StudentProfile[]) => {
      const currentRefresh = metricsRefreshRef.current + 1;
      metricsRefreshRef.current = currentRefresh;
      const nextMetrics: Record<string, StudentMetrics> = {};
      await Promise.all(
        targetStudents.map(async (student) => {
          try {
            const timeline = await getStudentTimeline(student.id, { limit: 50, order: 'desc' });
            const lastItem = timeline.items[0];
            const pendingDrafts = timeline.items.filter((item) => item.type === 'draft_saved').length;
            const recentErrors = timeline.items.filter((item) => item.status === 'failed').length;
            nextMetrics[student.id] = {
              lastActivityLabel: lastItem?.displayName ?? '--',
              lastActivityAt: lastItem?.createdAt ?? null,
              pendingDrafts,
              recentErrors,
            };
          } catch {
            nextMetrics[student.id] = {
              lastActivityLabel: '--',
              lastActivityAt: null,
              pendingDrafts: 0,
              recentErrors: 0,
            };
          }
        }),
      );
      if (metricsRefreshRef.current === currentRefresh) {
        setMetricsById(nextMetrics);
      }
    },
    [],
  );

  const refreshProfilesList = useCallback(async () => {
    setProfileOptionsError(null);
    try {
      const response = await listProfileContents();
      setProfileOptions(response.profiles ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load profiles';
      setProfileOptionsError(message);
    }
  }, []);

  const refreshTimeline = useCallback(async () => {
    if (!selectedStudent) return;
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const type = timelineTypeFilter === 'all' ? undefined : timelineTypeFilter;
      const status = timelineStatusFilter === 'all' ? undefined : timelineStatusFilter;
      const response = await getStudentTimeline(selectedStudent.id, {
        type,
        status,
        limit: timelineLimit,
        offset: timelineOffset,
        order: 'desc',
      });
      setTimelineItems(response.items);
      setTimelineTotal(response.total);
      lastTimelineRefreshRef.current = new Date().toISOString();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load timeline';
      setTimelineError(message);
    } finally {
      setTimelineLoading(false);
    }
  }, [selectedStudent, timelineLimit, timelineOffset, timelineStatusFilter, timelineTypeFilter]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadStudents(searchQuery);
    }, 250);
    return () => clearTimeout(timeout);
  }, [loadStudents, searchQuery]);

  useEffect(() => {
    if (students.length === 0) return;
    void loadMetrics(students);
  }, [students, loadMetrics]);

  useEffect(() => {
    void refreshProfilesList();
  }, [refreshProfilesList]);

  useEffect(() => {
    if (!selectedStudent) return;
    setStudentForm({
      student: selectedStudent.student,
      dbId: selectedStudent.dbId ?? null,
      pageParentId: selectedStudent.pageParentId ?? null,
      colorPreset: selectedStudent.colorPreset ?? null,
      accentPreference: selectedStudent.accentPreference ?? null,
      voices: selectedStudent.voices ?? {},
      manifestPreset: selectedStudent.manifestPreset ?? null,
      profileId: selectedStudent.profileId ?? null,
    });
    setVoicesText(JSON.stringify(selectedStudent.voices ?? {}, null, 2));
    setProfileId(selectedStudent.profileId ?? '');
    setProfileContent('');
    setProfileError(null);
    setIsCreating(false);
    setStudentSaveError(null);
    setDraftPreview(null);
  }, [selectedStudent]);

  useEffect(() => {
    if (selectedStudent || isCreating) return;
    setStudentForm(defaultStudentForm);
    setVoicesText('{}');
    setProfileId('');
    setProfileContent('');
  }, [isCreating, selectedStudent]);

  useEffect(() => {
    setProfileContent('');
    setProfileError(null);
  }, [profileId]);

  useEffect(() => {
    if (!selectedStudent) return;
    setTimelineOffset(0);
  }, [selectedStudent]);

  useEffect(() => {
    if (!selectedStudent) return;
    void refreshTimeline();
  }, [refreshTimeline, selectedStudent, timelineTypeFilter, timelineStatusFilter, timelineOffset, timelineLimit]);

  useEffect(() => {
    if (!selectedStudent) return;
    const interval = setInterval(() => {
      void refreshTimeline();
    }, 30_000);
    return () => clearInterval(interval);
  }, [refreshTimeline, selectedStudent]);

  useEffect(() => {
    if (!selectedStudent) return;
    const latest = recordings
      .filter((item) => item.studentId === selectedStudent.id)
      .map((item) => item.updatedAt)
      .sort()
      .at(-1);
    if (!latest) return;
    if (!lastTimelineRefreshRef.current || latest > lastTimelineRefreshRef.current) {
      void refreshTimeline();
    }
  }, [recordings, refreshTimeline, selectedStudent]);

  const handleSelectStudent = useCallback(
    async (student: StudentProfile) => {
      try {
        const profile = await getStudentProfile(student.id);
        setSelectedStudent(profile);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load student profile';
        toast.error(message);
      }
    },
    [setSelectedStudent],
  );

  const handleCreateNew = () => {
    setIsCreating(true);
    setSelectedStudent(null);
    setStudentForm(defaultStudentForm);
    setVoicesText('{}');
    setProfileId('');
    setProfileContent('');
    setDraftPreview(null);
  };

  const handleSaveStudent = async () => {
    setStudentSaveError(null);
    setStudentSaving(true);
    try {
      const voices =
        voicesText.trim().length === 0
          ? {}
          : (JSON.parse(voicesText) as Record<string, string>);
      if (!voices || typeof voices !== 'object' || Array.isArray(voices)) {
        throw new Error('Voices must be a JSON object');
      }

      const payload: StudentProfileUpdate = {
        student: studentForm.student.trim(),
        dbId: studentForm.dbId ?? null,
        pageParentId: studentForm.pageParentId ?? null,
        colorPreset: studentForm.colorPreset ?? null,
        accentPreference: studentForm.accentPreference ?? null,
        voices,
        manifestPreset: studentForm.manifestPreset ?? null,
        profileId: profileId || null,
      };

      if (isCreating) {
        const created = await createStudentProfile(payload as StudentProfileInput);
        setSelectedStudent(created);
        toast.success('Student created');
        void loadStudents(searchQuery);
        return;
      }

      if (!selectedStudent) {
        throw new Error('Select a student first');
      }

      const updated = await updateStudentProfile(selectedStudent.id, payload);
      updateSelectedStudent(updated);
      setSelectedStudent(updated);
      toast.success('Student updated');
      void loadStudents(searchQuery);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save student';
      setStudentSaveError(message);
    } finally {
      setStudentSaving(false);
    }
  };

  const handleDeleteStudent = async () => {
    if (!selectedStudent) return;
    if (!confirm(`Delete ${selectedStudent.student}? This will not remove recordings.`)) {
      return;
    }
    try {
      await deleteStudentProfile(selectedStudent.id);
      toast.success('Student deleted');
      setSelectedStudent(null);
      setIsCreating(false);
      void loadStudents(searchQuery);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete student';
      toast.error(message);
    }
  };

  const handleLoadProfileContent = async () => {
    const target = profileId.trim();
    if (!target) {
      setProfileError('Select a profile first');
      return;
    }
    setProfileLoading(true);
    setProfileError(null);
    try {
      const response = await getProfileContent(target);
      setProfileContent(response.content ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load profile content';
      setProfileError(message);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleSaveProfileContent = async () => {
    const target = profileId.trim();
    if (!target) {
      setProfileError('Select a profile first');
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    try {
      const response = await upsertProfileContent(target, profileContent);
      setProfileContent(response.content ?? '');
      toast.success('Profile saved');
      void refreshProfilesList();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save profile';
      setProfileError(message);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleDeleteProfileContent = async () => {
    const target = profileId.trim();
    if (!target) return;
    if (!confirm(`Delete profile ${target}?`)) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      await deleteProfileContent(target);
      toast.success('Profile deleted');
      setProfileContent('');
      void refreshProfilesList();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete profile';
      setProfileError(message);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleCopyId = (value: string) => {
    copy(value);
    toast.success('Copied to clipboard');
  };

  const handleOpenTranscript = (recordingId?: string | null) => {
    if (!recordingId) return;
    globalThis.dispatchEvent(
      new CustomEvent('esl:open-transcript', {
        detail: { recordingId },
      }),
    );
    globalThis.document
      .querySelector('#transcription-workspace')
      ?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleOpenPromptPackage = (promptPackageId?: string | null) => {
    if (!promptPackageId) return;
    globalThis.dispatchEvent(
      new CustomEvent('esl:open-prompt-package', {
        detail: { promptPackageId },
      }),
    );
    globalThis.document
      .querySelector('#transcription-workspace')
      ?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleOpenDraft = async (draftId?: string | null) => {
    if (!draftId) return;
    setDraftLoading(true);
    try {
      const draft = await fetchDraft(draftId);
      setDraftPreview({ id: draft.id, text: draft.text });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load draft';
      toast.error(message);
    } finally {
      setDraftLoading(false);
    }
  };

  const handleOpenJob = async (jobId?: string | null) => {
    if (!jobId) return;
    await trackJob(jobId);
    globalThis.document.querySelector('#job-table')?.scrollIntoView({ behavior: 'smooth' });
  };

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(timelineTotal / timelineLimit)),
    [timelineLimit, timelineTotal],
  );
  const currentPage = Math.floor(timelineOffset / timelineLimit) + 1;

  return (
    <section className="students-panel card animate-fade-in-up">
      <header className="students-header">
        <div className="students-title">
          <div className="students-icon">
            <StudentIcon />
          </div>
          <div>
            <span className="eyebrow">Students</span>
            <h2>Student Workspace</h2>
          </div>
        </div>
        <div className="students-actions">
          <button type="button" className="btn-secondary" onClick={handleCreateNew}>
            New student
          </button>
          <button type="button" className="btn-secondary" onClick={() => void loadStudents(searchQuery)}>
            <RefreshIcon />
            Refresh
          </button>
        </div>
      </header>

      <div className="students-body">
        <aside className="students-list">
          <div className="students-search">
            <input
              type="search"
              placeholder="Search students"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          {studentsError && <p className="error-text">{studentsError}</p>}
          {loadingStudents && <p className="muted-text">Loading students...</p>}
          <div className="students-list-grid">
            {students.map((student) => {
              const metrics = metricsById[student.id];
              const isActive = selectedStudent?.id === student.id;
              return (
                <button
                  key={student.id}
                  type="button"
                  className={`student-card ${isActive ? 'active' : ''}`}
                  onClick={() => void handleSelectStudent(student)}
                >
                  <div className="student-card-header">
                    <span className="student-name">{student.student}</span>
                    <span className="student-id" title={student.id}>
                      {student.id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="student-card-metrics">
                    <div>
                      <span className="metric-label">Last lesson</span>
                      <span className="metric-value">
                        {metrics?.lastActivityLabel ?? '--'}
                      </span>
                    </div>
                    <div>
                      <span className="metric-label">Pending drafts</span>
                      <span className="metric-value">{metrics?.pendingDrafts ?? 0}</span>
                    </div>
                    <div>
                      <span className="metric-label">Recent errors</span>
                      <span className="metric-value">{metrics?.recentErrors ?? 0}</span>
                    </div>
                  </div>
                  <div className="student-card-footer">
                    <span className="metric-label">Last activity</span>
                    <span className="metric-value">
                      {formatTimestamp(metrics?.lastActivityAt ?? null)}
                    </span>
                  </div>
                </button>
              );
            })}
            {students.length === 0 && !loadingStudents && (
              <p className="muted-text">No students found.</p>
            )}
          </div>
        </aside>

        <div className="students-detail">
          <section className="student-detail-card">
            <header>
              <div>
                <h3>{isCreating ? 'New student' : selectedStudent?.student ?? 'Select a student'}</h3>
                <p>Manage metadata and prompt profile linkage.</p>
              </div>
              {selectedStudent && (
                <button type="button" className="btn-ghost" onClick={handleDeleteStudent}>
                  Delete
                </button>
              )}
            </header>

            <div className="form-grid">
              <div className="form-field">
                <label className="field-label" htmlFor="student-name">
                  Student name
                </label>
                <input
                  id="student-name"
                  type="text"
                  value={studentForm.student}
                  onChange={(event) =>
                    setStudentForm((prev) => ({ ...prev, student: event.target.value }))
                  }
                  disabled={!isCreating && !!selectedStudent}
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="student-id">
                  Student ID
                </label>
                <div className="field-inline">
                  <input id="student-id" type="text" value={selectedStudent?.id ?? '--'} readOnly />
                  {selectedStudent && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => handleCopyId(selectedStudent.id)}
                    >
                      Copy
                    </button>
                  )}
                </div>
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="student-db-id">
                  Notion DB ID
                </label>
                <input
                  id="student-db-id"
                  type="text"
                  value={studentForm.dbId ?? ''}
                  onChange={(event) =>
                    setStudentForm((prev) => ({ ...prev, dbId: event.target.value || null }))
                  }
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="student-page-parent-id">
                  Page parent ID
                </label>
                <input
                  id="student-page-parent-id"
                  type="text"
                  value={studentForm.pageParentId ?? ''}
                  onChange={(event) =>
                    setStudentForm((prev) => ({ ...prev, pageParentId: event.target.value || null }))
                  }
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="student-color-preset">
                  Color preset
                </label>
                <input
                  id="student-color-preset"
                  type="text"
                  value={studentForm.colorPreset ?? ''}
                  onChange={(event) =>
                    setStudentForm((prev) => ({ ...prev, colorPreset: event.target.value || null }))
                  }
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="student-accent-preference">
                  Accent preference
                </label>
                <input
                  id="student-accent-preference"
                  type="text"
                  value={studentForm.accentPreference ?? ''}
                  onChange={(event) =>
                    setStudentForm((prev) => ({
                      ...prev,
                      accentPreference: event.target.value || null,
                    }))
                  }
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="student-manifest-preset">
                  Manifest preset
                </label>
                <input
                  id="student-manifest-preset"
                  type="text"
                  value={studentForm.manifestPreset ?? ''}
                  onChange={(event) =>
                    setStudentForm((prev) => ({
                      ...prev,
                      manifestPreset: event.target.value || null,
                    }))
                  }
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="student-profile-id">
                  Profile ID
                </label>
                <select
                  id="student-profile-id"
                  value={profileId}
                  onChange={(event) => setProfileId(event.target.value)}
                >
                  <option value="">No profile</option>
                  {profileOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {profileOptionsError && <p className="error-text">{profileOptionsError}</p>}
              </div>
              <div className="form-field full">
                <label className="field-label" htmlFor="student-voices-json">
                  Voices JSON
                </label>
                <textarea
                  id="student-voices-json"
                  rows={4}
                  value={voicesText}
                  onChange={(event) => setVoicesText(event.target.value)}
                />
              </div>
            </div>
            {studentSaveError && <p className="error-text">{studentSaveError}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleSaveStudent()}
                disabled={studentSaving || (!isCreating && !selectedStudent)}
              >
                {studentSaving ? 'Saving...' : isCreating ? 'Create student' : 'Save changes'}
              </button>
            </div>
          </section>

          <section className="student-detail-card">
            <header>
              <div>
                <h3>Profile content</h3>
                <p>Edit the prompt profile linked to the student.</p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => void refreshProfilesList()}>
                <RefreshIcon />
                Refresh
              </button>
            </header>
            <div className="form-grid">
              <div className="form-field">
                <label className="field-label" htmlFor="profile-file-select">
                  Profile file
                </label>
                <select
                  id="profile-file-select"
                  value={profileId}
                  onChange={(event) => {
                    setProfileId(event.target.value);
                    setProfileContent('');
                    setProfileError(null);
                  }}
                >
                  <option value="">Select profile</option>
                  {profileOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field profile-actions">
                <button type="button" className="btn-secondary" onClick={() => void handleLoadProfileContent()}>
                  {profileLoading ? 'Loading...' : 'Load'}
                </button>
                <button type="button" className="btn-primary" onClick={() => void handleSaveProfileContent()}>
                  {profileSaving ? 'Saving...' : 'Save'}
                </button>
                <button type="button" className="btn-ghost" onClick={() => void handleDeleteProfileContent()}>
                  Delete
                </button>
              </div>
              <div className="form-field full">
                <textarea
                  id="profile-content"
                  rows={6}
                  value={profileContent}
                  onChange={(event) => setProfileContent(event.target.value)}
                  placeholder="Profile content"
                />
                {profileError && <p className="error-text">{profileError}</p>}
              </div>
            </div>
          </section>

          <section className="student-detail-card">
            <header>
              <div>
                <h3>Timeline</h3>
                <p>Per-student history of recordings, drafts, and jobs.</p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => void refreshTimeline()}>
                <RefreshIcon />
                Refresh
              </button>
            </header>
            <div className="timeline-filters">
              <div className="form-field">
                <label className="field-label" htmlFor="timeline-type">
                  Type
                </label>
                <select
                  id="timeline-type"
                  value={timelineTypeFilter}
                  onChange={(event) =>
                    setTimelineTypeFilter(event.target.value as 'all' | StudentTimelineType)
                  }
                >
                  <option value="all">All types</option>
                  {timelineTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="timeline-status">
                  Status
                </label>
                <input
                  id="timeline-status"
                  type="text"
                  placeholder="Any"
                  value={timelineStatusFilter === 'all' ? '' : timelineStatusFilter}
                  onChange={(event) =>
                    setTimelineStatusFilter(event.target.value.trim() || 'all')
                  }
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="timeline-per-page">
                  Per page
                </label>
                <input
                  id="timeline-per-page"
                  type="number"
                  min={5}
                  max={100}
                  value={timelineLimit}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isNaN(value)) return;
                    setTimelineLimit(Math.min(100, Math.max(5, value)));
                  }}
                />
              </div>
            </div>
            {timelineError && <p className="error-text">{timelineError}</p>}
            {timelineLoading && <p className="muted-text">Loading timeline...</p>}
            <div className="timeline-list">
              {timelineItems.map((item) => (
                <div key={`${item.type}-${item.createdAt}-${item.jobId ?? item.recordingId}`} className="timeline-item">
                  <div className="timeline-summary">
                    <span className="timeline-type">{item.type.replaceAll('_', ' ')}</span>
                    <span className="timeline-title">{item.displayName}</span>
                    <span className="timeline-status">{item.status}</span>
                    <span className="timeline-time">{formatTimestamp(item.createdAt)}</span>
                  </div>
                  <div className="timeline-actions">
                    {item.recordingId && (
                      <button type="button" onClick={() => handleOpenTranscript(item.recordingId)}>
                        Open transcript
                      </button>
                    )}
                    {item.promptPackageId && (
                      <button
                        type="button"
                        onClick={() => handleOpenPromptPackage(item.promptPackageId)}
                      >
                        Open prompt
                      </button>
                    )}
                    {item.draftId && (
                      <button type="button" onClick={() => void handleOpenDraft(item.draftId)}>
                        Open draft
                      </button>
                    )}
                    {item.jobId && (
                      <button type="button" onClick={() => void handleOpenJob(item.jobId)}>
                        Open job
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {timelineItems.length === 0 && !timelineLoading && (
                <p className="muted-text">No timeline entries.</p>
              )}
            </div>
            <div className="timeline-pagination">
              <button
                type="button"
                className="btn-ghost"
                disabled={timelineOffset === 0}
                onClick={() => setTimelineOffset(Math.max(0, timelineOffset - timelineLimit))}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                className="btn-ghost"
                disabled={timelineOffset + timelineLimit >= timelineTotal}
                onClick={() => setTimelineOffset(timelineOffset + timelineLimit)}
              >
                Next
              </button>
            </div>
          </section>

          {draftPreview && (
            <section className="student-detail-card">
              <header>
                <div>
                  <h3>Draft preview</h3>
                  <p>Draft {draftPreview.id}</p>
                </div>
                <button type="button" className="btn-ghost" onClick={() => setDraftPreview(null)}>
                  Close
                </button>
              </header>
              <textarea rows={6} value={draftPreview.text} readOnly />
              {draftLoading && <p className="muted-text">Loading draft...</p>}
            </section>
          )}
        </div>
      </div>

      <style>{`
        .students-panel {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .students-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-4);
        }

        .students-title {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .students-icon {
          width: 44px;
          height: 44px;
          border-radius: var(--radius-lg);
          background: var(--gradient-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .students-actions {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .students-body {
          display: grid;
          grid-template-columns: minmax(220px, 0.9fr) minmax(0, 2.1fr);
          gap: var(--space-4);
        }

        .students-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .students-search input {
          width: 100%;
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-light);
          background: white;
        }

        .students-list-grid {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .student-card {
          border: 1px solid var(--border-light);
          background: white;
          border-radius: var(--radius-md);
          padding: var(--space-3);
          text-align: left;
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          transition: border 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        }

        .student-card:hover {
          border-color: var(--border-focus);
          box-shadow: var(--shadow-md);
          transform: translateY(-1px);
        }

        .student-card.active {
          border-color: var(--color-primary-400);
          box-shadow: var(--shadow-lg);
        }

        .student-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .student-name {
          font-weight: 600;
          color: var(--text-primary);
        }

        .student-id {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .student-card-metrics {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--space-2);
          font-size: var(--text-xs);
        }

        .metric-label {
          display: block;
          color: var(--text-muted);
        }

        .metric-value {
          display: block;
          font-weight: 600;
          color: var(--text-secondary);
        }

        .student-card-footer {
          border-top: 1px dashed var(--border-light);
          padding-top: var(--space-2);
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .students-detail {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .student-detail-card {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          background: white;
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .student-detail-card header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
        }

        .form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--space-3);
        }

        .form-field.full {
          grid-column: 1 / -1;
        }

        .form-field input,
        .form-field select,
        .form-field textarea {
          width: 100%;
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: var(--space-2);
          background: white;
        }

        .field-inline {
          display: flex;
          gap: var(--space-2);
          align-items: center;
        }

        .form-actions {
          display: flex;
          justify-content: flex-end;
        }

        .profile-actions {
          display: flex;
          align-items: flex-end;
          gap: var(--space-2);
        }

        .timeline-filters {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--space-3);
        }

        .timeline-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .timeline-item {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: var(--space-3);
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .timeline-summary {
          display: grid;
          grid-template-columns: 1fr 2fr 1fr 1fr;
          gap: var(--space-2);
          font-size: var(--text-sm);
        }

        .timeline-type {
          text-transform: capitalize;
          font-weight: 600;
        }

        .timeline-status {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-tertiary);
        }

        .timeline-actions {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .timeline-actions button {
          border: none;
          background: var(--color-gray-100);
          padding: var(--space-1) var(--space-2);
          border-radius: var(--radius-sm);
          font-size: var(--text-xs);
          cursor: pointer;
        }

        .timeline-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: var(--text-sm);
        }

        .error-text {
          color: var(--color-error-600);
          font-size: var(--text-sm);
        }

        .muted-text {
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }

        @media (max-width: 1100px) {
          .students-body {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .form-grid {
            grid-template-columns: 1fr;
          }

          .timeline-summary {
            grid-template-columns: 1fr;
          }

          .students-header {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </section>
  );
};
