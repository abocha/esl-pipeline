import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryRouter,
  MemoryRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { useAssignmentNavigationGuard } from './assignment-navigation-guard';
import { CalmStudioShell } from './CalmStudioShell';

function GuardedAssignment({ allow }: { allow: boolean }) {
  useAssignmentNavigationGuard(async () => allow);
  const location = useLocation();
  return <span data-testid="route">{location.pathname}</span>;
}

describe('CalmStudioShell', () => {
  it('renders the compact brand and admin workspace navigation', () => {
    const { container } = render(
      <MemoryRouter>
        <CalmStudioShell
          user={{ id: 'admin-1', email: 'admin@example.com', role: 'admin', isActive: true }}
          onLogout={vi.fn()}
        >
          Assignment workspace
        </CalmStudioShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Administration' })).toBeTruthy();
    expect(container.querySelector('.calm-shell__brand')?.textContent).toBe('ESL Pipeline');
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Assignments/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Students/i }).getAttribute('href')).toBe('/students');
    expect(screen.getByRole('link', { name: /Business/i }).getAttribute('href')).toBe('/business');
    expect(screen.getByRole('link', { name: /Prompts/i }).getAttribute('href')).toBe(
      '/admin/prompts',
    );
    expect(screen.getByRole('button', { name: /Open workspace menu/i })).toBeTruthy();
    for (const icon of container.querySelectorAll('nav svg, button svg')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it.each(['user', 'viewer'] as const)('hides Prompts for the %s role', (role) => {
    render(
      <MemoryRouter>
        <CalmStudioShell
          user={{ id: `${role}-1`, email: `${role}@example.com`, role, isActive: true }}
          onLogout={vi.fn()}
        >
          Assignment workspace
        </CalmStudioShell>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /Prompts/i })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Administration' })).toBeNull();
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

  it('blocks router history navigation while assignment recovery is unsafe', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <CalmStudioShell
              user={{ id: 'teacher-1', email: 'teacher@example.com', role: 'user', isActive: true }}
              onLogout={vi.fn()}
            >
              <GuardedAssignment allow={false} />
              <Outlet />
            </CalmStudioShell>
          ),
          children: [
            { index: true, element: <span>Assignments route</span> },
            { path: 'students', element: <span>Students route</span> },
          ],
        },
      ],
      { initialEntries: ['/students', '/'], initialIndex: 1 },
    );
    render(<RouterProvider router={router} />);

    await router.navigate(-1);
    await Promise.resolve();

    expect(router.state.location.pathname).toBe('/');
  });

  it('guards logout with the assignment durability decision', async () => {
    const onLogout = vi.fn();
    render(
      <MemoryRouter>
        <CalmStudioShell
          user={{ id: 'teacher-1', email: 'teacher@example.com', role: 'user', isActive: true }}
          onLogout={onLogout}
        >
          <GuardedAssignment allow={false} />
        </CalmStudioShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Logout/i }));
    await Promise.resolve();

    expect(onLogout).not.toHaveBeenCalled();
  });
});
