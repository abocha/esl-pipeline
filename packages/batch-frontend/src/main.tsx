import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';

import { AuthProvider } from './context/AuthContext';
import { App } from './ui/App';

// Entry for the minimal batch frontend.
// Assumes dev is run via `pnpm --filter @esl-pipeline/batch-frontend dev`.
//
// This file intentionally keeps bootstrapping simple: one root, one App.

const queryClient = new QueryClient();

ReactDOM.createRoot(document.querySelector('#root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '14px',
            },
          }}
        />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
