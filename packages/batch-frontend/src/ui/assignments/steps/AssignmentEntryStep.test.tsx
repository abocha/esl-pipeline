import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  RecentAssignmentItem,
  RecentAssignmentLineage,
} from '../../minimal/MinimalAssignment.entry-state';
import { AssignmentEntryStep } from './AssignmentEntryStep';

const learners = [{ id: 'student-cora', name: 'Cora', profileId: 'profiles/cora.md' }];
const publishedItem: RecentAssignmentItem = {
  id: 'job-published',
  kind: 'job',
  sourceJobId: null,
  learnerName: 'Cora',
  lessonTitle: undefined,
  recoveryAnchor: 'Guidance & assignment draft',
  activityLabel: 'Assignment published',
  outcomeLabel: 'Handout available',
  timeLabel: 'Yesterday at 2:30 PM',
  state: 'published',
  statusLabel: 'Published',
  statusTone: 'success',
  actionLabel: 'Open assignment',
  destination: 'review',
  selected: false,
};

function makeRecentItem(
  id: string,
  learnerName: string,
  overrides: Partial<RecentAssignmentItem> = {},
): RecentAssignmentItem {
  return {
    ...publishedItem,
    id,
    learnerName,
    ...overrides,
  };
}

function makeLineage(
  latest: RecentAssignmentItem,
  olderVersions: RecentAssignmentItem[] = [],
): RecentAssignmentLineage {
  return { id: latest.id, latest, olderVersions };
}

function EntryHarness({
  initialView = 'choice',
  recentLoading = false,
  recentItems = [publishedItem],
  recentLineages,
  recentError = null,
  recentHasMore = false,
  recentLoadingMore = false,
  recentLoadMoreError = null,
  onLoadMoreRecent = vi.fn(),
  onOpenRecent = vi.fn(),
  learnerLoading = false,
  learnerError = null,
  opening = false,
  starting = false,
  summaryState = 'needs-attention',
}: {
  initialView?: 'choice' | 'resume' | 'new' | 'summary';
  recentLoading?: boolean;
  recentItems?: RecentAssignmentItem[];
  recentLineages?: RecentAssignmentLineage[];
  recentError?: string | null;
  recentHasMore?: boolean;
  recentLoadingMore?: boolean;
  recentLoadMoreError?: string | null;
  onLoadMoreRecent?: () => Promise<void> | void;
  onOpenRecent?: () => void;
  learnerLoading?: boolean;
  learnerError?: string | null;
  opening?: boolean;
  starting?: boolean;
  summaryState?: RecentAssignmentItem['state'];
}) {
  const [view, setView] = useState(initialView);
  const [selectedRecentId, setSelectedRecentId] = useState('');
  const [selectedLearnerId, setSelectedLearnerId] = useState('');
  const lineages = recentLineages ?? recentItems.map((item) => makeLineage(item));
  const lineageProps = {
    recentLineages: lineages,
    recentHasMore,
    recentLoadingMore,
    recentLoadMoreError,
    onLoadMoreRecent,
  };

  return (
    <AssignmentEntryStep
      {...lineageProps}
      view={view}
      recentLoading={recentLoading}
      recentError={recentError}
      selectedRecentId={selectedRecentId}
      learners={learners}
      learnerLoading={learnerLoading}
      learnerError={learnerError}
      selectedLearnerId={selectedLearnerId}
      opening={opening}
      starting={starting}
      summary={
        view === 'summary' ? { learnerName: 'Cora', state: summaryState, origin: 'resume' } : null
      }
      onEnterResume={() => setView('resume')}
      onEnterNew={() => setView('new')}
      onChangeChoice={() => setView('choice')}
      onSelectRecent={setSelectedRecentId}
      onRetryRecent={vi.fn()}
      onOpenRecent={onOpenRecent}
      onSelectLearner={setSelectedLearnerId}
      onRetryLearners={vi.fn()}
      onStartNew={vi.fn()}
      onChangeAssignment={vi.fn()}
    />
  );
}

describe('AssignmentEntryStep', () => {
  it.each([
    ['student', '1'],
    ['assignment', '4'],
  ] as const)(
    'renders the unfinished %s destination as a compact step number',
    (destination, stepNumber) => {
      const { container } = render(
        <EntryHarness
          initialView="resume"
          recentItems={[
            makeRecentItem(`session-${destination}`, 'Cora', {
              kind: 'session',
              state: 'unfinished',
              statusLabel: 'Unfinished',
              statusTone: 'progress',
              destination,
            }),
          ]}
        />,
      );

      expect(
        container.querySelector('.assignment-entry-step__recent-state-icon')?.textContent,
      ).toBe(stepNumber);
    },
  );

  it('disables both unselected choices while recent work is loading', () => {
    render(<EntryHarness recentLoading />);

    expect(
      (screen.getByRole('button', { name: 'Resume recent work' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Start new assignment' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('combobox', { name: /Choose learner/i })).toBeNull();
  });

  it('disables Resume without an empty-state explanation when there is no recent work', () => {
    render(<EntryHarness recentItems={[]} />);

    expect(
      (screen.getByRole('button', { name: 'Resume recent work' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Start new assignment' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText(/No saved assignments yet/i)).toBeNull();
  });

  it('swaps route content rather than mixing Resume and New controls', async () => {
    const user = userEvent.setup();
    render(<EntryHarness />);

    await user.click(screen.getByRole('button', { name: 'Resume recent work' }));
    expect(screen.getByRole('radio', { name: /Cora.*Published/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start new assignment' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Choose learner/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Confirm and continue/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Change choice' }));
    await user.click(screen.getByRole('button', { name: 'Start new assignment' }));
    expect(screen.getByRole('combobox', { name: /Choose learner/i })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Cora.*Published/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume recent work' })).toBeNull();
  });

  it('uses native radios and only enables the selected recent item action', async () => {
    const user = userEvent.setup();
    render(<EntryHarness initialView="resume" />);

    expect(
      (screen.getByRole('button', { name: 'Continue assignment' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('radio', { name: /Cora.*Published/i }));
    expect(
      (screen.getByRole('button', { name: 'Open assignment' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText(/Existing work is preserved/i)).toBeNull();
  });

  it('shows four recent lineages first and reveals eight more without replacing them', async () => {
    const user = userEvent.setup();
    const lineages = Array.from({ length: 12 }, (_, index) =>
      makeLineage(makeRecentItem(`job-${index + 1}`, `Learner ${index + 1}`)),
    );
    render(
      <EntryHarness
        initialView="resume"
        recentItems={lineages.map((lineage) => lineage.latest)}
        recentLineages={lineages}
      />,
    );

    expect(screen.getAllByRole('radio')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Show older assignments' }));
    expect(screen.getAllByRole('radio')).toHaveLength(12);
  });

  it('expands a rerun lineage without repeating learner or recovery text', async () => {
    const user = userEvent.setup();
    const latest = makeRecentItem('job-3', 'Yulia G', {
      sourceJobId: 'job-2',
      recoveryAnchor: 'Guidance & assignment draft',
      state: 'needs-attention',
      statusLabel: 'Needs attention',
      statusTone: 'warning',
      actionLabel: 'Review issue',
    });
    const previous = makeRecentItem('job-2', 'Yulia G', { sourceJobId: 'job-1' });
    const original = makeRecentItem('job-1', 'Yulia G', { sourceJobId: null });
    render(
      <EntryHarness
        initialView="resume"
        recentItems={[latest, previous, original]}
        recentLineages={[makeLineage(latest, [previous, original])]}
      />,
    );

    const disclosure = screen.getByRole('button', { name: /3 versions/i });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByText('Yulia G')).toHaveLength(1);

    await user.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('radio', { name: /Previous rerun.*Published/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Original.*Published/i })).toBeTruthy();
    expect(screen.getAllByText('Yulia G')).toHaveLength(1);
    expect(screen.getAllByText('Guidance & assignment draft')).toHaveLength(1);
  });

  it('loads another collection page only after local lineages are exhausted', async () => {
    const user = userEvent.setup();
    const onLoadMoreRecent = vi.fn().mockResolvedValue(undefined);
    const lineages = Array.from({ length: 4 }, (_, index) =>
      makeLineage(makeRecentItem(`job-${index + 1}`, `Learner ${index + 1}`)),
    );
    render(
      <EntryHarness
        initialView="resume"
        recentItems={lineages.map((lineage) => lineage.latest)}
        recentLineages={lineages}
        recentHasMore
        onLoadMoreRecent={onLoadMoreRecent}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show older assignments' }));
    expect(onLoadMoreRecent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
  });

  it('selects and opens an exact older version with its own action', async () => {
    const user = userEvent.setup();
    const onOpenRecent = vi.fn();
    const latest = makeRecentItem('job-rerun', 'Yulia G', { sourceJobId: 'job-original' });
    const original = makeRecentItem('job-original', 'Yulia G', {
      sourceJobId: null,
      state: 'needs-attention',
      statusLabel: 'Needs attention',
      statusTone: 'warning',
      actionLabel: 'Review issue',
    });
    render(
      <EntryHarness
        initialView="resume"
        recentLineages={[makeLineage(latest, [original])]}
        onOpenRecent={onOpenRecent}
      />,
    );

    await user.click(screen.getByRole('button', { name: '2 versions' }));
    await user.click(screen.getByRole('radio', { name: /Original.*Needs attention/i }));
    await user.click(screen.getByRole('button', { name: 'Review issue' }));
    expect(onOpenRecent).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded rows visible beside a local load-more retry', () => {
    render(
      <EntryHarness
        initialView="resume"
        recentLineages={[makeLineage(publishedItem)]}
        recentLoadMoreError="Unable to load older assignments."
      />,
    );

    expect(screen.getByRole('radio', { name: /Cora.*Published/i })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Unable to load older assignments.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('keeps learner selection and one primary action inside New', async () => {
    const user = userEvent.setup();
    render(<EntryHarness initialView="new" />);

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Choose learner/i }),
      'student-cora',
    );
    expect(screen.getByRole('heading', { name: 'Cora' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByRole('button', { name: 'Resume recent work' })).toBeNull();
  });

  it('replaces only failed or loading route content with feedback', () => {
    const { rerender } = render(<EntryHarness initialView="resume" recentLoading />);

    expect(screen.getByRole('status', { name: 'Loading recent work' })).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();

    rerender(<EntryHarness initialView="resume" recentError="Recent work is unavailable." />);
    expect(screen.getByRole('alert').textContent).toContain('Recent work is unavailable.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change choice' })).toBeTruthy();
  });

  it('retains the selected learner while starting and blocks route changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<EntryHarness initialView="new" />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Choose learner/i }),
      'student-cora',
    );
    rerender(<EntryHarness initialView="new" starting />);

    expect(screen.getByRole('heading', { name: 'Cora' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Change choice' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it.each([
    ['unfinished', 'Unfinished'],
    ['in-progress', 'In progress'],
    ['ready-to-share', 'Ready to share'],
    ['published', 'Published'],
    ['needs-attention', 'Needs attention'],
  ] as const)(
    'renders the %s summary state without an entry route',
    (summaryState, expectedLabel) => {
      render(<EntryHarness initialView="summary" summaryState={summaryState} />);

      expect(screen.getByText(expectedLabel)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Resume recent work' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Start new assignment' })).toBeNull();
    },
  );

  it('shows the completed Resume summary without an entry route', () => {
    render(<EntryHarness initialView="summary" />);

    expect(screen.getByText('Reopened assignment')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change assignment' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start new assignment' })).toBeNull();
  });
});
