import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';

// Entry for the minimal batch frontend.
// Assumes dev is run via `pnpm --filter @esl-pipeline/batch-frontend dev`.
//
// This file intentionally keeps bootstrapping simple: one root, one App.

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
