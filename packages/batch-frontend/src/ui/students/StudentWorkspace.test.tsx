import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CalmStudioShell } from '../shell/CalmStudioShell';
import { useStudentAreaContext } from './StudentAreaContext';
import { StudentAreaShell } from './StudentAreaShell';
import { StudentWorkspace, StudentWorkspaceEmpty } from './StudentWorkspace';
import { useStudentPageEdits } from './StudentWorkspaceContext';

const api = vi.hoisted(() => ({
  listStudents: vi.fn(),
  getStudentProfile: vi.fn(),
  createStudentProfile: vi.fn(),
  restoreStudentProfile: vi.fn(),
  archiveStudentProfile: vi.fn(),
}));
vi.mock('../../utils/api', () => api);
const save = vi.fn();
export function EditorProbe() {
  const { studentId, student } = useStudentAreaContext();
  const [text, setText] = useState('');
  useStudentPageEdits({
    dirty: text !== '',
    save: async () => {
      const ok = await save(studentId, text);
      if (ok) setText('');
      return ok;
    },
    discard: () => setText(''),
  });
  return (
    <>
      <span data-testid="record">{student?.id ?? 'none'}</span>
      <label>
        Draft
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
    </>
  );
}
function setup(path = '/students/a/learning', logout = vi.fn()) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <CalmStudioShell
            user={{ id: 'tutor', email: 'tutor@example.test', role: 'user', isActive: true }}
            onLogout={logout}
          />
        ),
        children: [
          {
            path: '/students',
            element: <StudentWorkspace />,
            children: [
              { index: true, element: <StudentWorkspaceEmpty /> },
              {
                path: ':studentId',
                element: <StudentAreaShell />,
                children: ['overview', 'learning', 'history', 'schedule-billing'].map(
                  (section) => ({ path: section, element: <EditorProbe /> }),
                ),
              },
            ],
          },
          { path: '/business', element: <h1>Business page</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  save.mockResolvedValue(true);
  api.listStudents.mockImplementation(async ({ status }) => ({
    items:
      status === 'archived'
        ? [{ id: 'z', student: 'Zoe', archivedAt: '2026-01-01' }]
        : [
            { id: 'a', student: 'Alex' },
            { id: 'b', student: 'Beatrice' },
          ],
    total: status === 'archived' ? 1 : 2,
  }));
  api.getStudentProfile.mockImplementation(async (id) => ({
    id,
    student: id === 'a' ? 'Alex' : 'Beatrice',
  }));
  api.archiveStudentProfile.mockResolvedValue({});
  api.restoreStudentProfile.mockResolvedValue({});
});
describe('persistent student workspace', () => {
  it('retains section, roster search and history while remounting the learner page', async () => {
    const user = userEvent.setup(),
      router = setup('/students/a/history?q=e');
    await screen.findByRole('heading', { name: 'Alex' });
    const roster = screen.getByRole('complementary', { name: 'Student directory' });
    expect(within(roster).getByRole('link', { name: 'Beatrice' }).getAttribute('href')).toBe(
      '/students/b/history?q=e',
    );
    await user.click(within(roster).getByRole('link', { name: 'Beatrice' }));
    await screen.findByRole('heading', { name: 'Beatrice' });
    expect(screen.getByTestId('record').textContent).toBe('b');
    expect(screen.getByRole('complementary', { name: 'Student directory' })).toBe(roster);
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByRole('heading', { name: 'Alex' });
    expect(screen.getByTestId('record').textContent).toBe('a');
    expect(screen.getByRole('searchbox').getAttribute('value')).toBe('e');
  });
  it('never passes the previous learner record while the next identity loads', async () => {
    let resolve!: (value: unknown) => void;
    api.getStudentProfile.mockImplementation((id) =>
      id === 'b'
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve({ id, student: 'Alex' }),
    );
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { name: 'Alex' });
    await user.click(screen.getByRole('link', { name: 'Beatrice' }));
    await waitFor(() => expect(screen.getByTestId('record').textContent).toBe('none'));
    await act(async () => resolve({ id: 'b', student: 'Beatrice' }));
    expect(await screen.findByRole('heading', { name: 'Beatrice' })).toBeTruthy();
  });
  it('keeps dirty edits on cancel or failed save and saves before switching', async () => {
    const user = userEvent.setup(),
      router = setup();
    await screen.findByRole('heading', { name: 'Alex' });
    await user.type(screen.getByLabelText('Draft'), 'local text');
    await user.click(screen.getByRole('link', { name: 'Beatrice' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Keep your changes?' })).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    );
    expect(router.state.location.pathname).toBe('/students/a/learning');
    expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('local text');
    save.mockResolvedValueOnce(false);
    await user.click(screen.getByRole('link', { name: 'Beatrice' }));
    await user.click(await screen.findByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Unable to save'),
    );
    expect(router.state.location.pathname).toBe('/students/a/learning');
    await user.click(await screen.findByRole('button', { name: 'Save and continue' }));
    await screen.findByRole('heading', { name: 'Beatrice' });
    expect(save).toHaveBeenLastCalledWith('a', 'local text');
    expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('');
  });
  it('does not prompt for a search query change but guards logout', async () => {
    const user = userEvent.setup(),
      logout = vi.fn();
    setup(undefined, logout);
    await screen.findByRole('heading', { name: 'Alex' });
    await user.type(screen.getByLabelText('Draft'), 'unsaved');
    await user.type(screen.getByRole('searchbox'), 'Alex');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Logout' }));
    expect(logout).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
  it('guards archive before its mutation, retains errors and refreshes the directory on success', async () => {
    const user = userEvent.setup(),
      router = setup();
    await screen.findByRole('heading', { name: 'Alex' });
    await user.type(screen.getByLabelText('Draft'), 'unsaved');
    await user.click(screen.getByRole('button', { name: 'Actions for Alex' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive student' }));
    expect(api.archiveStudentProfile).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Alex?' });
    api.archiveStudentProfile.mockRejectedValueOnce(new Error('Archive failed'));
    await user.click(within(dialog).getByRole('button', { name: 'Archive student' }));
    expect(await screen.findByText('Archive failed')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/students/a/learning');
    await user.click(within(dialog).getByRole('button', { name: 'Archive student' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
    expect(api.archiveStudentProfile).toHaveBeenCalledWith('a', {
      reason: 'Archived from the student directory.',
    });
    expect(api.listStudents.mock.calls.length).toBeGreaterThan(1);
  });
  it('keeps section on status switches and does not strand an index focus URL', async () => {
    const user = userEvent.setup(),
      router = setup('/students/a/history');
    await screen.findByRole('heading', { name: 'Alex' });
    await user.click(screen.getByRole('button', { name: 'Archived' }));
    await screen.findByText('Zoe');
    await user.click(screen.getByRole('button', { name: 'Active' }));
    await screen.findByRole('link', { name: 'Beatrice' });
    expect(screen.getByRole('link', { name: 'Beatrice' }).getAttribute('href')).toContain(
      '/history',
    );
    await act(async () => {
      await router.navigate('/students?focus=1');
    });
    expect(screen.queryByRole('button', { name: 'Exit focus view' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Student directory' })).toBeTruthy();
  });
  it('does not redirect a different learner when an earlier archive completes late', async () => {
    let finish!: () => void;
    api.archiveStudentProfile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup(),
      router = setup();
    await screen.findByRole('heading', { name: 'Alex' });
    await user.click(screen.getByRole('button', { name: 'Actions for Alex' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive student' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Archive Alex?' })).getByRole('button', {
        name: 'Archive student',
      }),
    );
    await act(async () => {
      await router.navigate('/students/b/learning');
    });
    await screen.findByRole('heading', { name: 'Beatrice' });
    await act(async () => finish());
    expect(router.state.location.pathname).toBe('/students/b/learning');
    expect(screen.getByTestId('record').textContent).toBe('b');
  });
  it('toggles rail density independently of focus view and keeps Logout named', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { name: 'Alex' });
    await user.click(screen.getByRole('button', { name: 'Collapse main navigation' }));
    expect(localStorage.getItem('workspace-rail-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Logout' }).getAttribute('title')).toBe('Logout');
    await user.click(screen.getByRole('button', { name: 'Enter focus view' }));
    expect(await screen.findByRole('button', { name: 'Exit focus view' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Expand main navigation' }));
    expect(await screen.findByRole('button', { name: 'Exit focus view' })).toBeTruthy();
  });

  it('opens the student menu from the keyboard and dismisses with Escape or outside click', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { name: 'Alex' });
    const trigger = screen.getByRole('button', { name: 'Actions for Alex' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Archive student' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByRole('heading', { name: 'Students' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
