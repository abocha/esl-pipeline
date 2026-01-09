import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { MemoryRouter, useSearchParams } from 'react-router-dom';

import { useWizard, useWizardRouting, WizardProvider } from './WizardContext';

const STEP_KEYS = ['select', 'transcript', 'notes', 'review', 'publish'];

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
        <WizardProvider>
          <Harness />
        </WizardProvider>
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
        <WizardProvider>
          <Harness />
        </WizardProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go publish' }));

    await waitFor(() => {
      expect(screen.getByTestId('step-param').textContent).toBe('publish');
    });
  });
});
