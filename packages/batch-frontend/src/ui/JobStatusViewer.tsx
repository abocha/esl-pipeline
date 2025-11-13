import React, { useEffect, useState } from 'react';
import { getJobStatus, JobStatus } from '../utils/api';

type Props = {
  // When a job is created via the form, this is pre-filled for convenience.
  lastJobId: string | null;
};

/**
 * Compact viewer for a single job's status.
 *
 * Features:
 * - Input for jobId (pre-populated with last created).
 * - "Load" button for on-demand fetch.
 * - Optional polling toggle for basic auto-refresh.
 * - Renders key fields plus error/manifestPath when present.
 *
 * This intentionally does NOT attempt to list all jobs; batch-backend exposes
 * only GET /jobs/:jobId / POST /jobs in this version, so this viewer focuses
 * on targeted inspection.
 */
export const JobStatusViewer: React.FC<Props> = ({ lastJobId }) => {
  const [jobId, setJobId] = useState<string>(lastJobId || '');
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [poll, setPoll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep input synced with the latest created job.
  useEffect(() => {
    if (lastJobId && !jobId) {
      setJobId(lastJobId);
    }
  }, [lastJobId, jobId]);

  useEffect(() => {
    if (!poll || !jobId) return;

    const interval = setInterval(() => {
      void load(jobId, { quiet: true });
    }, 2000);

    return () => clearInterval(interval);
  }, [poll, jobId]);

  const load = async (id: string, opts?: { quiet?: boolean }) => {
    const targetId = id.trim();
    if (!targetId) {
      setError('Enter a jobId to load its status.');
      return;
    }

    if (!opts?.quiet) {
      setLoading(true);
      setError(null);
    }

    try {
      const s = await getJobStatus(targetId);
      setStatus(s);
      setError(null);
    } catch (err: any) {
      setStatus(null);
      setError(err.message || 'Failed to load job status.');
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  };

  return (
    <div
      style={{
        border: '1px solid #eee',
        padding: '10px',
        borderRadius: '6px',
        marginTop: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          Job Status
        </span>
        <input
          type="text"
          value={jobId}
          onChange={e => setJobId(e.target.value)}
          placeholder="Paste jobId here"
          style={{
            flex: 1,
            padding: '4px 6px',
            fontSize: '12px',
            borderRadius: '4px',
            border: '1px solid #ccc',
          }}
        />
        <button
          type="button"
          onClick={() => void load(jobId)}
          disabled={loading || !jobId.trim()}
          style={{
            padding: '5px 8px',
            fontSize: '12px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: loading ? '#999' : '#2563eb',
            color: '#fff',
            cursor: loading ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Loading...' : 'Load'}
        </button>
      </div>

      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          color: '#555',
          marginTop: '2px',
        }}
      >
        <input type="checkbox" checked={poll} onChange={e => setPoll(e.target.checked)} />
        Poll every 2s while this jobId is set
      </label>

      {error && (
        <div
          style={{
            marginTop: '4px',
            padding: '6px 8px',
            backgroundColor: '#fff4f4',
            borderRadius: '4px',
            border: '1px solid #f2c2c2',
            color: '#a40000',
            fontSize: '11px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}

      {status && (
        <div
          style={{
            marginTop: '4px',
            padding: '6px 8px',
            backgroundColor: '#f8fafc',
            borderRadius: '4px',
            border: '1px solid #e5e7eb',
            fontSize: '11px',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: '2px',
          }}
        >
          <div>
            <strong>jobId:</strong> <span style={{ wordBreak: 'break-all' }}>{status.jobId}</span>
          </div>
          <div>
            <strong>state:</strong> <StatusPill state={status.state} />
          </div>
          <div>
            <strong>createdAt:</strong> {status.createdAt}
          </div>
          <div>
            <strong>updatedAt:</strong> {status.updatedAt}
          </div>
          <div>
            <strong>startedAt:</strong> {status.startedAt || '—'}
          </div>
          <div>
            <strong>finishedAt:</strong> {status.finishedAt || '—'}
          </div>
          <div>
            <strong>manifestPath:</strong> {status.manifestPath || '—'}
          </div>
          <div>
            <strong>error:</strong>{' '}
            {status.error ? <span style={{ color: '#b91c1c' }}>{status.error}</span> : '—'}
          </div>
        </div>
      )}
    </div>
  );
};

const StatusPill: React.FC<{ state: JobStatus['state'] }> = ({ state }) => {
  const colorMap: Record<JobStatus['state'], string> = {
    queued: '#6b7280',
    running: '#2563eb',
    succeeded: '#15803d',
    failed: '#b91c1c',
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: '999px',
        backgroundColor: '#f3f4f6',
        color: colorMap[state] || '#111827',
        border: `1px solid ${colorMap[state] || '#d1d5db'}`,
        fontSize: '10px',
        gap: '4px',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '999px',
          backgroundColor: colorMap[state] || '#9ca3af',
        }}
      />
      {state}
    </span>
  );
};
