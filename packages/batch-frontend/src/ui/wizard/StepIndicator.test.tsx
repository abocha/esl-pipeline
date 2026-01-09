import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import { StepIndicator } from './StepIndicator';

describe('StepIndicator', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders current step label and custom icons', () => {
    render(
      <StepIndicator
        currentStep={2}
        totalSteps={3}
        steps={[
          { label: 'First', icon: <span data-testid="icon-first" /> },
          { label: 'Second', icon: <span data-testid="icon-second" /> },
          { label: 'Third', icon: <span data-testid="icon-third" /> },
        ]}
      />,
    );

    expect(screen.getByText('Second')).not.toBeNull();
    expect(screen.getByTestId('icon-second')).not.toBeNull();
    expect(screen.getByTestId('icon-third')).not.toBeNull();
    expect(screen.queryByTestId('icon-first')).toBeNull();
  });
});
