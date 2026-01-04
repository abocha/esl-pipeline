import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { JobStatus } from '../../utils/api';
import { getRecording, getStudentProfile, listUserJobs } from '../../utils/api';

interface PendingApprovalItem {
  job: JobStatus;
  recordingName: string | null;
  studentName: string | null;
}

const formatTimestamp = (value: string | null) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
};

const trimPath = (value: string | null) => {
  if (!value) return null;
  const parts = value.split('/');
  return parts.at(-1) ?? value;
};

export const PendingApprovals: React.FC = () => {
  const [items, setItems] = useState<PendingApprovalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadApprovals = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await listUserJobs({
          state: 'awaiting_approval',
          limit: 6,
          order: 'desc',
        });

        const jobs = response.jobs ?? [];
        const recordings = await Promise.all(
          jobs.map((job) =>
            job.recordingId ? getRecording(job.recordingId).catch(() => null) : Promise.resolve(null),
          ),
        );

        const studentIds = [
          ...new Set(
            recordings
              .map((recording) => recording?.studentId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0),
          ),
        ];

        const studentProfiles = await Promise.all(
          studentIds.map((studentId) =>
            getStudentProfile(studentId)
              .then((profile) => [studentId, profile] as const)
              .catch(() => [studentId, null] as const),
          ),
        );

        const studentMap = new Map<string, { student: string }>();
        for (const [studentId, profile] of studentProfiles) {
          if (profile) {
            studentMap.set(studentId, profile);
          }
        }

        const enriched = jobs.map((job, index) => {
          const recording = recordings[index];
          const recordingName =
            recording?.displayName ?? trimPath(job.md) ?? job.recordingId ?? job.jobId;
          const studentName =
            studentMap.get(recording?.studentId ?? '')?.student ?? recording?.studentId ?? null;
          return {
            job,
            recordingName,
            studentName,
          };
        });

        if (isActive) {
          setItems(enriched);
        }
      } catch (loadError) {
        if (isActive) {
          const message = loadError instanceof Error ? loadError.message : 'Unable to load approvals.';
          setError(message);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadApprovals();

    return () => {
      isActive = false;
    };
  }, []);

  const summary = useMemo(() => {
    if (isLoading) return 'Loading approvals...';
    if (error) return error;
    if (items.length === 0) return 'No approvals waiting right now.';
    return `${items.length} job${items.length === 1 ? '' : 's'} waiting for review.`;
  }, [items.length, isLoading, error]);

  return (
    <section className="pending-approvals card animate-fade-in-up">
      <header className="pending-header">
        <div>
          <p className="pending-eyebrow">Pending Approvals</p>
          <h3>Drafts ready for your review</h3>
        </div>
        <Link to="/jobs" className="pending-link">
          View all
        </Link>
      </header>
      <p className="pending-summary">{summary}</p>

      <div className="pending-list">
        {items.map((item) => (
          <Link
            key={item.job.jobId}
            className="pending-item"
            to={`/wizard?jobId=${encodeURIComponent(item.job.jobId)}&step=review`}
          >
            <div>
              <div className="pending-title">{item.recordingName ?? 'Untitled recording'}</div>
              <div className="pending-meta">
                <span>{item.studentName ?? 'Student pending'}</span>
                <span className="pending-dot" />
                <span>{formatTimestamp(item.job.updatedAt ?? item.job.createdAt)}</span>
              </div>
            </div>
            <span className="pending-pill">Awaiting approval</span>
          </Link>
        ))}
      </div>

      <style>{`
        .pending-approvals {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .pending-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-4);
        }

        .pending-eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-warning-600);
          margin-bottom: var(--space-2);
        }

        .pending-header h3 {
          margin: 0;
          font-size: var(--text-lg);
          font-family: var(--font-display);
        }

        .pending-link {
          font-size: var(--text-sm);
          color: var(--color-primary-500);
          text-decoration: none;
          font-weight: 600;
        }

        .pending-summary {
          margin: 0;
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }

        .pending-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .pending-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-xl);
          border: 1px solid var(--border-light);
          background: var(--bg-secondary);
          text-decoration: none;
          color: inherit;
          transition: border var(--transition-fast), box-shadow var(--transition-fast);
        }

        .pending-item:hover {
          border-color: rgba(99, 102, 241, 0.4);
          box-shadow: var(--shadow-md);
        }

        .pending-title {
          font-weight: 600;
        }

        .pending-meta {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          margin-top: var(--space-1);
        }

        .pending-dot {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: var(--text-tertiary);
        }

        .pending-pill {
          font-size: var(--text-xs);
          font-weight: 600;
          padding: var(--space-1) var(--space-2);
          border-radius: var(--radius-full);
          background: rgba(234, 179, 8, 0.12);
          color: var(--color-warning-600);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        @media (max-width: 640px) {
          .pending-item {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </section>
  );
};
