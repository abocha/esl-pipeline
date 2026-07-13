import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RecentAssignmentItem } from '../../minimal/MinimalAssignment.entry-state';
import { AssignmentEntryStep } from './AssignmentEntryStep';

const learners = [{ id: 'student-cora', name: 'Cora', profileId: 'profiles/cora.md' }];
const publishedItem: RecentAssignmentItem = {
  id: 'job-published',
  learnerName: 'Cora',
  lessonTitle: undefined,
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

function EntryHarness({
  initialView = 'choice',
  recentLoading = false,
  recentItems = [publishedItem],
  recentError = null,
  learnerLoading = false,
  learnerError = null,
  opening = false,
  starting = false,
  summaryState = 'needs-attention',
}: {
  initialView?: 'choice' | 'resume' | 'new' | 'summary';
  recentLoading?: boolean;
  recentItems?: RecentAssignmentItem[];
  recentError?: string | null;
  learnerLoading?: boolean;
  learnerError?: string | null;
  opening?: boolean;
  starting?: boolean;
  summaryState?: RecentAssignmentItem['state'];
}) {
  const [view, setView] = useState(initialView);
  const [selectedRecentId, setSelectedRecentId] = useState('');
  const [selectedLearnerId, setSelectedLearnerId] = useState('');

  return (
    <AssignmentEntryStep
      view={view}
      recentLoading={recentLoading}
      recentError={recentError}
      recentItems={recentItems}
      selectedRecentId={selectedRecentId}
      learners={learners}
      learnerLoading={learnerLoading}
      learnerError={learnerError}
      selectedLearnerId={selectedLearnerId}
      opening={opening}
      starting={starting}
      summary={
        view === 'summary'
          ? { learnerName: 'Cora', state: summaryState, origin: 'resume' }
          : null
      }
      onEnterResume={() => setView('resume')}
      onEnterNew={() => setView('new')}
      onChangeChoice={() => setView('choice')}
      onSelectRecent={setSelectedRecentId}
      onRetryRecent={vi.fn()}
      onOpenRecent={vi.fn()}
      onSelectLearner={setSelectedLearnerId}
      onRetryLearners={vi.fn()}
      onStartNew={vi.fn()}
      onChangeAssignment={vi.fn()}
    />
  );
}

describe('AssignmentEntryStep', () => {
  it('disables both unselected choices while recent work is loading', () => {
    render(<EntryHarness recentLoading />);

    expect((screen.getByRole('button', { name: 'Resume recent work' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Start new assignment' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('combobox', { name: /Choose learner/i })).toBeNull();
  });

  it('disables Resume without an empty-state explanation when there is no recent work', () => {
    render(<EntryHarness recentItems={[]} />);

    expect((screen.getByRole('button', { name: 'Resume recent work' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Start new assignment' }) as HTMLButtonElement).disabled).toBe(false);
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

    expect((screen.getByRole('button', { name: 'Continue assignment' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: /Cora.*Published/i }));
    expect((screen.getByRole('button', { name: 'Open assignment' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Opens Cora's published assignment/i)).toBeTruthy();
  });

  it('keeps learner selection and one primary action inside New', async () => {
    const user = userEvent.setup();
    render(<EntryHarness initialView="new" />);

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: /Choose learner/i }), 'student-cora');
    expect(screen.getByRole('heading', { name: 'Cora' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);
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

    await user.selectOptions(screen.getByRole('combobox', { name: /Choose learner/i }), 'student-cora');
    rerender(<EntryHarness initialView="new" starting />);

    expect(screen.getByRole('heading', { name: 'Cora' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Change choice' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['unfinished', 'Unfinished'],
    ['in-progress', 'In progress'],
    ['ready-to-share', 'Ready to share'],
    ['published', 'Published'],
    ['needs-attention', 'Needs attention'],
  ] as const)('renders the %s summary state without an entry route', (summaryState, expectedLabel) => {
    render(<EntryHarness initialView="summary" summaryState={summaryState} />);

    expect(screen.getByText(expectedLabel)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume recent work' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start new assignment' })).toBeNull();
  });

  it('shows the completed Resume summary without an entry route', () => {
    render(<EntryHarness initialView="summary" />);

    expect(screen.getByText('Reopened assignment')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change assignment' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start new assignment' })).toBeNull();
  });
});
