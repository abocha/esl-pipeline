import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AssignmentSession, listAssignmentSessions } from '../../utils/api';
import { StudentTranscriptHistory } from './StudentTranscriptHistory';

vi.mock('../../utils/api', () => ({ listAssignmentSessions: vi.fn() }));

function session(id: string, overrides: Partial<AssignmentSession> = {}): AssignmentSession {
  return {
    id,
    studentId: 'student-1',
    lessonId: null,
    homeworkIntent: 'none',
    transcriptCompletedAt: '2026-10-07T12:00:00.000Z',
    updatedAt: '2026-10-07T12:00:00.000Z',
    ...overrides,
  } as AssignmentSession;
}

function history(studentId = 'student-1') {
  return (
    <MemoryRouter>
      <StudentTranscriptHistory key={studentId} studentId={studentId} />
    </MemoryRouter>
  );
}

describe('StudentTranscriptHistory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('links unlinked completed transcripts for this student and excludes other students and unfinished work', async () => {
    vi.mocked(listAssignmentSessions).mockResolvedValue({
      sessions: [
        session('unlinked / result'),
        session('other-student', { studentId: 'student-2' }),
        session('unfinished', { transcriptCompletedAt: null }),
        session('promoted', { homeworkIntent: 'create', transcriptCompletedAt: null }),
      ],
      total: 4,
      limit: 20,
    });
    render(history());
    const link = await screen.findByRole('link', { name: 'View transcript' });
    expect(link.getAttribute('href')).toBe('/?sessionId=unlinked%20%2F%20result');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(listAssignmentSessions).toHaveBeenCalledWith(20, 'history', 0);
  });

  it('pages beyond fifty mixed entries using server offsets without reporting a false empty archive', async () => {
    const entries = Array.from({ length: 65 }, (_, index) =>
      index === 21 || index === 61
        ? session(`result-${index}`)
        : session(`other-${index}`, { homeworkIntent: 'create', transcriptCompletedAt: null }),
    );
    vi.mocked(listAssignmentSessions).mockImplementation(
      async (limit = 20, _scope, offset = 0) => ({
        sessions: entries.slice(offset, offset + limit),
        total: entries.length,
        limit,
      }),
    );
    const user = userEvent.setup();
    render(history());
    await screen.findByText('No transcripts in the results loaded so far.');
    expect(screen.queryByText('No completed transcripts for this student yet.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show older transcripts' }));
    await screen.findByRole('link', { name: 'View transcript' });
    await user.click(screen.getByRole('button', { name: 'Show older transcripts' }));
    await waitFor(() => expect(listAssignmentSessions).toHaveBeenCalledWith(20, 'history', 40));
    await user.click(screen.getByRole('button', { name: 'Show older transcripts' }));
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2));
    expect(listAssignmentSessions).toHaveBeenNthCalledWith(4, 20, 'history', 60);
    expect(screen.queryByRole('button', { name: 'Show older transcripts' })).toBeNull();
  });

  it('shows loading and only claims no results after the complete response', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof listAssignmentSessions>>) => void;
    vi.mocked(listAssignmentSessions).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(history());
    expect(screen.getByRole('status').textContent).toBe('Loading transcripts…');
    expect(screen.queryByText('No completed transcripts for this student yet.')).toBeNull();
    await act(async () => {
      resolve({ sessions: [], total: 0, limit: 20 });
    });
    expect(screen.getByText('No completed transcripts for this student yet.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps initial load failures retryable without claiming an empty archive', async () => {
    vi.mocked(listAssignmentSessions)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ sessions: [session('result')], total: 1, limit: 20 });
    const user = userEvent.setup();
    render(history());
    await screen.findByRole('alert');
    expect(screen.queryByText('No completed transcripts for this student yet.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('link', { name: 'View transcript' });
    expect(listAssignmentSessions).toHaveBeenNthCalledWith(2, 20, 'history', 0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retains earlier results and retries the same offset after a later page fails', async () => {
    vi.mocked(listAssignmentSessions)
      .mockResolvedValueOnce({ sessions: [session('first')], total: 2, limit: 20 })
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ sessions: [session('second')], total: 2, limit: 20 });
    const user = userEvent.setup();
    render(history());
    await screen.findByRole('link', { name: 'View transcript' });
    await user.click(screen.getByRole('button', { name: 'Show older transcripts' }));
    await screen.findByRole('alert');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2));
    expect(listAssignmentSessions).toHaveBeenNthCalledWith(2, 20, 'history', 1);
    expect(listAssignmentSessions).toHaveBeenNthCalledWith(3, 20, 'history', 1);
  });

  it('resets when switching students and ignores the old pending response', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof listAssignmentSessions>>) => void;
    vi.mocked(listAssignmentSessions)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveOld = done;
        }),
      )
      .mockResolvedValueOnce({
        sessions: [session('new-result', { studentId: 'student-2' })],
        total: 1,
        limit: 20,
      });
    const view = render(history());
    view.rerender(history('student-2'));
    const region = await screen.findByRole('region', { name: 'Lesson transcripts' });
    await within(region).findByRole('link', { name: 'View transcript' });
    await act(async () => {
      resolveOld({ sessions: [session('old-result')], total: 1, limit: 20 });
    });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/?sessionId=new-result');
    expect(listAssignmentSessions).toHaveBeenNthCalledWith(2, 20, 'history', 0);
  });
});
