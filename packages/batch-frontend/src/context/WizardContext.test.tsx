import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { MemoryRouter, useSearchParams } from 'react-router-dom';

import { AuthContext } from './AuthContext';
import { useWizard, useWizardRouting, WizardProvider } from './WizardContext';

const STEP_KEYS = ['select', 'transcript', 'notes', 'review', 'publish'];
const USER_ID = 'u1';
const STORAGE_KEY = `esl-wizard-state:${USER_ID}`;

const Harness = () => {
  useWizardRouting(STEP_KEYS);
  const { state, actions } = useWizard();
  const [searchParams] = useSearchParams();

  return (
    <div>
      <div data-testid="current-step">{state.currentStep}</div>
      <div data-testid="active-job">{state.activeJobId ?? 'none'}</div>
      <div data-testid="step-param">{searchParams.get('step') ?? 'none'}</div>
      <button type="button" onClick={() => actions.goToStep(4)}>
        Go publish
      </button>
    </div>
  );
};

describe('WizardContext routing', () => {
  afterEach(() => {
    cleanup();
  });

  it('hydrates state from deep link params', async () => {
    render(
      <MemoryRouter initialEntries={['/wizard?step=notes&jobId=job-1']}>
        <AuthContext.Provider
          value={{
            user: { id: 'u1', email: 'test@example.com', role: 'user', isActive: true },
            isAuthenticated: true,
            isLoading: false,
            login: async () => {},
            register: async () => {},
            logout: async () => {},
            refresh: async () => {},
            setUserFromProfile: () => {},
          }}
        >
          <WizardProvider>
            <Harness />
          </WizardProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-step').textContent).toBe('2');
      expect(screen.getByTestId('active-job').textContent).toBe('job-1');
    });
  });

  it('syncs state changes back to URL', async () => {
    render(
      <MemoryRouter initialEntries={['/wizard?step=select']}>
        <AuthContext.Provider
          value={{
            user: { id: 'u1', email: 'test@example.com', role: 'user', isActive: true },
            isAuthenticated: true,
            isLoading: false,
            login: async () => {},
            register: async () => {},
            logout: async () => {},
            refresh: async () => {},
            setUserFromProfile: () => {},
          }}
        >
          <WizardProvider>
            <Harness />
          </WizardProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go publish' }));

    await waitFor(() => {
      expect(screen.getByTestId('step-param').textContent).toBe('publish');
    });
  });
});

describe('WizardContext persistence', () => {
  afterEach(() => {
    globalThis.localStorage.clear();
    cleanup();
  });

  it('hydrates wizard state from localStorage', async () => {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      state: {
        currentStep: 2,
        activeJobId: 'job-123',
        jobState: null,
        jobMd: null,
        recordingId: null,
        transcriptId: null,
        transcriptText: '',
        transcriptSkipped: false,
        promptPackageId: null,
        draftId: null,
        draftText: '',
        notes: 'remember this',
        templateId: '',
        profileId: '',
        overrides: {
          preset: undefined,
          notionDatabase: undefined,
          withTts: undefined,
          forceTts: undefined,
          ttsStrategy: undefined,
          upload: 'auto',
          voiceId: undefined,
          voiceAccent: undefined,
        },
      },
    };
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    render(
      <MemoryRouter initialEntries={['/wizard']}>
        <AuthContext.Provider
          value={{
            user: { id: USER_ID, email: 'test@example.com', role: 'user', isActive: true },
            isAuthenticated: true,
            isLoading: false,
            login: async () => {},
            register: async () => {},
            logout: async () => {},
            refresh: async () => {},
            setUserFromProfile: () => {},
          }}
        >
          <WizardProvider>
            <Harness />
          </WizardProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-step').textContent).toBe('2');
      expect(screen.getByTestId('active-job').textContent).toBe('job-123');
    });
  });

  it('persists wizard state updates', async () => {
    const PersistenceHarness = () => {
      const { state, dispatch } = useWizard();
      return (
        <div>
          <div data-testid="notes">{state.notes || 'empty'}</div>
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_NOTES', payload: 'saved notes' })}
          >
            Save notes
          </button>
        </div>
      );
    };

    render(
      <MemoryRouter initialEntries={['/wizard']}>
        <AuthContext.Provider
          value={{
            user: { id: USER_ID, email: 'test@example.com', role: 'user', isActive: true },
            isAuthenticated: true,
            isLoading: false,
            login: async () => {},
            register: async () => {},
            logout: async () => {},
            refresh: async () => {},
            setUserFromProfile: () => {},
          }}
        >
          <WizardProvider>
            <PersistenceHarness />
          </WizardProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));

    await waitFor(() => {
      const stored = globalThis.localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.state.notes).toBe('saved notes');
    });
  });
});
