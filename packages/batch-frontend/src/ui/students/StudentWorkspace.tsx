import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type {
  JobState,
  JobListResponse,
  JobProvenanceResponse,
  ProfileRevisionSummaryResponse,
  PromptPackageLineageResponse,
  StudentProfile,
  StudentTimelineType,
  StudentProfileBindingListResponse,
  StudentTimelineResponse,
} from '../../utils/api';
import {
  activateProfileRevision,
  fetchJobProvenance,
  fetchPromptPackageLineage,
  getProfileContent,
  getStudentProfile,
  getStudentTimeline,
  listProfileContents,
  listProfileRevisions,
  listStudentProfileBindings,
  listStudents,
  listUserJobs,
  restoreProfileRevision,
  updateStudentProfile,
  upsertProfileContent,
} from '../../utils/api';

const HISTORY_LIMIT = 25;
const BINDING_LIMIT = 20;
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
  'job_action_cancel',
  'job_action_edit_metadata',
];

function toIsoOrUndefined(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export const StudentWorkspace: React.FC = () => {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile | null>(null);
  const [profileBindingSaving, setProfileBindingSaving] = useState(false);
  const [bindingSuccess, setBindingSuccess] = useState<string | null>(null);

  const [profileOptions, setProfileOptions] = useState<{ id: string; label: string }[]>([]);
  const [profileOptionsError, setProfileOptionsError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  const [profileEditorText, setProfileEditorText] = useState('');
  const [loadedProfileContent, setLoadedProfileContent] = useState('');
  const [profileBusy, setProfileBusy] = useState<'loading' | 'saving' | 'restoring' | 'activating' | null>(
    null,
  );
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileRevisions, setProfileRevisions] = useState<ProfileRevisionSummaryResponse[]>([]);

  const [jobHistory, setJobHistory] = useState<JobListResponse['jobs']>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [historyStateFilter, setHistoryStateFilter] = useState<'all' | JobState>('all');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');

  const [timeline, setTimeline] = useState<StudentTimelineResponse['items']>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<'all' | StudentTimelineType>('all');
  const [timelineFrom, setTimelineFrom] = useState('');
  const [timelineTo, setTimelineTo] = useState('');

  const [bindingHistory, setBindingHistory] = useState<StudentProfileBindingListResponse['items']>([]);
  const [bindingHistoryLoading, setBindingHistoryLoading] = useState(false);
  const [bindingHistoryError, setBindingHistoryError] = useState<string | null>(null);

  const [selectedJobId, setSelectedJobId] = useState('');
  const [selectedPromptPackageId, setSelectedPromptPackageId] = useState('');

  const [jobProvenance, setJobProvenance] = useState<JobProvenanceResponse | null>(null);
  const [jobProvenanceLoading, setJobProvenanceLoading] = useState(false);
  const [jobProvenanceError, setJobProvenanceError] = useState<string | null>(null);

  const [lineage, setLineage] = useState<PromptPackageLineageResponse | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageError, setLineageError] = useState<string | null>(null);

  const selectedJob = useMemo(
    () => jobHistory.find((job) => job.jobId === selectedJobId) ?? null,
    [jobHistory, selectedJobId],
  );

  const profileDirty = useMemo(
    () => profileEditorText.trim() !== loadedProfileContent.trim(),
    [loadedProfileContent, profileEditorText],
  );

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    setStudentsError(null);
    try {
      const response = await listStudents({ limit: 200, offset: 0, order: 'asc' });
      const items = response.items ?? [];
      setStudents(items);
      setSelectedStudentId((current) => {
        if (current && items.some((item) => item.id === current)) return current;
        return items.find((item) => item.student === 'Default')?.id ?? items[0]?.id ?? '';
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

  const loadJobHistory = useCallback(async (studentId: string) => {
    if (!studentId) {
      setJobHistory([]);
      return;
    }
    setJobsLoading(true);
    setJobsError(null);
    try {
      const response = await listUserJobs({
        studentId,
        state: historyStateFilter === 'all' ? undefined : historyStateFilter,
        from: toIsoOrUndefined(historyFrom),
        to: toIsoOrUndefined(historyTo),
        limit: HISTORY_LIMIT,
        offset: 0,
        order: 'desc',
      });
      setJobHistory(response.jobs ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load assignment history.';
      setJobsError(message);
      setJobHistory([]);
    } finally {
      setJobsLoading(false);
    }
  }, [historyFrom, historyStateFilter, historyTo]);

  const loadTimeline = useCallback(async (studentId: string) => {
    if (!studentId) {
      setTimeline([]);
      return;
    }
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const response = await getStudentTimeline(studentId, {
        type: timelineTypeFilter === 'all' ? undefined : timelineTypeFilter,
        from: toIsoOrUndefined(timelineFrom),
        to: toIsoOrUndefined(timelineTo),
        limit: HISTORY_LIMIT,
        offset: 0,
        order: 'desc',
      });
      setTimeline(response.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load student timeline.';
      setTimelineError(message);
      setTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [timelineFrom, timelineTo, timelineTypeFilter]);

  const loadBindings = useCallback(async (studentId: string) => {
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
      setBindingHistory(response.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load profile binding history.';
      setBindingHistoryError(message);
      setBindingHistory([]);
    } finally {
      setBindingHistoryLoading(false);
    }
  }, []);

  const loadSelectedStudent = useCallback(async (studentId: string) => {
    if (!studentId) {
      setSelectedStudent(null);
      setSelectedProfileId('');
      setJobHistory([]);
      setTimeline([]);
      setBindingHistory([]);
      return;
    }

    setBindingSuccess(null);
    try {
      const profile = await getStudentProfile(studentId);
      setSelectedStudent(profile);
      setSelectedProfileId(profile.profileId ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load selected student.';
      setSelectedStudent(null);
      setProfileError(message);
    }

    await Promise.all([loadJobHistory(studentId), loadTimeline(studentId), loadBindings(studentId)]);
  }, [loadBindings, loadJobHistory, loadTimeline]);

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([loadStudents(), loadProfileOptions()]);
  }, [loadProfileOptions, loadStudents]);

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
      await Promise.all([loadStudents(), loadBindings(selectedStudentId), loadTimeline(selectedStudentId)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update student profile binding.';
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
      const revisions = await listProfileRevisions(saved.id, { limit: 25, offset: 0, order: 'desc' });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile content saved.');
      await loadTimeline(selectedStudentId);
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
      const revisions = await listProfileRevisions(restored.id, { limit: 25, offset: 0, order: 'desc' });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile revision restored.');
      await loadTimeline(selectedStudentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to restore profile revision.';
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
      await loadTimeline(selectedStudentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to activate profile revision.';
      setProfileError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleInspectJob = (jobId: string, promptPackageId: string | null) => {
    setSelectedJobId(jobId);
    setSelectedPromptPackageId(promptPackageId ?? '');
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
        if (!selectedPromptPackageId && provenance.promptPackage?.id) {
          setSelectedPromptPackageId(provenance.promptPackage.id);
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
  }, [selectedJobId, selectedPromptPackageId]);

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
  }, [selectedPromptPackageId]);

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
            <h2>Student Context</h2>
            <p>Choose the student context for all workspace panels.</p>
          </header>

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
                  <span className="workspace-muted">{new Date(binding.effectiveFrom).toLocaleString()}</span>
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
                    <div className="workspace-muted">{new Date(revision.createdAt).toLocaleString()}</div>
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
            <h2>Assignment History</h2>
            <p>Recent assignments for this student with outcome visibility.</p>
          </header>

          <div className="workspace-inline workspace-filter-row">
            <label className="workspace-field">
              State
              <select
                value={historyStateFilter}
                onChange={(event) => setHistoryStateFilter(event.target.value as 'all' | JobState)}
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
                value={historyFrom}
                onChange={(event) => setHistoryFrom(event.target.value)}
              />
            </label>

            <label className="workspace-field">
              To
              <input
                type="datetime-local"
                value={historyTo}
                onChange={(event) => setHistoryTo(event.target.value)}
              />
            </label>

            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => void loadJobHistory(selectedStudentId)}
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
                    <tr key={job.jobId} className={selectedJobId === job.jobId ? 'workspace-selected-row' : ''}>
                      <td>
                        <code>{job.jobId.slice(0, 8)}</code>
                        <div className="workspace-muted">prompt {job.promptPackageId ?? 'n/a'}</div>
                      </td>
                      <td>{job.state}</td>
                      <td>{new Date(job.createdAt).toLocaleString()}</td>
                      <td>{job.notionUrl ? 'Notion' : job.anytypeUrl ? 'Anytype' : 'Pending'}</td>
                      <td>
                        <button
                          type="button"
                          className="workspace-secondary-btn"
                          onClick={() => handleInspectJob(job.jobId, job.promptPackageId)}
                        >
                          Inspect
                        </button>
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

          {jobProvenanceLoading ? <p className="workspace-muted">Loading job provenance...</p> : null}
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
                      {new Date(action.requestedAt).toLocaleString()} by {action.requestedBy ?? 'unknown'}
                    </div>
                  </div>
                  <span>{action.outcome}</span>
                </div>
              ))}
            </div>
          ) : null}

          {lineageLoading ? <p className="workspace-muted">Loading prompt lineage...</p> : null}
          {lineageError ? <p className="workspace-error">{lineageError}</p> : null}

          {lineage ? (
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
                <strong>Binding at creation:</strong> {lineage.bindingAtCreation?.profileId ?? 'n/a'}
              </span>
            </div>
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
                value={timelineTypeFilter}
                onChange={(event) => setTimelineTypeFilter(event.target.value as 'all' | StudentTimelineType)}
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
                value={timelineFrom}
                onChange={(event) => setTimelineFrom(event.target.value)}
              />
            </label>

            <label className="workspace-field">
              To
              <input
                type="datetime-local"
                value={timelineTo}
                onChange={(event) => setTimelineTo(event.target.value)}
              />
            </label>

            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => void loadTimeline(selectedStudentId)}
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
                <div key={`${event.type}-${event.createdAt}-${index}`} className="workspace-list-item">
                  <div>
                    <strong>{event.type}</strong>
                    <div className="workspace-muted">{new Date(event.createdAt).toLocaleString()}</div>
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
