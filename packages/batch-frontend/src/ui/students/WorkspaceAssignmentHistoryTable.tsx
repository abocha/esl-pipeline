import { Link } from 'react-router-dom';

import type { JobListResponse } from '../../utils/api';

export interface WorkspaceAssignmentHistoryTableProps {
  jobs: JobListResponse['jobs'];
  selectedJobId: string;
  onInspectJob: (jobId: string, promptPackageId: string | null) => void;
}

export function WorkspaceAssignmentHistoryTable({
  jobs,
  selectedJobId,
  onInspectJob,
}: WorkspaceAssignmentHistoryTableProps) {
  return (
    <div className="workspace-table-wrap">
      <table className="workspace-table">
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">State</th>
            <th scope="col">Created</th>
            <th scope="col">Publish</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
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
  );
}
