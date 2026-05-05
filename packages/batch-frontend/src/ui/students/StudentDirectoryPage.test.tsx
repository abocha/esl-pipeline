import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentDirectoryPage } from './StudentDirectoryPage';

const apiMocks = vi.hoisted(() => ({
  archiveStudentProfile: vi.fn(),
  createStudentProfile: vi.fn(),
  listProfileContents: vi.fn(),
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
    vi.clearAllMocks();
    apiMocks.listProfileContents.mockResolvedValue({ profiles: [] });
    apiMocks.listStudents.mockResolvedValue({
      items: [
        {
          id: 'student-alex-rivera',
          student: 'Alex Rivera',
          profileId: 'profiles/students/alex.md',
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

  it('renders compact identity cards that lead into the shared student masthead', async () => {
    renderDirectory();

    expect(await screen.findByText('AR')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Alex Rivera' })).toBeTruthy();
    expect(screen.getByText('Student ID: alex-riv')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open student/i }).getAttribute('href')).toBe(
      '/students/student-alex-rivera/overview',
    );
    expect(screen.queryByRole('link', { name: /Open Overview/i })).toBeNull();
  });

  it('archives students with confirmation and restores them from the archived view', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    apiMocks.listStudents
      .mockResolvedValueOnce({
        items: [
          {
            id: 'student-alex-rivera',
            student: 'Alex Rivera',
            profileId: 'profiles/students/alex.md',
            archivedAt: null,
          },
        ],
        total: 1,
        limit: 200,
        offset: 0,
        order: 'asc',
      })
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 200,
        offset: 0,
        order: 'asc',
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'student-alex-rivera',
            student: 'Alex Rivera',
            profileId: 'profiles/students/alex.md',
            archivedAt: '2026-01-03T00:00:00.000Z',
            archiveReason: 'Student paused lessons.',
          },
        ],
        total: 1,
        limit: 200,
        offset: 0,
        order: 'asc',
      })
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 200,
        offset: 0,
        order: 'asc',
      });

    renderDirectory();

    const alexCard = (await screen.findByRole('heading', { name: 'Alex Rivera' })).closest(
      'article',
    );
    if (!alexCard) throw new Error('Expected Alex card');

    expect(within(alexCard).queryByRole('button', { name: /^Archive student$/i })).toBeNull();

    await user.click(
      within(alexCard).getByRole('button', { name: /Student actions for Alex Rivera/i }),
    );
    await user.click(within(alexCard).getByRole('menuitem', { name: /Archive student/i }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Are you sure you want to archive Alex Rivera? Lesson history and profile audit records will be preserved.',
    );
    expect(apiMocks.archiveStudentProfile).toHaveBeenCalledWith('student-alex-rivera', {
      reason: 'Archived from the student directory.',
    });
    expect(apiMocks.listStudents).toHaveBeenLastCalledWith({
      limit: 200,
      offset: 0,
      order: 'asc',
      status: 'active',
    });

    await user.click(screen.getByRole('button', { name: /Archived/i }));
    expect(apiMocks.listStudents).toHaveBeenLastCalledWith({
      limit: 200,
      offset: 0,
      order: 'asc',
      status: 'archived',
    });
    expect(await screen.findByText(/Student paused lessons/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Restore student/i }));

    expect(apiMocks.restoreStudentProfile).toHaveBeenCalledWith('student-alex-rivera');
    expect(apiMocks.listStudents).toHaveBeenLastCalledWith({
      limit: 200,
      offset: 0,
      order: 'asc',
      status: 'archived',
    });

    confirmSpy.mockRestore();
  });

  it('keeps archive behind the student actions menu and cancels when the user is unsure', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    apiMocks.listStudents.mockResolvedValueOnce({
      items: [
        {
          id: 'student-alex-rivera',
          student: 'Alex Rivera',
          profileId: 'profiles/students/alex.md',
          archivedAt: null,
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
      order: 'asc',
    });

    renderDirectory();

    const alexCard = (await screen.findByRole('heading', { name: 'Alex Rivera' })).closest(
      'article',
    );
    if (!alexCard) throw new Error('Expected Alex card');

    expect(within(alexCard).queryByRole('button', { name: /^Archive student$/i })).toBeNull();

    await user.click(
      within(alexCard).getByRole('button', { name: /Student actions for Alex Rivera/i }),
    );
    await user.click(within(alexCard).getByRole('menuitem', { name: /Archive student/i }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Are you sure you want to archive Alex Rivera? Lesson history and profile audit records will be preserved.',
    );
    expect(apiMocks.archiveStudentProfile).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});
