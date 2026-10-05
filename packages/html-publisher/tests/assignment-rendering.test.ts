// @vitest-environment jsdom

import { readFileSync as readAssignmentFixture } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { AssignmentV1 as FixtureAssignmentV1 } from '@esl-pipeline/contracts';

import { renderAssignmentToHtml } from '../src/assignment-rendering.js';
import { createRenderedDocument } from './rendering.test-harness.js';

describe('native typed assignment rendering', () => {
  it.each([false, true])(
    'keeps native reading order with pronunciation present=%s',
    async (present) => {
      const a = assignmentFixture();
      if (!present) a.pronunciation = null;
      const original = JSON.stringify(a);
      const doc = createRenderedDocument(
        await renderAssignmentToHtml(a, {
          preview: true,
          studyTextAudioUrl: 'http://localhost/study.wav',
        }),
      );
      expect(doc.querySelector('.toc-shell, .table-of-contents')).toBeNull();
      expect(
        [...doc.querySelectorAll('.mission-key-language > li')].map((li) => li.textContent),
      ).toEqual(a.mission.keyLanguage);
      expect(doc.querySelector('#assignment-section-4')?.textContent).toBe(
        present ? '4. ✍️ Practice & Pronunciation' : '4. ✍️ Practice',
      );
      const transcript = doc.querySelector<HTMLDetailsElement>('details.study-text')!;
      expect(transcript.open).toBe(false);
      expect(transcript.previousElementSibling?.matches('.audio-figure')).toBe(true);
      expect(transcript.textContent).toContain(a.input.studyText.turns[0]!.text);
      const placeholder = createRenderedDocument(
        await renderAssignmentToHtml(a, { preview: true }),
      );
      expect(
        placeholder
          .querySelector('details.study-text')
          ?.previousElementSibling?.matches('.audio-placeholder'),
      ).toBe(true);

      const key = [...doc.querySelectorAll('details')].find(
        (d) => d.querySelector('summary')?.textContent === 'Answer Key',
      )!;
      expect([...key.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
        'Comprehension Check Answers',
        'A. Controlled Practice Answers',
        'Sample Mission',
      ]);
      const questions = [...a.input.comprehension, ...a.practice.flatMap((part) => part.items)];
      expect(
        [...key.querySelectorAll('.answer-key-item')].map((item) =>
          [...item.querySelectorAll('p')].map((p) => p.textContent),
        ),
      ).toEqual(
        questions.map((q) => [
          q.prompt,
          `Answer: ${q.answer}`,
          ...(q.explanation === null ? [] : [`Explanation: ${q.explanation}`]),
        ]),
      );
      const parts = a.practice.map(
        (part, i) => `Part ${i + 1}${part.title ? `: ${part.title}` : ''}`,
      );
      expect([...doc.querySelectorAll('main > h4')].map((h) => h.textContent)).toEqual(parts);
      expect([...key.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(parts);
      expect(JSON.stringify(a)).toBe(original);
    },
  );

  it('preserves authored trap punctuation and separates wrong, corrected and explanation roles', async () => {
    const a = assignmentFixture();
    a.toolkit.grammar[0]!.traps = [
      {
        original: 'He ride a bike.',
        improved: 'He rides a bike.',
        explanation: 'Use third-person -s.',
      },
      { original: 'Does he rides?', improved: 'Does he ride?', explanation: 'Use the base verb!' },
      { original: '<wrong>', improved: 'Wait...', explanation: 'Authored ellipsis remains...' },
    ];
    const doc = createRenderedDocument(await renderAssignmentToHtml(a));
    expect(
      [...doc.querySelectorAll('.grammar-trap')].map((trap) =>
        [...trap.querySelectorAll('p')].map((p) => p.textContent),
      ),
    ).toEqual(
      a.toolkit.grammar[0]!.traps.map((t) => [
        `Wrong: ${t.original}`,
        `Corrected: ${t.improved}`,
        `Explanation: ${t.explanation}`,
      ]),
    );
    expect(doc.querySelector('.grammar-traps')?.textContent).not.toContain('bike..');
    expect(doc.querySelector('.grammar-traps wrong')).toBeNull();
  });

  it('uses compact generated captions, omits exact duplicates and preserves source attribution', async () => {
    const a = assignmentFixture();
    a.input.source = {
      title: 'A useful demo',
      attribution: 'Demo contributor',
      url: 'https://example.com/source?a=1&b=2',
    };
    const generated = createRenderedDocument(await renderAssignmentToHtml(a));
    expect(generated.querySelector('.source-caption')?.textContent).toBe(a.input.source.title);
    expect(generated.querySelector('main')?.textContent).not.toContain('Title/Source');
    for (const title of [a.metadata.title, a.metadata.topic]) {
      a.input.source.title = title;
      expect(
        createRenderedDocument(await renderAssignmentToHtml(a)).querySelector('.source-caption'),
      ).toBeNull();
    }
    a.input.kind = 'authentic';
    const authentic = createRenderedDocument(await renderAssignmentToHtml(a));
    expect(authentic.querySelector('main')?.textContent).toContain(
      `Title/Source: ${a.input.source.title}`,
    );
    for (const doc of [generated, authentic]) {
      expect(doc.querySelector('main')?.textContent).toContain(a.input.source.attribution);
      expect(
        doc.querySelector('a[href="https://example.com/source?a=1&b=2"]')?.getAttribute('rel'),
      ).toBe('noopener noreferrer');
    }
  });

  it('preserves sections, disclosures, ordered answers, grammar, vocabulary and responsive shell', async () => {
    const a = assignmentFixture();
    const doc = createRenderedDocument(await renderAssignmentToHtml(a, { preview: true }));
    expect(doc.querySelectorAll('main > h2')).toHaveLength(8);
    expect(doc.querySelectorAll('details.study-text')).toHaveLength(1);
    const details = [...doc.querySelectorAll('details')];
    expect(
      details.find((d) => d.querySelector('summary')?.textContent === 'Answer Key')?.open,
    ).toBe(false);
    expect(
      details.find((d) => d.querySelector('summary')?.textContent === 'Teacher’s Follow-up Plan')
        ?.open,
    ).toBe(false);
    expect(doc.querySelector('.hero-title')?.textContent).toBe(a.metadata.title);
    expect(doc.querySelector('.page-tags')?.textContent).toContain(a.metadata.student);
    expect(doc.querySelector('table thead')?.textContent).toBe('ExpressionMeaningExample');
    expect(doc.querySelector('table tbody')?.textContent).toContain(
      a.toolkit.vocabulary[0]!.example,
    );
    expect(doc.querySelector('.table-scroll')).not.toBeNull();
    expect(doc.querySelector('style')?.textContent).toContain('@media');
    expect(doc.querySelector('.audio-placeholder')).not.toBeNull();
    expect(doc.querySelectorAll('.word-tts-button:disabled').length).toBeGreaterThan(0);
    const key = details.find((d) => d.querySelector('summary')?.textContent === 'Answer Key')!;
    expect([...key.querySelectorAll('ol')][0]?.textContent).toContain(
      a.input.comprehension[0]!.answer,
    );
    expect(key.textContent).toContain(a.outputTask.sampleResponse);
  });

  it('associates duplicate text clips by item index and pair side and binds controls once', async () => {
    const a = assignmentFixture();
    a.pronunciation = {
      mode: 'minimal_pair',
      target: 'Vowels',
      focus: 'Length',
      action: 'Repeat',
      deliverable: 'Record',
      pairs: [0, 1].map(() => ({
        left: { text: 'ship', transcription: null },
        right: { text: 'sheep', transcription: '/ʃiːp/' },
      })),
    };
    const clips = [0, 1].flatMap((i) =>
      ['left', 'right'].map((side) => ({
        id: `minimal-pair-${i + 1}-${side}`,
        itemIndex: i,
        kind: `pair_${side}` as 'pair_left' | 'pair_right',
        engine: 'provider' as const,
        text: side === 'left' ? 'ship' : 'sheep',
        url: `https://audio.test/${i}-${side}.mp3`,
      })),
    );
    const doc = createRenderedDocument(
      await renderAssignmentToHtml(a, {
        pronunciationAudio: { mode: 'minimal_pair', itemClips: clips },
      }),
    );
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>('[data-pronunciation-clip]')];
    expect(buttons.map((b) => b.dataset.pronunciationClip)).toEqual(clips.map((c) => c.id));
    const play = vi.fn().mockResolvedValue(undefined);
    const audio = vi.fn(function (this: { play: typeof play }, _url: string) {
      this.play = play;
    });
    Object.defineProperty(globalThis, 'Audio', { configurable: true, value: audio });
    buttons[2]!.click();
    expect(audio).toHaveBeenCalledExactlyOnceWith('https://audio.test/1-left.mp3');
    vi.unstubAllGlobals();
  });

  it('treats markup as literal data, blocks unsafe media, and preserves safe query URLs', async () => {
    const a = assignmentFixture();
    const hostile = '<img src=x onerror=evil()> :::toggle [link](javascript:evil()) | **plain**';
    a.metadata.title = hostile;
    a.toolkit.vocabulary[0]!.expression = hostile;
    a.input.studyText.turns[0]!.text = hostile;
    const html = await renderAssignmentToHtml(a, {
      studyTextAudioUrl: 'https://audio.test/a.mp3?x=1&y=2',
      pronunciationAudio: {
        mode: 'shadow_sentence',
        primaryClip: null,
        itemClips: [
          {
            id: 'bad',
            itemIndex: 0,
            kind: 'word_item',
            engine: 'provider',
            text: '</script><script>evil()</script>',
            url: 'javascript:evil()',
          },
        ],
      },
    });
    const doc = createRenderedDocument(html);
    expect(doc.querySelectorAll('img, object, embed')).toHaveLength(0);
    expect(doc.querySelector('.hero-title')?.textContent).toBe(hostile);
    expect(doc.querySelector('audio')?.getAttribute('src')).toBe(
      'https://audio.test/a.mp3?x=1&y=2',
    );
    expect(
      doc.querySelector('button[data-pronunciation-clip="bad"]')?.hasAttribute('disabled'),
    ).toBe(true);
    expect(doc.querySelector('#esl-pronunciation-audio')?.textContent).not.toContain('javascript:');
    expect(html).not.toContain('</script><script>evil()');
  });

  it.each(['connected_speech', 'intonation'] as const)(
    'renders native %s targets and available primary audio',
    async (mode) => {
      const a = assignmentFixture();
      const common = {
        target: 'Clear speech',
        focus: 'Practice',
        action: 'Repeat',
        deliverable: 'Record',
      };
      a.pronunciation =
        mode === 'connected_speech'
          ? {
              ...common,
              mode,
              lines: [{ careful: 'want to', spoken: '/wɒnə/' }],
              naturalSentence: 'I want to try.',
            }
          : {
              ...common,
              mode,
              drills: [{ text: 'Ready?', transcription: null, chunks: [], stressedWords: [] }],
              naturalSentence: 'Ready?',
              contourCue: 'Rise at the end.',
            };
      const doc = createRenderedDocument(
        await renderAssignmentToHtml(a, { pronunciationAudioUrl: 'https://audio.test/main.mp3' }),
      );
      expect(
        doc
          .querySelector('[data-assignment-pronunciation]')
          ?.getAttribute('data-assignment-pronunciation'),
      ).toBe(mode);
      expect(doc.querySelector('[data-pronunciation-item]')?.textContent).toContain(
        mode === 'connected_speech' ? 'want to' : 'Ready?',
      );
      expect(doc.querySelector('.pronunciation-sentence-anchor')?.textContent).toContain(
        a.pronunciation.naturalSentence,
      );
      expect(doc.querySelector('audio')?.getAttribute('src')).toBe('https://audio.test/main.mp3');
    },
  );

  it('keeps punctuation-aware stress, chunks and safe embedded source media', async () => {
    const a = assignmentFixture();
    a.pronunciation = {
      mode: 'sentence_stress',
      target: 'Contrast',
      focus: 'Stress',
      action: 'Repeat',
      deliverable: 'Record',
      drills: [
        { text: 'First, save it.', chunks: [], stressedWords: ['FIRST'], transcription: null },
      ],
      naturalSentence: 'First, save it.',
      contourCue: null,
    };
    a.input.media = [{ kind: 'video', url: 'https://youtu.be/abcdefghijk' }];
    const doc = createRenderedDocument(await renderAssignmentToHtml(a));
    expect(doc.querySelector('.pronunciation-line-text strong')?.textContent).toBe('First');
    expect(doc.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://www.youtube.com/embed/abcdefghijk',
    );
    a.pronunciation.mode = 'rhythm_chunking';
    a.pronunciation.drills[0]!.chunks = ['First,', 'save it.'];
    const chunks = createRenderedDocument(await renderAssignmentToHtml(a));
    expect(chunks.querySelector('.pronunciation-line-text')?.textContent).toBe('First, | save it.');
  });
});

function assignmentFixture(): FixtureAssignmentV1 {
  return JSON.parse(
    readAssignmentFixture(
      resolve(
        process.env.PIPELINE_CWD ?? process.cwd(),
        'packages/contracts/tests/assignment-fixture.json',
      ),
      'utf8',
    ),
  ) as FixtureAssignmentV1;
}
