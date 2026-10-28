import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  const preview = {
    studentId: 'student-1',
    overallLevel: 'B1',
    primaryGoals: ['First goal.', 'Second goal.', 'Third goal.'],
    persistentChallenges: ['First challenge.', 'Second challenge.', 'Third challenge.'],
    interests: ['First interest.', 'Second interest.', 'Third interest.'],
    communicationContexts: [],
    stableStrengths: [],
    studyPreferences: [],
    durableConstraints: [],
    goalsAndContexts: [],
    strengthsAndChallenges: [],
    teacherNoteSnippet: 'An exact durable teacher note.',
    updatedAt: null,
  };
  function profileStage(studentId = 'student-1', sessionId = 'session-1') {
    return (
      <ContextStageSection
        stage={{ id: 'context', title: 'Teaching context', description: '', status: 'current' }}
        studentId={studentId}
        studentName="Alex"
        selectedProfileId={studentId}
        sessionId={sessionId}
        profilePreview={preview}
        profileRevisionError={null}
        learnerContext={baseContext}
        teacherNotes=""
        onTeacherNotesChange={vi.fn()}
      />
    );
  }

  it('reveals exact primary items with named keyboard controls and keeps status outside the reading region', async () => {
    const user = userEvent.setup();
    render(profileStage());
    const region = screen.getByRole('region', { name: 'Learner profile details' });
    expect(region.tabIndex).toBe(0);
    expect(within(region).queryByText(/Preparing learner context/)).toBeNull();
    expect(within(region).queryByRole('link', { name: 'Edit in Learning' })).toBeNull();
    for (const [name, last] of [
      ['goals', 'Third goal.'],
      ['challenges', 'Third challenge.'],
      ['interests', 'Third interest.'],
    ] as const) {
      expect(screen.queryByText(last)).toBeNull();
      const button = screen.getByRole('button', { name: `Show all ${name} (3)` });
      const controlledId = button.getAttribute('aria-controls');
      button.focus();
      await user.keyboard('{Enter}');
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(document.getElementById(controlledId!)?.textContent).toContain(last);
      expect(screen.getAllByText(last)).toHaveLength(1);
      await user.keyboard(' ');
      expect(screen.queryByText(last)).toBeNull();
      expect(document.activeElement).toBe(button);
    }
  });

  it('resets primary and secondary disclosures for both learner and assignment switches', () => {
    const view = render(profileStage());
    for (const next of [profileStage('student-2'), profileStage('student-2', 'session-2')]) {
      fireEvent.click(screen.getByRole('button', { name: 'Show all goals (3)' }));
      const details = screen.getByText('More learner context').closest('details')!;
      details.open = true;
      view.rerender(next);
      expect(screen.queryByText('Third goal.')).toBeNull();
      expect(screen.getByText('More learner context').closest('details')?.open).toBe(false);
    }
  });

  it('offers disclosure for a single clipped paragraph and secondary teacher note', () => {
    // jsdom has no layout: emulate only the browser overflow signal here.
    // Real two-line clipping and viewport containment are verified in the browser.
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(80);
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
    try {
      render(
        <ContextStageSection
          stage={{ id: 'context', title: '', description: '', status: 'current' }}
          studentId="student-1"
          studentName="Alex"
          selectedProfileId="student-1"
          profilePreview={{ ...preview, primaryGoals: ['One huge paragraph. '.repeat(60)] }}
          profileRevisionError={null}
          learnerContext={baseContext}
          teacherNotes=""
          onTeacherNotesChange={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Show all goals (1)' }));
      expect(screen.getByText('One huge paragraph. '.repeat(60).trim()).textContent).toBe(
        'One huge paragraph. '.repeat(60).trim(),
      );
      fireEvent.click(screen.getByText('More learner context'));
      fireEvent.click(screen.getByRole('button', { name: 'Show all teacher note' }));
      expect(screen.getAllByText(preview.teacherNoteSnippet)).toHaveLength(1);
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  it('expands only populated additional context and keeps the summary unique', () => {
    render(
      <ContextStageSection
        stage={{ id: 'context', title: 'Teaching context', description: '', status: 'current' }}
        studentId="student-maya"
        studentName="Maya"
        selectedProfileId="student-maya"
        profilePreview={{
          studentId: 'student-maya',
          overallLevel: 'B1',
          primaryGoals: ['Explain project decisions.'],
          communicationContexts: ['Team meetings.'],
          stableStrengths: ['Clear structure.'],
          persistentChallenges: ['Past tense consistency.'],
          interests: ['Cooking.'],
          studyPreferences: [],
          durableConstraints: ['Limited time on weekdays.'],
          goalsAndContexts: [],
          strengthsAndChallenges: [],
          teacherNoteSnippet: 'Durable teacher observation.',
          updatedAt: null,
        }}
        profileRevisionError={null}
        learnerContext={{ ...baseContext, state: 'not_applicable' }}
        teacherNotes="This assignment only."
        onTeacherNotesChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('More learner context'));
    expect(screen.getAllByText('Explain project decisions.')).toHaveLength(1);
    expect(screen.getAllByText('Past tense consistency.')).toHaveLength(1);
    expect(screen.getAllByText('Cooking.')).toHaveLength(1);
    expect(screen.getByText('Team meetings.')).toBeTruthy();
    expect(screen.getByText('Clear structure.')).toBeTruthy();
    expect(screen.getByText('Limited time on weekdays.')).toBeTruthy();
    expect(screen.getByText('Durable teacher observation.')).toBeTruthy();
    expect(screen.queryByText('Study preferences')).toBeNull();
    expect(
      (screen.getByRole('textbox', { name: 'Lesson guidance' }) as HTMLTextAreaElement).value,
    ).toBe('This assignment only.');
  });

  it('distinguishes unavailable learner context from a missing profile', () => {
    render(
      <ContextStageSection
        stage={{ id: 'context', title: 'Teaching context', description: '', status: 'current' }}
        studentId="student-maya"
        studentName="Maya"
        selectedProfileId=""
        profilePreview={null}
        profileRevisionError="Unable to load learner context."
        learnerContext={null}
        teacherNotes=""
        onTeacherNotesChange={vi.fn()}
        onRetryContext={vi.fn()}
      />,
    );
    expect(screen.getByText('Unable to load learner context.')).toBeTruthy();
    expect(screen.queryByText(/No structured Learning page context/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry learner context' })).toBeTruthy();
  });

  it('keeps lesson guidance editable while preparing without revision controls', () => {
    const { onTeacherNotesChange } = mount(baseContext);
    expect(screen.getByText(/Preparing learner context from this lesson/i)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Lesson guidance' }), {
      target: { value: 'Keep this guidance' },
    });
    expect(onTeacherNotesChange).toHaveBeenCalledWith('Keep this guidance');
    expect(screen.queryByRole('button', { name: /Populate|Approve|Activate|Skip/i })).toBeNull();
    expect(screen.getByRole('link', { name: 'Edit in Learning' })).toBeTruthy();
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
      (screen.getByRole('textbox', { name: 'Lesson guidance' }) as HTMLTextAreaElement).value,
    ).toBe('Keep this guidance');
    expect(screen.queryByRole('button', { name: /Populate|Approve/i })).toBeNull();
  });
});
