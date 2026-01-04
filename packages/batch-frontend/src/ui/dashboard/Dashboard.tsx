import React from 'react';

import { NotificationsPanel } from '../notifications/NotificationsPanel';
import { ActivityFeed } from '../jobs/ActivityFeed';
import { PendingApprovals } from './PendingApprovals';
import { QuickActions } from './QuickActions';
import { WeeklySummary } from './WeeklySummary';

export const Dashboard: React.FC = () => {
  return (
    <div className="dashboard-shell">
      <div className="dashboard-hero animate-fade-in-up">
        <div>
          <p className="dashboard-eyebrow">Dashboard</p>
          <h2>Your ESL command center</h2>
          <p className="dashboard-subtitle">
            Track approvals, keep students on pace, and launch new assignments from one place.
          </p>
        </div>
        <div className="dashboard-orbit" />
      </div>

      <QuickActions />

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <ActivityFeed />
        </div>
        <div className="dashboard-side">
          <PendingApprovals />
          <NotificationsPanel />
        </div>
      </div>

      <WeeklySummary />

      <style>{`
        .dashboard-shell {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .dashboard-hero {
          position: relative;
          padding: var(--space-8);
          border-radius: var(--radius-3xl);
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(14, 165, 233, 0.08));
          border: 1px solid rgba(99, 102, 241, 0.2);
          overflow: hidden;
        }

        .dashboard-eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--color-primary-500);
          margin-bottom: var(--space-2);
        }

        .dashboard-hero h2 {
          margin: 0 0 var(--space-2);
          font-size: var(--text-3xl);
          font-family: var(--font-display);
        }

        .dashboard-subtitle {
          margin: 0;
          color: var(--text-secondary);
          max-width: 520px;
        }

        .dashboard-orbit {
          position: absolute;
          top: -40px;
          right: -20px;
          width: 180px;
          height: 180px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.25), transparent 70%);
          filter: blur(2px);
          animation: float 6s ease-in-out infinite;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
          gap: var(--space-5);
        }

        .dashboard-main,
        .dashboard-side {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        @media (max-width: 1024px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .dashboard-hero {
            padding: var(--space-6);
          }

          .dashboard-hero h2 {
            font-size: var(--text-2xl);
          }
        }
      `}</style>
    </div>
  );
};
