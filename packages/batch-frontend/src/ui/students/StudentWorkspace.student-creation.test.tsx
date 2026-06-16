import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  renderCreateStudentDialogOpen,
  renderWorkspaceForStudentCreation,
  setupStudentWorkspaceTest,
  studentWorkspaceApiMocks,
} from './StudentWorkspace.test-harness';

describe('StudentWorkspace student creation', () => {
  beforeEach(() => {
    setupStudentWorkspaceTest();
  });

  it('renders the create-student dialog and lets it close without touching the workspace', async () => {
    const user = userEvent.setup();

    renderCreateStudentDialogOpen();

    expect(screen.getByRole('heading', { name: /Create student/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByLabelText(/Student Name/i)).toBeNull();
  });

  it('creates a student and keeps workspace context updated', async () => {
    const user = userEvent.setup();
    studentWorkspaceApiMocks.createStudentProfile.mockResolvedValue({
      id: 'student-alex',
      student: 'Alex',
      profileId: null,
    });
    studentWorkspaceApiMocks.getStudentProfile.mockImplementation(async (id: string) => {
      if (id === 'student-alex') {
        return {
          id: 'student-alex',
          student: 'Alex',
          profileId: null,
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
    fireEvent.change(screen.getByLabelText(/Student Name/i), { target: { value: 'Alex' } });
    await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

    await waitFor(() => {
      expect(studentWorkspaceApiMocks.createStudentProfile).toHaveBeenCalledWith({
        student: 'Alex',
      });
    });

    expect(screen.getByText(/Created student Alex/i)).toBeTruthy();
  });

  it('creates a DB-only student when no starter profile details are entered', async () => {
    const user = userEvent.setup();
    studentWorkspaceApiMocks.createStudentProfile.mockResolvedValue({
      id: 'student-mila',
      student: 'Mila',
      profileId: null,
    });

    await renderWorkspaceForStudentCreation();

    await user.click(screen.getByRole('button', { name: /Create Student/i }));
    fireEvent.change(screen.getByLabelText(/Student Name/i), { target: { value: 'Mila' } });
    await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

    await waitFor(() => {
      expect(studentWorkspaceApiMocks.createStudentProfile).toHaveBeenCalledWith({
        student: 'Mila',
      });
    });
  });

  it('does not expose profile selectors or legacy advanced fields', async () => {
    renderCreateStudentDialogOpen();

    expect(screen.getByRole('heading', { name: /Create student/i })).toBeTruthy();
    expect(screen.queryByLabelText(/Initial Profile/i)).toBeNull();
    expect(screen.queryByText(/No learner profile selected/i)).toBeNull();
    expect(screen.queryByText(/Advanced fields/i)).toBeNull();
    expect(screen.queryByLabelText(/Color Preset/i)).toBeNull();
    expect(screen.queryByLabelText(/Accent Preference/i)).toBeNull();
    expect(screen.queryByLabelText(/Manifest Preset/i)).toBeNull();
    expect(screen.getByLabelText(/Current Level/i)).toBeTruthy();
    expect(screen.getByLabelText(/Primary Goals/i)).toBeTruthy();
    expect(screen.getByLabelText(/Communication Contexts/i)).toBeTruthy();
    expect(screen.getByLabelText(/Interests & Useful Themes/i)).toBeTruthy();
    expect(screen.getByLabelText(/Stable Strengths/i)).toBeTruthy();
    expect(screen.getByLabelText(/Persistent Challenges/i)).toBeTruthy();
    expect(screen.getByLabelText(/Study Preferences/i)).toBeTruthy();
    expect(screen.getByLabelText(/Durable Constraints/i)).toBeTruthy();
    expect(screen.getByLabelText(/Teacher Notes/i)).toBeTruthy();
  });

  it('creates a student from any partial starter profile fields', async () => {
    const user = userEvent.setup();
    studentWorkspaceApiMocks.createStudentProfile.mockResolvedValue({
      id: 'student-nadia',
      student: 'Nadia',
      profileId: 'profiles/students/student-nadia.md',
    });

    await renderWorkspaceForStudentCreation();

    await user.click(screen.getByRole('button', { name: /Create Student/i }));
    const createStudentArticle = screen
      .getByRole('heading', { name: /Create student/i })
      .closest('article');
    expect(createStudentArticle).toBeTruthy();
    const createForm = within(createStudentArticle as HTMLElement);
    fireEvent.change(createForm.getByLabelText(/Student Name/i), { target: { value: 'Nadia' } });
    fireEvent.change(createForm.getByLabelText(/Stable Strengths/i), {
      target: { value: 'Comfortable with prepared speaking.' },
    });
    await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

    await waitFor(() => {
      expect(studentWorkspaceApiMocks.createStudentProfile).toHaveBeenCalledWith({
        student: 'Nadia',
        starterProfile: {
          stableStrengths: 'Comfortable with prepared speaking.',
        },
      });
    });
  });
});
