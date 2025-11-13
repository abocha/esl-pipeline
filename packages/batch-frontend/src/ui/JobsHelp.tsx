import React from 'react';

/**
 * Developer-focused helper panel.
 *
 * Explains:
 * - How this UI talks to @esl-pipeline/batch-backend.
 * - How to configure base URLs in local dev.
 * - Expected job lifecycle so status values make sense at a glance.
 */
export const JobsHelp: React.FC = () => {
  return (
    <div
      style={{
        border: '1px solid #eee',
        padding: '10px',
        borderRadius: '6px',
        fontSize: '11px',
        color: '#374151',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <strong style={{ fontSize: '12px' }}>How this UI works</strong>
      <ul
        style={{
          paddingLeft: '16px',
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          listStyleType: 'disc',
        }}
      >
        <li>
          Submits jobs via <code>POST /jobs</code> with <code>md</code>, <code>preset</code>,{' '}
          <code>withTts</code>, <code>upload</code>.
        </li>
        <li>
          Loads status via <code>GET /jobs/:jobId</code> and shows <code>state</code>, timestamps,{' '}
          <code>error</code>, and <code>manifestPath</code>.
        </li>
        <li>
          In dev, calls <code>/jobs</code> directly; Vite proxies these to the local batch-backend
          (default <code>http://localhost:8080</code>).
        </li>
        <li>
          To override the backend URL:
          <ul
            style={{
              paddingLeft: '14px',
              margin: 0,
              listStyleType: 'circle',
              display: 'flex',
              flexDirection: 'column',
              gap: '1px',
            }}
          >
            <li>
              Set <code>VITE_BATCH_BACKEND_URL</code> when building, or
            </li>
            <li>
              Define <code>window.__BATCH_BACKEND_URL__</code> before loading the bundle.
            </li>
          </ul>
        </li>
        <li>
          Expected states:
          <code>queued</code> → <code>running</code> → <code>succeeded</code> / <code>failed</code>.
        </li>
      </ul>
      <div style={{ marginTop: '4px', color: '#6b7280' }}>
        For deeper behavior and env details, see <code>packages/batch-backend/README.md</code> and{' '}
        <code>docs/batch-backend-ssot.md</code> in this repo.
      </div>
    </div>
  );
};
