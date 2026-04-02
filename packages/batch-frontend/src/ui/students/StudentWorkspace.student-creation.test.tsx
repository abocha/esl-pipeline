import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS,
  renderWorkspace,
  setupStudentWorkspaceTest,
} from './StudentWorkspace.test-harness';
import * as api from '../../utils/api';

describe('StudentWorkspace student creation', () => {
  beforeEach(() => {
    setupStudentWorkspaceTest();
  });

  it('validates student creation name before submit', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole(
      'button',
      { name: /Create Student/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

    await user.click(screen.getByRole('button', { name: /Create Student/i }));
    await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

    expect(screen.getByText(/Student name is required/i)).toBeTruthy();
    expect(api.createStudentProfile).not.toHaveBeenCalled();
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

    renderWorkspace();

    await screen.findByRole(
      'button',
      { name: /Create Student/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

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

  it(
    'creates a complete starter profile payload and lets it override the initial profile picker',
    async () => {
      const user = userEvent.setup();
      renderWorkspace();

      await screen.findByRole(
        'button',
        { name: /Create Student/i },
        { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
      );

      await user.click(screen.getByRole('button', { name: /Create Student/i }));
      await screen.findByLabelText(/Student Name/i);
      fireEvent.change(screen.getByLabelText(/Student Name/i), { target: { value: 'Mira' } });
      await user.selectOptions(screen.getByLabelText(/Initial Profile/i), 'profile-alt.md');
      await user.click(screen.getByText(/Starter profile \(optional\)/i));
      fireEvent.change(screen.getByLabelText(/Starter Level/i), { target: { value: 'B1' } });
      fireEvent.change(screen.getByLabelText(/Starter Goals/i), {
        target: { value: 'Speak more clearly at work.' },
      });
      fireEvent.change(screen.getByLabelText(/Profession Or Context/i), {
        target: { value: 'CSM with intl clients.' },
      });
      fireEvent.change(screen.getByLabelText(/Interests/i), {
        target: { value: 'Travel and books.' },
      });
      fireEvent.change(screen.getByLabelText(/Long-Running Challenges/i), {
        target: { value: 'Needs clearer tense control.' },
      });
      fireEvent.change(screen.getByLabelText(/Study Preferences Or Constraints/i), {
        target: { value: 'Prefers structured review blocks.' },
      });
      await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

      await waitFor(() => {
        expect(api.createStudentProfile).toHaveBeenCalledWith({
          student: 'Mira',
          starterProfile: {
            level: 'B1',
            goals: 'Speak more clearly at work.',
            professionOrContext: 'CSM with intl clients.',
            interests: 'Travel and books.',
            longRunningChallenges: 'Needs clearer tense control.',
            studyPreferencesOrConstraints: 'Prefers structured review blocks.',
          },
        });
      });
    },
    15000,
  );

  it(
    'blocks create when the starter profile section is partially filled',
    async () => {
      const user = userEvent.setup();
      renderWorkspace();

      await screen.findByRole(
        'button',
        { name: /Create Student/i },
        { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
      );

      await user.click(screen.getByRole('button', { name: /Create Student/i }));
      fireEvent.change(screen.getByLabelText(/Student Name/i), { target: { value: 'Mira' } });
      await user.click(screen.getByText(/Starter profile \(optional\)/i));
      fireEvent.change(screen.getByLabelText(/Starter Goals/i), {
        target: { value: 'Speak more clearly at work.' },
      });
      await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

      expect(api.createStudentProfile).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          /Complete all required starter profile fields or clear the starter profile section/i,
        ),
      ).toBeTruthy();
    },
    15000,
  );

  it(
    'keeps create form values on create failure',
    async () => {
      const user = userEvent.setup();
      vi.mocked(api.createStudentProfile).mockRejectedValue(new Error('Student already exists'));

      renderWorkspace();

      await screen.findByRole(
        'button',
        { name: /Create Student/i },
        { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
      );

      await user.click(screen.getByRole('button', { name: /Create Student/i }));
      await screen.findByLabelText(/Student Name/i);
      fireEvent.change(screen.getByLabelText(/Student Name/i), {
        target: { value: 'Existing' },
      });
      await user.click(screen.getByText(/Advanced fields/i));
      fireEvent.change(screen.getByLabelText(/Color Preset/i), {
        target: { value: 'amber' },
      });
      await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

      await waitFor(() => {
        expect(screen.getByText(/Student already exists/i)).toBeTruthy();
      });

      expect((screen.getByLabelText(/Student Name/i) as HTMLInputElement).value).toBe('Existing');
      expect((screen.getByLabelText(/Color Preset/i) as HTMLInputElement).value).toBe('amber');
    },
    10000,
  );
});
