import type { Dispatch, SetStateAction } from 'react';
import { Link } from 'react-router-dom';

import type { JobListResponse, StudentTimelineResponse } from '../../utils/api';
import type { HistoryFilters, TimelineFilters } from './StudentWorkspace.logic';

export interface WorkspaceHistoryPanelProps {
  selectedStudentId: string;
  selectedJobId: string;
  jobHistory: JobListResponse['jobs'];
  jobsLoading: boolean;
  jobsError: string | null;
  historyFiltersDraft: HistoryFilters;
  setHistoryFiltersDraft: Dispatch<SetStateAction<HistoryFilters>>;
  onApplyHistoryFilters: (filters: HistoryFilters) => void | Promise<void>;
  timeline: StudentTimelineResponse['items'];
  timelineLoading: boolean;
  timelineError: string | null;
  timelineFiltersDraft: TimelineFilters;
  setTimelineFiltersDraft: Dispatch<SetStateAction<TimelineFilters>>;
  onApplyTimelineFilters: (filters: TimelineFilters) => void | Promise<void>;
  onInspectJob: (jobId: string, promptPackageId: string | null) => void;
}

export function WorkspaceHistoryPanel({
  selectedStudentId,
  selectedJobId,
  jobHistory,
  jobsLoading,
  jobsError,
  historyFiltersDraft,
  setHistoryFiltersDraft,
  onApplyHistoryFilters,
  timeline,
  timelineLoading,
  timelineError,
  timelineFiltersDraft,
  setTimelineFiltersDraft,
  onApplyTimelineFilters,
  onInspectJob,
}: WorkspaceHistoryPanelProps) {
  return (
    <>
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
                  state: event.target.value as HistoryFilters['state'],
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
            onClick={() => void onApplyHistoryFilters({ ...historyFiltersDraft })}
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
                          onClick={() => onInspectJob(job.jobId, job.promptPackageId)}
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
                  type: event.target.value as TimelineFilters['type'],
                }))
              }
            >
              <option value="all">All events</option>
              <option value="recording_ingested">recording_ingested</option>
              <option value="transcript_ready">transcript_ready</option>
              <option value="prompt_package_created">prompt_package_created</option>
              <option value="draft_saved">draft_saved</option>
              <option value="job_awaiting_approval">job_awaiting_approval</option>
              <option value="job_completed">job_completed</option>
              <option value="student_profile_binding_changed">
                student_profile_binding_changed
              </option>
              <option value="profile_revision_saved">profile_revision_saved</option>
              <option value="profile_revision_restored">profile_revision_restored</option>
              <option value="profile_revision_activated">profile_revision_activated</option>
              <option value="template_revision_saved">template_revision_saved</option>
              <option value="template_revision_restored">template_revision_restored</option>
              <option value="template_revision_activated">template_revision_activated</option>
              <option value="job_action_rerun">job_action_rerun</option>
              <option value="job_action_cancel">job_action_cancel</option>
              <option value="job_action_edit_metadata">job_action_edit_metadata</option>
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
            onClick={() => void onApplyTimelineFilters({ ...timelineFiltersDraft })}
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
    </>
  );
}
