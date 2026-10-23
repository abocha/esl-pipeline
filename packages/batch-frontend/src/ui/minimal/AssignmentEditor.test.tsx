import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { validateFreshAssignmentV1 } from '@esl-pipeline/contracts';

import { editorFixture, pronunciationFixture } from '../../dev/assignment-editor-fixture';
import { AssignmentEditor } from './AssignmentEditor';

const context = { studentName: 'Alex', inputKind: 'generate' as const, suppliedUrls: [] };
function setup(value = editorFixture(), readOnly = false) {
  let current = value;
  const changed = vi.fn();
  function Harness() {
    const [text, setText] = useState(JSON.stringify(value));
    return (
      <AssignmentEditor
        text={text}
        validationContext={context}
        readOnly={readOnly}
        saveStatus="All changes saved"
        onChange={(next) => {
          current = JSON.parse(next);
          changed(next);
          setText(next);
        }}
      />
    );
  }
  const view = render(<Harness />);
  return { ...view, current: () => current, changed };
}
const edit = (label: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: label.replace(' · optional', '') }), {
    target: { value },
  });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('current AssignmentV1 workbook editor', () => {
  it('returns focus from the panel, selects a neighbor after deletion and restores selection with Undo', async () => {
    const h = setup();
    const prompt = screen.getByRole('textbox', { name: 'Group 1 · Prompt 2' });
    fireEvent.focus(prompt);
    fireEvent.focus(screen.getByRole('textbox', { name: 'Answer' }));
    click('Close related fields');
    expect(document.activeElement).toBe(prompt);
    expect(h.container.querySelector('.assignment-editor-context')).toBeNull();
    click('Remove Group 1 item 2');
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(document.activeElement).toHaveProperty('value', 'They ___ meet at ten.');
    click('Undo');
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(document.activeElement).toHaveProperty('value', 'She ___ take a picnic.');
  });

  it('edits a generated monologue paragraph without changing its speaker identity', () => {
    const value = editorFixture();
    value.input.studyText = {
      type: 'monologue',
      speakers: [value.input.studyText.speakers[0]!],
      turns: [{ speakerId: 'alex', text: 'A weekend plan.' }],
    };
    const h = setup(value);
    edit('Paragraph 1', 'A revised weekend plan.');
    expect(h.current().input.studyText.turns).toEqual([
      { speakerId: 'alex', text: 'A revised weekend plan.' },
    ]);
    expect(h.current().input.studyText.type).toBe('monologue');
    expect(() => validateFreshAssignmentV1(h.current(), context)).not.toThrow();
  });
  it('edits a practice prompt on the page and answer only in its identified contextual panel', () => {
    const h = setup();
    const prompt = screen.getByRole('textbox', { name: 'Group 1 · Prompt 2' });
    fireEvent.focus(prompt);
    const panel = screen.getByRole('complementary', { name: 'Group 1 · Item 2 related fields' });
    expect(within(panel).queryByRole('textbox', { name: /Prompt/ })).toBeNull();
    fireEvent.change(prompt, { target: { value: 'We ___ meet Jo.' } });
    edit('Answer', 'are going to');
    edit('Explanation · optional', 'Use are with we.');
    expect(h.current().practice[0]!.items[1]).toEqual({
      prompt: 'We ___ meet Jo.',
      answer: 'are going to',
      explanation: 'Use are with we.',
    });
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
  });

  it('keeps incomplete local fields visible, marks errors and blocks learner view until repaired', () => {
    const h = setup();
    edit('Assignment title', '');
    expect(screen.getByRole('textbox', { name: 'Assignment title' })).toHaveProperty('value', '');
    expect(
      screen.getByRole('textbox', { name: 'Assignment title' }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Learner view' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toMatch(/not saved/);
    click('Edit related fields · Assignment details');
    edit('Icon', '');
    edit('Support language', 'bad language');
    expect(screen.getByRole('textbox', { name: 'Icon' })).toHaveProperty('value', '');
    expect(screen.getByRole('textbox', { name: 'Support language' })).toHaveProperty(
      'value',
      'bad language',
    );
    edit('Assignment title', 'Repaired');
    edit('Icon', '🌿');
    edit('Support language', 'ru');
    expect(() => validateFreshAssignmentV1(h.current(), context)).not.toThrow();
    expect(screen.getByRole('button', { name: 'Learner view' })).toHaveProperty('disabled', false);
  });

  it('edits current content and speakers without changing IDs, references or structural families', () => {
    const h = setup();
    edit('Turn 1', 'План на субботу — visit the park.');
    edit('Speaker 1 name', 'Sam');
    click('Edit related fields · Speaker 1');
    edit('Speaker role', 'Guide');
    edit('Persona · optional', '');
    edit('Alternative 1 meaning', 'An earlier intention.');
    edit('Trap 1 corrected', 'She is going to walk today.');
    edit('Vocabulary 1 example', 'Let us visit the museum instead.');
    edit('Group 1 title · optional', 'Choose the form');
    edit('Group 1 instructions · optional', 'Complete all three plans.');
    edit('Preparation 1', 'Choose a plan.');
    edit('Delivery · optional', '');
    edit('Self-check 1', 'Check be.');
    click('Teacher notes');
    edit('Teacher rationale · optional', 'PRIVATE_REVISED');
    edit('Next-lesson warm-up', 'PRIVATE_NEXT');
    expect(h.current().input.studyText.speakers[0]).toMatchObject({
      id: 'alex',
      displayName: 'Sam',
      persona: null,
    });
    expect(h.current().input.studyText.turns[0]!.speakerId).toBe('alex');
    expect(h.current().outputTask.delivery).toBeNull();
    expect(h.current().teacherRationale).toBe('PRIVATE_REVISED');
    expect(() => validateFreshAssignmentV1(h.current(), context)).not.toThrow();
    expect(
      screen.queryByRole('button', { name: /^(Add speaker|Change mode|Add group|Split|Merge)$/i }),
    ).toBeNull();
  });

  it('allows only supplied source URLs and keeps the source type fixed', () => {
    const value = editorFixture();
    value.input.source.url = 'https://example.test/supplied';
    render(
      <AssignmentEditor
        text={JSON.stringify(value)}
        onChange={vi.fn()}
        validationContext={{ ...context, suppliedUrls: ['https://example.test/supplied'] }}
        saveStatus="Saved"
      />,
    );
    click('Edit related fields · Source and media');
    const choices = within(screen.getByRole('combobox', { name: 'Source URL' })).getAllByRole(
      'option',
    );
    expect(choices.map((option) => option.getAttribute('value'))).toEqual([
      '',
      'https://example.test/supplied',
    ]);
    expect(screen.queryByRole('combobox', { name: /Source type/ })).toBeNull();
  });

  it('adds, reorders and trims items/groups, prevents invalid final deletions, and undoes structural actions', () => {
    const h = setup();
    click('Move group 2 up');
    expect(h.current().practice[0]!.title).toBe('Make it natural');
    click('Undo');
    expect(h.current().practice[0]!.title).toBe('Complete the plans');
    click('Move Group 1 item 2 up');
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('She ___ take a picnic.');
    click('Add group 1 item');
    expect(h.current().practice[0]!.items).toHaveLength(4);
    edit('Group 1 · Prompt 4', 'We ___ call Jo.');
    fireEvent.focus(screen.getByRole('textbox', { name: 'Group 1 · Prompt 4' }));
    edit('Answer', 'are going to');
    click('Remove Group 1 item 4');
    click('Remove group 2');
    expect(screen.getByRole('button', { name: 'Remove group 1' })).toHaveProperty('disabled', true);
    click('Undo');
    expect(h.current().practice).toHaveLength(2);
    click('Remove pronunciation');
    expect(h.current().pronunciation).toBeNull();
    click('Undo');
    expect(h.current().pronunciation?.mode).toBe('shadow_sentence');
    click('Add vocabulary entry');
    expect(h.current().toolkit.vocabulary).toHaveLength(2);
    click('Undo');
    expect(h.current().toolkit.vocabulary).toHaveLength(1);
  });

  it.each([
    ['shadow_sentence', 'Word 1', 'walk'],
    ['minimal_pair', 'Pair 1 left', 'sit'],
    ['connected_speech', 'Line 1 spoken', 'going to'],
    ['intonation', 'Contour cue · optional', 'Rise then fall'],
    ['rhythm_chunking', 'Drill 1 transcription · optional', '/test/'],
    ['sentence_stress', 'Drill 1 stressed word 1', 'visit'],
  ] as const)('edits and adds payload items in existing %s mode', (mode, field, value) => {
    const initial = editorFixture();
    initial.pronunciation = pronunciationFixture(mode);
    const h = setup(initial);
    edit(field, value);
    expect(h.current().pronunciation?.mode).toBe(mode);
    expect(JSON.stringify(h.current().pronunciation)).toContain(value);
    click('Add pronunciation item');
    expect(screen.getByRole('button', { name: 'Remove pronunciation item 2' })).toBeTruthy();
    click('Undo');
    expect(screen.queryByRole('button', { name: 'Remove pronunciation item 2' })).toBeNull();
    expect(() => validateFreshAssignmentV1(h.current(), context)).not.toThrow();
  });

  it('keeps an invalid stress/chunk buffer editable with the associated domain problem', () => {
    const initial = editorFixture();
    initial.pronunciation = pronunciationFixture('rhythm_chunking');
    setup(initial);
    edit('Drill 1 chunk 1', 'A different sentence');
    expect(screen.getByRole('alert').textContent).toContain('chunks must reconstruct');
    expect(screen.getByRole('textbox', { name: 'Drill 1 chunk 1' })).toHaveProperty(
      'value',
      'A different sentence',
    );
  });

  it('round-trips linguistic Highlight and removal, plain paste and multilingual IME without HTML interpretation', async () => {
    const h = setup();
    const field = screen.getByRole('textbox', {
      name: 'Group 1 · Prompt 1',
    }) as HTMLTextAreaElement;
    fireEvent.focus(field);
    field.setSelectionRange(0, 1);
    fireEvent.select(field);
    click('Highlight');
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('`I` ___ visit the park.');
    field.setSelectionRange(1, 2);
    fireEvent.select(field);
    click('Remove highlight');
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('I ___ visit the park.');
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: '日本語 <b>text</b>' } });
    fireEvent.compositionEnd(field);
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('日本語 <b>text</b>');
    expect(h.container.querySelector('b')).toBeNull();
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('I ___ visit the park.');
  });

  it('uses the shared learner view with answers in the key and no private material anywhere in its DOM', () => {
    const h = setup();
    click('Teacher notes');
    click('Learner view');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(h.container.querySelector('.assignment-editor-context')).toBeNull();
    expect(h.container.innerHTML).not.toMatch(/PRIVATE_|teacherRationale|teacherFollowUp/);
    expect(
      screen.getByText('Use am with I.').closest('details')?.querySelector('summary')?.textContent,
    ).toBe('Answer Key');
    expect(screen.getAllByText(/Complete the plans/)).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: /^A\. Exercises/ })).toBeNull();
  });

  it('keeps a completed reference immutable while permitting inspection of its notes', () => {
    const h = setup(editorFixture(), true);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    click('Teacher notes');
    expect(screen.getByText(/PRIVATE_TEACHER_RATIONALE/)).toBeTruthy();
    expect(h.changed).not.toHaveBeenCalled();
  });
});
