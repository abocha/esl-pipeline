import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudentActivityItem, StudentActivityResponse } from '@esl-pipeline/contracts';

import { StudentHistoryPage } from './StudentHistoryPage';

const apiMocks = vi.hoisted(() => ({ getStudentActivity: vi.fn() }));
const contextMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/api', () => apiMocks);
vi.mock('./StudentAreaContext', () => ({ useStudentAreaContext: contextMock }));

function item(overrides: Partial<StudentActivityItem> = {}): StudentActivityItem {
  return {
    id: 'activity-1',
    type: 'lesson_completed',
    category: 'lessons',
    occurredAt: '2026-10-17T09:00:00.000Z',
    subject: 'Lesson completed · Travel plans',
    summary: '50 min · 1 credit used',
    evidence: 'recorded',
    effects: [{ label: 'Credits', value: '−1' }],
    details: [{ label: 'Reason', value: 'Lesson completed' }],
    links: [{ label: 'Open lesson', href: '/students/student-alex/schedule-billing' }],
    ...overrides,
  };
}
function page(overrides: Partial<StudentActivityResponse> = {}): StudentActivityResponse {
  return {
    items: [item()],
    nextCursor: null,
    timezone: 'Asia/Bangkok',
    coverage: { recordingStartedAt: null, notice: 'Earlier changes may not have been recorded.' },
    ...overrides,
  };
}
function context(studentId = 'student-alex') {
  return {
    studentId,
    student: { id: studentId, student: studentId },
    studentLoading: false,
    studentError: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// biome-ignore lint/style/useComponentExportOnlyModules: Router controls are a test-only fixture, not a hot-reload module.
function LocationControl() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current filters">{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
    </>
  );
}
function history(url = '/students/student-alex/history') {
  return (
    <MemoryRouter initialEntries={[url]}>
      <StudentHistoryPage />
      <LocationControl />
    </MemoryRouter>
  );
}

describe('StudentHistoryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.mockReturnValue(context());
    apiMocks.getStudentActivity.mockResolvedValue(page());
  });

  it('explains an inverted date range without calling it unavailable and recovers when cleared', async () => {
    const user = userEvent.setup();
    render(history('/students/student-alex/history?from=2026-10-18&to=2026-10-17'));
    expect(screen.getByRole('alert').textContent).toBe(
      'Choose an end date on or after the start date.',
    );
    expect(apiMocks.getStudentActivity).not.toHaveBeenCalled();
    expect(screen.queryByText('History unavailable')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(
      await screen.findByRole('heading', { name: 'Lesson completed · Travel plans' }),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows factual activity and a useful destination with evidence in Details', async () => {
    const user = userEvent.setup();
    render(history());
    expect(
      await screen.findByRole('heading', { name: 'Lesson completed · Travel plans' }),
    ).toBeTruthy();
    expect(screen.getByText('50 min · 1 credit used')).toBeTruthy();
    expect(screen.getByText('−1')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Open lesson: Lesson completed · Travel plans' })
        .getAttribute('href'),
    ).toBe('/students/student-alex/schedule-billing');
    expect(screen.getByText('Earlier changes may not have been recorded.')).toBeTruthy();
    await user.click(screen.getByText('Details', { selector: 'summary' }));
    expect(screen.getByText('Recorded action')).toBeTruthy();
    expect(screen.getByText('Reason')).toBeTruthy();
    expect(screen.queryByText('duration pending · format pending')).toBeNull();
    expect(apiMocks.getStudentActivity).toHaveBeenCalledWith('student-alex', {
      category: 'all',
      limit: 30,
    });
  });

  it('distinguishes known empty history from a failed request and recovers through Retry', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentActivity
      .mockRejectedValueOnce(new Error('History service unavailable'))
      .mockResolvedValueOnce(page({ items: [] }));
    render(history());
    expect(await screen.findByRole('heading', { name: 'History unavailable' })).toBeTruthy();
    expect(screen.queryByText('No history yet')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry history' }));
    expect(await screen.findByRole('heading', { name: 'No history yet' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the previous records visible after a failed refresh and replaces them on recovery', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentActivity
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error('Refresh unavailable'))
      .mockResolvedValueOnce(
        page({ items: [item({ id: 'new', subject: 'New recorded action' })] }),
      );
    render(history());
    await screen.findByText('Lesson completed · Travel plans');
    await user.click(screen.getByRole('button', { name: 'Refresh history' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Previously loaded activity is still shown.',
    );
    expect(screen.getByText('Lesson completed · Travel plans')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry history' }));
    expect(await screen.findByText('New recorded action')).toBeTruthy();
    expect(screen.queryByText('Lesson completed · Travel plans')).toBeNull();
  });

  it('appends older parent rows without duplicating identities from the previous page', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentActivity
      .mockResolvedValueOnce(page({ nextCursor: 'next-page' }))
      .mockResolvedValueOnce(
        page({
          items: [
            item(),
            item({ id: 'older', subject: 'Payment recorded · USD 120.00', category: 'billing' }),
          ],
        }),
      );
    render(history());
    await user.click(await screen.findByRole('button', { name: 'Load older activity' }));
    await screen.findByText('Payment recorded · USD 120.00');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(apiMocks.getStudentActivity).toHaveBeenLastCalledWith('student-alex', {
      category: 'all',
      limit: 30,
      cursor: 'next-page',
    });
    expect(screen.queryByRole('button', { name: 'Load older activity' })).toBeNull();
  });

  it('retries an unavailable older page at the same cursor while preserving loaded data', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentActivity
      .mockResolvedValueOnce(page({ nextCursor: 'retry-cursor' }))
      .mockRejectedValueOnce(new Error('Older activity unavailable'))
      .mockResolvedValueOnce(page({ items: [item({ id: 'older', subject: 'Earlier lesson' })] }));
    render(history());
    await user.click(await screen.findByRole('button', { name: 'Load older activity' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Lesson completed · Travel plans')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry loading older activity' }));
    await screen.findByText('Earlier lesson');
    expect(apiMocks.getStudentActivity.mock.calls[1]).toEqual(
      apiMocks.getStudentActivity.mock.calls[2],
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('queries filters on the server and restores them through browser navigation', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentActivity.mockImplementation(async (_id, query) =>
      query.category === 'profile' ? page({ items: [] }) : page(),
    );
    render(history('/students/student-alex/history?from=2026-10-01'));
    await screen.findByText('Lesson completed · Travel plans');
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    expect(await screen.findByRole('heading', { name: 'No matching activity' })).toBeTruthy();
    expect(screen.getByLabelText('Current filters').textContent).toContain('activity=profile');
    expect(apiMocks.getStudentActivity).toHaveBeenLastCalledWith('student-alex', {
      category: 'profile',
      from: '2026-10-01',
      limit: 30,
    });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Lesson completed · Travel plans')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('ignores an older filter response that resolves after the new filter result', async () => {
    const pending = deferred<StudentActivityResponse>();
    apiMocks.getStudentActivity
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(
        page({ items: [item({ id: 'profile', subject: 'Profile saved', category: 'profile' })] }),
      );
    const user = userEvent.setup();
    render(history());
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await screen.findByText('Profile saved');
    await act(async () => pending.resolve(page()));
    expect(screen.queryByText('Lesson completed · Travel plans')).toBeNull();
  });

  it('does not retain learner A records or late responses after switching to B without remounting', async () => {
    const lateA = deferred<StudentActivityResponse>();
    apiMocks.getStudentActivity
      .mockResolvedValueOnce(page())
      .mockReturnValueOnce(lateA.promise)
      .mockRejectedValueOnce(new Error('B history unavailable'));
    const user = userEvent.setup();
    const view = render(history());
    await screen.findByText('Lesson completed · Travel plans');
    await user.click(screen.getByRole('button', { name: 'Refresh history' }));
    contextMock.mockReturnValue(context('student-b'));
    view.rerender(history());
    await screen.findByRole('heading', { name: 'History unavailable' });
    await act(async () =>
      lateA.resolve(page({ items: [item({ subject: 'Late private A record' })] })),
    );
    expect(screen.queryByText('Lesson completed · Travel plans')).toBeNull();
    expect(screen.queryByText('Late private A record')).toBeNull();
    expect(apiMocks.getStudentActivity).toHaveBeenLastCalledWith('student-b', {
      category: 'all',
      limit: 30,
    });
  });

  it('exposes a retained transcript finish and later homework outcome in the same filtered feed', async () => {
    apiMocks.getStudentActivity.mockResolvedValue(
      page({
        items: [
          item({
            id: 'finish',
            type: 'transcript_saved',
            subject: 'Transcript saved · No homework planned',
            evidence: 'retained',
            links: [{ label: 'Open transcript', href: '/?sessionId=lesson-session' }],
          }),
          item({
            id: 'publication',
            type: 'homework_published',
            subject: 'Homework published · Travel plans',
            evidence: 'retained',
            links: [{ label: 'Open homework', href: 'https://example.test/homework.html' }],
          }),
        ],
      }),
    );
    render(history('/students/student-alex/history?activity=lessons'));
    expect(
      await screen.findByRole('link', {
        name: 'Open transcript: Transcript saved · No homework planned',
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Open homework: Homework published · Travel plans' })
        .getAttribute('href'),
    ).toBe('https://example.test/homework.html');
    expect(screen.queryByRole('heading', { name: 'Lesson transcripts' })).toBeNull();
  });

  it('keeps effective date-only values on the supplied date across workspace midnight', async () => {
    apiMocks.getStudentActivity.mockResolvedValue(
      page({ timezone: 'America/Los_Angeles', items: [item({ effectiveAt: '2026-01-01' })] }),
    );
    render(history());
    const details = (await screen.findByText('Details', { selector: 'summary' })).parentElement!;
    fireEvent.click(within(details).getByText('Details', { selector: 'summary' }));
    expect(within(details).getByText('Jan 1, 2026')).toBeTruthy();
  });

  it('does not render executable or protocol-relative artifact destinations', async () => {
    apiMocks.getStudentActivity.mockResolvedValue(
      page({
        items: [
          item({
            links: [
              { label: 'Unsafe artifact', href: 'javascript:alert(1)' },
              { label: 'Ambiguous artifact', href: '//outside.test/material' },
            ],
          }),
        ],
      }),
    );
    render(history());
    await screen.findByText('Lesson completed · Travel plans');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
