// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthDialog } from './AuthDialog';

const authMock = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => authMock,
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: toastMock,
  toast: toastMock,
}));

function renderRegisterDialog(inviteToken: string | null = 'invite-token') {
  return render(
    <AuthDialog
      mode="register"
      inviteToken={inviteToken}
      onClose={vi.fn()}
      onSwitchMode={vi.fn()}
    />,
  );
}

describe('AuthDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('explains invite and password requirements on the registration form', () => {
    renderRegisterDialog();

    expect(screen.getByText('Invitation link detected')).toBeTruthy();
    expect(
      screen.getByText(
        'Use at least 8 characters. Spaces are okay; no symbols or numbers are required.',
      ),
    ).toBeTruthy();
  });

  it('validates the published password rule before submitting registration', async () => {
    const user = userEvent.setup();
    renderRegisterDialog();

    await user.type(screen.getByLabelText(/^Email$/i), 'teacher@example.com');
    await user.type(screen.getByLabelText(/^Password$/i), 'short');
    await user.type(screen.getByLabelText(/^Confirm Password$/i), 'short');
    await user.click(screen.getByRole('button', { name: /^Create account$/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('Use at least 8 characters.');
    expect(authMock.register).not.toHaveBeenCalled();
  });

  it('tells users to open their invite link when registration has no invite token', async () => {
    const user = userEvent.setup();
    renderRegisterDialog(null);

    await user.type(screen.getByLabelText(/^Email$/i), 'teacher@example.com');
    await user.type(screen.getByLabelText(/^Password$/i), 'long enough');
    await user.type(screen.getByLabelText(/^Confirm Password$/i), 'long enough');
    await user.click(screen.getByRole('button', { name: /^Create account$/i }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Open the invitation link from your email to create an account.',
    );
    expect(authMock.register).not.toHaveBeenCalled();
  });

  it('closes after invited registration succeeds because the backend signs the user in', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    authMock.register.mockResolvedValue(undefined);
    render(
      <AuthDialog
        mode="register"
        inviteToken="invite-token"
        onClose={onClose}
        onSwitchMode={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/^Email$/i), 'teacher@example.com');
    await user.type(screen.getByLabelText(/^Password$/i), 'long enough');
    await user.type(screen.getByLabelText(/^Confirm Password$/i), 'long enough');
    await user.click(screen.getByRole('button', { name: /^Create account$/i }));

    await waitFor(() => {
      expect(authMock.register).toHaveBeenCalledWith(
        'teacher@example.com',
        'long enough',
        'user',
        'invite-token',
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(toastMock.success).toHaveBeenCalledWith('Account created. Welcome in.');
  });
});
