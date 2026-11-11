import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handoutHtml, sampleWorkbook } from './assignment-model';
import CalmStudioV2 from './CalmStudioV2';
import { type Lesson, learners, today } from './fixtures';
import { SchedulingDrawer } from './SchedulingDrawer';

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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderStudio(view = 'learning', learner = 'alex') {
  const router = createMemoryRouter([{ path: '*', element: <CalmStudioV2 /> }], {
    initialEntries: [`/?sandboxScenario=calm-studio-v2&studioView=${view}&learner=${learner}`],
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('Calm Studio design journeys', () => {
  it('adds a student from the roster and makes them available for scheduling', async () => {
    const user = userEvent.setup();
    renderStudio('billing');
    const directory = screen.getByRole('complementary', { name: 'Student directory' });
    await user.click(within(directory).getByRole('button', { name: 'Add student' }));
    const add = screen.getByRole('dialog', { name: 'Add student' });
    await user.type(within(add).getByLabelText('Student name'), 'Jamie River');
    await user.type(within(add).getByLabelText('Current level'), 'A1');
    await user.type(within(add).getByLabelText('Learning goal'), 'Ask for help while travelling.');
    await user.click(within(add).getByRole('button', { name: 'Add student' }));
    expect(within(directory).getByRole('heading', { name: /Students.*4/ })).toBeTruthy();
    const profile = screen.getByRole('region', { name: 'Learning profile' });
    expect(within(profile).getByText('Ask for help while travelling.')).toBeTruthy();
    expect(within(profile).queryByText(/Short preparation followed/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Schedule lesson' }));
    const schedule = screen.getByRole('dialog', { name: 'Schedule lesson' });
    expect(within(schedule).getByText('Jamie River')).toBeTruthy();
    await user.click(within(schedule).getByRole('button', { name: 'Create lesson' }));
    await user.click(screen.getByRole('button', { name: /Details for Jamie River/ }));
    await user.click(screen.getByRole('button', { name: 'Calendar event' }));
    const event = screen.getByRole('dialog', { name: 'Google Calendar event · simulated' });
    expect(
      within(event).getByRole('heading', { name: 'Jamie River · English lesson' }),
    ).toBeTruthy();
    await user.click(within(event).getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByRole('button', { name: 'Business' }));
    await user.click(screen.getByRole('button', { name: 'Schedule lesson' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Schedule lesson' })).getByRole('option', {
        name: 'Jamie River',
      }),
    ).toBeTruthy();
  });

  it('shows reset state for a missing sandbox student without displaying another student’s billing', () => {
    renderStudio('billing', 'student-reset');
    expect(screen.getByRole('heading', { name: 'This sandbox student was reset' })).toBeTruthy();
    expect(within(screen.getByRole('main')).queryByText('USD 120.00')).toBeNull();
  });

  it('does not replace an unsaved profile draft with an older version', async () => {
    const user = userEvent.setup();
    renderStudio('learning');
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    await user.type(screen.getByLabelText('Learning goals'), ' Keep my wording.');
    await user.click(screen.getByRole('button', { name: 'Profile versions' }));
    const versions = screen.getByRole('dialog', { name: 'Profile versions' });
    const restore = within(versions).getByRole('button', { name: 'Use as profile draft' });
    expect((restore as HTMLButtonElement).disabled).toBe(true);
    await user.click(restore);
    await user.click(within(versions).getByRole('button', { name: 'Close dialog' }));
    expect((screen.getByLabelText('Learning goals') as HTMLTextAreaElement).value).toContain(
      'Keep my wording.',
    );
  });

  it('keeps a tutor draft intact when first-lesson enrichment updates the active profile', async () => {
    vi.useFakeTimers();
    renderStudio('learning', 'daniel');
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    fireEvent.change(screen.getByLabelText('Teacher notes'), {
      target: { value: 'My own focus wording' },
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    const user = userEvent.setup();
    expect(screen.getByText('Profile updated in the background')).toBeTruthy();
    expect((screen.getByLabelText('Teacher notes') as HTMLTextAreaElement).value).toBe(
      'My own focus wording',
    );
    expect(
      (screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Review background update' }));
    await user.click(screen.getByRole('button', { name: 'Review merged draft' }));
    expect((screen.getByLabelText('Teacher notes') as HTMLTextAreaElement).value).toBe(
      'My own focus wording',
    );
    expect((screen.getByLabelText('Persistent challenges') as HTMLTextAreaElement).value).toContain(
      'Rehearsing a question',
    );
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.getByText('My own focus wording')).toBeTruthy();
    expect(screen.getByText(/Version 3/)).toBeTruthy();
  });

  it('retains ready memory on refresh failure without reapplying an automatic profile update', async () => {
    const user = userEvent.setup();
    renderStudio('learning', 'maria');
    await user.click(screen.getByText('Preview states'));
    await user.click(screen.getByLabelText('Fail next background-memory preview'));
    await user.click(screen.getByRole('button', { name: 'Simulate background refresh' }));
    await user.click(screen.getByText('Preview states'));
    await waitFor(
      () => expect(screen.getByText(/The last ready context is retained/)).toBeTruthy(),
      { timeout: 3500 },
    );
    expect(screen.getByText(/Previous teaching notes ·/)).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Learning profile' })).getByText(learners[1].goal),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View changes' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry background update' }));
    await waitFor(() => expect(screen.getByText('Ready snapshot')).toBeTruthy(), { timeout: 3500 });
    expect(screen.getByText(/Version 2/)).toBeTruthy();
    expect(screen.getByText(learners[1].focus)).toBeTruthy();
  });

  it('undoes one automatic profile item, retains the others and does not reapply it on retry', async () => {
    const user = userEvent.setup();
    renderStudio('learning', 'maria');
    expect(screen.queryByRole('button', { name: 'Compare with profile' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View changes' }));
    const changes = screen.getByRole('dialog', { name: 'Profile updates' });
    const rows = within(changes).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    await user.click(within(rows[0]!).getByRole('button', { name: 'Undo' }));
    expect(within(rows[0]!).getByRole('button', { name: 'Undone' })).toBeTruthy();
    expect(within(rows[1]!).getByRole('button', { name: 'Undo' })).toBeTruthy();
    await user.click(within(changes).getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect((screen.getByLabelText('Stable strengths') as HTMLTextAreaElement).value).not.toContain(
      'Supports a design recommendation',
    );
    expect((screen.getByLabelText('Study preferences') as HTMLTextAreaElement).value).toContain(
      'A brief rehearsal helps',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    await user.click(screen.getByText('Preview states'));
    await user.click(screen.getByRole('button', { name: 'Simulate background refresh' }));
    await user.click(screen.getByText('Preview states'));
    await waitFor(() => expect(screen.getByText('Ready snapshot')).toBeTruthy(), { timeout: 3500 });
    await user.click(screen.getByRole('button', { name: 'View changes' }));
    expect(screen.getByRole('button', { name: 'Undone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undone' }).textContent).toContain('Reverted');
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByRole('button', { name: /Alex Morgan/ }));
    await user.click(screen.getByRole('button', { name: 'View changes' }));
    expect(screen.queryByRole('button', { name: 'Undone' })).toBeNull();
  });

  it('protects later tutor wording when reviewing an earlier automatic update', async () => {
    const user = userEvent.setup();
    renderStudio('learning');
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    await user.clear(screen.getByLabelText('Study preferences'));
    await user.type(screen.getByLabelText('Study preferences'), 'Tutor-confirmed preference.');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    await user.click(screen.getByRole('button', { name: 'View changes' }));
    const changes = screen.getByRole('dialog', { name: 'Profile updates' });
    const row = within(changes)
      .getAllByRole('listitem')
      .find((item) => within(item).queryByRole('heading', { name: 'Study preferences' }))!;
    expect(within(row).getByText('Now · Edited later')).toBeTruthy();
    expect(within(row).getByText('Tutor-confirmed preference.')).toBeTruthy();
    expect((within(row).getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it('carries the full saved learner profile into a new assignment without dropping constraints', async () => {
    const user = userEvent.setup();
    renderStudio('learning', 'maria');
    expect(screen.getByText(/Some newer work needs attention/)).toBeTruthy();
    expect(screen.getByText('Ready snapshot')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect((screen.getByLabelText('Stable strengths') as HTMLTextAreaElement).value).toContain(
      'Self-corrects',
    );
    await user.clear(screen.getByLabelText('Current level'));
    await user.type(screen.getByLabelText('Current level'), 'B2+');
    await user.clear(screen.getByLabelText('Durable constraints'));
    await user.type(screen.getByLabelText('Durable constraints'), 'Use short mobile tasks.');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.getByRole('button', { name: /Maria Petrova/ }).textContent).toContain('B2+');
    await user.click(screen.getByRole('button', { name: 'Assignments' }));
    await user.click(screen.getByRole('button', { name: 'Start assignment' }));
    await user.selectOptions(screen.getByLabelText('Learner'), 'maria');
    await user.click(screen.getByRole('button', { name: 'Choose source' }));
    await user.type(screen.getByLabelText('Transcript or source text'), 'A meeting contribution.');
    await user.click(screen.getByRole('button', { name: 'Confirm source & continue' }));
    const context = (
      screen.getByLabelText('Context to use for this assignment') as HTMLTextAreaElement
    ).value;
    expect(context).toContain('Use short mobile tasks.');
    expect(context).toContain('Stable strengths');
    expect(context).toContain('Study preferences');
  });
  it('preserves an edited workbook when an unchanged source is reconfirmed', async () => {
    const user = userEvent.setup();
    renderStudio('editor');
    await user.clear(screen.getByLabelText('Assignment title'));
    await user.type(screen.getByLabelText('Assignment title'), 'Tutor-edited assignment');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await user.click(screen.getByRole('button', { name: /^1\s*Source$/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm source & continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm teaching context' }));
    await user.click(screen.getByRole('button', { name: 'Continue to editor' }));
    expect((screen.getByLabelText('Assignment title') as HTMLInputElement).value).toBe(
      'Tutor-edited assignment',
    );
    expect((screen.getByLabelText('Study text') as HTMLTextAreaElement).value).toContain(
      'Last Saturday',
    );
  });
  it('requires reconfirmation before using downstream work after a source edit', async () => {
    const user = userEvent.setup();
    renderStudio('editor');
    await user.click(screen.getByRole('button', { name: /^1\s*Source$/ }));
    await user.type(screen.getByLabelText('Transcript or source text'), ' A different source.');
    expect(
      (screen.getByRole('button', { name: /^4\s*Edit assignment$/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Confirm source & continue' }));
    expect(screen.getByLabelText('Context to use for this assignment')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /^4\s*Edit assignment$/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the completion and credit effect before creating homework and charges only once', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(`${today}T18:00:00+07:00`).getTime());
    const user = userEvent.setup();
    renderStudio('schedule', 'maria');
    const details = () => screen.getByRole('button', { name: /Details for Maria Petrova/ });
    await user.click(details());
    await user.click(screen.getByRole('button', { name: /^Complete & add homework/ }));
    let modal = screen.getByRole('dialog', { name: 'Add homework' });
    expect(within(modal).getByText(/Scheduled.*Completed/)).toBeTruthy();
    expect(within(modal).getByText('Lesson credits')).toBeTruthy();
    await user.click(within(modal).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Billing' }));
    expect(
      within(screen.getByRole('region', { name: 'Lesson credits' })).getByText('1', {
        selector: 'strong',
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    await user.click(details());
    await user.click(screen.getByRole('button', { name: /^Complete & add homework/ }));
    modal = screen.getByRole('dialog', { name: 'Add homework' });
    await user.click(within(modal).getByRole('button', { name: 'Complete & add homework' }));
    expect(screen.getByLabelText('Transcript or source text')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Students' }));
    await user.click(screen.getByRole('button', { name: 'Billing' }));
    expect(
      within(screen.getByRole('region', { name: 'Lesson credits' })).getByText('0', {
        selector: 'strong',
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    await user.click(details());
    expect(screen.queryByRole('button', { name: /^Complete lesson/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open homework' }));
    await user.click(screen.getByRole('button', { name: 'Students' }));
    await user.click(screen.getByRole('button', { name: 'Billing' }));
    expect(
      within(screen.getByRole('region', { name: 'Lesson credits' })).getByText('0', {
        selector: 'strong',
      }),
    ).toBeTruthy();
  });

  it('rechecks lesson end on confirmation without silently charging an open preparation dialog', async () => {
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(`${today}T15:59:00+07:00`).getTime());
    const user = userEvent.setup();
    renderStudio('schedule', 'maria');
    await user.click(screen.getByRole('button', { name: /Details for Maria Petrova/ }));
    await user.click(screen.getByRole('button', { name: 'Prepare homework' }));
    const modal = screen.getByRole('dialog', { name: 'Add homework' });
    expect(within(modal).queryByText('Lesson credits')).toBeNull();
    clock.mockReturnValue(new Date(`${today}T16:00:00+07:00`).getTime());
    await user.click(within(modal).getByRole('button', { name: 'Choose lesson material' }));
    expect(within(modal).getByText('Lesson credits')).toBeTruthy();
    expect(within(modal).getByRole('button', { name: 'Complete & add homework' })).toBeTruthy();
    await user.click(within(modal).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Billing' }));
    expect(
      within(screen.getByRole('region', { name: 'Lesson credits' })).getByText('1', {
        selector: 'strong',
      }),
    ).toBeTruthy();
  });

  it('reconciles a completed lesson charge and keeps packages separate from payments', async () => {
    const user = userEvent.setup();
    renderStudio('schedule');
    await user.click(
      screen.getByRole('button', { name: /Details for Alex Morgan on .* at 09:00/ }),
    );
    await user.click(screen.getByText('Edit notes & charge'));
    await user.click(screen.getByLabelText('Chargeable lesson'));
    await user.click(screen.getByRole('button', { name: 'Save notes & charge' }));
    await user.click(screen.getByRole('button', { name: 'Billing' }));
    expect(screen.getByText('4', { selector: 'strong' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add lesson credits' }));
    await user.clear(screen.getByLabelText('Number of lesson credits'));
    await user.type(screen.getByLabelText('Number of lesson credits'), '2');
    await user.click(screen.getByRole('button', { name: 'Add credits' }));
    expect(screen.getByText('6', { selector: 'strong' })).toBeTruthy();
    expect(screen.getAllByText('USD 120.00')).toHaveLength(1);
    expect(screen.queryByText('USD 2.00')).toBeNull();
  });
  it('creates and publishes a separate learner assignment from exact authentic material', async () => {
    const user = userEvent.setup();
    const router = renderStudio('assignments');
    await user.click(screen.getByRole('button', { name: 'Start assignment' }));
    const start = screen.getByRole('dialog', { name: 'Start assignment' });
    await user.selectOptions(within(start).getByLabelText('Learner'), 'daniel');
    await user.click(within(start).getByRole('button', { name: 'Choose source' }));
    await user.type(
      screen.getByLabelText('Transcript or source text'),
      'A recorded conversation about finding a café.',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm source & continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm teaching context' }));
    await user.click(screen.getByRole('radio', { name: 'Authentic text' }));
    await user.type(
      screen.getByLabelText('Exact authentic text'),
      'Turn left at the bookshop. The café is next to the station.',
    );
    await user.click(screen.getByRole('button', { name: 'Create draft from this text' }));
    expect((screen.getByLabelText('Study text') as HTMLTextAreaElement).value).toContain(
      'Turn left at the bookshop.',
    );
    await user.click(screen.getByRole('button', { name: 'Add question' }));
    await user.type(screen.getByLabelText('Question'), 'Where is the café?');
    await user.type(screen.getByLabelText('Model answer'), 'Next to the station.');
    await user.type(screen.getByLabelText('Teacher-only notes'), 'PRIVATE teacher preparation');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await user.click(screen.getByRole('button', { name: 'Learner preview' }));
    expect(screen.getByText(/Where is the café\?/)).toBeTruthy();
    expect(screen.queryByText('PRIVATE teacher preparation')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review before sharing' }));
    await user.click(screen.getByRole('button', { name: 'Publish local handout' }));
    await user.click(screen.getByRole('button', { name: 'Open learner handout' }));
    expect(screen.getByRole('button', { name: 'Download HTML' })).toBeTruthy();
    expect(router.state.location.search).toContain('learner=daniel');
    expect(screen.queryByText('PRIVATE teacher preparation')).toBeNull();
  });

  it('keeps transcript-only completion separate from homework and lesson credits', async () => {
    const user = userEvent.setup();
    renderStudio('assignments');
    await user.click(screen.getByRole('button', { name: 'Start assignment' }));
    await user.selectOptions(screen.getByLabelText('Learner'), 'daniel');
    await user.click(screen.getByRole('button', { name: 'Choose source' }));
    await user.type(
      screen.getByLabelText('Transcript or source text'),
      'A finished transcript with no homework.',
    );
    await user.click(screen.getByRole('radio', { name: 'Transcript only' }));
    await user.click(
      screen.getByRole('button', { name: 'Confirm source & finish transcript-only lesson' }),
    );
    expect(screen.getByRole('heading', { name: 'Transcript-only lesson finished' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Prepare homework from this source' }));
    expect(
      (screen.getByLabelText('Context to use for this assignment') as HTMLTextAreaElement).value,
    ).toContain('travelling');
    await user.click(screen.getByRole('button', { name: 'Students' }));
    await user.click(screen.getByRole('button', { name: 'Billing' }));
    expect(screen.getByText('No payments recorded.')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Lesson credits' })).getByText('0', {
        selector: 'strong',
      }),
    ).toBeTruthy();
  });

  it('exports only escaped learner content, excluding teacher notes', () => {
    const workbook = {
      ...sampleWorkbook(learners[0]),
      title: '<script>unsafe()</script>',
      teacherNotes: 'PRIVATE preparation',
    };
    const html = handoutHtml(workbook);
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('PRIVATE preparation');
  });
  it('retains the correct learner and edits when Save & leave fails', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    await user.clear(screen.getByLabelText('Learning goals'));
    await user.type(screen.getByLabelText('Learning goals'), 'Keep this unsaved teaching goal');
    await user.click(screen.getByText('Preview states'));
    await user.click(screen.getByLabelText('Profile / assignment save failure'));
    await user.click(screen.getByRole('button', { name: /Maria Petrova/ }));
    const dialog = screen.getByRole('dialog', { name: 'Keep your changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Save & leave' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Your edits are still here');
    expect((screen.getByLabelText('Learning goals') as HTMLTextAreaElement).value).toBe(
      'Keep this unsaved teaching goal',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await user.click(screen.getByLabelText('Profile / assignment save failure'));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    await user.click(screen.getByRole('button', { name: /Maria Petrova/ }));
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect((screen.getByLabelText('Learning goals') as HTMLTextAreaElement).value).toContain(
      'international team',
    );
    await user.click(screen.getByRole('button', { name: /Alex Morgan/ }));
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect((screen.getByLabelText('Learning goals') as HTMLTextAreaElement).value).toBe(
      'Keep this unsaved teaching goal',
    );
  });

  it('protects unsaved profile edits during browser history navigation', async () => {
    const user = userEvent.setup();
    const router = renderStudio('overview');
    await user.click(screen.getByRole('button', { name: 'Learning' }));
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    await user.type(screen.getByLabelText('Learning goals'), ' Additional context.');
    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByRole('dialog', { name: 'Keep your changes?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Learning goals') as HTMLTextAreaElement).value).toContain(
      'Additional context.',
    );
    expect(router.state.location.search).toContain('studioView=learning');
  });

  it('shows unavailable context without claiming the learner has an empty profile', async () => {
    const user = userEvent.setup();
    renderStudio('overview');
    await user.click(screen.getByText('Preview states'));
    await user.selectOptions(screen.getByLabelText('Learner context'), 'unavailable');
    expect(screen.getByRole('heading', { name: 'Learner context unavailable' })).toBeTruthy();
    expect(screen.queryByText('No learner context recorded yet.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry context' }));
    expect(screen.getByText(learners[0].goal)).toBeTruthy();
  });

  it('recovers only the unconfirmed weekly operation without duplicating the confirmed event', async () => {
    const user = userEvent.setup();
    const created: Lesson[] = [];
    render(
      <SchedulingDrawer
        learner={learners[0]}
        outcome="partial"
        onCreate={(items) => created.push(...items)}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Weekly' }));
    await user.click(screen.getByRole('button', { name: 'Add weekly time' }));
    await user.click(screen.getByRole('button', { name: 'Create weekly schedule' }));
    expect(created).toHaveLength(1);
    const firstId = created[0]!.id;
    expect(screen.getByText('Creation not confirmed · retained for recovery')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Check retained operation' }));
    expect(created).toHaveLength(2);
    expect(new Set(created.map((item) => item.id)).size).toBe(2);
    expect(created.filter((item) => item.id === firstId)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Check retained operation' })).toBeNull();
  });
});
