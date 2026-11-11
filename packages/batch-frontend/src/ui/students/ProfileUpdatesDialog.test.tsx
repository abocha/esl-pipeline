import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProfileChangeListDto, ProfileMaintenanceChangeDto } from '@esl-pipeline/contracts';

import {
  listProfileChanges,
  ProfileRevisionConflictApiError,
  undoProfileChange,
} from '../../utils/api';
import { ProfileUpdatesDialog } from './ProfileUpdatesDialog';

vi.mock('../../utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/api')>();
  return {
    listProfileChanges: vi.fn(),
    undoProfileChange: vi.fn(),
    ProfileRevisionConflictApiError: actual.ProfileRevisionConflictApiError,
  };
});
vi.mock('../../context/WorkspaceTimezoneContext', () => ({
  useWorkspaceTimezone: () => 'Asia/Ho_Chi_Minh',
}));

function change(overrides: Partial<ProfileMaintenanceChangeDto> = {}): ProfileMaintenanceChangeDto {
  return {
    id: 'change-1',
    field: 'studyPreferences',
    addedValue: 'Prefers short review loops',
    beforeValue: ['Likes examples'],
    afterValue: ['Likes examples', 'Prefers short review loops'],
    appliedAt: '2026-11-01T01:00:00Z',
    sourceRevisionId: 'revision-1',
    resultRevisionId: 'revision-2',
    sourceSnapshotId: 'snapshot-1',
    sourceLessonMemoryIds: ['memory-1'],
    sourceLessonIds: ['lesson-1'],
    status: 'applied',
    canUndo: true,
    blockedReason: null,
    undoneAt: null,
    reconsiderationAvailable: false,
    evidence: [
      {
        lessonMemoryId: 'memory-1',
        lessonId: 'lesson-1',
        lessonStartedAt: '2026-10-31T08:00:00Z',
        facts: [
          {
            fact: 'Prefers short review loops',
            evidence: [
              {
                quote: 'I prefer ten minutes of review each day.',
                speakerRole: 'student',
                sourceId: 'transcript-1',
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}
function page(items = [change()], activeRevisionId = 'revision-2'): ProfileChangeListDto {
  return { studentId: 'student-alex', activeRevisionId, items, nextCursor: null };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProfileChanges).mockReset();
  vi.mocked(undoProfileChange).mockReset();
  vi.mocked(listProfileChanges).mockResolvedValue(page());
});

describe('ProfileUpdatesDialog', () => {
  it('renders exact additions and Before/Now values and opens their immutable evidence without mutation', async () => {
    render(
      <ProfileUpdatesDialog
        studentId="student-alex"
        onClose={vi.fn()}
        onProfileChanged={vi.fn()}
      />,
    );
    const undo = await screen.findByRole('button', { name: 'Undo Prefers short review loops' });
    const row = undo.closest('li')!;
    expect(within(row).getByText('New')).toBeTruthy();
    expect(
      within(within(row).getByRole('region', { name: 'Before' })).getByText('Likes examples'),
    ).toBeTruthy();
    expect(
      within(within(row).getByRole('region', { name: 'Now' })).getByText(
        'Prefers short review loops',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Changed')).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'View lesson evidence for Prefers short review loops' }),
    );
    expect(screen.getByRole('heading', { name: 'Lesson evidence' })).toBeTruthy();
    expect(screen.getByText('I prefer ten minutes of review each day.')).toBeTruthy();
    expect(screen.getByText('Student')).toBeTruthy();
    expect(undoProfileChange).not.toHaveBeenCalled();
    expect(listProfileChanges).toHaveBeenCalledTimes(1);
  });

  it('uses the loaded active head for one-item Undo and reloads authoritative history after success', async () => {
    const undone = change({ status: 'undone', canUndo: false, undoneAt: '2026-11-01T02:00:00Z' });
    vi.mocked(listProfileChanges)
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page([undone], 'revision-3'));
    vi.mocked(undoProfileChange).mockResolvedValue({
      profile: {
        studentId: 'student-alex',
        content: 'profile',
        currentRevisionId: 'revision-3',
        activeRevisionId: 'revision-3',
        updatedAt: '2026-11-01T02:00:00Z',
      },
      change: undone,
    });
    const onChanged = vi.fn(async () => {});
    render(
      <ProfileUpdatesDialog
        studentId="student-alex"
        onClose={vi.fn()}
        onProfileChanged={onChanged}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Undo Prefers short review loops' }),
    );
    expect(undoProfileChange).toHaveBeenCalledWith('student-alex', 'change-1', {
      expectedActiveRevisionId: 'revision-2',
    });
    await screen.findByText('Undone');
    expect(screen.queryByRole('button', { name: 'Undo Prefers short review loops' })).toBeNull();
    expect(listProfileChanges).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'After update' })).toBeTruthy();
  });

  it('shows a server refusal and rechecks the ledger instead of claiming the addition was undone', async () => {
    vi.mocked(undoProfileChange).mockRejectedValue(
      new ProfileRevisionConflictApiError('profile_change_conflict', 'revision-3'),
    );
    vi.mocked(listProfileChanges)
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(
        page(
          [change({ status: 'blocked', canUndo: false, blockedReason: 'field_changed' })],
          'revision-3',
        ),
      );
    render(
      <ProfileUpdatesDialog
        studentId="student-alex"
        onClose={vi.fn()}
        onProfileChanged={vi.fn()}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Undo Prefers short review loops' }),
    );
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This field changed after the update. Undo is unavailable.',
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Undo Prefers short review loops',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    expect(screen.queryByText('Undone')).toBeNull();
  });

  it('ignores an earlier student response after the dialog changes owner', async () => {
    let resolveOld!: (value: ProfileChangeListDto) => void;
    const old = new Promise<ProfileChangeListDto>((resolve) => {
      resolveOld = resolve;
    });
    vi.mocked(listProfileChanges).mockReturnValueOnce(old).mockResolvedValueOnce({
      studentId: 'student-bella',
      activeRevisionId: 'bella-head',
      items: [],
      nextCursor: null,
    });
    const props = { onClose: vi.fn(), onProfileChanged: vi.fn(async () => {}) };
    const rendered = render(<ProfileUpdatesDialog studentId="student-alex" {...props} />);
    rendered.rerender(<ProfileUpdatesDialog studentId="student-bella" {...props} />);
    await screen.findByText('No automatic profile updates yet.');
    await act(async () => {
      resolveOld(page());
      await old;
    });
    expect(screen.queryByRole('button', { name: 'Undo Prefers short review loops' })).toBeNull();
    expect(undoProfileChange).not.toHaveBeenCalled();
  });

  it('does not refresh a new student when an earlier student Undo settles', async () => {
    let resolveUndo!: (value: Awaited<ReturnType<typeof undoProfileChange>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof undoProfileChange>>>((resolve) => {
      resolveUndo = resolve;
    });
    vi.mocked(undoProfileChange).mockReturnValueOnce(pending);
    const onChanged = vi.fn(async () => {});
    const view = render(
      <ProfileUpdatesDialog
        studentId="student-alex"
        onClose={vi.fn()}
        onProfileChanged={onChanged}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Undo Prefers short review loops' }),
    );
    vi.mocked(listProfileChanges).mockResolvedValueOnce({
      studentId: 'student-bella',
      activeRevisionId: null,
      items: [],
      nextCursor: null,
    });
    view.rerender(
      <ProfileUpdatesDialog
        studentId="student-bella"
        onClose={vi.fn()}
        onProfileChanged={onChanged}
      />,
    );
    await screen.findByText('No automatic profile updates yet.');
    await act(async () => {
      resolveUndo({
        profile: {
          studentId: 'student-alex',
          content: '',
          currentRevisionId: 'revision-3',
          activeRevisionId: 'revision-3',
          updatedAt: null,
        },
        change: change({ status: 'undone', canUndo: false }),
      });
      await pending;
    });
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText('No automatic profile updates yet.')).toBeTruthy();
  });
});
