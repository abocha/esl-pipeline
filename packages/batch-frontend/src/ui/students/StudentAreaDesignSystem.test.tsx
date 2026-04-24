import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  StudentAreaActionLink,
  StudentAreaDesignSystemStyles,
  StudentAreaEmptyState,
  StudentAreaFrame,
  StudentAreaMetricCard,
  StudentAreaNote,
  StudentAreaPanel,
  StudentAreaSectionLabel,
  StudentAreaSkeleton,
  StudentAreaStatusPill,
} from './StudentAreaDesignSystem';

describe('StudentAreaDesignSystem', () => {
  it('provides shared student-area primitives with stable classes', () => {
    render(
      <MemoryRouter>
        <StudentAreaDesignSystemStyles />
        <StudentAreaFrame>Frame body</StudentAreaFrame>
        <StudentAreaPanel tone="attention">Panel body</StudentAreaPanel>
        <StudentAreaSectionLabel>Profile state</StudentAreaSectionLabel>
        <StudentAreaMetricCard eyebrow="Revision" value="Active" detail="v1" tone="success" />
        <StudentAreaStatusPill tone="warning">Needs review</StudentAreaStatusPill>
        <StudentAreaEmptyState>
          <h2>Nothing here yet</h2>
        </StudentAreaEmptyState>
        <StudentAreaSkeleton className="skeleton-line" />
        <StudentAreaNote>Small, regular steps create real progress.</StudentAreaNote>
        <StudentAreaActionLink to="/students/student-alex/learning">Open Learning</StudentAreaActionLink>
      </MemoryRouter>,
    );

    expect(screen.getByText('Frame body').className).toContain('student-area-frame');
    expect(screen.getByText('Panel body').className).toContain('student-area-panel');
    expect(screen.getByText('Panel body').className).toContain('student-area-panel-attention');
    expect(screen.getByText('Profile state').className).toContain('student-area-section-label');
    expect(screen.getByText('Revision')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByText('Needs review').className).toContain('student-area-status-pill-warning');
    expect(screen.getByText('Nothing here yet').parentElement?.className).toContain(
      'student-area-empty-state',
    );
    expect(document.querySelector('.student-area-skeleton')).toBeTruthy();
    expect(screen.getByText('Small, regular steps create real progress.').className).toContain(
      'student-area-note',
    );
    expect(screen.getByRole('link', { name: 'Open Learning' }).getAttribute('href')).toBe(
      '/students/student-alex/learning',
    );
    expect(document.querySelector('[data-student-area-design-system="true"]')).toBeTruthy();
  });
});
