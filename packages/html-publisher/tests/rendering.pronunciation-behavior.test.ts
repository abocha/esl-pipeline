// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type {
  PronunciationAudioClip,
  PronunciationAudioPayload,
} from '@esl-pipeline/shared-infrastructure';

import { renderToHtml } from '../src/rendering.js';
import { createRenderedDocument, extractBehaviorScript } from './rendering.test-harness.js';

function buildPronunciationAudioPayload(
  mode: PronunciationAudioPayload['mode'],
  itemClips: PronunciationAudioClip[],
  primaryClip?: PronunciationAudioClip,
): PronunciationAudioPayload {
  return {
    mode,
    ...(primaryClip ? { primaryClip } : {}),
    itemClips,
  };
}

describe('rendering', () => {
  it('ships browser word-level pronunciation controls for shadow_sentence mode', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** shadow_sentence
  **Shadow sentence:** The weather was unexpectedly warm.
  
  1. weather — /ˈweð.ər/
  2. unexpectedly — /ˌʌn.ɪkˈspek.tɪd.li/
  3. warm — /wɔːrm/`;
    const html = await renderToHtml(markdown, 'Pronunciation', {
      pronunciationAudio: buildPronunciationAudioPayload(
        'shadow_sentence',
        [
          {
            id: 'shadow-word-1-edge',
            itemIndex: 0,
            kind: 'word_item',
            engine: 'edge',
            text: 'weather',
            url: 'https://example.com/weather.mp3',
            label: 'Word',
          },
        ],
        {
          id: 'primary-shadow',
          kind: 'shadow_sentence',
          engine: 'provider',
          text: 'The weather was unexpectedly warm.',
          url: 'https://example.com/shadow.mp3',
          label: 'Sentence',
        },
      ),
    });
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
    expect(html).toContain('esl-pronunciation-audio');
  });

  it('ships browser connected-speech playback controls', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** connected_speech
  
  1. "Change helps us." -> Change help-sus.
  2. "It gives us food." -> It give-sus food.
  3. "Light feels stronger." -> Light feel-stronger.

  **Natural sentence practice:** The device is as heavy as the old one.`;
    const html = await renderToHtml(markdown, 'Connected Speech', {
      pronunciationAudio: buildPronunciationAudioPayload(
        'connected_speech',
        [
          {
            id: 'connected-1',
            itemIndex: 0,
            kind: 'connected_target',
            engine: 'provider',
            text: 'Change help-sus.',
            url: 'https://example.com/connected-1.mp3',
            label: 'Play',
          },
        ],
        {
          id: 'connected-sentence',
          kind: 'primary',
          engine: 'provider',
          text: 'The device is as heavy as the old one.',
          url: 'https://example.com/connected-sentence.mp3',
          label: 'Sentence',
        },
      ),
    });
    const renderedDocument = createRenderedDocument(html);
    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const firstItem = listItems.find((item) => item.textContent?.includes('Change helps us.'));
    const sentenceAnchor = renderedDocument.querySelector('.pronunciation-natural-sentence');
    const sentenceButtons = sentenceAnchor
      ? [...sentenceAnchor.querySelectorAll('.word-tts-button')]
      : [];

    expect(html).toContain('connected_speech');
    expect(html).toContain('Play connected speech line');
    expect(firstItem?.querySelector('.pronunciation-connected-line')).toBeTruthy();
    expect(firstItem?.querySelector('.pronunciation-connected-careful')?.textContent).toContain(
      'Change helps us.',
    );
    expect(firstItem?.querySelector('.pronunciation-connected-target')?.textContent).toContain(
      'Change help-sus.',
    );
    expect(sentenceAnchor?.textContent).toContain('Natural sentence practice:');
    expect(sentenceAnchor?.textContent).toContain('The device is as heavy as the old one.');
    expect(sentenceButtons).toHaveLength(1);
    expect(sentenceButtons[0]?.getAttribute('aria-label')).toContain('Play pronunciation sentence');
  });

  it('renders sentence-level pronunciation controls for intonation mode', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** intonation
  
  1. Do you have a second? — /duː juː hæv ə ˈsekənd/ Contour cue: rise
  2. Is everything okay? — /ɪz ˈevriθɪŋ oʊˈkeɪ/ Contour cue: rise

  **Natural sentence practice:** Are you free tonight after work?`;
    const html = await renderToHtml(markdown, 'Intonation Pronunciation', {
      pronunciationAudio: buildPronunciationAudioPayload(
        'intonation',
        [
          {
            id: 'intonation-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'Do you have a second?',
            url: 'https://example.com/intonation-1.mp3',
            label: 'Play',
          },
        ],
        {
          id: 'intonation-sentence',
          kind: 'primary',
          engine: 'provider',
          text: 'Are you free tonight after work?',
          url: 'https://example.com/intonation-sentence.mp3',
          label: 'Sentence',
        },
      ),
    });
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const firstItem = listItems.find((item) => item.textContent?.includes('Do you have a second?'));
    const sentenceAnchor = renderedDocument.querySelector('.pronunciation-natural-sentence');
    const sentenceButtons = sentenceAnchor
      ? [...sentenceAnchor.querySelectorAll('.word-tts-button')]
      : [];

    expect(firstItem?.querySelector('.word-tts-button')?.textContent).toBe('Play');
    expect(firstItem?.querySelector('.pronunciation-line-text')?.textContent).toContain(
      'Do you have a second?',
    );
    expect(firstItem?.querySelector('.word-tts-transcription')?.textContent).toBe(
      '/duː juː hæv ə ˈsekənd/',
    );
    expect(firstItem?.querySelector('.pronunciation-contour-badge')?.textContent).toBe('rise');
    expect(sentenceAnchor?.textContent).toContain('Are you free tonight after work?');
    expect(sentenceButtons).toHaveLength(1);
  });

  it('renders disabled pronunciation buttons when preview payload has no clip URLs yet', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** intonation
  
  1. Do you have a second? — /duː juː hæv ə ˈsekənd/ Contour cue: rise

  **Natural sentence practice:** Are you free tonight after work?`;
    const html = await renderToHtml(markdown, 'Preview Pronunciation', {
      pronunciationAudio: buildPronunciationAudioPayload(
        'intonation',
        [
          {
            id: 'intonation-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'Do you have a second?',
            label: 'Play',
          },
        ],
        {
          id: 'intonation-sentence',
          kind: 'primary',
          engine: 'provider',
          text: 'Are you free tonight after work?',
          label: 'Sentence',
        },
      ),
    });
    const renderedDocument = createRenderedDocument(html);
    const buttons = [...renderedDocument.querySelectorAll('.word-tts-button')];
    const sentenceAnchor = renderedDocument.querySelector('.pronunciation-natural-sentence');

    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.getAttribute('disabled') !== null)).toBe(true);
    expect(buttons[0]?.getAttribute('title')).toContain('not generated yet');
    expect(sentenceAnchor?.textContent).toContain('Natural sentence practice:');
  });

  it('renders rhythm_chunking drill lines with playback controls', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** rhythm_chunking
  
  1. We should | review this | carefully. — /wi ʃʊd rɪˈvjuː ðɪs ˈkeə.fəl.i/
  2. Let me know | when you arrive. — /let mi nəʊ wen ju əˈraɪv/

  **Natural sentence practice:** We should review this carefully before class.`;
    const html = await renderToHtml(markdown, 'Rhythm Chunking', {
      pronunciationAudio: buildPronunciationAudioPayload(
        'rhythm_chunking',
        [
          {
            id: 'rhythm-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'We should review this carefully.',
            url: 'https://example.com/rhythm-1.mp3',
            label: 'Play',
          },
        ],
        {
          id: 'rhythm-sentence',
          kind: 'primary',
          engine: 'provider',
          text: 'We should review this carefully before class.',
          url: 'https://example.com/rhythm-sentence.mp3',
          label: 'Sentence',
        },
      ),
    });
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const firstItem = listItems.find((item) => item.textContent?.includes('We should'));
    const sentenceAnchor = renderedDocument.querySelector('.pronunciation-natural-sentence');

    expect(firstItem?.querySelector('.word-tts-button')?.textContent).toBe('Play');
    expect(firstItem?.textContent).toContain('We should | review this | carefully.');
    expect(sentenceAnchor?.textContent).toContain('We should review this carefully before class.');
  });

  it('renders sentence_stress drill lines with playback controls', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** sentence_stress
  
  1. We **really** need to leave now. — /wi ˈrɪə.li niːd tə liːv naʊ/
  2. I **can** help with that. — /aɪ kən help wɪð ðæt/

  **Natural sentence practice:** We really need to leave now before traffic gets worse.`;
    const html = await renderToHtml(markdown, 'Sentence Stress', {
      pronunciationAudio: buildPronunciationAudioPayload(
        'sentence_stress',
        [
          {
            id: 'stress-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'We really need to leave now.',
            url: 'https://example.com/stress-1.mp3',
            label: 'Play',
          },
        ],
        {
          id: 'stress-sentence',
          kind: 'primary',
          engine: 'provider',
          text: 'We really need to leave now before traffic gets worse.',
          url: 'https://example.com/stress-sentence.mp3',
          label: 'Sentence',
        },
      ),
    });
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const firstItem = listItems.find((item) => item.textContent?.includes('really'));
    const sentenceAnchor = renderedDocument.querySelector('.pronunciation-natural-sentence');

    expect(firstItem?.querySelector('.word-tts-button')?.textContent).toBe('Play');
    expect(firstItem?.textContent).toContain('really');
    expect(sentenceAnchor?.textContent).toContain(
      'We really need to leave now before traffic gets worse.',
    );
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

  it('renders play controls for both sides of each minimal pair', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** minimal_pair
  **Target:** Differentiating the short /ɪ/ from the long /iː/.
  
  1. Stiff /stɪf/ — Steve /stiːv/
  2. Live /lɪv/ — Leave /liːv/`;
    const html = await renderToHtml(markdown, 'Minimal Pair Controls', {
      pronunciationAudio: buildPronunciationAudioPayload('minimal_pair', [
        {
          id: 'minimal-1-left',
          itemIndex: 0,
          kind: 'pair_left',
          engine: 'edge',
          text: 'Stiff',
          url: 'https://example.com/stiff.mp3',
          label: 'Left',
        },
        {
          id: 'minimal-1-right',
          itemIndex: 0,
          kind: 'pair_right',
          engine: 'edge',
          text: 'Steve',
          url: 'https://example.com/steve.mp3',
          label: 'Right',
        },
      ]),
    });
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.markdown-body li')];
    const firstItem = listItems.find((item) => item.textContent?.includes('Stiff'));
    const buttons = firstItem ? [...firstItem.querySelectorAll('.word-tts-button')] : [];
    const transcriptions = firstItem
      ? [...firstItem.querySelectorAll('.word-tts-transcription')].map((node) => node.textContent)
      : [];

    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute('aria-label')).toContain('Stiff /stɪf/');
    expect(buttons[1]?.getAttribute('aria-label')).toContain('Steve /stiːv/');
    expect(transcriptions).toEqual(['/stɪf/', '/stiːv/']);
    expect(firstItem?.querySelector('.pronunciation-word-pair')).toBeTruthy();
  });

  it('matches drill item clips by numbered drill order inside pronunciation callouts', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  :::callout 🗣️
  - **Mode:** minimal_pair
  - **Target:** Hear the short /ɪ/ and long /iː/ clearly.
  - **Focus:** Notice the vowel length difference.
  - **Action:** Listen and repeat both words.
  - **Deliverable:** One short recording.
  - 1. ship /ʃɪp/ — sheep /ʃiːp/
  - 2. live /lɪv/ — leave /liːv/
  :::`;
    const html = await renderToHtml(markdown, 'Minimal Pair Callout Indexing', {
      pronunciationAudio: buildPronunciationAudioPayload('minimal_pair', [
        {
          id: 'minimal-callout-1-left',
          itemIndex: 0,
          kind: 'pair_left',
          engine: 'edge',
          text: 'ship',
          url: 'https://example.com/ship.mp3',
          label: 'Left',
        },
        {
          id: 'minimal-callout-1-right',
          itemIndex: 0,
          kind: 'pair_right',
          engine: 'edge',
          text: 'sheep',
          url: 'https://example.com/sheep.mp3',
          label: 'Right',
        },
      ]),
    });
    const renderedDocument = createRenderedDocument(html);

    const listItems = [...renderedDocument.querySelectorAll('.callout .content li')];
    const drillItem = listItems.find((item) => item.textContent?.includes('ship'));
    const buttons = drillItem ? [...drillItem.querySelectorAll('.word-tts-button')] : [];

    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute('aria-label')).toContain('ship /ʃɪp/');
    expect(buttons[1]?.getAttribute('aria-label')).toContain('sheep /ʃiːp/');
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
    expect(scriptText).toContain('esl-pronunciation-audio');
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
    expect(paragraphs[1]?.querySelector('.pronunciation-shadow-sentence')).toBeTruthy();
  });

  it('preserves inline markup in word-drill items after behavior script runs', async () => {
    const markdown = `### C. Pronunciation Micro-Focus
  
  **Mode:** shadow_sentence
  **Shadow sentence:** There was a flood, so the vehicle stopped working.
  
  1. \`Flood\` — /flʌd/
  2. *Vehicle* — /viːɪkl/
  3. **Stopped** — /stɒpt/`;
    const html = await renderToHtml(markdown, 'Pronunciation Inline Markup', {
      pronunciationAudio: buildPronunciationAudioPayload('shadow_sentence', [
        {
          id: 'inline-1',
          itemIndex: 0,
          kind: 'word_item',
          engine: 'edge',
          text: 'Flood',
          url: 'https://example.com/flood.mp3',
          label: 'Play',
        },
      ]),
    });
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
    const html = await renderToHtml(markdown, 'Pronunciation Notes', {
      pronunciationAudio: buildPronunciationAudioPayload('shadow_sentence', [
        {
          id: 'notes-1',
          itemIndex: 0,
          kind: 'word_item',
          engine: 'edge',
          text: "wouldn't",
          url: 'https://example.com/wouldnt.mp3',
          label: 'Play',
        },
      ]),
    });
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
    const html = await renderToHtml(markdown, 'Pronunciation No Dash', {
      pronunciationAudio: buildPronunciationAudioPayload('shadow_sentence', [
        {
          id: 'no-dash-1',
          itemIndex: 0,
          kind: 'word_item',
          engine: 'edge',
          text: "wouldn't",
          url: 'https://example.com/no-dash.mp3',
          label: 'Play',
        },
      ]),
    });
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
    const html = await renderToHtml(markdown, 'Pronunciation Slash Word', {
      pronunciationAudio: buildPronunciationAudioPayload('shadow_sentence', [
        {
          id: 'slash-1',
          itemIndex: 0,
          kind: 'word_item',
          engine: 'edge',
          text: 'and/or',
          url: 'https://example.com/and-or.mp3',
          label: 'Play',
        },
        {
          id: 'slash-2',
          itemIndex: 1,
          kind: 'word_item',
          engine: 'edge',
          text: 'either/or',
          url: 'https://example.com/either-or.mp3',
          label: 'Play',
        },
      ]),
    });
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
