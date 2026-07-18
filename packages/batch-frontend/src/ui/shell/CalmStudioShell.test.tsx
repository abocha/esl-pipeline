import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { useAssignmentNavigationGuard } from './assignment-navigation-guard';
import { CalmStudioShell } from './CalmStudioShell';

function GuardedAssignment({ allow }: { allow: boolean }) {
  useAssignmentNavigationGuard(async () => allow);
  const location = useLocation();
  return <span data-testid="route">{location.pathname}</span>;
}

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

  it('places the sandbox marker with the account controls in the rail footer', () => {
    const { container } = render(
      <MemoryRouter>
        <CalmStudioShell
          user={{ id: 'sandbox-1', email: 'sandbox@example.test', role: 'user', isActive: true }}
          onLogout={vi.fn()}
          sandboxMode
        >
          Assignment workspace
        </CalmStudioShell>
      </MemoryRouter>,
    );

    const marker = screen.getByLabelText('Frontend sandbox mode');
    expect(marker.closest('.calm-shell__rail-footer')).toBeTruthy();
    expect(container.querySelector('.calm-shell__topbar .calm-shell__sandbox')).toBeNull();
  });

  it('consults the assignment durability guard before workspace SPA navigation', async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <CalmStudioShell
          user={{ id: 'teacher-1', email: 'teacher@example.com', role: 'user', isActive: true }}
          onLogout={vi.fn()}
        >
          <GuardedAssignment allow={false} />
        </CalmStudioShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: /Students/i }));
    await Promise.resolve();
    expect(screen.getByTestId('route').textContent).toBe('/');

    rerender(
      <MemoryRouter initialEntries={['/']}>
        <CalmStudioShell
          user={{ id: 'teacher-1', email: 'teacher@example.com', role: 'user', isActive: true }}
          onLogout={vi.fn()}
        >
          <GuardedAssignment allow />
        </CalmStudioShell>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: /Students/i }));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/students'));
  });

  it('reserves the desktop top row while showing the toolbar only on narrow screens', () => {
    const css = readFileSync(join(process.cwd(), 'src/ui/shell/CalmStudioShell.css'), 'utf8');
    const desktopTopbar = css.match(/\.calm-shell__topbar\s*\{([^}]*)\}/)?.[1];

    expect(css).toContain('grid-template-rows: 58px minmax(0, 1fr)');
    expect(desktopTopbar).toContain('display: none');
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*\.calm-shell__topbar\s*\{[^}]*display:\s*flex/,
    );
  });
});
