import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { WorkshopShell } from './WorkshopShell';
import * as viewportHook from '../utils/useViewport';

vi.mock('../ui/rail/WorkContextPanel', () => ({
  WorkContextPanel: () => <div data-testid="work-context-panel" />,
}));

vi.mock('../ui/rail/NotificationLedger', () => ({
  NotificationLedger: () => <div data-testid="notification-ledger" />,
}));

const mockUser = {
  id: 'u1',
  email: 'tutor@example.com',
  role: 'user' as const,
  isActive: true,
};

const renderShell = () => {
  return render(
    <MemoryRouter>
      <WorkshopShell
        user={mockUser}
        theme="light"
        onToggleTheme={vi.fn()}
        onOpenProfile={vi.fn()}
        onLogout={vi.fn()}
      >
        <div>Content</div>
      </WorkshopShell>
    </MemoryRouter>,
  );
};

describe('WorkshopShell', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toggles rail state on tablet', () => {
    vi.spyOn(viewportHook, 'useViewport').mockReturnValue('tablet');
    const { container } = renderShell();

    const shell = container.querySelector('.workshop-shell') as HTMLElement;
    expect(shell.dataset.rail).toBe('peek');

    const toggle = screen.getByRole('button', { name: 'Pin' });
    fireEvent.click(toggle);

    expect(shell.dataset.rail).toBe('pinned');
    expect(screen.getByRole('button', { name: 'Peek' })).not.toBeNull();
  });

  it('opens and closes rail on mobile', () => {
    vi.spyOn(viewportHook, 'useViewport').mockReturnValue('mobile');
    const { container } = renderShell();

    const shell = container.querySelector('.workshop-shell') as HTMLElement;
    expect(shell.dataset.railOpen).toBe('false');

    const openButton = screen.getByRole('button', { name: 'Open context and ledger' });
    fireEvent.click(openButton);

    expect(shell.dataset.railOpen).toBe('true');

    const closeBackdrop = screen.getByRole('button', { name: 'Close context panel' });
    fireEvent.click(closeBackdrop);

    expect(shell.dataset.railOpen).toBe('false');
  });
});
