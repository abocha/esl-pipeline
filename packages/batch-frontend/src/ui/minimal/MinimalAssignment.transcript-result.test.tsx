import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AssignmentSession, StudentScheduleBillingSurface } from '../../utils/api';
import { TranscriptReviewResult } from './MinimalAssignment.transcript-result';

function props() {
  return {
    session: null as AssignmentSession | null,
    transcriptText: 'Teacher: How was your weekend? Student: It was good.',
    studentName: 'Example learner',
    lesson: null as StudentScheduleBillingSurface['lessons'][number] | null,
    lessonLoadingError: null as string | null,
    roles: [] as { speaker: number; role: 'teacher' | 'student' | '' }[],
    completed: false,
    busy: false,
    error: null as string | null,
    onEdit: vi.fn(),
    onChoiceChange: vi.fn(),
    onStartHomework: vi.fn(),
  };
}

describe('TranscriptReviewResult', () => {
  it('keeps review read-only, choice editable, and errors visible without announcing absent speaker roles', async () => {
    const input = { ...props(), error: 'Please review the newer transcript.' };
    const user = userEvent.setup();
    render(<TranscriptReviewResult {...input} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Speaker roles' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(input.error);
    await user.click(screen.getByRole('checkbox', { name: 'No homework for this lesson' }));
    expect(input.onChoiceChange).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole('button', { name: 'Edit transcript' }));
    expect(input.onEdit).toHaveBeenCalledOnce();
  });

  it('shows relevant speaker roles and does not expose a linked lesson ID while details fail to load', () => {
    render(
      <TranscriptReviewResult
        {...props()}
        session={{ lessonId: 'private-lesson-id' } as AssignmentSession}
        lessonLoadingError="unavailable"
        roles={[{ speaker: 0, role: 'teacher' }]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Speaker roles' })).toBeTruthy();
    expect(screen.getByText('Speaker 1: teacher')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Lesson and credit status could not be loaded.',
    );
    expect(screen.queryByText(/private-lesson-id/)).toBeNull();
  });

  it.each([
    [true, true, 'Credit used'],
    [false, true, 'Credit not used'],
    [false, false, 'Non-credit lesson'],
  ])(
    'keeps actual lesson/credit truth for credit event %s and consumesCredit %s',
    (hasEvent, consumesCredit, expected) => {
      render(
        <TranscriptReviewResult
          {...props()}
          session={{ lessonId: 'lesson-1' } as AssignmentSession}
          lesson={
            {
              title: 'Conversation practice',
              startsAt: '2026-10-07T12:00:00.000Z',
              status: 'completed',
              creditEventId: hasEvent ? 'event-1' : null,
              consumesCredit,
            } as StudentScheduleBillingSurface['lessons'][number]
          }
        />,
      );
      expect(screen.getByText(`completed · ${expected}`)).toBeTruthy();
    },
  );

  it.each([
    {
      processing: undefined,
      expected: ['Status unavailable', 'Status unavailable', 'Status unavailable'],
    },
    {
      processing: { lessonMemory: 'pending', snapshot: 'failed', enrichment: 'uncertain' } as const,
      expected: ['In progress', 'Failed', 'Status needs checking'],
    },
  ])(
    'keeps completion and Create homework available while processing is unavailable or needs attention',
    async ({ processing, expected }) => {
      const input = {
        ...props(),
        completed: true,
        session: { transcriptProcessing: processing } as AssignmentSession,
      };
      const user = userEvent.setup();
      const { container } = render(<TranscriptReviewResult {...input} />);
      expect(container.querySelector('details')?.open).toBe(false);
      expect(
        screen.getByRole('heading', { name: 'Transcript confirmed — no homework planned' }),
      ).toBeTruthy();
      expect(screen.queryByRole('checkbox')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Create homework' }));
      expect(input.onStartHomework).toHaveBeenCalledOnce();
      await user.click(screen.getByText(/Processing details/));
      expect([...container.querySelectorAll('dd')].map((item) => item.textContent)).toEqual(
        expected,
      );
    },
  );
});
