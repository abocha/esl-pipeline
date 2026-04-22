import { act, render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useOutletContext,
} from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentAreaShell } from './StudentAreaShell';

const apiMocks = vi.hoisted(() => ({
  getStudentProfile: vi.fn(),
}));

vi.mock('../../utils/api', () => apiMocks);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function StudentShellProbe() {
  const context = useOutletContext<{
    student: { profileId?: string | null } | null;
    studentId: string;
  }>();

  return (
    <div>
      <span data-testid="student-shell-student-id">{context.studentId}</span>
      <span data-testid="student-shell-profile-id">{context.student?.profileId ?? 'none'}</span>
      <Outlet />
    </div>
  );
}

function renderStudentAreaShell(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/students/:studentId',
        element: <StudentAreaShell />,
        children: [
          {
            path: 'overview',
            element: <StudentShellProbe />,
          },
        ],
      },
    ],
    {
      initialEntries: [initialPath],
    },
  );

  const result = render(<RouterProvider router={router} />);
  return { router, ...result };
}

describe('StudentAreaShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores stale student responses after route navigation', async () => {
    const studentA = createDeferred<{
      id: string;
      student: string;
      profileId: string | null;
    }>();
    const studentB = createDeferred<{
      id: string;
      student: string;
      profileId: string | null;
    }>();

    apiMocks.getStudentProfile.mockImplementation((studentId: string) => {
      if (studentId === 'student-a') return studentA.promise;
      if (studentId === 'student-b') return studentB.promise;
      throw new Error(`Unexpected studentId: ${studentId}`);
    });

    const { router } = renderStudentAreaShell('/students/student-a/overview');

    await act(async () => {
      await router.navigate('/students/student-b/overview');
    });

    await act(async () => {
      studentB.resolve({
        id: 'student-b',
        student: 'Bora',
        profileId: 'profile-b.md',
      });
    });

    expect(await screen.findByRole('heading', { name: 'Bora' })).toBeTruthy();
    expect(screen.getByTestId('student-shell-student-id').textContent).toBe('student-b');
    expect(screen.getByTestId('student-shell-profile-id').textContent).toBe('profile-b.md');

    await act(async () => {
      studentA.resolve({
        id: 'student-a',
        student: 'Aiko',
        profileId: 'profile-a.md',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Bora' })).toBeTruthy();
      expect(screen.getByTestId('student-shell-student-id').textContent).toBe('student-b');
      expect(screen.getByTestId('student-shell-profile-id').textContent).toBe('profile-b.md');
    });
  });
});
