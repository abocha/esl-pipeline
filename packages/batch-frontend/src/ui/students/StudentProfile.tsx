import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  getStudentProfile,
  getStudentTimeline,
  type StudentProfile as StudentProfileType,
  type StudentTimelineItem,
} from '../../utils/api';

const formatTimestamp = (value?: string | null) => {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const getTimelineLabel = (item: StudentTimelineItem) => {
  if (item.displayName) return item.displayName;
  return item.type.replaceAll('_', ' ');
};

export const StudentProfile: React.FC = () => {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<StudentProfileType | null>(null);
  const [timelineItems, setTimelineItems] = useState<StudentTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      if (!studentId) {
        setError('Missing student id.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [profileResponse, timelineResponse] = await Promise.all([
          getStudentProfile(studentId),
          getStudentTimeline(studentId, { limit: 30, order: 'desc' }),
        ]);
        if (!active) return;
        setProfile(profileResponse);
        setTimelineItems(timelineResponse.items ?? []);
      } catch (loadError) {
        if (!active) return;
        const message =
          loadError instanceof Error ? loadError.message : 'Unable to load student profile.';
        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      active = false;
    };
  }, [studentId]);

  const metrics = useMemo(() => {
    const pendingDrafts = timelineItems.filter((item) => item.type === 'draft_saved').length;
    const recentErrors = timelineItems.filter((item) => item.status === 'failed').length;
    const lastActivity = timelineItems[0]?.createdAt ?? null;
    return { pendingDrafts, recentErrors, lastActivity };
  }, [timelineItems]);

  return (
    <div className="student-profile-page">
      <header className="profile-header">
        <div>
          <p className="eyebrow">Student Hub</p>
          <h2>{profile?.student ?? 'Student profile'}</h2>
          <p className="muted">Detail view and history.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/students')}>
          Back to students
        </button>
      </header>

      {loading ? (
        <div className="profile-loading card">
          <div className="spinner" />
          <span>Loading profile...</span>
        </div>
      ) : error ? (
        <div className="profile-error card">
          <p className="error-text">{error}</p>
        </div>
      ) : (
        <div className="profile-grid">
          <section className="card profile-card">
            <header>
              <h3>Overview</h3>
            </header>
            <div className="overview-grid">
              <div>
                <span className="label">Student ID</span>
                <span className="value mono">{profile?.id ?? '--'}</span>
              </div>
              <div>
                <span className="label">Profile ID</span>
                <span className="value">{profile?.profileId ?? '--'}</span>
              </div>
              <div>
                <span className="label">Notion DB</span>
                <span className="value">{profile?.dbId ?? '--'}</span>
              </div>
              <div>
                <span className="label">Manifest preset</span>
                <span className="value">{profile?.manifestPreset ?? '--'}</span>
              </div>
              <div>
                <span className="label">Accent</span>
                <span className="value">{profile?.accentPreference ?? '--'}</span>
              </div>
              <div>
                <span className="label">Last activity</span>
                <span className="value">{formatTimestamp(metrics.lastActivity)}</span>
              </div>
            </div>
            <div className="metrics-row">
              <div className="metric">
                <span className="metric-value">{metrics.pendingDrafts}</span>
                <span className="metric-label">Drafts pending</span>
              </div>
              <div className="metric">
                <span className="metric-value">{metrics.recentErrors}</span>
                <span className="metric-label">Recent errors</span>
              </div>
            </div>
          </section>

          <section className="card profile-card">
            <header>
              <h3>Focus areas</h3>
            </header>
            <p className="muted">
              Focus, goals, and vocabulary tracking will appear here once the backend provides
              student detail metadata.
            </p>
          </section>

          <section className="card profile-card">
            <header>
              <h3>Vocabulary log</h3>
            </header>
            <p className="muted">
              Vocabulary growth and mastery signals are not yet available in the API.
            </p>
          </section>

          <section className="card profile-card timeline-card">
            <header>
              <h3>Recent timeline</h3>
            </header>
            {timelineItems.length === 0 ? (
              <p className="muted">No history yet.</p>
            ) : (
              <ul className="timeline-list">
                {timelineItems.slice(0, 12).map((item) => (
                  <li
                    key={`${item.type}-${item.createdAt}-${item.jobId ?? item.recordingId ?? item.transcriptId ?? item.draftId ?? 'n/a'}`}
                    className="timeline-item"
                  >
                    <div>
                      <span className="timeline-label">{getTimelineLabel(item)}</span>
                      <span className="timeline-meta">
                        {item.status ?? 'ok'} · {item.type.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <span className="timeline-time">{formatTimestamp(item.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <style>{`
        .student-profile-page {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .profile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-4);
          flex-wrap: wrap;
        }

        .profile-header h2 {
          margin: 0;
          font-size: var(--text-2xl);
        }

        .profile-loading,
        .profile-error {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-4);
        }

        .profile-grid {
          display: grid;
          gap: var(--space-4);
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }

        .profile-card header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--space-2);
        }

        .overview-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: var(--space-3);
        }

        .label {
          display: block;
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
        }

        .value {
          font-size: var(--text-sm);
          color: var(--text-primary);
        }

        .value.mono {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
        }

        .metrics-row {
          display: flex;
          gap: var(--space-4);
          margin-top: var(--space-3);
        }

        .metric {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .metric-value {
          font-size: var(--text-lg);
          font-weight: 600;
        }

        .metric-label {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .timeline-card {
          grid-column: 1 / -1;
        }

        .timeline-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .timeline-item {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-3);
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
        }

        .timeline-label {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .timeline-meta {
          display: block;
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .timeline-time {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          white-space: nowrap;
        }

        @media (max-width: 720px) {
          .profile-header {
            align-items: flex-start;
          }

          .metrics-row {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
};
