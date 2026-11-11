import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CalendarEventDialog } from './CalendarEventDialog';
import { type Learner, type Lesson } from './fixtures';

beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute('open');
  });
});

describe('CalendarEventDialog', () => {
  it('shows a custom learner and applies simulated Calendar form changes', async () => {
    const user = userEvent.setup();
    const learner: Learner = {
      id: 'custom-learner',
      name: 'Jamie River',
      initials: 'JR',
      level: 'A1',
      email: '',
      goal: 'Ask for help while travelling.',
      focus: '',
      interests: '',
      challenge: '',
      balance: 0,
    };
    const lesson: Lesson = {
      id: 'custom-lesson',
      learnerId: learner.id,
      date: '2026-11-02',
      time: '10:00',
      duration: 60,
      state: 'Scheduled',
      notes: '',
      charge: true,
    };
    const onChange = vi.fn();
    const onClose = vi.fn();

    render(
      <CalendarEventDialog
        learner={learner}
        lesson={lesson}
        onChange={onChange}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Jamie River · English lesson' })).toBeTruthy();
    const date = screen.getByLabelText('Date');
    const time = screen.getByLabelText('Time');
    const duration = screen.getByLabelText('Duration');
    expect(date).toBeTruthy();
    expect(time).toBeTruthy();

    fireEvent.change(date, { target: { value: '2026-11-04' } });
    fireEvent.change(time, { target: { value: '11:30' } });
    await user.selectOptions(duration, '90');
    await user.click(screen.getByRole('button', { name: 'Apply simulated Calendar change' }));

    expect(onChange).toHaveBeenCalledWith({
      ...lesson,
      date: '2026-11-04',
      time: '11:30',
      duration: 90,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
