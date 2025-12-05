import React, { useMemo } from 'react';

import { type JobEntry, useJobMonitor } from '../../context/JobMonitorContext';

// Icons
const ActivityIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const CheckCircleIcon = () => (
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
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const XCircleIcon = () => (
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
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const LoaderIcon = () => (
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
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
  </svg>
);

const ClockIcon = () => (
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
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

interface ActivityEvent {
  id: string;
  type: 'queued' | 'running' | 'succeeded' | 'failed';
  jobId: string;
  fileName?: string;
  timestamp: Date;
}

export const ActivityFeed: React.FC = () => {
  const { jobs } = useJobMonitor();

  // Generate activity events from jobs list
  const events: ActivityEvent[] = useMemo(() => {
    return jobs.slice(0, 15).map((job: JobEntry) => ({
      id: `${job.jobId}-${job.state}-${job.updatedAt}`,
      type: job.state as ActivityEvent['type'],
      jobId: job.jobId,
      fileName: job.fileName,
      timestamp: new Date(job.updatedAt ?? job.createdAt),
    }));
  }, [jobs]);

  const getEventIcon = (type: ActivityEvent['type']) => {
    switch (type) {
      case 'succeeded': {
        return <CheckCircleIcon />;
      }
      case 'failed': {
        return <XCircleIcon />;
      }
      case 'running': {
        return <LoaderIcon />;
      }
      case 'queued': {
        return <ClockIcon />;
      }
      default: {
        return null;
      }
    }
  };

  const getEventConfig = (type: ActivityEvent['type']) => {
    switch (type) {
      case 'succeeded': {
        return {
          color: 'var(--color-success-500)',
          bg: 'rgba(16, 185, 129, 0.1)',
          label: 'Completed',
        };
      }
      case 'failed': {
        return { color: 'var(--color-error-500)', bg: 'rgba(244, 63, 94, 0.1)', label: 'Failed' };
      }
      case 'running': {
        return { color: 'var(--color-info-500)', bg: 'rgba(14, 165, 233, 0.1)', label: 'Running' };
      }
      case 'queued': {
        return {
          color: 'var(--color-primary-500)',
          bg: 'rgba(99, 102, 241, 0.1)',
          label: 'Queued',
        };
      }
      default: {
        return { color: 'var(--text-tertiary)', bg: 'var(--bg-tertiary)', label: 'Unknown' };
      }
    }
  };

  return (
    <section className="activity-feed card">
      <header className="feed-header">
        <div className="feed-icon">
          <ActivityIcon />
        </div>
        <div className="feed-title">
          <h3>Activity Feed</h3>
          <span className="feed-count">{events.length} jobs</span>
        </div>
      </header>

      <div className="feed-list">
        {events.length === 0 ? (
          <div className="feed-empty">
            <span className="empty-icon">📭</span>
            <span>No activity yet</span>
          </div>
        ) : (
          events.map((event, index) => {
            const config = getEventConfig(event.type);
            return (
              <div
                key={event.id}
                className={`feed-item ${event.type === 'running' ? 'running' : ''}`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="item-icon" style={{ color: config.color, background: config.bg }}>
                  {getEventIcon(event.type)}
                </div>
                <div className="item-content">
                  <span className="item-label">{config.label}</span>
                  <span className="item-file">{event.fileName || event.jobId}</span>
                </div>
                <span className="item-time">{formatTimeAgo(event.timestamp)}</span>
              </div>
            );
          })
        )}
      </div>

      <style>{`
        .activity-feed {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
          max-height: 400px;
        }

        .feed-header {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .feed-icon {
          width: 44px;
          height: 44px;
          background: var(--gradient-primary);
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .feed-title h3 {
          font-size: var(--text-base);
          margin: 0;
        }

        .feed-count {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .feed-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          overflow-y: auto;
          padding-right: var(--space-2);
          flex: 1;
        }

        .feed-list::-webkit-scrollbar {
          width: 4px;
        }

        .feed-list::-webkit-scrollbar-thumb {
          background: var(--color-gray-300);
          border-radius: var(--radius-full);
        }

        .feed-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          padding: var(--space-8);
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }

        .empty-icon {
          font-size: 1.5rem;
        }

        .feed-item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          animation: slideIn 0.3s ease-out backwards;
          transition: all var(--transition-fast);
        }

        .feed-item:hover {
          border-color: var(--border-medium);
        }

        .feed-item.running {
          animation: slideIn 0.3s ease-out backwards, pulse-status 2s ease-in-out infinite;
        }

        .item-icon {
          width: 32px;
          height: 32px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .feed-item.running .item-icon svg {
          animation: spin 1.5s linear infinite;
        }

        .item-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .item-label {
          font-size: var(--text-xs);
          font-weight: 600;
          color: var(--text-primary);
        }

        .item-file {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .item-time {
          font-size: var(--text-xs);
          color: var(--text-muted);
          flex-shrink: 0;
        }
      `}</style>
    </section>
  );
};

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 10) return 'now';
  if (diffSecs < 60) return `${diffSecs}s`;

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;

  return date.toLocaleDateString();
}
