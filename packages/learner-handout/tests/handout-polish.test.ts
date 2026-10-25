import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { validateAssignmentV1 } from '@esl-pipeline/contracts';

import grammar from '../../contracts/tests/assignment-grammar-fixture.json';
import { createFixture, createPolishFixture } from '../preview/fixtures.js';
import { renderLearnerHandoutDocument } from '../src/server.js';

describe('ESL-32 shared learner surface', () => {
  it('keeps only explicitly authored bracket cues attached without changing their text', () => {
    const props = createFixture();
    const prompt =
      'Use (`sail`), (`-ing`) and (`subject + a long sentence that may wrap`). Plain (sail), (ordinary prose `cue`), (`<img src=x>`). (`open and unmatched stay literal.';
    props.assignment.practice[0]!.items[0]!.prompt = prompt;
    const before = JSON.stringify(props);
    const doc = new JSDOM(renderLearnerHandoutDocument(props)).window.document;
    const item = doc.querySelector('.practice-part li')!;
    expect([...item.querySelectorAll('.bracketed-cue')].map((c) => c.textContent)).toEqual([
      '(sail)',
      '(-ing)',
      '(subject + a long sentence that may wrap)',
      '(<img src=x>)',
    ]);
    for (const cue of item.querySelectorAll('.bracketed-cue')) {
      expect(cue.firstChild?.textContent).toBe('(');
      expect(cue.lastChild?.textContent).toBe(')');
      expect(cue.querySelector('code')?.textContent).not.toMatch(/[()]/);
    }
    expect(item.textContent).toBe(
      'Use (sail), (-ing) and (subject + a long sentence that may wrap). Plain (sail), (ordinary prose cue), (<img src=x>). (`open and unmatched stay literal.',
    );
    expect(item.querySelector('img')).toBeNull();
    expect(JSON.stringify(props)).toBe(before);
  });

  it('admits the full retained lesson without shortening the visual fixture', () => {
    const props = createPolishFixture();
    expect(() => validateAssignmentV1(props.assignment)).not.toThrow();
    expect(props.assignment.input.studyText.turns).toHaveLength(6);
    const g = props.assignment.toolkit.grammar[0]!;
    if (!('formBlocks' in g)) throw new Error('Structured grammar required');
    expect(g.formBlocks).toHaveLength(3);
    expect(g.comparisons).toHaveLength(2);
    expect(props.assignment.toolkit.vocabulary).toHaveLength(5);
    expect(props.assignment.practice.map((p) => p.items.length)).toEqual([5, 3, 3]);
    expect(props.assignment.practice[0]!.items[0]!.prompt).toContain('(be)');
    expect(props.assignment.practice[0]!.items[0]!.prompt).not.toContain('`be`');
  });
  it('renders plain pattern alternatives and authored chunks as escaped cues without mutating data', () => {
    const props = createFixture();
    props.assignment = validateAssignmentV1(grammar);
    const topic = props.assignment.toolkit.grammar[0]!;
    if (!('formBlocks' in topic)) throw new Error('Structured grammar required');
    const plain = 'before + subject + present simple, imperative; subject + cannot + base verb';
    const authored =
      '`if + subject + present simple`, `subject + will + base verb`;\n`<img src=x onerror=evil()>` `open';
    topic.formBlocks[0]!.pattern = plain;
    topic.formBlocks[1]!.pattern = authored;
    const before = JSON.stringify(props);
    const doc = new JSDOM(renderLearnerHandoutDocument(props)).window.document;
    const patterns = doc.querySelectorAll('.grammar-pattern');
    expect(patterns[0]!.textContent).toBe(plain);
    expect(patterns[0]!.querySelectorAll('.pattern-line')).toHaveLength(2);
    expect([...patterns[0]!.querySelectorAll('code')].map((cue) => cue.textContent)).toEqual([
      'before + subject + present simple',
      'imperative',
      'subject + cannot + base verb',
    ]);
    expect([...patterns[1]!.querySelectorAll('code')].map((cue) => cue.textContent)).toEqual([
      'if + subject + present simple',
      'subject + will + base verb',
      '<img src=x onerror=evil()>',
      '`open',
    ]);
    expect(doc.querySelector('code code, img')).toBeNull();
    expect(JSON.stringify(props)).toBe(before);
  });

  it('keeps vocabulary column relationships and transcript speakers in the shared document', () => {
    const props = createFixture();
    const doc = new JSDOM(renderLearnerHandoutDocument(props)).window.document;
    const row = doc.querySelector('.vocabulary-table tbody tr')!;
    expect([...row.querySelectorAll('td')].map((cell) => cell.getAttribute('headers'))).toEqual([
      'vocabulary-expression',
      'vocabulary-meaning',
      'vocabulary-example',
    ]);
    expect(
      [...row.querySelectorAll('.vocabulary-cell-label')].every(
        (label) => label.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
    expect(doc.querySelector('.transcript-speaker')?.textContent).toBe(
      `${props.assignment.input.studyText.speakers[0]!.displayName}:`,
    );
    expect(doc.querySelector('.listening-panel audio')?.getAttribute('preload')).toBe('none');
    expect(doc.querySelector('.sample-mission')?.textContent).toBe(
      props.assignment.outputTask.sampleResponse,
    );
  });

  it('formats direct strings and Text/Field with escaped highlights and one part number', () => {
    const props = createFixture();
    props.assignment = validateAssignmentV1(grammar);
    props.assignment.metadata.icon = '🌦️';
    props.assignment.practice[0]!.title = '1. Исправь `форму`';
    const cue = 'После `will` нет `-s`. (`windy`) `<img src=x onerror=evil()>` `open 🌦️';
    props.assignment.practice[0]!.items[0]!.prompt = cue;
    props.assignment.toolkit.grammar[0]!.explanation = cue;
    props.assignment.toolkit.vocabulary[0] = {
      expression: '`get back`',
      meaning: cue,
      example: 'We `get back` soon.',
    };
    props.assignment.teacherFollowUp = {
      warmUp: 'PRIVATE_WARMUP',
      correctionFocus: 'PRIVATE_CORRECTION',
    };
    const before = JSON.stringify(props);
    const html = renderLearnerHandoutDocument(props);
    const doc = new JSDOM(html).window.document;
    const hero = doc.querySelector('.hero-icon')!;
    expect(hero.textContent).toBe('🌦️');
    expect(hero.getAttribute('aria-hidden')).toBe('true');
    expect(hero.querySelector('svg')).toBeNull();
    expect(
      [...doc.querySelectorAll('.practice-part h3, .practice-part h4')].map((h) => h.textContent),
    ).toEqual(['Part 1: Исправь форму', 'Part 2', 'Part 1: Исправь форму', 'Part 2']);
    const prompt = doc.querySelector('.practice-part li')!;
    expect(prompt.textContent).toBe(
      'После will нет -s. (windy) <img src=x onerror=evil()> `open 🌦️',
    );
    expect([...prompt.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'will',
      '-s',
      'windy',
      '<img src=x onerror=evil()>',
    ]);
    expect(doc.querySelector('tbody td strong code')?.textContent).toBe('get back');
    expect(doc.querySelector('tbody td em code')?.textContent).toBe('get back');
    expect(doc.querySelector('img')).toBeNull();
    for (const sentinel of [
      'PRIVATE_WARMUP',
      'PRIVATE_CORRECTION',
      "Teacher's Follow-up Plan",
      'assignment-section-8',
    ])
      expect(html).not.toContain(sentinel);
    expect(JSON.stringify(props)).toBe(before);
    delete props.assignment.metadata.icon;
    expect(
      new JSDOM(renderLearnerHandoutDocument(props)).window.document.querySelector('.hero-icon')
        ?.textContent,
    ).toBe('🎧');
    expect(props.assignment.metadata).not.toHaveProperty('icon');
  });

  it('reveals only the chosen line, preserves labels/language and never hides it again', () => {
    const props = createFixture();
    props.assignment = validateAssignmentV1(grammar);
    props.assignment.toolkit.grammar[0]!.traps.push({
      original: 'Wrong two',
      improved: 'Correct `two`',
      explanation: 'Explain `two`',
    });
    const dom = new JSDOM(renderLearnerHandoutDocument(props), { runScripts: 'dangerously' });
    const doc = dom.window.document;
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>('[data-grammar-reveal]')];
    const contents = [...doc.querySelectorAll<HTMLElement>('.reveal-content')];
    for (const button of buttons) {
      expect(button.textContent).toBe('');
      expect(button.getAttribute('aria-label')).toMatch(/^Reveal (corrected sentence|explanation)/);
      expect(button.querySelector('button, code, svg')).toBeNull();
      expect(button.parentElement!.querySelectorAll('button')).toHaveLength(1);
    }
    expect(contents.map((c) => c.getAttribute('aria-hidden'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    expect(
      [...doc.querySelectorAll('.grammar-reveal .field-label')].map((s) => s.textContent),
    ).toEqual(['Corrected:', 'Explanation:', 'Corrected:', 'Explanation:']);
    for (const marker of doc.querySelectorAll('.field-marker')) {
      expect(marker.querySelector('.field-label')?.classList.contains('sr-only')).toBe(true);
      expect(marker.querySelector('.field-decoration')?.getAttribute('aria-hidden')).toBe('true');
      expect(marker.querySelector('.field-decoration svg')).not.toBeNull();
      expect(marker.querySelector('button')).toBeNull();
    }
    expect(doc.querySelector('.grammar-traps')?.getAttribute('role')).toBe('list');
    expect(contents[0]!.lang).toBe('en');
    buttons[1]!.focus();
    buttons[1]!.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
    expect(contents.every((c) => c.getAttribute('aria-hidden') === 'true')).toBe(true);
    buttons[1]!.click();
    expect(doc.activeElement).toBe(contents[1]);
    expect(contents.map((c) => c.getAttribute('aria-hidden'))).toEqual([
      'true',
      null,
      'true',
      'true',
    ]);
    expect(buttons[1]!.hidden).toBe(true);
    buttons[1]!.click();
    expect(contents[1]!.getAttribute('aria-hidden')).toBeNull();
    buttons[2]!.click();
    expect(contents[2]!.querySelector('code')?.textContent).toBe('two');
    dom.window.close();
  });

  it('keeps the actual long cue-formatted answer escaped and unchanged behind an empty control', () => {
    const props = createPolishFixture();
    const answer =
      'Use `present simple` after the connector. <img src=x onerror=alert(1)> & keep this long explanation intact. '.repeat(
        5,
      );
    props.assignment.toolkit.grammar[0]!.traps[0]!.explanation = answer;
    const before = JSON.stringify(props);
    const dom = new JSDOM(renderLearnerHandoutDocument(props), { runScripts: 'dangerously' });
    const doc = dom.window.document;
    const target = doc.querySelectorAll('.reveal-target')[1]!;
    const content = target.querySelector<HTMLElement>('.reveal-content')!;
    const button = target.querySelector<HTMLButtonElement>('button')!;
    const text = content.textContent;
    expect(text).toBe(answer.replaceAll('`', ''));
    expect(content.querySelectorAll('code')).toHaveLength(5);
    expect(target.querySelector('img')).toBeNull();
    expect(button.textContent).toBe('');
    expect(content.getAttribute('aria-hidden')).toBe('true');
    button.click();
    expect(content.textContent).toBe(text);
    expect(content.getAttribute('aria-hidden')).toBeNull();
    expect(button.hidden).toBe(true);
    expect(JSON.stringify(props)).toBe(before);
    dom.window.close();
  });

  it('keeps per-button completion/retry truthful through switching and late events', async () => {
    const props = createFixture('minimal_pair', 'available');
    props.media!.pronunciationAudio!.itemClips!.forEach((clip) => {
      clip.label = 'Word';
    });
    const dom = new JSDOM(renderLearnerHandoutDocument(props), { runScripts: 'dangerously' });
    const audios: any[] = [];
    const play = vi.fn().mockResolvedValue(undefined);
    dom.window.Audio = class extends dom.window.EventTarget {
      pause = vi.fn();
      play = play;
      constructor() {
        super();
        audios.push(this);
      }
    } as unknown as typeof dom.window.Audio;
    const buttons = [
      ...dom.window.document.querySelectorAll<HTMLButtonElement>('[data-pronunciation-clip]'),
    ];
    const status = (i: number) => buttons[i]!.querySelector('.clip-status')!.textContent;
    const error = (i: number) =>
      buttons[i]!.parentElement!.querySelector<HTMLElement>('.clip-error')!;
    expect(status(0)).toBe('Play');
    expect(error(0).hidden).toBe(true);
    const icons = buttons[0]!.querySelectorAll('svg');
    expect(icons).toHaveLength(4);
    // Clicking a nested SVG must still trigger delegated playback.
    icons[0]!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(status(0)).toBe('Playing…');
    expect(buttons[0]!.dataset.playbackState).toBe('playing');
    buttons[1]!.click();
    expect(audios[0].pause).toHaveBeenCalledOnce();
    audios[0].dispatchEvent(new dom.window.Event('ended'));
    audios[0].dispatchEvent(new dom.window.Event('error'));
    expect(status(0)).toBe('Play');
    expect(error(0).hidden).toBe(true);
    expect(buttons[0]!.dataset.playbackState).toBe('play');
    expect(buttons[0]!.querySelectorAll('svg')).toHaveLength(4);
    expect(status(1)).toBe('Playing…');
    audios[1].dispatchEvent(new dom.window.Event('ended'));
    expect(status(1)).toBe('Replay');
    expect(buttons[1]!.dataset.playbackState).toBe('replay');
    play.mockRejectedValueOnce(new Error('offline'));
    buttons[1]!.click();
    await Promise.resolve();
    expect(status(1)).toBe('Retry');
    expect(error(1).hidden).toBe(false);
    expect(error(1).textContent).toBe("Couldn't play audio.");
    expect(buttons[1]!.querySelector('.clip-retry-label')?.textContent).toBe('Retry');
    expect(buttons[1]!.dataset.playbackState).toBe('retry');
    expect(buttons[1]!.getAttribute('aria-label')).toContain('Retry pronunciation for sheep');
    buttons[1]!.click();
    await Promise.resolve();
    expect(status(1)).toBe('Playing…');
    expect(error(1).hidden).toBe(true);
    audios[3].dispatchEvent(new dom.window.Event('error'));
    expect(error(1).hidden).toBe(false);
    buttons[0]!.click();
    audios[3].dispatchEvent(new dom.window.Event('error'));
    expect(error(1).hidden).toBe(true);
    expect(error(0).hidden).toBe(true);
    dom.window.close();
  });

  it('animates both directions, cancels rapid toggles and uses native reduced-motion behavior', () => {
    const dom = new JSDOM(renderLearnerHandoutDocument(createFixture()), {
      runScripts: 'dangerously',
    });
    const doc = dom.window.document;
    const details = doc.querySelector('details')!;
    const summary = details.querySelector('summary')!;
    const content = details.querySelector('.disclosure-content')!;
    const animations: any[] = [];
    const animate = vi.fn().mockImplementation(() => {
      const a = { cancel: vi.fn(), onfinish: () => {} };
      animations.push(a);
      return a;
    });
    Object.assign(content, { animate });
    Object.assign(dom.window, { matchMedia: () => ({ matches: false }) });
    summary.click();
    expect(details.open).toBe(true);
    summary.click();
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    animations[0].onfinish();
    expect(details.open).toBe(true);
    animations[1].onfinish();
    expect(details.open).toBe(false);
    summary.click();
    animations[2].onfinish();
    expect(details.open).toBe(true);
    Object.assign(dom.window, { matchMedia: () => ({ matches: true }) });
    summary.click();
    expect(details.open).toBe(false);
    expect(animate).toHaveBeenCalledTimes(3);
    dom.window.close();
  });
});
