import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';

import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import './index.css';
import { App } from './ui/App';

// Entry for the ESL Pipeline batch frontend.
// Assumes dev is run via `pnpm --filter @esl-pipeline/batch-frontend dev`.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 2,
    },
  },
});

ReactDOM.createRoot(document.querySelector('#root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <App />
          <Toaster
            position="bottom-right"
            toastOptions={{
              duration: 4000,
              style: {
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                borderRadius: 'var(--radius-xl)',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--border-light)',
                padding: 'var(--space-3) var(--space-4)',
              },
              success: {
                iconTheme: {
                  primary: 'var(--color-success-500)',
                  secondary: 'white',
                },
              },
              error: {
                iconTheme: {
                  primary: 'var(--color-error-500)',
                  secondary: 'white',
                },
              },
            }}
          />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
