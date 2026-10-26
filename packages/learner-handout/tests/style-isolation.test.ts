import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createFixture, createPolishFixture, pronunciationModes } from '../preview/fixtures.js';
import { LearnerHandout } from '../src/LearnerHandout.js';
import { Pronunciation } from '../src/Pronunciation.js';

describe('embedded learner-handout style boundary', () => {
  it('keeps selectors off representative host and sibling markup across media and interaction states', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    const { document, CSSRule } = dom.window;
    const host = document.createElement('section');
    host.innerHTML = `
      <h1>Tutor workspace</h1><h2>Assignment</h2><h3>Context</h3><p>Tutor guidance</p>
      <button class="minimal-primary">Create assignment</button>
      <button class="product-button product-button--primary">Continue</button>
      <button class="workspace-primary-btn" disabled>Saving</button>
      <button class="business-primary-button">Save settings</button>
      <details><summary>Support details</summary><a href="#">Help</a></details>
      <input><textarea></textarea><audio></audio>
    `;
    document.body.append(host);
    const embedded = document.createElement('div');
    embedded.innerHTML = renderToStaticMarkup(createElement(LearnerHandout, createPolishFixture()));
    for (const mode of pronunciationModes) {
      const fixture = createFixture(mode, 'mixed');
      const section = document.createElement('div');
      section.innerHTML = renderToStaticMarkup(
        createElement(Pronunciation, {
          pronunciation: fixture.assignment.pronunciation!,
          media: fixture.media,
          preview: true,
        }),
      );
      embedded.querySelector('.learner-handout')!.append(section);
    }
    document.body.append(embedded);
    // Identical sibling markup proves even generic class names stay inside the handout.
    const sibling = embedded.cloneNode(true) as HTMLElement;
    sibling.querySelector('.learner-handout')!.removeAttribute('class');
    document.body.append(sibling);
    const style = document.createElement('style');
    style.textContent = readFileSync(new URL('../src/handout.css', import.meta.url), 'utf8');
    document.head.append(style);

    const inspect = (rules: CSSRuleList): string[] => {
      const escaped: string[] = [];
      for (const rule of rules) {
        if (rule.type === CSSRule.STYLE_RULE) {
          const { selectorText } = rule as CSSStyleRule;
          const interaction = /:(hover|active|focus-visible|focus-within|focus)\b/g;
          const states = [
            ...new Set([...selectorText.matchAll(interaction)].map((match) => match[1]!)),
          ];
          // Check both truth values, preserving :not() and mixed positive/negative conditions.
          // These are selector-containment probes, not browser layout or cascade assertions.
          for (let mask = 0; mask < 2 ** states.length; mask++) {
            const selector = selectorText
              .replace(/::[\w-]+(?:\([^)]*\))?/g, ':where(*)')
              .replace(interaction, (_match, state: string) =>
                mask & (1 << states.indexOf(state)) ? ':where(*)' : ':not(*)',
              );
            if (
              [...document.querySelectorAll(selector)].some((el) => !el.closest('.learner-handout'))
            ) {
              escaped.push(selectorText);
              break;
            }
          }
        } else if ('cssRules' in rule) {
          // Check print/mobile rules too, independent of the runner's viewport/media support.
          escaped.push(...inspect((rule as CSSGroupingRule).cssRules));
        }
      }
      return escaped;
    };
    expect(style.sheet).not.toBeNull();
    expect(inspect(style.sheet!.cssRules)).toEqual([]);

    // Positive controls: the oracle must reject the reported and audited regressions.
    const leaks = [
      'button:hover:not(:disabled)',
      'button:not(:hover)',
      'button:hover:not(:focus-visible)',
      '.pronunciation-word-pair',
    ];
    const leakingStyle = document.createElement('style');
    leakingStyle.textContent = leaks
      .map((selector) => `${selector} { background: white; }`)
      .join('\n');
    document.head.append(leakingStyle);
    expect(inspect(leakingStyle.sheet!.cssRules)).toEqual(leaks);
    dom.window.close();
    // CSSOM matching over a rendered lesson and its sibling competes with the other jsdom suites.
  }, 15_000);
});
