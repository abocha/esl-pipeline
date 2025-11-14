import React, { useMemo } from 'react';
import { useJobMonitor } from '../../context/JobMonitorContext';

const stateLabels: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
};

export const ActivityFeed: React.FC = () => {
  const { jobs } = useJobMonitor();
  const items = useMemo(() => {
    return jobs
      .map(job => ({
        jobId: job.jobId,
        state: job.state,
        updatedAt: job.updatedAt ?? job.createdAt,
        message:
          job.state === 'failed'
            ? job.error ?? 'Job failed.'
            : job.state === 'succeeded'
            ? 'Job finished successfully.'
            : `Job is ${stateLabels[job.state] ?? job.state}.`,
      }))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, 8);
  }, [jobs]);

  return (
    <section style={cardStyle}>
      <p style={eyebrowStyle}>Activity</p>
      <h3 style={{ margin: '4px 0 12px' }}>Recent updates</h3>
      {items.length === 0 ? (
        <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px' }}>No job activity yet.</p>
      ) : (
        <ul style={listStyle}>
          {items.map(item => (
            <li key={`${item.jobId}-${item.updatedAt}`} style={listItemStyle}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '13px' }}>Job {item.jobId}</p>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#475569' }}>{item.message}</p>
              </div>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                {new Date(item.updatedAt ?? '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: '20px',
  padding: '20px',
  boxShadow: '0 20px 70px rgba(15, 23, 42, 0.08)',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#94a3b8',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const listItemStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  padding: '10px 14px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
