import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { validateAssignmentV1 } from '@esl-pipeline/contracts';

import grammar from '../../contracts/tests/assignment-grammar-fixture.json';
import { createFixture } from '../preview/fixtures.js';
import { renderLearnerHandoutDocument } from '../src/server.js';

describe('ESL-32 shared learner surface', () => {
  it('formats direct strings and Text/Field with escaped highlights and one part number', () => {
    const props = createFixture();
    props.assignment = validateAssignmentV1(grammar);
    props.assignment.metadata.icon = '🌦️';
    props.assignment.practice[0]!.title = '1. Исправь `форму`';
    const cue = 'После `will` нет `-s`. (`windy`) `<img src=x onerror=evil()>` `open';
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
    expect(doc.querySelector('.hero-icon')?.textContent).toBe('🌦️');
    expect([...doc.querySelectorAll('.practice-part h4')].map((h) => h.textContent)).toEqual([
      'Part 1: Исправь форму',
      'Part 2',
      'Part 1: Исправь форму',
      'Part 2',
    ]);
    const prompt = doc.querySelector('.practice-part li')!;
    expect(prompt.textContent).toBe('После will нет -s. (windy) <img src=x onerror=evil()> `open');
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
    expect(contents.map((c) => c.getAttribute('aria-hidden'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    expect([...doc.querySelectorAll('.grammar-reveal > strong')].map((s) => s.textContent)).toEqual(
      ['Corrected:', 'Explanation:', 'Corrected:', 'Explanation:'],
    );
    expect(contents[0]!.lang).toBe('en');
    buttons[1]!.focus();
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

  it('keeps per-button completion/retry truthful through switching and late events', async () => {
    const dom = new JSDOM(
      renderLearnerHandoutDocument(createFixture('minimal_pair', 'available')),
      { runScripts: 'dangerously' },
    );
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
    buttons[0]!.click();
    expect(buttons[0]!.textContent).toBe('Playing…');
    buttons[1]!.click();
    expect(audios[0].pause).toHaveBeenCalledOnce();
    audios[0].dispatchEvent(new dom.window.Event('ended'));
    audios[0].dispatchEvent(new dom.window.Event('error'));
    expect(buttons[0]!.textContent).toBe('Play');
    expect(buttons[1]!.textContent).toBe('Playing…');
    audios[1].dispatchEvent(new dom.window.Event('ended'));
    expect(buttons[1]!.textContent).toBe('Replay');
    play.mockRejectedValueOnce(new Error('offline'));
    buttons[1]!.click();
    await Promise.resolve();
    expect(buttons[1]!.textContent).toBe('Retry');
    expect(buttons[1]!.getAttribute('aria-label')).toContain('Retry pronunciation for sheep');
    buttons[1]!.click();
    await Promise.resolve();
    expect(buttons[1]!.textContent).toBe('Playing…');
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
