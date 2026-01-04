import React from 'react';
import { useNavigate } from 'react-router-dom';

const SparkIcon = () => (
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
    <path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 21l-2.5-7.5L3 11l6.5-2.5L12 2z" />
  </svg>
);

const UploadIcon = () => (
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
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const FolderIcon = () => (
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
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const SlidersIcon = () => (
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
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

const actions = [
  {
    title: 'New Assignment',
    description: 'Upload audio or markdown to start a new job.',
    path: '/wizard',
    tone: 'primary',
    icon: <SparkIcon />,
  },
  {
    title: 'Recent Jobs',
    description: 'Review the latest runs and approvals.',
    path: '/jobs',
    tone: 'secondary',
    icon: <UploadIcon />,
  },
  {
    title: 'Students',
    description: 'Manage profiles and timelines.',
    path: '/students',
    tone: 'secondary',
    icon: <FolderIcon />,
  },
  {
    title: 'Settings',
    description: 'Tune presets and output options.',
    path: '/settings',
    tone: 'secondary',
    icon: <SlidersIcon />,
  },
];

export const QuickActions: React.FC = () => {
  const navigate = useNavigate();

  return (
    <section className="quick-actions animate-fade-in-up">
      <header className="quick-actions-header">
        <div>
          <p className="quick-actions-eyebrow">Quick Actions</p>
          <h2>Move fast with guided workflows</h2>
        </div>
        <button type="button" className="btn-ghost" onClick={() => navigate('/wizard')}>
          Start wizard
        </button>
      </header>
      <div className="quick-actions-grid">
        {actions.map((action) => (
          <button
            key={action.title}
            type="button"
            className={`quick-action-card ${action.tone}`}
            onClick={() => navigate(action.path)}
          >
            <div className="quick-action-icon">{action.icon}</div>
            <div className="quick-action-content">
              <h3>{action.title}</h3>
              <p>{action.description}</p>
            </div>
          </button>
        ))}
      </div>

      <style>{`
        .quick-actions {
          padding: var(--space-6);
          border-radius: var(--radius-2xl);
          background: var(--gradient-glass);
          border: 1px solid var(--border-light);
          box-shadow: var(--shadow-card);
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .quick-actions-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-4);
        }

        .quick-actions-eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-primary-500);
          margin-bottom: var(--space-2);
        }

        .quick-actions-header h2 {
          font-size: var(--text-2xl);
          font-family: var(--font-display);
          margin: 0;
        }

        .quick-actions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: var(--space-4);
        }

        .quick-action-card {
          display: flex;
          gap: var(--space-3);
          align-items: flex-start;
          padding: var(--space-4);
          border-radius: var(--radius-xl);
          border: 1px solid transparent;
          background: var(--bg-primary);
          text-align: left;
          cursor: pointer;
          transition: transform var(--transition-base), box-shadow var(--transition-base), border var(--transition-base);
        }

        .quick-action-card:hover {
          transform: translateY(-2px);
          border-color: var(--border-medium);
          box-shadow: var(--shadow-card-hover);
        }

        .quick-action-card.primary {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(14, 165, 233, 0.12));
          border-color: rgba(99, 102, 241, 0.35);
        }

        .quick-action-icon {
          width: 44px;
          height: 44px;
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-primary-600);
          background: rgba(99, 102, 241, 0.15);
        }

        .quick-action-card.primary .quick-action-icon {
          background: var(--gradient-primary);
          color: white;
        }

        .quick-action-content h3 {
          margin: 0;
          font-size: var(--text-base);
          font-weight: 600;
        }

        .quick-action-content p {
          margin: var(--space-1) 0 0;
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        @media (max-width: 720px) {
          .quick-actions-header {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </section>
  );
};
