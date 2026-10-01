import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { StudentStep } from './StudentStep';

const students = [
  { id: 'student-alex', name: 'Alex' },
  { id: 'student-bella', name: 'Bella' },
];

function StudentHarness({
  initialStudentId = '',
  selectionLocked = false,
}: {
  initialStudentId?: string;
  selectionLocked?: boolean;
}) {
  const [studentId, setStudentId] = useState(initialStudentId);

  return (
    <StudentStep
      students={students}
      selectedStudentId={studentId}
      selectionLocked={selectionLocked}
      error={null}
      onSelect={setStudentId}
    >
      <div>Assignment setup</div>
    </StudentStep>
  );
}

describe('StudentStep', () => {
  it('replaces learner controls with a stable loading state', () => {
    render(
      <StudentStep
        students={students}
        selectedStudentId=""
        selectionLocked={false}
        loading
        error={null}
        onSelect={() => undefined}
      >
        <div>Assignment setup</div>
      </StudentStep>,
    );

    expect(screen.getByRole('status', { name: 'Loading learners' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Choose learner/i })).toBeNull();
    expect(screen.queryByText('Assignment setup')).toBeNull();
  });

  it('uses concise picker copy without repeating the step name', () => {
    render(<StudentHarness />);

    expect(screen.getByRole('heading', { name: 'Choose learner' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Choose learner' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Select…' })).toBeTruthy();
    expect(screen.queryByText(/^Student$/i)).toBeNull();
  });

  it('collapses immediately after a valid selection and reopens through Change student', async () => {
    const user = userEvent.setup();
    render(<StudentHarness />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Choose learner/i }),
      'student-alex',
    );

    expect(screen.getByRole('heading', { name: 'Alex' })).toBeTruthy();
    expect(screen.getByText('Selected for this assignment')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Choose learner/i })).toBeNull();
    expect(screen.getByText('Change')).toBeTruthy();
    expect(screen.queryByText(/^Student$/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /Change student/i }));

    const studentSelect = screen.getByRole('combobox', { name: /Choose learner/i });
    expect((studentSelect as HTMLSelectElement).value).toBe('student-alex');
    await waitFor(() => expect(document.activeElement).toBe(studentSelect));
  });

  it('does not expose manual refresh or learner-context reassurance', () => {
    render(<StudentHarness initialStudentId="student-alex" />);

    expect(screen.queryByRole('button', { name: /Refresh students/i })).toBeNull();
    expect(screen.queryByText(/Learner context stays connected/i)).toBeNull();
  });

  it('preserves the linked-lesson lock in the selected summary', async () => {
    const user = userEvent.setup();
    render(<StudentHarness initialStudentId="student-alex" selectionLocked />);

    const changeButton = screen.getByRole('button', { name: /Change student/i });
    expect((changeButton as HTMLButtonElement).disabled).toBe(true);

    await user.click(changeButton);
    expect(screen.queryByRole('combobox', { name: /Choose learner/i })).toBeNull();
  });
});
