import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AssignmentWorkflow } from './AssignmentWorkflow';
import type { AssignmentWorkflowStep } from './assignment-workflow';

const steps: AssignmentWorkflowStep[] = [
  { id: 'student', label: 'Student', status: 'complete' },
  { id: 'source', label: 'Lesson source', status: 'current' },
  { id: 'context', label: 'Teaching context', status: 'locked' },
  { id: 'assignment', label: 'Create', status: 'locked' },
  { id: 'review', label: 'Review & share', status: 'locked' },
];

describe('AssignmentWorkflow', () => {
  it('renders semantic progress and focused content', () => {
    render(
      <AssignmentWorkflow
        steps={steps}
        activeStep="source"
        highestAvailableStep="source"
        saveState="saved"
        onStepRequest={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        continueLabel="Confirm and continue"
      >
        Lesson source content
      </AssignmentWorkflow>,
    );
    expect(screen.getByRole('navigation', { name: 'Assignment progress' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Lesson source/i }).getAttribute('aria-current'),
    ).toBe('step');
    expect(
      (screen.getByRole('button', { name: /Teaching context/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Lesson source content')).toBeTruthy();
  });

  it('keeps save status without repeating the active step in a page header', () => {
    render(
      <AssignmentWorkflow
        steps={steps}
        activeStep="source"
        highestAvailableStep="source"
        saveState="saved"
        onStepRequest={vi.fn()}
        onBack={vi.fn()}
      >
        Lesson source content
      </AssignmentWorkflow>,
    );

    expect(screen.getByRole('region', { name: 'Assignment builder' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('All changes saved');
    expect(screen.queryByText('Assignment builder')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Lesson source' })).toBeNull();
  });

  it('keeps the selected student visible in the workflow context', () => {
    render(
      <AssignmentWorkflow
        steps={steps}
        activeStep="source"
        highestAvailableStep="source"
        saveState="saved"
        studentName="Yulia G"
        onStepRequest={vi.fn()}
        onBack={vi.fn()}
      >
        Lesson source content
      </AssignmentWorkflow>,
    );

    expect(screen.getByText('Assignment for Yulia G')).toBeTruthy();
  });

  it('allows returning to a completed step without discarding work', async () => {
    const onStepRequest = vi.fn();
    render(
      <AssignmentWorkflow
        steps={steps}
        activeStep="source"
        highestAvailableStep="source"
        saveState="idle"
        onStepRequest={onStepRequest}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        continueLabel="Confirm and continue"
      >
        Content
      </AssignmentWorkflow>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Student/i }));
    expect(onStepRequest).toHaveBeenCalledWith('student');
  });
});
