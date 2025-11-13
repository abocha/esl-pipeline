import React, { useState } from 'react';
import { JobForm } from './JobForm';
import { JobStatusViewer } from './JobStatusViewer';
import { JobsHelp } from './JobsHelp';

/**
 * Root App component for the minimal batch-frontend.
 *
 * Goals:
 * - Provide a simple, developer-friendly UI to:
 *   - Submit new jobs to POST /jobs
 *   - Inspect job status via GET /jobs/:jobId
 * - Keep everything local, with configuration via:
 *   - Vite dev proxy (for /jobs)
 *   - BATCH_BACKEND_URL env (for direct fetch when not proxied)
 *
 * NOTE:
 * - This is intentionally minimal; no routing library or complex state management.
 */

export const App: React.FC = () => {
  const [lastJobId, setLastJobId] = useState<string | null>(null);

  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        padding: '16px',
        maxWidth: '960px',
        margin: '0 auto',
      }}
    >
      <header style={{ marginBottom: '16px' }}>
        <h1
          style={{
            fontSize: '20px',
            margin: 0,
            fontWeight: 600,
          }}
        >
          ESL Pipeline Batch Jobs
        </h1>
        <p style={{ margin: '4px 0 0', color: '#555', fontSize: '13px' }}>
          Local, minimal UI for @esl-pipeline/batch-backend. Submit jobs, inspect status, and
          surface errors.
        </p>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)',
          gap: '16px',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <JobForm
            onJobCreated={jobId => {
              setLastJobId(jobId);
            }}
          />
          <div style={{ marginTop: '16px' }}>
            <JobStatusViewer lastJobId={lastJobId} />
          </div>
        </div>

        <aside>
          <JobsHelp />
        </aside>
      </section>
    </div>
  );
};
