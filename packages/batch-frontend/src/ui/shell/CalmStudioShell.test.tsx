import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CalmStudioShell } from './CalmStudioShell';

describe('CalmStudioShell', () => {
  it('renders the ESL mark and workspace navigation', () => {
    const { container } = render(
      <MemoryRouter>
        <CalmStudioShell
          user={{ id: 'teacher-1', email: 'teacher@example.com', role: 'user', isActive: true }}
          onLogout={vi.fn()}
        >
          Assignment workspace
        </CalmStudioShell>
      </MemoryRouter>,
    );

    expect(screen.getByText('ESL')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Assignments/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Students/i }).getAttribute('href')).toBe('/students');
    expect(screen.getByRole('link', { name: /Business/i }).getAttribute('href')).toBe('/business');
    expect(screen.getByRole('link', { name: /Assignment Templates/i }).getAttribute('href')).toBe(
      '/prompts',
    );
    expect(screen.getByRole('button', { name: /Open workspace menu/i })).toBeTruthy();
    for (const icon of container.querySelectorAll('nav svg, button svg')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
