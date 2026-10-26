import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createPolishFixture } from '../preview/fixtures.js';
import { LearnerHandout } from '../src/LearnerHandout.js';

describe('embedded learner-handout style boundary', () => {
  it('cannot style the host document, tutor controls or sibling content in any media/state rule', () => {
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
    document.body.append(embedded);
    // Identical sibling markup proves even generic class names stay inside the handout.
    const sibling = embedded.cloneNode(true) as HTMLElement;
    sibling.querySelector('.learner-handout')!.removeAttribute('class');
    document.body.append(sibling);
    const style = document.createElement('style');
    style.textContent = readFileSync(new URL('../src/handout.css', import.meta.url), 'utf8');
    document.head.append(style);

    const escaped: string[] = [];
    const inspect = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule.type === CSSRule.STYLE_RULE) {
          const { selectorText } = rule as CSSStyleRule;
          // Exercise interaction and pseudo-element owners without relying on jsdom hover/layout.
          const selector = selectorText
            .replace(/::[\w-]+(?:\([^)]*\))?/g, ':where(*)')
            .replace(/:(?:hover|active|focus-visible|focus-within|focus)\b/g, ':where(*)');
          if (
            [...document.querySelectorAll(selector)].some((el) => !el.closest('.learner-handout'))
          ) {
            escaped.push(selectorText);
          }
        } else if ('cssRules' in rule) {
          // Check print/mobile rules too, independent of the runner's viewport/media support.
          inspect((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    expect(style.sheet).not.toBeNull();
    inspect(style.sheet!.cssRules);
    expect(escaped).toEqual([]);
    dom.window.close();
    // CSSOM matching over a rendered lesson and its sibling competes with the other jsdom suites.
  }, 15_000);
});
