import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssignmentWorkflow } from './AssignmentWorkflow';

describe('AssignmentWorkflow responsive contract', () => {
  it('keeps one focused canvas and accessible navigation at every width', () => {
    const { container } = render(
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
        saveState="saved"
        onStepRequest={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        continueLabel="Confirm and continue"
      >
        Active source form
      </AssignmentWorkflow>,
    );

    expect(screen.getByRole('navigation', { name: 'Assignment progress' })).toBeTruthy();
    expect(container.querySelectorAll('.assignment-workflow__canvas')).toHaveLength(1);
    expect(
      container.querySelectorAll('button:not([aria-label]) svg:not([aria-hidden="true"])'),
    ).toHaveLength(0);
  });

  it('defines tablet and narrow layout breakpoints', () => {
    const cssPath = join(process.cwd(), 'src/ui/assignments/AssignmentWorkflow.css');
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('@media (max-width: 620px)');
    expect(css).toContain('grid-template-columns: 1fr');
  });

  it('defines a calm studio surface and wrapping quick controls for advanced actions', () => {
    const cssPath = join(process.cwd(), 'src/ui/assignments/AssignmentWorkflow.css');
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('.assignment-advanced-actions {');
    expect(css).toContain('.assignment-advanced-actions__quick {');
    expect(css).toContain('.assignment-advanced-actions :is(input, select) {');
    expect(css).toContain('border-radius: var(--cs-radius-control)');
  });
});
