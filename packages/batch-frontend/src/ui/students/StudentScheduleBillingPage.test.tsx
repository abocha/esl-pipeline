import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StudentScheduleBillingPage } from './StudentScheduleBillingPage';

const useStudentAreaContextMock = vi.hoisted(() => vi.fn());

vi.mock('./StudentAreaContext', () => ({
  useStudentAreaContext: useStudentAreaContextMock,
}));

describe('StudentScheduleBillingPage', () => {
  it('starts with honest operations placeholders instead of a duplicated page hero', () => {
    useStudentAreaContextMock.mockReturnValue({
      student: {
        id: 'student-alex',
        student: 'Alex',
        profileId: 'profiles/students/alex.md',
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(),
    });

    render(<StudentScheduleBillingPage />);

    expect(screen.queryByRole('heading', { name: 'Schedule & Billing' })).toBeNull();
    expect(screen.getByText('Next lesson')).toBeTruthy();
    expect(screen.getByText('Lesson credits')).toBeTruthy();
    expect(screen.getByText('Reminders')).toBeTruthy();
    expect(screen.getByText('Invoices and payments')).toBeTruthy();
    expect(screen.getByText(/planned homes, not learner-profile fields/i)).toBeTruthy();
  });
});
