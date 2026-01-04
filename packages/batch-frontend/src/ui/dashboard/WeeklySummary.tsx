import React, { useEffect, useMemo, useState } from 'react';

import type { JobSummaryResponse, StudentSummaryResponse } from '../../utils/api';
import { getJobSummary, getStudentSummary } from '../../utils/api';

const formatDate = (value: string | null) => {
  if (!value) return 'No recent lesson';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No recent lesson';
  return date.toLocaleDateString();
};

export const WeeklySummary: React.FC = () => {
  const [jobSummary, setJobSummary] = useState<JobSummaryResponse | null>(null);
  const [studentSummary, setStudentSummary] = useState<StudentSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadSummary = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [jobs, students] = await Promise.all([
          getJobSummary(),
          getStudentSummary({ limit: 5, order: 'desc' }),
        ]);
        if (isActive) {
          setJobSummary(jobs);
          setStudentSummary(students);
        }
      } catch (loadError) {
        if (isActive) {
          const message = loadError instanceof Error ? loadError.message : 'Unable to load summary.';
          setError(message);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadSummary();

    return () => {
      isActive = false;
    };
  }, []);

  const metrics = useMemo(() => {
    if (!jobSummary) return [];
    return [
      {
        label: 'Jobs in last 7 days',
        value: jobSummary.last7Days.total,
      },
      {
        label: 'Succeeded this week',
        value: jobSummary.last7Days.succeeded,
      },
      {
        label: 'Pending approvals',
        value: jobSummary.pendingApprovals,
      },
      {
        label: 'TTS enabled',
        value: jobSummary.tts.enabled,
      },
    ];
  }, [jobSummary]);

  return (
    <section className="weekly-summary card animate-fade-in-up">
      <header className="summary-header">
        <div>
          <p className="summary-eyebrow">Weekly Summary</p>
          <h3>Momentum check for the last seven days</h3>
        </div>
        <div className="summary-badge">Updated live</div>
      </header>

      {error ? (
        <p className="summary-error">{error}</p>
      ) : (
        <div className="summary-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="summary-metric">
              <span className="metric-value">{isLoading ? '...' : metric.value}</span>
              <span className="metric-label">{metric.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="summary-students">
        <div className="students-header">
          <h4>Students on the move</h4>
          <span>{studentSummary?.total ?? 0} active</span>
        </div>
        <div className="students-list">
          {studentSummary?.items?.length ? (
            studentSummary.items.map((student) => (
              <div key={student.id} className="student-row">
                <div>
                  <div className="student-name">{student.name}</div>
                  <div className="student-meta">Last lesson: {formatDate(student.lastLessonAt)}</div>
                </div>
                <div className="student-drafts">
                  <span>{student.pendingDrafts}</span>
                  <small>pending drafts</small>
                </div>
              </div>
            ))
          ) : (
            <div className="students-empty">{isLoading ? 'Loading students...' : 'No recent student activity.'}</div>
          )}
        </div>
      </div>

      <style>{`
        .weekly-summary {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .summary-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-4);
        }

        .summary-eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-info-500);
          margin-bottom: var(--space-2);
        }

        .summary-header h3 {
          margin: 0;
          font-size: var(--text-lg);
          font-family: var(--font-display);
        }

        .summary-badge {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-full);
          background: rgba(14, 165, 233, 0.12);
          color: var(--color-info-600);
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .summary-error {
          margin: 0;
          color: var(--color-error-500);
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: var(--space-4);
        }

        .summary-metric {
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .metric-value {
          font-size: var(--text-2xl);
          font-weight: 700;
          font-family: var(--font-display);
        }

        .metric-label {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        .summary-students {
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .students-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        .students-header h4 {
          margin: 0;
          font-size: var(--text-base);
          color: var(--text-primary);
        }

        .students-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .student-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
        }

        .student-name {
          font-weight: 600;
        }

        .student-meta {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .student-drafts {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          font-size: var(--text-sm);
          font-weight: 600;
        }

        .student-drafts small {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .students-empty {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
          padding: var(--space-3);
        }

        @media (max-width: 720px) {
          .summary-header {
            flex-direction: column;
            align-items: flex-start;
          }

          .student-row {
            flex-direction: column;
            align-items: flex-start;
          }

          .student-drafts {
            align-items: flex-start;
          }
        }
      `}</style>
    </section>
  );
};
