import copy from 'copy-to-clipboard';
import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { type JobEntry, useJobMonitor } from '../../context/JobMonitorContext';

const stateColors: Record<string, string> = {
  queued: '#94a3b8',
  running: '#0ea5e9',
  succeeded: '#22c55e',
  failed: '#ef4444',
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
    // Happy path: already have the Notion URL.
    if (job.notionUrl) {
      copy(job.notionUrl);
      toast.success('Notion link copied to clipboard.');
      return;
    }

    // Fallback: refetch latest status to pick up notionUrl from backend.
    toast.loading('Fetching latest link…', { id: `copy-${job.jobId}` });
    try {
      await trackJob(job.jobId);
      const refreshed = jobMap[job.jobId] ?? jobs.find((j) => j.jobId === job.jobId);
      if (refreshed?.notionUrl) {
        copy(refreshed.notionUrl);
        toast.success('Notion link copied to clipboard.', { id: `copy-${job.jobId}` });
      } else {
        toast.error('Notion link is not available yet. Try again after the job finishes.', {
          id: `copy-${job.jobId}`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to fetch latest job status.';
      toast.error(message, { id: `copy-${job.jobId}` });
    }
  };

  const handleRegenerate = (jobId: string) => {
    toast(`Audio regeneration for ${jobId} is under construction.`);
  };

  const handleAddJob = async () => {
    const trimmed = manualJobId.trim();
    if (!trimmed) {
      toast.error('Enter a job ID to track.');
      return;
    }
    setIsAdding(true);
    try {
      await trackJob(trimmed);
      toast.success(`Tracking job ${trimmed}`);
      setManualJobId('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to fetch job status.';
      toast.error(message);
    } finally {
      setIsAdding(false);
    }
  };

  const toggleLiveUpdates = () => {
    if (liveUpdatesPaused) {
      resumeLiveUpdates();
    } else {
      pauseLiveUpdates();
    }
  };

  return (
    <section style={cardStyle}>
      <div style={tableHeaderStyle}>
        <div>
          <p style={eyebrowStyle}>Jobs</p>
          <h3 style={{ margin: '4px 0 0' }}>Active jobs</h3>
        </div>
        <div style={controlsWrapStyle}>
          <button type="button" onClick={toggleLiveUpdates} style={secondaryButtonStyle}>
            {liveUpdatesPaused ? 'Resume live updates' : 'Pause live updates'}
          </button>
          <input
            type="text"
            placeholder="Search jobs…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={searchInputStyle}
          />
          <div style={addJobWrapStyle}>
            <input
              type="text"
              placeholder="Track job ID…"
              value={manualJobId}
              onChange={(event) => setManualJobId(event.target.value)}
              style={searchInputStyle}
            />
            <button
              type="button"
              onClick={() => void handleAddJob()}
              style={primaryButtonStyle}
              disabled={isAdding}
            >
              {isAdding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
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
                <td colSpan={6} style={emptyCellStyle}>
                  No jobs yet. Upload markdown files to start the pipeline.
                </td>
              </tr>
            ) : (
              filteredJobs.map((job) => (
                <tr key={job.jobId}>
                  <td style={{ fontWeight: 600, fontSize: '13px' }}>{job.jobId}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '13px' }}>{job.fileName ?? '—'}</span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>{job.md || '—'}</span>
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        ...statusPillStyle,
                        backgroundColor: stateColors[job.state] ?? '#cbd5f5',
                      }}
                    >
                      {job.state}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: '12px', color: '#475569' }}>
                      <div>{job.preset ?? 'preset?'}</div>
                      <div>{formatMode(job.mode)}</div>
                    </div>
                  </td>
                  <td style={{ fontSize: '12px' }}>
                    {job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}
                  </td>
                  <td>
                    <div style={actionRowStyle}>
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => handleCopy(job)}
                      >
                        Copy link
                      </button>
                      <button
                        type="button"
                        style={{
                          ...primaryButtonStyle,
                          opacity: job.state === 'succeeded' ? 1 : 0.4,
                          cursor: job.state === 'succeeded' ? 'pointer' : 'not-allowed',
                        }}
                        disabled={job.state !== 'succeeded'}
                        onClick={() => handleRegenerate(job.jobId)}
                      >
                        Regenerate audio
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: '20px',
  padding: '24px',
  boxShadow: '0 25px 70px rgba(15, 23, 42, 0.08)',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const tableHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#94a3b8',
};

const searchInputStyle: React.CSSProperties = {
  borderRadius: '12px',
  border: '1px solid #e2e8f0',
  padding: '8px 12px',
  fontSize: '13px',
  flex: '1 1 220px',
  minWidth: '180px',
};

const controlsWrapStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

function formatMode(mode: JobEntry['mode'] = 'auto'): string {
  const value = mode === null ? 'auto' : mode;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const addJobWrapStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  alignItems: 'center',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

const statusPillStyle: React.CSSProperties = {
  display: 'inline-block',
  borderRadius: '999px',
  padding: '4px 10px',
  fontSize: '12px',
  color: '#fff',
  textTransform: 'capitalize',
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: '999px',
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 600,
  background: 'linear-gradient(120deg, #4f46e5, #6366f1)',
  color: '#fff',
  cursor: 'pointer',
  opacity: 1,
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '999px',
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 600,
  background: '#fff',
  cursor: 'pointer',
};

const emptyCellStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '20px 0',
  color: '#94a3b8',
  fontSize: '13px',
};
