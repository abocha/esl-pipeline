// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderToHtml } from '../src/rendering.js';
import { createRenderedDocument, extractBehaviorScript } from './rendering.test-harness.js';

describe('rendering', () => {
  it('ships browser word-level pronunciation controls for shadow_sentence mode', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** shadow_sentence
  **Shadow sentence:** The weather was unexpectedly warm.
  
  1. weather — /ˈweð.ər/
  2. unexpectedly — /ˌʌn.ɪkˈspek.tɪd.li/
  3. warm — /wɔːrm/`;
    const html = await renderToHtml(markdown, 'Pronunciation');
    expect(html).toContain('.word-tts-button');
    expect(html).toContain('.pronunciation-word-tts');
    expect(html).toContain('.pronunciation-shadow-sentence');
    expect(html).toContain('.pronunciation-word-main');
    expect(html).toContain('.pronunciation-word-content');
    expect(html).toContain('Charis+SIL');
    expect(html).toContain("font-family: 'Charis SIL'");
    expect(html).toContain('justify-content: flex-start;');
    expect(html).not.toContain('justify-content: space-between;');
    expect(html).toContain('shadow_sentence');
    expect(html).not.toContain('item.replaceChildren(wordMain);');
    expect(html).toContain('speechSynthesis');
  });

  it('ships browser connected-speech playback controls', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** connected_speech
  
  1. "Change helps us." -> Change help-sus.
  2. "It gives us food." -> It give-sus food.
  3. "Light feels stronger." -> Light feel-stronger.`;
    const html = await renderToHtml(markdown, 'Connected Speech');
    expect(html).toContain('connected_speech');
    expect(html).toContain('Play connected speech line');
  });

  it('ships word-level pronunciation controls for non-shadow pronunciation modes', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** intonation
  
  1. rise-fall — /ˈraɪz.fɔːl/
  2. contrastive stress — /kənˈtræs.tɪv stres/`;
    const html = await renderToHtml(markdown, 'Intonation Pronunciation');
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const firstItem = listItems.find((item) => item.textContent?.includes('rise-fall'));

    expect(firstItem?.querySelector('.word-tts-button')?.textContent).toBe('Play');
    expect(firstItem?.querySelector('.word-tts-transcription')?.textContent).toBe('/ˈraɪz.fɔːl/');
    expect(firstItem?.textContent?.match(/\/ˈraɪz.fɔːl\//g)?.length ?? 0).toBe(1);
  });

  it('does not require numbered word drills in other pronunciation modes', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** minimal_pair
  
  **Target:** Distinguish ship and sheep.
  
  **Action:** Listen and repeat carefully.`;
    const html = await renderToHtml(markdown, 'Minimal Pair Without Drill List');
    const renderedDocument = createRenderedDocument(html);

    expect(renderedDocument.body.textContent).toContain('Target:');
    expect(renderedDocument.querySelector('.word-tts-button')).toBeNull();
  });

  it('emits a parseable behavior script', async () => {
    const html = await renderToHtml('### C. Pronunciation Micro-Focus', 'Script Parse');
    const scriptText = extractBehaviorScript(html);
    expect(scriptText).toBeTruthy();
    expect(scriptText).toContain('theme-preference');
    expect(scriptText).toContain('data-generated-colgroup');
    expect(scriptText).toContain('data-balanced-columns');
    expect(scriptText).toContain('data-table-archetype');
    expect(scriptText).toContain('data-cell-prose');
    expect(scriptText).toContain('if (!isDesktopViewport())');
    expect(scriptText).toContain(
      "existingColgroup.getAttribute('data-generated-colgroup') !== 'true'",
    );
    expect(scriptText).toContain('speechSynthesis');
    expect(() => new Function(scriptText)).not.toThrow();
  });

  it('normalizes LLM-variant pronunciation markup for clean rendering', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  :::callout 🗣️
  - \`**Mode:** shadow_sentence\`
  - \`**Shadow sentence:** There was a flood, so the vehicle stopped working.\`
  - 1. \`Flood\` — /flʌd/
  - 2. \`Vehicle\` — /viːɪkl/
  - 3. \`Stopped\` — /stɒpt/ (End with T sound)
  :::`;
    const html = await renderToHtml(markdown, 'Pronunciation Variant');
    const renderedDocument = createRenderedDocument(html);
    expect(html).toContain('<strong>Shadow sentence:</strong>');
    expect(html).not.toContain('<code>**Shadow sentence:**');
    expect(renderedDocument.querySelector('#content')?.textContent).not.toContain('?.[');
  });

  it('targets only the shadow sentence line inside pronunciation callouts', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  :::callout 🗣️
  - \`**Mode:** shadow_sentence\`
  - \`**Shadow sentence:** There was a flood, so the vehicle stopped working.\`
  - 1. \`Flood\` — /flʌd/
  :::`;
    const html = await renderToHtml(markdown, 'Pronunciation Shadow Target');
    const renderedDocument = createRenderedDocument(html);

    const shadowSentence = renderedDocument.querySelector('.pronunciation-shadow-sentence');
    expect(shadowSentence).toBeTruthy();
    expect(shadowSentence?.textContent).toContain('Shadow sentence');

    const callout = renderedDocument.querySelector('.callout');
    expect(callout).toBeTruthy();
    expect(callout?.classList.contains('pronunciation-shadow-sentence')).toBe(false);
  });

  it('does not mistake the mode line for the shadow sentence in paragraph callouts', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  :::callout 🗣️
  **Mode:** shadow_sentence
  **Target:** The weak /ə/ in appointment and the smooth flow of negative contractions.
  **Focus:** You have a tendency to add an intrusive "O" sound in contractions.
  **Action:** Listen to the audio and shadow the sentence.
  
  **Shadow sentence:** I wouldn't have made an appointment if I had known the price.
  
  1. wouldn't — /ˈwʊd.ənt/
  :::`;
    const html = await renderToHtml(markdown, 'Pronunciation Paragraph Callout');
    const renderedDocument = createRenderedDocument(html);

    const highlighted = renderedDocument.querySelector('.pronunciation-shadow-sentence');
    expect(highlighted).toBeTruthy();
    expect(highlighted?.textContent).toContain('Shadow sentence:');
    expect(highlighted?.textContent).not.toContain('Mode: shadow_sentence');

    const paragraphs = [...renderedDocument.querySelectorAll('.callout .content p')];
    expect(paragraphs[0]?.classList.contains('pronunciation-shadow-sentence')).toBe(false);
    expect(paragraphs[1]?.classList.contains('pronunciation-shadow-sentence')).toBe(true);
  });

  it('preserves inline markup in word-drill items after behavior script runs', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** shadow_sentence
  **Shadow sentence:** There was a flood, so the vehicle stopped working.
  
  1. \`Flood\` — /flʌd/
  2. *Vehicle* — /viːɪkl/
  3. **Stopped** — /stɒpt/`;
    const html = await renderToHtml(markdown, 'Pronunciation Inline Markup');
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const floodItem = listItems.find((item) => item.textContent?.includes('Flood'));
    const vehicleItem = listItems.find((item) => item.textContent?.includes('Vehicle'));
    const stoppedItem = listItems.find((item) => item.textContent?.includes('Stopped'));

    expect(floodItem?.querySelector('code')?.textContent).toContain('Flood');
    expect(vehicleItem?.querySelector('em')?.textContent).toContain('Vehicle');
    expect(stoppedItem?.querySelector('strong')?.textContent).toContain('Stopped');
    expect(floodItem?.querySelector('.word-tts-button')?.textContent).toBe('Play');
    expect(vehicleItem?.querySelector('.pronunciation-word-main')).toBeTruthy();
    expect(floodItem?.querySelector('.pronunciation-word-content')?.textContent).not.toContain(
      '/flʌd/',
    );
    expect(floodItem?.textContent?.match(/\/flʌd\//g)?.length ?? 0).toBe(1);
  });

  it('renders optional pronunciation notes on the right without duplicating transcription', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** shadow_sentence
  **Shadow sentence:** I wouldn't have made an appointment if I had known the price.
  
  1. wouldn't — /ˈwʊd.ənt/ (wu-DNT, NOT wud-not!)
  2. appointment — /əˈpɔɪnt.mənt/`;
    const html = await renderToHtml(markdown, 'Pronunciation Notes');
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const wouldntItem = listItems.find((item) => item.textContent?.includes("wouldn't"));

    expect(wouldntItem?.querySelector('.pronunciation-word-content')?.textContent).toContain(
      "wouldn't",
    );
    expect(wouldntItem?.querySelector('.pronunciation-word-content')?.textContent).not.toContain(
      '—',
    );
    expect(wouldntItem?.querySelector('.pronunciation-word-content')?.textContent).not.toContain(
      '/ˈwʊd.ənt/',
    );
    expect(wouldntItem?.querySelector('.word-tts-transcription')?.textContent).toBe('/ˈwʊd.ənt/');
    expect(wouldntItem?.textContent?.match(/\/ˈwʊd.ənt\//g)?.length ?? 0).toBe(1);
    expect(wouldntItem?.querySelector('.pronunciation-word-note')?.textContent).toBe(
      '(wu-DNT, NOT wud-not!)',
    );
  });

  it('supports word drill lines without dash delimiters', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** shadow_sentence
  **Shadow sentence:** I wouldn't have made an appointment if I had known the price.
  
  1. wouldn't /ˈwʊd.ənt/
  2. have /əv/
  3. appointment /əˈpɔɪnt.mənt/`;
    const html = await renderToHtml(markdown, 'Pronunciation No Dash');
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const wouldntItem = listItems.find((item) => item.textContent?.includes("wouldn't"));

    expect(wouldntItem?.querySelector('.word-tts-button')?.textContent).toBe('Play');
    expect(wouldntItem?.querySelector('.word-tts-transcription')?.textContent).toBe('/ˈwʊd.ənt/');
    expect(wouldntItem?.querySelector('.pronunciation-word-content')?.textContent).toContain(
      "wouldn't",
    );
    expect(wouldntItem?.querySelector('.pronunciation-word-content')?.textContent).not.toContain(
      '—',
    );
    expect(wouldntItem?.textContent?.match(/\/ˈwʊd.ənt\//g)?.length ?? 0).toBe(1);
  });

  it('preserves slash-bearing words for dashed and no-dash pronunciation lines', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** shadow_sentence
  **Shadow sentence:** Please practice and/or quickly.
  
  1. and/or — /ˈændɔːr/
  2. either/or /ˈaɪðərɔːr/
  3. quickly /ˈkwɪkli/`;
    const html = await renderToHtml(markdown, 'Pronunciation Slash Word');
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const andOrItem = listItems.find((item) => item.textContent?.includes('and/or'));
    const eitherOrItem = listItems.find((item) => item.textContent?.includes('either/or'));

    expect(andOrItem?.querySelector('.pronunciation-word-content')?.textContent).toContain(
      'and/or',
    );
    expect(andOrItem?.querySelector('.word-tts-transcription')?.textContent).toBe('/ˈændɔːr/');
    expect(andOrItem?.textContent?.match(/\/ˈændɔːr\//g)?.length ?? 0).toBe(1);

    expect(eitherOrItem?.querySelector('.pronunciation-word-content')?.textContent).toContain(
      'either/or',
    );
    expect(eitherOrItem?.querySelector('.word-tts-transcription')?.textContent).toBe('/ˈaɪðərɔːr/');
    expect(eitherOrItem?.textContent?.match(/\/ˈaɪðərɔːr\//g)?.length ?? 0).toBe(1);
  });
});
