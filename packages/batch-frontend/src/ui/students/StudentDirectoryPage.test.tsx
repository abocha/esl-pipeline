import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentDirectoryPage } from './StudentDirectoryPage';

const apiMocks = vi.hoisted(() => ({
  archiveStudentProfile: vi.fn(),
  createStudentProfile: vi.fn(),
  listStudents: vi.fn(),
  restoreStudentProfile: vi.fn(),
}));

vi.mock('../../utils/api', () => apiMocks);

function renderDirectory() {
  return render(
    <MemoryRouter>
      <StudentDirectoryPage />
    </MemoryRouter>,
  );
}

describe('StudentDirectoryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.listStudents.mockResolvedValue({
      items: [
        {
          id: 'student-alex-rivera',
          student: 'Alex Rivera',
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
      order: 'asc',
    });
    apiMocks.archiveStudentProfile.mockResolvedValue({
      id: 'student-alex-rivera',
      student: 'Alex Rivera',
      archivedAt: '2026-01-03T00:00:00.000Z',
    });
    apiMocks.restoreStudentProfile.mockResolvedValue({
      id: 'student-alex-rivera',
      student: 'Alex Rivera',
      archivedAt: null,
    });
  });

  it('renders compact learner links into the persistent workspace', async () => {
    renderDirectory();

    expect(await screen.findByText('AR')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alex Rivera' }).getAttribute('href')).toBe(
      '/students/student-alex-rivera/overview',
    );
    expect(screen.queryByRole('link', { name: /Open Overview/i })).toBeNull();
  });

  it('shows the student-list error without normal empty-state copy', async () => {
    apiMocks.listStudents.mockRejectedValueOnce(new Error('Student directory unavailable.'));

    renderDirectory();

    expect(await screen.findByText('Student directory unavailable.')).toBeTruthy();
    expect(screen.queryByText(/No students yet/i)).toBeNull();
    expect(screen.queryByText(/No archived students/i)).toBeNull();
  });

  it('shows the active empty state after a successful empty response', async () => {
    apiMocks.listStudents.mockResolvedValueOnce({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
      order: 'asc',
    });

    renderDirectory();

    expect(
      await screen.findByText('No students yet. Create the first learner to begin.'),
    ).toBeTruthy();
  });

  it('uses the same student-owned create form without loading profile options', async () => {
    const user = userEvent.setup();
    apiMocks.createStudentProfile.mockResolvedValue({
      id: 'student-nadia',
      student: 'Nadia',
    });

    renderDirectory();

    await user.click(screen.getByRole('button', { name: /Add student/i }));
    expect(screen.queryByLabelText(/Initial Profile/i)).toBeNull();
    expect(screen.queryByText(/Advanced fields/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Student Name/i), { target: { value: 'Nadia' } });
    fireEvent.change(screen.getByLabelText(/Stable Strengths/i), {
      target: { value: 'Comfortable with prepared speaking.' },
    });
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add student' })).getByRole('button', {
        name: 'Add student',
      }),
    );

    expect(apiMocks.createStudentProfile).toHaveBeenCalledWith({
      student: 'Nadia',
      starterProfile: {
        stableStrengths: 'Comfortable with prepared speaking.',
      },
    });
  });

  it('clears create-student validation when the tutor edits the form', async () => {
    const user = userEvent.setup();

    renderDirectory();

    await user.click(screen.getByRole('button', { name: /Add student/i }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add student' })).getByRole('button', {
        name: 'Add student',
      }),
    );

    expect(screen.getByText('Student name is required.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Student Name/i), { target: { value: 'Mina' } });

    expect(screen.queryByText('Student name is required.')).toBeNull();
  });

  it('keeps archived tab results when the active tab load resolves later', async () => {
    const user = userEvent.setup();
    let resolveActiveLoad: (value: {
      items: { id: string; student: string; archivedAt?: string }[];
      total: number;
      limit: number;
      offset: number;
      order: string;
    }) => void = () => {};
    apiMocks.listStudents
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveActiveLoad = resolve;
          }),
      )
      .mockResolvedValueOnce({
        items: [
          {
            id: 'student-archived-rivera',
            student: 'Archived Rivera',
            archivedAt: '2026-01-03T00:00:00.000Z',
          },
        ],
        total: 1,
        limit: 200,
        offset: 0,
        order: 'asc',
      });

    renderDirectory();

    await user.click(screen.getByRole('button', { name: /Archived/i }));
    expect(await screen.findByText('Archived Rivera')).toBeTruthy();

    resolveActiveLoad({
      items: [
        {
          id: 'student-active-rivera',
          student: 'Active Rivera',
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
      order: 'asc',
    });

    expect(await screen.findByText('Archived Rivera')).toBeTruthy();
    expect(screen.queryByText('Active Rivera')).toBeNull();
  });

  it.each(['active', 'archived'] as const)(
    'never reuses %s learners or actions after a failed status switch',
    async (initialStatus) => {
      const user = userEvent.setup();
      const loadedPage = {
        items: [
          {
            id: 'learner',
            student: 'Loaded Learner',
            archivedAt: initialStatus === 'archived' ? '2026-01-03' : null,
          },
        ],
        total: 1,
        limit: 200,
        offset: 0,
        order: 'asc',
      };
      if (initialStatus === 'archived') {
        apiMocks.listStudents.mockResolvedValueOnce({ ...loadedPage, items: [] });
      }
      apiMocks.listStudents
        .mockResolvedValueOnce(loadedPage)
        .mockRejectedValueOnce(new Error('Directory unavailable.'));
      renderDirectory();
      if (initialStatus === 'archived') {
        await screen.findByText(/No students yet/);
        await user.click(screen.getByRole('button', { name: 'Archived' }));
      }
      await screen.findByText('Loaded Learner');
      await user.click(
        screen.getByRole('button', { name: initialStatus === 'active' ? 'Archived' : 'Active' }),
      );
      await screen.findByText('Directory unavailable.');
      expect(screen.queryByText('Loaded Learner')).toBeNull();
      expect(screen.queryByRole('button', { name: /Restore student|Student actions/ })).toBeNull();
      expect(apiMocks.archiveStudentProfile).not.toHaveBeenCalled();
      expect(apiMocks.restoreStudentProfile).not.toHaveBeenCalled();
    },
  );

  it('submits creation from the focused name field and returns focus on cancel', async () => {
    const user = userEvent.setup();
    apiMocks.createStudentProfile.mockResolvedValue({ id: 'student-nadia', student: 'Nadia' });
    renderDirectory();
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Student Name' }));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Student name is required.',
    );
    expect(screen.getByRole('textbox', { name: 'Student Name' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    await user.type(screen.getByRole('textbox', { name: 'Student Name' }), 'Nadia{Enter}');
    await waitFor(() =>
      expect(apiMocks.createStudentProfile).toHaveBeenCalledWith({ student: 'Nadia' }),
    );
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add student' }));
  });

  it('searches names, reaches later pages, and distinguishes no matches from an empty roster', async () => {
    const user = userEvent.setup();
    apiMocks.listStudents
      .mockResolvedValueOnce({
        items: [{ id: 'alex', student: 'Alex Rivera' }],
        total: 201,
        limit: 200,
        offset: 0,
        order: 'asc',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'zoe', student: 'Zoe' }],
        total: 201,
        limit: 200,
        offset: 200,
        order: 'asc',
      })
      .mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0, order: 'asc' });
    renderDirectory();
    await screen.findByText('Alex Rivera');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Zoe');
    expect(apiMocks.listStudents).toHaveBeenLastCalledWith({
      limit: 200,
      offset: 200,
      order: 'asc',
      status: 'active',
    });
    await user.type(screen.getByRole('searchbox', { name: 'Search students' }), 'Missing');
    expect(await screen.findByText(/No students match/)).toBeTruthy();
    expect(screen.queryByText(/No students yet/)).toBeNull();
    expect(apiMocks.listStudents).toHaveBeenLastCalledWith({
      q: 'Missing',
      limit: 200,
      offset: 0,
      order: 'asc',
      status: 'active',
    });
    expect(screen.getByRole('button', { name: 'Active' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('returns to an existing page when the final page becomes empty', async () => {
    const user = userEvent.setup();
    const firstPage = {
      items: [{ id: 'alex', student: 'Alex' }],
      total: 201,
      limit: 200,
      offset: 0,
      order: 'asc',
    };
    apiMocks.listStudents
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({ ...firstPage, items: [], total: 200, offset: 200 })
      .mockResolvedValueOnce({ ...firstPage, total: 200 });
    renderDirectory();
    await screen.findByText('Alex');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(apiMocks.listStudents).toHaveBeenCalledTimes(3));
    await screen.findByText('Alex');
    expect(apiMocks.listStudents).toHaveBeenLastCalledWith({
      limit: 200,
      offset: 0,
      order: 'asc',
      status: 'active',
    });
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('refreshes the current directory after an action finishes across a status switch', async () => {
    const user = userEvent.setup();
    let finishRestore!: () => void;
    apiMocks.restoreStudentProfile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRestore = resolve;
        }),
    );
    apiMocks.listStudents
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({
        items: [{ id: 'archived', student: 'Archived Learner', archivedAt: '2026-01-03' }],
        total: 1,
      })
      .mockResolvedValue({ items: [{ id: 'active', student: 'Active Learner' }], total: 1 });
    renderDirectory();
    await screen.findByText(/No students yet/);
    await user.click(screen.getByRole('button', { name: 'Archived' }));
    await screen.findByText('Archived Learner');
    await user.click(screen.getByRole('button', { name: 'Restore student' }));
    await user.click(screen.getByRole('button', { name: 'Active' }));
    await screen.findByText('Active Learner');
    finishRestore();
    await waitFor(() => expect(apiMocks.listStudents).toHaveBeenCalledTimes(4));
    expect(apiMocks.listStudents).toHaveBeenLastCalledWith({
      limit: 200,
      offset: 0,
      order: 'asc',
      status: 'active',
    });
  });
});
