import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AssignmentWorkflow } from './AssignmentWorkflow';

describe('AssignmentWorkflow navigation', () => {
  it('does not offer Back on the first step', () => {
    render(
      <AssignmentWorkflow
        steps={[
          { id: 'student', label: 'Student', status: 'current' },
          { id: 'source', label: 'Lesson source', status: 'locked' },
          { id: 'context', label: 'Teaching context', status: 'locked' },
          { id: 'assignment', label: 'Create', status: 'locked' },
          { id: 'review', label: 'Review & share', status: 'locked' },
        ]}
        activeStep="student"
        highestAvailableStep="student"
        saveState="idle"
        onStepRequest={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        continueLabel="Confirm and continue"
      >
        Student content
      </AssignmentWorkflow>,
    );

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeTruthy();
  });

  it('exposes explicit Back and confirmation actions', async () => {
    const onBack = vi.fn();
    const onContinue = vi.fn();
    render(
      <AssignmentWorkflow
        steps={[
          { id: 'student', label: 'Student', status: 'complete' },
          { id: 'source', label: 'Lesson source', status: 'current' },
          { id: 'context', label: 'Teaching context', status: 'locked' },
          { id: 'assignment', label: 'Create', status: 'locked' },
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
          { id: 'assignment', label: 'Create', status: 'complete' },
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

  it('keeps Review free of footer actions until completion is available', () => {
    render(
      <AssignmentWorkflow
        steps={[
          { id: 'student', label: 'Student', status: 'complete' },
          { id: 'source', label: 'Lesson source', status: 'complete' },
          { id: 'context', label: 'Teaching context', status: 'complete' },
          { id: 'assignment', label: 'Create', status: 'complete' },
          { id: 'review', label: 'Review & share', status: 'current' },
        ]}
        activeStep="review"
        highestAvailableStep="review"
        saveState="saved"
        onStepRequest={vi.fn()}
        onBack={vi.fn()}
      >
        Unpublished assignment
      </AssignmentWorkflow>,
    );

    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assignment ready' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start another assignment' })).toBeNull();
  });

  it('places post-completion operations below the footer and before support details', () => {
    const { container } = render(
      <AssignmentWorkflow
        steps={[
          { id: 'student', label: 'Student', status: 'complete' },
          { id: 'source', label: 'Lesson source', status: 'complete' },
          { id: 'context', label: 'Teaching context', status: 'complete' },
          { id: 'assignment', label: 'Create', status: 'complete' },
          { id: 'review', label: 'Review & share', status: 'current' },
        ]}
        activeStep="review"
        highestAvailableStep="review"
        saveState="saved"
        onStepRequest={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
        completionLabel="Start another assignment"
        postFooter={<section aria-label="Advanced actions">Operations</section>}
        support={<div>Support details</div>}
      >
        Published assignment
      </AssignmentWorkflow>,
    );

    const canvas = container.querySelector('.assignment-workflow__canvas')!;
    const footer = container.querySelector('.assignment-workflow__footer')!;
    const postFooter = container.querySelector('.assignment-workflow__post-footer')!;
    const support = container.querySelector('.assignment-workflow__support')!;

    expect(canvas.contains(screen.getByLabelText('Advanced actions'))).toBe(false);
    expect(footer.compareDocumentPosition(postFooter) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(postFooter.compareDocumentPosition(support) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
