import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentDirectoryPage } from './StudentDirectoryPage';

const apiMocks = vi.hoisted(() => ({
  createStudentProfile: vi.fn(),
  listProfileContents: vi.fn(),
  listStudents: vi.fn(),
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
});
