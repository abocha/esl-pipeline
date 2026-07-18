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
          { id: 'assignment', label: 'Create', status: 'locked' },
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
    expect(css).toContain('min-height: var(--cs-control-primary)');
  });

  it('does not use off-screen positioning to hide inactive workflow steps', () => {
    const cssPath = join(process.cwd(), 'src/ui/assignments/AssignmentWorkflow.css');
    const css = readFileSync(cssPath, 'utf8');

    expect(css).not.toContain(".assignment-workflow__step-mount[data-active='false']");
    expect(css).not.toContain('left: -100000px');
  });

  it('sticks desktop progress to the viewport top after the desktop toolbar is removed', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/ui/assignments/AssignmentWorkflow.css'),
      'utf8',
    );
    const progressRule = css.match(/\.assignment-workflow__progress\s*\{([^}]*)\}/)?.[1];

    expect(progressRule).toContain('position: sticky');
    expect(progressRule).toContain('top: 0');
  });

  it('defines a calm studio surface and wrapping quick controls for advanced actions', () => {
    const cssPath = join(process.cwd(), 'src/ui/assignments/AssignmentWorkflow.css');
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('.assignment-advanced-actions {');
    expect(css).toContain('.assignment-advanced-actions__quick {');
    expect(css).toContain('.assignment-advanced-actions :is(input, select) {');
    expect(css).toContain('border-radius: var(--cs-radius-control)');
  });

  it('uses complete card borders instead of workflow divider rules', () => {
    const workflowCssPath = join(process.cwd(), 'src/ui/assignments/AssignmentWorkflow.css');
    const workflowCss = readFileSync(workflowCssPath, 'utf8');
    const footerRule = workflowCss.match(/\.assignment-workflow__footer\s*\{([^}]*)\}/)?.[1];

    expect(footerRule).not.toContain('border-top');
    expect(workflowCss).toContain('.assignment-workflow__support .support-details {');
    expect(workflowCss).toMatch(
      /\.assignment-workflow__support \.support-details\s*\{[^}]*border-top:\s*0/,
    );

    const minimalCssPath = join(process.cwd(), 'src/ui/minimal/MinimalAssignment.css');
    const minimalCss = readFileSync(minimalCssPath, 'utf8');

    expect(minimalCss).toContain(
      '.minimal-stage-panel:first-child:not(.assignment-advanced-actions)',
    );
  });

  it('keeps resume status in a fixed rail and stacks rows on narrow screens', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/ui/assignments/AssignmentWorkflow.css'),
      'utf8',
    );
    const rowRule = css.match(/\.assignment-entry-step__recent-row\s*\{([^}]*)\}/)?.[1];

    expect(rowRule).toContain(
      'grid-template-columns: 20px minmax(150px, 0.75fr) minmax(220px, 1.35fr) 156px',
    );
    expect(css).toContain('.assignment-entry-step__version-pill:hover');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(
      /@media \(max-width: 620px\)[\s\S]*\.assignment-entry-step__recent-row[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/,
    );
  });
});
