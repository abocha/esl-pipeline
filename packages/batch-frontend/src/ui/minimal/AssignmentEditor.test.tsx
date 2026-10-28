import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { validateFreshAssignmentV1 } from '@esl-pipeline/contracts';

import { editorFixture, pronunciationFixture } from '../../dev/assignment-editor-fixture';
import { AssignmentEditor } from './AssignmentEditor';
import { restoreTextSelection, textSelection } from './AssignmentEditor.inline';

const context = { studentName: 'Alex', inputKind: 'generate' as const, suppliedUrls: [] };
function setup(value = editorFixture(), readOnly = false, section = 'Practice') {
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
  if (section === 'Practice') fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
  return { ...view, current: () => current, changed };
}
const click = (name: string) => {
  const button = screen.queryByRole('button', { name });
  if (button) return fireEvent.click(button);
  const item = name.replace(/^(Move|Remove) /, '').replace(/ (up|down)$/, '');
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${item}` }));
  return fireEvent.click(screen.getByRole('menuitem', { name }));
};
const edit = (label: string, value: string) => {
  label = label.replace(/ · optional$/, '');
  if (!screen.queryByRole('textbox', { name: label })) {
    const section = /^(Icon|Topic|Level|Support language)/.test(label)
      ? 'Assignment details'
      : /^(Paragraph|Turn|Speaker|Persona|Voice|Accent|Source)/.test(label)
        ? 'Listen and read'
        : /^(Grammar|Form|Alternative|Trap|Vocabulary|Comparison|Use)/.test(label)
          ? 'Grammar & vocabulary'
          : /^(Word|Pair|Line|Drill|Contour|Pronunciation|Shadow|Natural)/.test(label)
            ? 'Say it clearly'
            : /^(Preparation|Delivery|Self-check|Requirement|Main task|Sample|Extension)/.test(
                  label,
                )
              ? 'Your task'
              : /^(Teacher|Next-lesson|Correction)/.test(label)
                ? 'Teacher notes'
                : 'Practice';
    click(section);
  }
  const field = screen.getByRole('textbox', { name: label });
  field.textContent = value;
  fireEvent.input(field);
};
describe('current AssignmentV1 workbook editor', () => {
  it('starts on the first section and preserves explicit navigation across edits and Undo', () => {
    setup(editorFixture(), false, 'Your goal');
    const nav = screen.getByRole('navigation', { name: 'Assignment sections' });
    expect(within(nav).getAllByRole('button')[0]!.getAttribute('aria-current')).toBe('page');
    click('Practice');
    edit('Group 1 · Prompt 1', 'Changed prompt');
    expect(screen.getByRole('button', { name: 'Practice' }).getAttribute('aria-current')).toBe(
      'page',
    );
    click('Undo');
    expect(screen.getByRole('button', { name: 'Practice' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('toggles whole-node boundary selections repeatedly and preserves markup through Undo/Redo', () => {
    const h = setup();
    const field = screen.getByRole('textbox', { name: 'Group 1 · Prompt 1' });
    const original = field.textContent!;
    const selectContents = () => {
      act(() => field.focus());
      const range = document.createRange();
      range.selectNodeContents(field);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      fireEvent.mouseUp(field);
    };
    for (let i = 0; i < 3; i++) {
      selectContents();
      click('Highlight');
      expect(h.current().practice[0]!.items[0]!.prompt).toBe('`' + original + '`');
      expect(field.querySelectorAll('mark')).toHaveLength(1);
      selectContents();
      click('Remove highlight');
      expect(h.current().practice[0]!.items[0]!.prompt).toBe(original);
      expect(field.querySelector('mark')).toBeNull();
    }
    click('Undo');
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('`' + original + '`');
    click('Redo');
    expect(h.current().practice[0]!.items[0]!.prompt).toBe(original);
  });

  it('adds highlight to a mixed selection even when it begins inside a highlight', () => {
    const initial = editorFixture();
    initial.practice[0]!.items[0]!.prompt = '`Hello` world';
    const h = setup(initial);
    const field = screen.getByRole('textbox', { name: 'Group 1 · Prompt 1' });
    act(() => field.focus());
    restoreTextSelection(field, { start: 1, end: 11 });
    fireEvent.mouseUp(field);
    click('Highlight');
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('`Hello world`');
    expect(field.querySelectorAll('mark')).toHaveLength(1);
  });

  it('selects a neighbor after deletion and restores selection with Undo', async () => {
    const h = setup();
    const prompt = screen.getByRole('textbox', { name: 'Group 1 · Prompt 2' });
    fireEvent.focus(prompt);
    act(() => prompt.focus());
    expect(h.container.querySelector('.assignment-editor-context')).toBeNull();
    click('Remove Group 1 item 2');
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(document.activeElement).toHaveProperty('textContent', 'They ___ meet at ten.');
    click('Undo');
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(document.activeElement).toHaveProperty('textContent', 'She ___ take a picnic.');
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
  it('edits prompts, answers and explanations together on the workbook', () => {
    const h = setup();
    expect(screen.getByRole('textbox', { name: 'Group 1 · Answer 2' })).toBeTruthy();
    edit('Group 1 · Prompt 2', 'We ___ meet Jo.');
    edit('Group 1 · Answer 2', 'are going to');
    edit('Group 1 · Explanation 2', 'Use are with we.');
    expect(h.current().practice[0]!.items[1]).toEqual({
      prompt: 'We ___ meet Jo.',
      answer: 'are going to',
      explanation: 'Use are with we.',
    });
    expect(h.container.querySelector('.assignment-editor-context')).toBeNull();
  });
  it('keeps incomplete local fields visible, marks errors and blocks learner view until repaired', () => {
    const h = setup();
    edit('Assignment title', '');
    expect(screen.getByRole('textbox', { name: 'Assignment title' })).toHaveProperty(
      'textContent',
      '',
    );
    expect(
      screen.getByRole('textbox', { name: 'Assignment title' }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Learner view' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toMatch(/not saved/);
    click('Assignment details');
    expect(screen.getByRole('heading', { name: 'Assignment details' })).toBeTruthy();
    expect(h.container.querySelector('.assignment-editor-context')).toBeNull();
    edit('Icon', '');
    edit('Support language', 'bad language');
    expect(screen.getByRole('textbox', { name: 'Icon' })).toHaveProperty('textContent', '');
    expect(screen.getByRole('textbox', { name: 'Support language' })).toHaveProperty(
      'textContent',
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
    click('Listen and read');
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
    click('Make it natural');
    click('Move group 2 up');
    expect(h.current().practice[0]!.title).toBe('Make it natural');
    click('Undo');
    click('Complete the plans');
    expect(h.current().practice[0]!.title).toBe('Complete the plans');
    click('Move Group 1 item 2 up');
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('She ___ take a picnic.');
    click('Add group 1 item');
    expect(h.current().practice[0]!.items).toHaveLength(4);
    edit('Group 1 · Prompt 4', 'We ___ call Jo.');
    fireEvent.focus(screen.getByRole('textbox', { name: 'Group 1 · Prompt 4' }));
    edit('Group 1 · Answer 4', 'are going to');
    click('Remove Group 1 item 4');
    click('Make it natural');
    click('Remove group 2');
    click('Actions for group 1');
    expect(screen.getByRole('menuitem', { name: 'Remove group 1' })).toHaveProperty(
      'disabled',
      true,
    );
    click('Undo');
    expect(h.current().practice).toHaveLength(2);
    click('Say it clearly');
    click('Remove pronunciation');
    expect(h.current().pronunciation).toBeNull();
    click('Undo');
    expect(h.current().pronunciation?.mode).toBe('shadow_sentence');
    click('Grammar & vocabulary');
    click('Add vocabulary entry');
    expect(h.current().toolkit.vocabulary).toHaveLength(2);
    click('Undo');
    expect(h.current().toolkit.vocabulary).toHaveLength(1);
  });
  it('cancels a pending drag when Undo restores earlier text', () => {
    const h = setup();
    edit('Group 1 · Prompt 1', 'Revised first question');
    const grip = screen.getByRole('button', { name: 'Actions for Group 1 item 1' });
    fireEvent.pointerDown(grip, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 100 });
    expect(h.container.querySelector('.assignment-editor-drag-ghost')).not.toBeNull();
    fireEvent.keyDown(grip, { key: 'z', ctrlKey: true });
    expect(h.container.querySelector('.assignment-editor-drag-ghost')).toBeNull();
    fireEvent.pointerUp(document, { clientX: 20, clientY: 100 });
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('I ___ visit the park.');
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', false);
    click('Redo');
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('Revised first question');
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
    expect(screen.getByRole('button', { name: 'Actions for pronunciation item 2' })).toBeTruthy();
    click('Undo');
    expect(screen.queryByRole('button', { name: 'Actions for pronunciation item 2' })).toBeNull();
    expect(() => validateFreshAssignmentV1(h.current(), context)).not.toThrow();
  });
  it('keeps an invalid stress/chunk buffer editable with the associated domain problem', () => {
    const initial = editorFixture();
    initial.pronunciation = pronunciationFixture('rhythm_chunking');
    setup(initial);
    edit('Drill 1 chunk 1', 'A different sentence');
    expect(screen.getByRole('alert').textContent).toContain('need attention');
    expect(screen.getByRole('textbox', { name: 'Drill 1 chunk 1' })).toHaveProperty(
      'textContent',
      'A different sentence',
    );
    const field = screen.getByRole('textbox', { name: 'Drill 1 chunk 1' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Chunks must reconstruct this drill text.',
    );
  });
  it('lets Tab leave a multiline selection and reach formatting for a single line', () => {
    const initial = editorFixture();
    initial.practice[0]!.items[0]!.prompt = 'Hello\nworld';
    setup(initial);
    const field = screen.getByRole('textbox', { name: 'Group 1 · Prompt 1' });
    act(() => field.focus());
    restoreTextSelection(field, { start: 0, end: 11 });
    fireEvent.mouseUp(field);
    expect(screen.queryByRole('toolbar', { name: 'Text formatting' })).toBeNull();
    const tab = createEvent.keyDown(field, { key: 'Tab', bubbles: true, cancelable: true });
    fireEvent(field, tab);
    expect(tab.defaultPrevented).toBe(false);
    restoreTextSelection(field, { start: 0, end: 5 });
    fireEvent.mouseUp(field);
    fireEvent.keyDown(field, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Highlight' }));
  });

  it('round-trips linguistic Highlight and removal and multilingual IME without HTML interpretation', async () => {
    const h = setup();
    const field = screen.getByRole('textbox', {
      name: 'Group 1 · Prompt 1',
    });
    act(() => field.focus());
    const range = document.createRange();
    range.setStart(field.firstChild!, 0);
    range.setEnd(field.firstChild!, 1);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(field);
    click('Highlight');
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('`I` ___ visit the park.');
    fireEvent.mouseUp(field);
    click('Remove highlight');
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('I ___ visit the park.');
    fireEvent.compositionStart(field);
    field.textContent = '日本語 <b>text</b>';
    fireEvent.input(field);
    fireEvent.compositionEnd(field);
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('日本語 <b>text</b>');
    expect(h.container.querySelector('b')).toBeNull();
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
    expect(h.current().practice[0]!.items[0]!.prompt).toBe('I ___ visit the park.');
  });
  it.each([0, 3, 5])(
    'keeps typing after Enter at offset %i, pastes plain text and redraws Undo/Redo',
    (offset) => {
      const initial = editorFixture();
      initial.practice[0]!.items[0]!.prompt = 'Hello';
      const h = setup(initial);
      const field = screen.getByRole('textbox', { name: 'Group 1 · Prompt 1' });
      act(() => field.focus());
      restoreTextSelection(field, { start: offset, end: offset });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(textSelection(field)).toEqual({ start: offset + 1, end: offset + 1 });
      fireEvent.paste(field, { clipboardData: { getData: () => '<b>plain</b>' } });
      expect(h.current().practice[0]!.items[0]!.prompt).toBe(
        'Hello'.slice(0, offset) + '\n<b>plain</b>' + 'Hello'.slice(offset),
      );
      expect(field.querySelector('b')).toBeNull();
      fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
      click('Redo');
      expect(field.textContent).toContain('<b>plain</b>');
      // An externally restored value must redraw even when it was emitted earlier in this session.
      click('Undo');
      click('Undo');
      expect(field.textContent).toBe('Hello');
    },
  );

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
    expect(screen.getAllByText(/Complete the plans/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('heading', { name: /^A\. Exercises/ })).toBeNull();
  });
  it('loads shared opening and closing animations for both learner disclosures', () => {
    setup();
    click('Learner view');
    for (const label of ['Transcript', 'Answer Key']) {
      const summary = screen.getByText(label, { selector: 'summary' });
      const details = summary.closest('details')!;
      const content = details.querySelector('.disclosure-content')!;
      const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null };
      const animate = vi.fn(() => animation);
      Object.assign(content, { animate });
      fireEvent.click(summary);
      expect(animate).toHaveBeenCalledTimes(1);
      expect(details.open).toBe(true);
      animation.onfinish?.();
      fireEvent.click(summary);
      expect(animate).toHaveBeenCalledTimes(2);
      // Closing remains open until the shared animation finishes.
      expect(details.open).toBe(true);
      animation.onfinish?.();
      expect(details.open).toBe(false);
    }
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
