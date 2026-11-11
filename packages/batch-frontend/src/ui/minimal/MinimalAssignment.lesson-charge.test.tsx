import { within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  testApi as api,
  createMinimalUser,
  makeAssignmentSession,
  makeScheduleBillingSurface,
  makeStudentLesson,
  renderMinimalAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';

describe('native lesson charge review', () => {
  beforeEach(setupMinimalAssignmentTest);

  async function enterLinkedLesson() {
    globalThis.history.replaceState(null, '', '/?studentId=student-alex&lessonId=legacy-lesson');
    let lesson = makeStudentLesson({
      id: 'legacy-lesson',
      status: 'scheduled',
      plannedCharge: null,
      consumesCredit: false,
    });
    vi.mocked(api.getStudentLesson).mockImplementation(async () => lesson);
    vi.mocked(api.updateStudentLesson).mockImplementation(async (_studentId, _lessonId, body) => {
      lesson = { ...lesson, plannedCharge: body.plannedCharge ?? lesson.plannedCharge };
      return makeScheduleBillingSurface({ lessons: [lesson] });
    });
    const user = createMinimalUser();
    renderMinimalAssignment();
    const start = await screen.findByRole('button', { name: 'Start new assignment' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    await user.click(start);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    return {
      user,
      review: await screen.findByRole('region', { name: 'Review lesson charge' }),
      setPlannedCharge: (plannedCharge: boolean) => {
        lesson = { ...lesson, plannedCharge };
      },
    };
  }

  it('persists an explicit free choice before native linking, leaving completion to the backend session path', async () => {
    const { user, review } = await enterLinkedLesson();
    expect(api.confirmStudentAssignmentSession).not.toHaveBeenCalled();
    expect(api.updateStudentLesson).not.toHaveBeenCalled();
    await user.click(within(review).getByRole('radio', { name: 'No charge' }));
    await user.click(within(review).getByRole('button', { name: 'Confirm charge' }));
    await waitFor(() => expect(api.confirmStudentAssignmentSession).toHaveBeenCalledTimes(1));
    expect(api.updateStudentLesson).toHaveBeenCalledExactlyOnceWith(
      'student-alex',
      'legacy-lesson',
      {
        plannedCharge: false,
        expectedStatus: 'scheduled',
        expectedPlannedCharge: null,
      },
    );
    expect(api.confirmStudentAssignmentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-alex',
        lessonId: 'legacy-lesson',
        requestId: expect.any(String),
      }),
    );
    expect(screen.queryByRole('region', { name: 'Review lesson charge' })).toBeNull();
  });

  it('cancels review without creating a session or changing the ledger', async () => {
    const { user, review } = await enterLinkedLesson();
    await user.click(within(review).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(api.confirmStudentAssignmentSession).not.toHaveBeenCalled();
    expect(api.updateStudentLesson).not.toHaveBeenCalled();
  });

  it('requires fresh review after a concurrent charge change and retries the same durable entry', async () => {
    const { user, review, setPlannedCharge } = await enterLinkedLesson();
    const saved = makeAssignmentSession({
      id: 'accepted-session',
      studentId: 'student-alex',
      lessonId: 'legacy-lesson',
    });
    vi.mocked(api.confirmStudentAssignmentSession)
      .mockImplementationOnce(async () => {
        setPlannedCharge(true);
        throw new api.AssignmentLessonConflictApiError(saved);
      })
      .mockResolvedValueOnce(saved);
    await user.click(within(review).getByRole('radio', { name: 'No charge' }));
    await user.click(within(review).getByRole('button', { name: 'Confirm charge' }));
    await screen.findByText(/Your assignment link is saved/);
    expect(api.confirmStudentAssignmentSession).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const fresh = await screen.findByRole('region', { name: 'Review lesson charge' });
    expect(
      (within(fresh).getByRole('radio', { name: '1 lesson credit' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(api.confirmStudentAssignmentSession).toHaveBeenCalledTimes(1);
    await user.click(within(fresh).getByRole('radio', { name: 'No charge' }));
    await user.click(within(fresh).getByRole('button', { name: 'Confirm charge' }));
    await waitFor(() => expect(api.confirmStudentAssignmentSession).toHaveBeenCalledTimes(2));
    const requests = vi.mocked(api.confirmStudentAssignmentSession).mock.calls;
    expect(requests[1]?.[0].requestId).toBe(requests[0]?.[0].requestId);
    expect(requests[1]?.[0]).toMatchObject({
      expectedLessonPlannedCharge: false,
      expectedLessonStatus: 'scheduled',
    });
    expect(api.updateStudentLesson).toHaveBeenLastCalledWith('student-alex', 'legacy-lesson', {
      plannedCharge: false,
      expectedStatus: 'scheduled',
      expectedPlannedCharge: true,
    });
  });
});
