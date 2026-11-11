import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchStudentOptions, listAssignmentSessions } from '../../utils/api';
import DayPage from './DayPage';

vi.mock('../../utils/api', () => ({
  fetchStudentOptions: vi.fn(),
  listAssignmentSessions: vi.fn(),
}));
vi.mock('../business/BusinessSchedulePage', () => ({
  BusinessSchedulePage: () => <h2>Real agenda controller</h2>,
}));
vi.mock('../../context/WorkspaceTimezoneContext', () => ({
  useWorkspaceTimezone: () => 'Asia/Bangkok',
}));
function ScheduleTarget() {
  const location = useLocation();
  return <p>Student schedule{location.hash}</p>;
}

describe('Your day entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchStudentOptions).mockResolvedValue({
      students: [{ id: 'student/alex', name: 'Alex' }],
    });
    vi.mocked(listAssignmentSessions).mockResolvedValue({ sessions: [], total: 0, limit: 4 });
  });
  function mount() {
    render(
      <MemoryRouter initialEntries={['/day']}>
        <Routes>
          <Route path="/day" element={<DayPage />} />
          <Route path="/students/:id/schedule" element={<ScheduleTarget />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('selects a real student before handing scheduling to the existing Calendar route', async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText('No unfinished assignments.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Schedule lesson' }));
    const dialog = screen.getByRole('dialog', { name: 'Schedule a lesson' });
    await user.type(within(dialog).getByRole('searchbox'), 'unknown');
    expect(await within(dialog).findByText('No students match.')).toBeTruthy();
    await user.clear(within(dialog).getByRole('searchbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Alex' }));
    expect(await screen.findByText('Student schedule#teaching-calendar')).toBeTruthy();
  });

  it('keeps the agenda usable when assignment retrieval fails and retries independently', async () => {
    vi.mocked(listAssignmentSessions).mockRejectedValueOnce(new Error('Unavailable'));
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Real agenda controller' })).toBeTruthy();
    expect(screen.queryByText('No unfinished assignments.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText('No unfinished assignments.')).toBeTruthy();
  });
});
