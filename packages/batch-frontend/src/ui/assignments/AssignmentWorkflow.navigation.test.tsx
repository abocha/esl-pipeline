import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AssignmentWorkflow } from './AssignmentWorkflow';

describe('AssignmentWorkflow navigation', () => {
  it('exposes explicit Back and confirmation actions', async () => {
    const onBack = vi.fn();
    const onContinue = vi.fn();
    render(
      <AssignmentWorkflow
        steps={[
          { id: 'student', label: 'Student', status: 'complete' },
          { id: 'source', label: 'Lesson source', status: 'current' },
          { id: 'context', label: 'Teaching context', status: 'locked' },
          { id: 'create', label: 'Create', status: 'locked' },
          { id: 'review', label: 'Review & share', status: 'locked' },
        ]}
        activeStep="source"
        highestAvailableStep="source"
        saveState="saving"
        onStepRequest={vi.fn()}
        onBack={onBack}
        onContinue={onContinue}
        continueLabel="Confirm and continue"
      >
        Content
      </AssignmentWorkflow>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saving…')).toBeTruthy();
  });

  it('shows an explicit completion action without a dead Review continuation', async () => {
    const onComplete = vi.fn();
    render(
      <AssignmentWorkflow
        steps={[
          { id: 'student', label: 'Student', status: 'complete' },
          { id: 'source', label: 'Lesson source', status: 'complete' },
          { id: 'context', label: 'Teaching context', status: 'complete' },
          { id: 'create', label: 'Create', status: 'complete' },
          { id: 'review', label: 'Review & share', status: 'current' },
        ]}
        activeStep="review"
        highestAvailableStep="review"
        saveState="saved"
        onStepRequest={vi.fn()}
        onBack={vi.fn()}
        onComplete={onComplete}
        completionLabel="Start another assignment"
      >
        Published assignment
      </AssignmentWorkflow>,
    );

    expect(screen.queryByRole('button', { name: 'Assignment ready' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Start another assignment' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
