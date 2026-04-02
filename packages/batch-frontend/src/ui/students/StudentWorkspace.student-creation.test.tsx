import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  renderCreateStudentDialogOpen,
  renderWorkspaceForStudentCreation,
  setupStudentWorkspaceTest,
} from './StudentWorkspace.test-harness';
import * as api from '../../utils/api';

describe('StudentWorkspace student creation', () => {
  beforeEach(() => {
    setupStudentWorkspaceTest();
  });

  it('renders the create-student dialog and lets it close without touching the workspace', async () => {
    const user = userEvent.setup();

    renderCreateStudentDialogOpen();

    expect(screen.getByRole('heading', { name: /Student Context/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByLabelText(/Student Name/i)).toBeNull();
  });

  it('creates a student and keeps workspace context updated', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createStudentProfile).mockResolvedValue({
      id: 'student-alex',
      student: 'Alex',
      profileId: 'profile-alt.md',
    });
    vi.mocked(api.getStudentProfile).mockImplementation(async (id: string) => {
      if (id === 'student-alex') {
        return {
          id: 'student-alex',
          student: 'Alex',
          profileId: 'profile-alt.md',
        };
      }
      return {
        id: 'student-default',
        student: 'Default',
        profileId: 'profile-default.md',
      };
    });

    await renderWorkspaceForStudentCreation();

    await user.click(screen.getByRole('button', { name: /Create Student/i }));
    await user.type(screen.getByLabelText(/Student Name/i), 'Alex');
    await user.selectOptions(screen.getByLabelText(/Initial Profile/i), 'profile-alt.md');
    await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

    await waitFor(() => {
      expect(api.createStudentProfile).toHaveBeenCalledWith({
        student: 'Alex',
        profileId: 'profile-alt.md',
      });
    });

    expect(screen.getByText(/Created student Alex/i)).toBeTruthy();
  });
});
