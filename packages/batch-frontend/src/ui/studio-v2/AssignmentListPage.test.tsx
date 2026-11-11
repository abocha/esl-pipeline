import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../utils/api';
import AssignmentListPage from './AssignmentListPage';

vi.mock('../../utils/api', () => ({
  listAssignmentSessions: vi.fn(),
  listUserJobs: vi.fn(),
  fetchStudentOptions: vi.fn(),
}));
vi.mock('../../context/WorkspaceTimezoneContext', () => ({
  useWorkspaceTimezone: () => 'Asia/Ho_Chi_Minh',
}));

function session(overrides: Partial<api.AssignmentSession> = {}): api.AssignmentSession {
  return {
    id: 'session-active',
    userId: 'user-1',
    studentId: 'student-1',
    lessonId: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    revision: 1,
    homeworkIntent: 'create',
    transcriptCompletedAt: null,
    completionKind: null,
    transcriptCompletionHistory: [],
    confirmedStep: 'student',
    confirmed: { student: { studentId: 'student-1' }, source: null, context: null, create: null },
    publishTarget: null,
    selectedTtsProvider: null,
    selectedTtsStrategy: null,
    selectedTtsModel: null,
    selectedPreset: null,
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: null,
    selectedProfileId: null,
    selectedProfileRevisionId: null,
    selectedProfileRevisionHash: null,
    shareJobId: null,
    createdAt: '2026-10-30T10:00:00Z',
    updatedAt: '2026-10-30T10:00:00Z',
    ...overrides,
  };
}

function job(overrides: Partial<api.JobStatus> = {}): api.JobStatus {
  return {
    jobId: 'job-original',
    studentId: 'student-1',
    md: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    preset: null,
    withTts: false,
    voiceId: null,
    upload: null,
    voiceAccent: null,
    forceTts: null,
    publishTarget: null,
    ttsStrategy: null,
    autoPublish: false,
    htmlUrl: null,
    state: 'queued',
    createdAt: '2026-10-29T10:00:00Z',
    updatedAt: '2026-10-29T10:00:00Z',
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
    ...overrides,
  };
}

function mount() {
  return render(
    <MemoryRouter>
      <AssignmentListPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.fetchStudentOptions).mockResolvedValue({
    students: [{ id: 'student-1', name: 'Ada' }],
  });
  vi.mocked(api.listAssignmentSessions).mockImplementation(async (_limit, scope) => ({
    sessions: scope === 'history' ? [] : [session()],
    total: scope === 'history' ? 0 : 1,
    limit: _limit ?? 20,
  }));
  vi.mocked(api.listUserJobs).mockResolvedValue({ jobs: [], total: 0, limit: 20, offset: 0 });
});

describe('AssignmentListPage', () => {
  it('opens native exact versions, groups only proven source lineage, and requires succeeded publication with a URL', async () => {
    vi.mocked(api.listUserJobs).mockResolvedValue({
      jobs: [
        job({
          jobId: 'job-rerun',
          sourceJobId: 'job-original',
          state: 'failed',
          htmlUrl: 'https://example.test/old',
          updatedAt: '2026-10-31T11:00:00Z',
        }),
        job({ state: 'succeeded', htmlUrl: 'https://example.test/handout' }),
        job({ jobId: 'job-independent', state: 'succeeded', updatedAt: '2026-10-30T12:00:00Z' }),
      ],
      total: 3,
      limit: 20,
      offset: 0,
    });
    mount();
    await screen.findByText('Needs attention');
    expect(screen.getByRole('link', { name: 'Start assignment' }).getAttribute('href')).toBe(
      '/assignments/new',
    );
    expect(screen.getByRole('link', { name: /Continue assignment/ }).getAttribute('href')).toBe(
      '/?sessionId=session-active',
    );
    expect(screen.getByRole('link', { name: /Review issue/ }).getAttribute('href')).toBe(
      '/?jobId=job-rerun',
    );
    expect(screen.getByText('1 earlier version')).toBeTruthy();
    await userEvent.click(screen.getByText('1 earlier version'));
    expect(screen.getByRole('link', { name: /Open assignment/ }).getAttribute('href')).toBe(
      '/?jobId=job-original',
    );
    expect(screen.getByRole('link', { name: /Review assignment/ }).getAttribute('href')).toBe(
      '/?jobId=job-independent',
    );
    expect(screen.getAllByText('Published', { selector: 'span' })).toHaveLength(1);
    expect(screen.getByText('Ready to share')).toBeTruthy();
  });

  it('uses the current transcript marker, deduplicates promoted history, and never labels pending Share as published', async () => {
    const finish = {
      studentId: 'student-1',
      completedAt: '2026-10-29T12:00:00Z',
      expectedRevision: 1,
      resultingRevision: 2,
      source: {
        lessonId: null,
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
        transcriptStorageUri: 'memory://transcripts/transcript-1',
        transcriptHash: 'a'.repeat(64),
      },
    };
    vi.mocked(api.listAssignmentSessions).mockImplementation(async (_limit, scope) => ({
      sessions:
        scope === 'history'
          ? [
              session({
                id: 'promoted',
                revision: 1,
                homeworkIntent: 'none',
                transcriptCompletedAt: finish.completedAt,
                transcriptCompletionHistory: [finish],
              }),
              session({
                id: 'finished',
                homeworkIntent: 'none',
                transcriptCompletedAt: finish.completedAt,
                transcriptCompletionHistory: [finish],
              }),
              session({ id: 'shared', confirmedStep: 'share', shareJobId: 'pending-share' }),
              session({
                id: 'outside-jobs',
                confirmedStep: 'share',
                shareJobId: 'older-exact-job',
              }),
            ]
          : [
              session({
                id: 'promoted',
                revision: 3,
                homeworkIntent: 'create',
                transcriptCompletedAt: null,
                transcriptCompletionHistory: [finish],
              }),
            ],
      total: scope === 'history' ? 4 : 1,
      limit: 20,
    }));
    vi.mocked(api.listUserJobs).mockResolvedValue({
      jobs: [job({ jobId: 'pending-share' })],
      total: 1,
      limit: 20,
      offset: 0,
    });
    mount();
    expect(
      (await screen.findByRole('link', { name: /View transcript/ })).getAttribute('href'),
    ).toBe('/?sessionId=finished');
    expect(screen.getAllByRole('link', { name: /Continue assignment/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Continue assignment/ }).getAttribute('href')).toBe(
      '/?sessionId=promoted',
    );
    expect(screen.getByText('In progress', { selector: 'span' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Publication status unavailable/ }).getAttribute('href'),
    ).toBe('/?jobId=older-exact-job');
    expect(screen.queryByText('Published', { selector: 'span' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'transcript');
    expect(screen.getAllByRole('link', { name: /View transcript/ })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /Continue assignment/ })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'unfinished');
    expect(screen.queryByRole('link', { name: /View transcript/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Continue assignment/ })).toBeTruthy();
  });

  it('paginates active work, history and jobs together; failed pages preserve rows and retry all offsets', async () => {
    vi.mocked(api.listAssignmentSessions).mockImplementation(async (limit, scope, offset) => {
      if (scope === 'active')
        return {
          sessions: [session({ id: offset === 0 ? 'active-one' : 'active-two' })],
          total: 2,
          limit: 20,
        };
      if (offset === 0)
        return {
          sessions: [
            session({
              id: 'history-one',
              homeworkIntent: 'none',
              transcriptCompletedAt: '2026-10-29T12:00:00Z',
            }),
          ],
          total: 2,
          limit: 20,
        };
      return {
        sessions: [
          session({
            id: 'history-two',
            homeworkIntent: 'none',
            transcriptCompletedAt: '2026-10-28T12:00:00Z',
          }),
        ],
        total: 2,
        limit: limit ?? 20,
      };
    });
    vi.mocked(api.listUserJobs)
      .mockResolvedValueOnce({ jobs: [job()], total: 2, limit: 20, offset: 0 })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        jobs: [job({ jobId: 'older-job' })],
        total: 2,
        limit: 20,
        offset: 1,
      });
    mount();
    await screen.findByRole('button', { name: 'Load older assignments' });
    expect(screen.getByText('Filters apply to loaded work.')).toBeTruthy();
    expect(api.listAssignmentSessions).toHaveBeenCalledWith(20, 'active', 0);
    await userEvent.click(screen.getByRole('button', { name: 'Load older assignments' }));
    await screen.findByRole('button', { name: 'Retry older assignments' });
    expect(screen.getByRole('link', { name: /Continue assignment/ })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /View transcript/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Retry older assignments' }));
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: /View transcript/ })).toHaveLength(2),
    );
    expect(api.listAssignmentSessions).toHaveBeenNthCalledWith(3, 20, 'active', 1);
    expect(api.listAssignmentSessions).toHaveBeenNthCalledWith(4, 20, 'history', 1);
    expect(api.listAssignmentSessions).toHaveBeenNthCalledWith(5, 20, 'active', 1);
    expect(api.listAssignmentSessions).toHaveBeenNthCalledWith(6, 20, 'history', 1);
    expect(api.listUserJobs).toHaveBeenLastCalledWith({ limit: 20, offset: 1 });
    expect(screen.getAllByRole('link', { name: /Continue assignment/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Load older assignments' })).toBeNull();
    expect(screen.queryByText('Filters apply to loaded work.')).toBeNull();
  });

  it('ignores an older page superseded by a focus refresh without unlocking a concurrent page request', async () => {
    let finishOldPage!: (value: api.AssignmentSessionListResponse) => void;
    const oldPage = new Promise<api.AssignmentSessionListResponse>((resolve) => {
      finishOldPage = resolve;
    });
    let finishNewPage!: (value: api.AssignmentSessionListResponse) => void;
    const newPage = new Promise<api.AssignmentSessionListResponse>((resolve) => {
      finishNewPage = resolve;
    });
    let olderRequests = 0;
    vi.mocked(api.listAssignmentSessions).mockImplementation(async (limit, scope, offset) => {
      if (scope === 'history') return { sessions: [], total: 0, limit: 20 };
      if (offset === 1) return ++olderRequests === 1 ? oldPage : newPage;
      return { sessions: [session({ id: 'current' })], total: 2, limit: limit ?? 20 };
    });
    mount();
    await screen.findByRole('button', { name: 'Load older assignments' });
    await userEvent.click(screen.getByRole('button', { name: 'Load older assignments' }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() =>
      expect(
        vi
          .mocked(api.listAssignmentSessions)
          .mock.calls.filter(([, scope, offset]) => scope === 'active' && offset === 0),
      ).toHaveLength(2),
    );
    expect(screen.getByRole('link', { name: /Continue assignment/ }).getAttribute('href')).toBe(
      '/?sessionId=current',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load older assignments' }));
    await act(async () => {
      finishOldPage({ sessions: [session({ id: 'stale' })], total: 2, limit: 20 });
      await oldPage;
    });
    expect(screen.getAllByRole('link', { name: /Continue assignment/ })).toHaveLength(1);
    expect(
      (screen.getByRole('button', { name: 'Load older assignments' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => {
      finishNewPage({ sessions: [session({ id: 'fresh-older' })], total: 2, limit: 20 });
      await newPage;
    });
    expect(
      screen
        .getAllByRole('link', { name: /Continue assignment/ })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/?sessionId=current', '/?sessionId=fresh-older']);
    expect(screen.queryByRole('button', { name: 'Load older assignments' })).toBeNull();
  });

  it('shows unavailable rather than an empty list when a required source fails and recovers through Retry', async () => {
    vi.mocked(api.fetchStudentOptions)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ students: [{ id: 'student-1', name: 'Ada' }] });
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain('Assignments unavailable.');
    expect(screen.queryByText('No assignments found.')).toBeNull();
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(
      (await screen.findByRole('link', { name: /Continue assignment/ })).textContent,
    ).toContain('Ada');
  });
});
