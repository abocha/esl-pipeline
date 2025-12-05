import copy from 'copy-to-clipboard';
import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { type JobEntry, useJobMonitor } from '../../context/JobMonitorContext';

// Icons
const CopyIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const RefreshIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const SearchIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const PlayIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const PauseIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

interface StateConfig {
  color: string;
  bg: string;
  label: string;
}

const defaultConfig: StateConfig = {
  color: 'var(--color-gray-500)',
  bg: 'var(--color-gray-100)',
  label: 'Unknown',
};

const stateConfig: Record<string, StateConfig> = {
  queued: { color: 'var(--color-gray-500)', bg: 'var(--color-gray-100)', label: 'Queued' },
  running: { color: 'var(--color-info-600)', bg: 'rgba(14, 165, 233, 0.15)', label: 'Running' },
  succeeded: {
    color: 'var(--color-success-600)',
    bg: 'rgba(16, 185, 129, 0.15)',
    label: 'Succeeded',
  },
  failed: { color: 'var(--color-error-600)', bg: 'rgba(244, 63, 94, 0.15)', label: 'Failed' },
};

export const JobTable: React.FC = () => {
  const { jobs, jobMap, trackJob, liveUpdatesPaused, pauseLiveUpdates, resumeLiveUpdates } =
    useJobMonitor();
  const [search, setSearch] = useState('');
  const [manualJobId, setManualJobId] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const filteredJobs = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = term
      ? jobs.filter(
          (job) =>
            job.jobId.toLowerCase().includes(term) ||
            job.fileName?.toLowerCase().includes(term) ||
            job.md.toLowerCase().includes(term),
        )
      : jobs;
    return result.slice(0, 20);
  }, [jobs, search]);

  const handleCopy = async (job: JobEntry) => {
    if (job.notionUrl) {
      copy(job.notionUrl);
      toast.success('Notion link copied!');
      return;
    }

    toast.loading('Fetching latest link…', { id: `copy-${job.jobId}` });
    try {
      const latest = (await trackJob(job.jobId)) ?? jobMap[job.jobId] ?? job;
      const refreshed = latest ?? jobs.find((j) => j.jobId === job.jobId);
      if (refreshed?.notionUrl) {
        copy(refreshed.notionUrl);
        toast.success('Notion link copied!', { id: `copy-${job.jobId}` });
      } else {
        toast.error('Link not available yet', { id: `copy-${job.jobId}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to fetch job status';
      toast.error(message, { id: `copy-${job.jobId}` });
    }
  };

  const handleRegenerate = (jobId: string) => {
    toast(`Audio regeneration for ${jobId} coming soon!`, { icon: '🔊' });
  };

  const handleAddJob = async () => {
    const trimmed = manualJobId.trim();
    if (!trimmed) {
      toast.error('Enter a job ID to track');
      return;
    }
    setIsAdding(true);
    try {
      await trackJob(trimmed);
      toast.success(`Tracking job ${trimmed}`);
      setManualJobId('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to fetch job';
      toast.error(message);
    } finally {
      setIsAdding(false);
    }
  };

  const toggleLiveUpdates = () => {
    if (liveUpdatesPaused) {
      resumeLiveUpdates();
      toast.success('Live updates resumed');
    } else {
      pauseLiveUpdates();
      toast('Live updates paused', { icon: '⏸️' });
    }
  };

  const stats = useMemo(() => {
    const running = jobs.filter((j) => j.state === 'running').length;
    const succeeded = jobs.filter((j) => j.state === 'succeeded').length;
    const failed = jobs.filter((j) => j.state === 'failed').length;
    return { running, succeeded, failed };
  }, [jobs]);

  return (
    <section className="job-table card animate-fade-in-up">
      <header className="table-header">
        <div className="table-title">
          <span className="eyebrow">Jobs</span>
          <h2>Active Jobs</h2>
          <div className="table-stats">
            {stats.running > 0 && (
              <span className="stat stat-running">
                <span className="stat-dot animate-pulse" />
                {stats.running} running
              </span>
            )}
            {stats.succeeded > 0 && (
              <span className="stat stat-success">{stats.succeeded} done</span>
            )}
            {stats.failed > 0 && <span className="stat stat-error">{stats.failed} failed</span>}
          </div>
        </div>

        <div className="table-controls">
          <button
            type="button"
            onClick={toggleLiveUpdates}
            className={`btn-live ${liveUpdatesPaused ? 'paused' : ''}`}
          >
            {liveUpdatesPaused ? <PlayIcon /> : <PauseIcon />}
            {liveUpdatesPaused ? 'Resume' : 'Pause'}
          </button>

          <div className="search-box">
            <SearchIcon />
            <input
              type="text"
              placeholder="Search jobs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="add-job-box">
            <input
              type="text"
              placeholder="Track job ID…"
              value={manualJobId}
              onChange={(e) => setManualJobId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleAddJob()}
            />
            <button
              type="button"
              onClick={() => void handleAddJob()}
              disabled={isAdding}
              className="btn-primary btn-sm"
            >
              {isAdding ? 'Adding…' : 'Track'}
            </button>
          </div>
        </div>
      </header>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Job ID</th>
              <th>File</th>
              <th>Status</th>
              <th>Preset / Mode</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  <div className="empty-content">
                    <span className="empty-icon">📋</span>
                    <span>No jobs yet. Upload markdown files to start.</span>
                  </div>
                </td>
              </tr>
            ) : (
              filteredJobs.map((job, index) => (
                <JobRow
                  key={job.jobId}
                  job={job}
                  onCopy={() => void handleCopy(job)}
                  onRegenerate={() => handleRegenerate(job.jobId)}
                  style={{ animationDelay: `${index * 50}ms` }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <style>{`
        .job-table {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .table-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--space-4);
          flex-wrap: wrap;
        }

        .table-title {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-primary-500);
        }

        .table-title h2 {
          font-size: var(--text-xl);
          margin: 0;
        }

        .table-stats {
          display: flex;
          gap: var(--space-3);
          margin-top: var(--space-1);
        }

        .stat {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          font-size: var(--text-xs);
          font-weight: 500;
        }

        .stat-running {
          color: var(--color-info-500);
        }

        .stat-success {
          color: var(--color-success-500);
        }

        .stat-error {
          color: var(--color-error-500);
        }

        .stat-dot {
          width: 6px;
          height: 6px;
          background: currentColor;
          border-radius: 50%;
        }

        .table-controls {
          display: flex;
          gap: var(--space-2);
          align-items: center;
          flex-wrap: wrap;
        }

        .btn-live {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          padding: var(--space-2) var(--space-3);
          background: var(--color-success-500);
          border: none;
          border-radius: var(--radius-full);
          color: white;
          font-size: var(--text-xs);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-live:hover {
          background: var(--color-success-600);
        }

        .btn-live.paused {
          background: var(--color-gray-400);
        }

        .search-box {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          color: var(--text-tertiary);
        }

        .search-box input {
          border: none;
          background: none;
          padding: 0;
          font-size: var(--text-sm);
          width: 140px;
        }

        .add-job-box {
          display: flex;
          gap: var(--space-2);
        }

        .add-job-box input {
          width: 140px;
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          font-size: var(--text-sm);
        }

        .btn-sm {
          padding: var(--space-2) var(--space-3);
          font-size: var(--text-xs);
        }

        .table-wrapper {
          overflow-x: auto;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-light);
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th {
          background: var(--bg-secondary);
          text-align: left;
          padding: var(--space-3) var(--space-4);
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
          border-bottom: 1px solid var(--border-light);
        }

        td {
          padding: var(--space-4);
          border-bottom: 1px solid var(--border-light);
          font-size: var(--text-sm);
        }

        tr:last-child td {
          border-bottom: none;
        }

        tbody tr {
          transition: background var(--transition-fast);
          animation: fadeInUp 0.3s ease-out backwards;
        }

        tbody tr:hover {
          background: var(--bg-secondary);
        }

        .empty-state {
          text-align: center;
          padding: var(--space-10) !important;
        }

        .empty-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-2);
          color: var(--text-tertiary);
        }

        .empty-icon {
          font-size: 2rem;
        }
      `}</style>
    </section>
  );
};

interface JobRowProps {
  job: JobEntry;
  onCopy: () => void;
  onRegenerate: () => void;
  style?: React.CSSProperties;
}

const JobRow: React.FC<JobRowProps> = ({ job, onCopy, onRegenerate, style }) => {
  const config: StateConfig = stateConfig[job.state] ?? defaultConfig;
  const isRunning = job.state === 'running';

  return (
    <tr style={style}>
      <td>
        <code className="job-id">{job.jobId}</code>
      </td>
      <td>
        <div className="file-cell">
          <span className="file-name">{job.fileName ?? '—'}</span>
          <span className="file-path">{job.md || '—'}</span>
        </div>
      </td>
      <td>
        <span
          className={`status-pill ${isRunning ? 'animate-pulse' : ''}`}
          style={{ color: config.color, background: config.bg }}
        >
          {isRunning && <span className="status-dot" />}
          {config.label}
        </span>
      </td>
      <td>
        <div className="preset-cell">
          <span className="preset-name">{job.preset ?? '—'}</span>
          <span className="preset-mode">{formatMode(job.mode)}</span>
        </div>
      </td>
      <td>
        <span className="timestamp">
          {job.updatedAt ? formatTime(new Date(job.updatedAt)) : '—'}
        </span>
      </td>
      <td>
        <div className="actions">
          <button type="button" onClick={onCopy} className="btn-action">
            <CopyIcon />
            <span>Copy link</span>
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={job.state !== 'succeeded'}
            className="btn-action btn-accent"
          >
            <RefreshIcon />
            <span>Regen</span>
          </button>
        </div>
      </td>

      <style>{`
        .job-id {
          font-size: var(--text-xs);
          font-family: var(--font-mono);
          background: var(--bg-tertiary);
          padding: var(--space-1) var(--space-2);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
        }

        .file-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .file-name {
          font-weight: 500;
          color: var(--text-primary);
        }

        .file-path {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          max-width: 200px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-full);
          font-size: var(--text-xs);
          font-weight: 600;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          background: currentColor;
          border-radius: 50%;
        }

        .preset-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .preset-name {
          font-weight: 500;
          color: var(--text-primary);
        }

        .preset-mode {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .timestamp {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .actions {
          display: flex;
          gap: var(--space-2);
        }

        .btn-action {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          padding: var(--space-1) var(--space-2);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          font-size: var(--text-xs);
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-action:hover:not(:disabled) {
          background: var(--bg-tertiary);
          border-color: var(--border-medium);
          color: var(--text-primary);
        }

        .btn-action:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .btn-action.btn-accent:not(:disabled) {
          background: var(--color-primary-50);
          border-color: var(--color-primary-200);
          color: var(--color-primary-600);
        }

        [data-theme="dark"] .btn-action.btn-accent:not(:disabled) {
          background: rgba(99, 102, 241, 0.15);
        }

        .btn-action.btn-accent:hover:not(:disabled) {
          background: var(--color-primary-100);
          border-color: var(--color-primary-300);
        }
      `}</style>
    </tr>
  );
};

function formatMode(mode: JobEntry['mode'] = 'auto'): string {
  const value = mode === null ? 'auto' : mode;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString();
}
