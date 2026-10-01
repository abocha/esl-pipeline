import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AssignmentLearnerContext } from '../../utils/api';
import { ContextStageSection } from './MinimalAssignment.stages';

const baseContext: AssignmentLearnerContext = {
  assignmentSessionId: 'assignment-1',
  studentId: 'student-1',
  source: {
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    transcriptHash: 'a'.repeat(64),
  },
  eligibility: 'eligible',
  state: 'preparing',
  operationState: 'waiting_evidence',
  profile: null,
  pinned: null,
  confirmationAvailable: false,
  warning: null,
};

function mount(context: AssignmentLearnerContext, notes = '') {
  const onTeacherNotesChange = vi.fn();
  const view = render(
    <ContextStageSection
      stage={{ id: 'context', title: 'Teaching context', description: '', status: 'current' }}
      studentId="student-1"
      studentName="Alex"
      selectedProfileId={context.profile?.studentId ?? ''}
      profilePreview={null}
      profileRevisionError={null}
      learnerContext={context}
      teacherNotes={notes}
      onTeacherNotesChange={onTeacherNotesChange}
    />,
  );
  return { ...view, onTeacherNotesChange };
}

describe('assignment learner-context presentation', () => {
  it('keeps lesson guidance editable while preparing without revision controls', () => {
    const { onTeacherNotesChange } = mount(baseContext);
    expect(screen.getByText(/Preparing learner context from this lesson/i)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Teacher notes' }), {
      target: { value: 'Keep this guidance' },
    });
    expect(onTeacherNotesChange).toHaveBeenCalledWith('Keep this guidance');
    expect(screen.queryByRole('button', { name: /Populate|Approve|Activate|Skip/i })).toBeNull();
    expect(screen.getByRole('link', { name: 'Edit learner profile' })).toBeTruthy();
  });

  it('shows completion and failure as concise assignment states', () => {
    const view = mount({ ...baseContext, state: 'completed', operationState: 'succeeded' });
    expect(screen.getByText(/Learner context updated from this lesson/i)).toBeTruthy();
    view.rerender(
      <ContextStageSection
        stage={{ id: 'context', title: 'Teaching context', description: '', status: 'current' }}
        studentId="student-1"
        studentName="Alex"
        selectedProfileId=""
        profilePreview={null}
        profileRevisionError={null}
        learnerContext={{
          ...baseContext,
          state: 'failed',
          operationState: 'uncertain',
          warning: 'enrichment_uncertain',
        }}
        teacherNotes="Keep this guidance"
        onTeacherNotesChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/could not be prepared from this lesson/i)).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: 'Teacher notes' }) as HTMLTextAreaElement).value,
    ).toBe('Keep this guidance');
    expect(screen.queryByRole('button', { name: /Populate|Approve/i })).toBeNull();
  });
});
