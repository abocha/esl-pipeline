import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import type { AssignmentV1 } from '@esl-pipeline/contracts';
import { renderLearnerHandoutDocument } from '@esl-pipeline/learner-handout/server';
import type { PronunciationAudioPayload } from '@esl-pipeline/shared-infrastructure';

import { ASSIGNMENT_HTML_RENDERER_VERSION, renderAssignmentToHtml } from '../src/index.js';

const fixture = (): AssignmentV1 =>
  JSON.parse(
    readFileSync(new URL('../../contracts/tests/assignment-fixture.json', import.meta.url), 'utf8'),
  );
const documentFor = async (options = {}) =>
  new JSDOM(await renderAssignmentToHtml(fixture(), options)).window.document;
const primary = (url?: string) => ({
  id: 'resolved-primary',
  kind: 'primary' as const,
  engine: 'provider' as const,
  text: 'Sentence',
  url,
});

describe('native React publication adapter', () => {
  it('delegates the full document to learner-handout and keeps renderer identity separate', async () => {
    const assignment = fixture();
    const before = JSON.stringify(assignment);
    const html = await renderAssignmentToHtml(assignment);
    expect(html).toBe(renderLearnerHandoutDocument({ assignment }));
    expect(JSON.stringify(assignment)).toBe(before);
    expect(ASSIGNMENT_HTML_RENDERER_VERSION).toBe(3);
  });

  it.each([
    {
      structured: undefined,
      fallback: 'https://audio.test/url-only.mp3',
      expected: 'https://audio.test/url-only.mp3',
    },
    {
      structured: primary('https://audio.test/structured.mp3'),
      fallback: 'https://audio.test/fallback.mp3',
      expected: 'https://audio.test/structured.mp3',
    },
    {
      structured: primary(),
      fallback: 'https://audio.test/fallback.mp3',
      expected: 'https://audio.test/fallback.mp3',
    },
    {
      structured: primary('javascript:evil()'),
      fallback: 'https://audio.test/fallback.mp3',
      expected: 'https://audio.test/fallback.mp3',
    },
    { structured: undefined, fallback: 'data:audio/mp3,evil', expected: null },
    { structured: undefined, fallback: undefined, expected: null },
  ])(
    'preserves primary URL precedence and admits safe media: $expected',
    async ({ structured, fallback, expected }) => {
      const doc = await documentFor({
        studyTextAudioUrl: 'https://audio.test/study.mp3',
        pronunciationAudioUrl: fallback,
        pronunciationAudio: { mode: 'shadow_sentence', primaryClip: structured },
      });
      expect(doc.querySelector('audio[aria-label="Study audio"]')?.getAttribute('src')).toBe(
        'https://audio.test/study.mp3',
      );
      expect(
        doc
          .querySelector('audio[aria-label="Pronunciation sentence audio"]')
          ?.getAttribute('src') ?? null,
      ).toBe(expected);
      expect(
        doc.querySelector('[data-assignment-pronunciation] .audio-placeholder')?.textContent ??
          null,
      ).toBe(expected ? null : 'Pronunciation sentence audio: audio unavailable');
    },
  );

  it('maps item clips by index and minimal-pair side, never by duplicate word text or payload order', async () => {
    const assignment = fixture();
    assignment.pronunciation = {
      target: 'Vowels',
      focus: 'Contrast',
      action: 'Repeat',
      deliverable: 'Say both',
      mode: 'minimal_pair',
      pairs: [0, 1].map(() => ({
        left: { text: 'ship', transcription: null },
        right: { text: 'sheep', transcription: null },
      })),
    };
    const audio: PronunciationAudioPayload = {
      mode: 'minimal_pair',
      itemClips: [
        {
          id: 'right-1',
          kind: 'pair_right',
          itemIndex: 1,
          engine: 'provider',
          text: 'sheep',
          url: 'https://audio.test/right-1.mp3',
        },
        {
          id: 'left-0',
          kind: 'pair_left',
          itemIndex: 0,
          engine: 'provider',
          text: 'ship',
          url: 'https://audio.test/left-0.mp3',
        },
        {
          id: 'right-0',
          kind: 'pair_right',
          itemIndex: 0,
          engine: 'provider',
          text: 'sheep',
          url: 'javascript:evil()',
        },
        { id: 'left-1', kind: 'pair_left', itemIndex: 1, engine: 'provider', text: 'ship' },
      ],
    };
    const before = JSON.stringify(audio);
    const doc = new JSDOM(await renderAssignmentToHtml(assignment, { pronunciationAudio: audio }))
      .window.document;
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>('[data-pronunciation-clip]')];
    expect(buttons.map((b) => b.dataset.pronunciationClip)).toEqual([
      'left-0',
      'right-0',
      'left-1',
      'right-1',
    ]);
    expect(buttons.map((b) => b.dataset.audioUrl ?? null)).toEqual([
      'https://audio.test/left-0.mp3',
      null,
      null,
      'https://audio.test/right-1.mp3',
    ]);
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, true, false]);
    expect(JSON.stringify(audio)).toBe(before);
  });

  it('preserves unavailable item controls, preview placeholders and safe source attribution', async () => {
    const preview = await documentFor({ preview: true });
    expect([...preview.querySelectorAll('.audio-placeholder')].map((p) => p.textContent)).toEqual([
      'Study audio: Audio track generating...',
      'Pronunciation sentence audio: Audio track generating...',
    ]);
    expect(
      preview.querySelector('[data-pronunciation-item] button')?.hasAttribute('disabled'),
    ).toBe(true);
    const assignment = fixture();
    assignment.input.kind = 'authentic';
    assignment.input.source = {
      ...assignment.input.source,
      title: 'Authentic title',
      attribution: 'Original author',
      url: 'https://source.test/article',
    };
    assignment.input.media = [
      { kind: 'video', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
      { kind: 'audio', url: 'javascript:evil()' },
    ];
    const doc = new JSDOM(
      await renderAssignmentToHtml(assignment, {
        preview: true,
        studyTextAudioUrl: 'javascript:evil()',
      }),
    ).window.document;
    expect(doc.querySelector('main')?.textContent).toContain('Original author');
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://source.test/article');
    expect(doc.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://www.youtube.com/embed/abcdefghijk',
    );
    expect(doc.querySelector('audio')).toBeNull();
    expect(doc.querySelector('details.study-text')?.previousElementSibling?.className).toBe(
      'audio-placeholder',
    );
    assignment.input.source.url = 'javascript:evil()';
    expect(
      new JSDOM(await renderAssignmentToHtml(assignment)).window.document.querySelector('a'),
    ).toBeNull();
  });

  it('passes only explicit safe h2/h3 presentation colors', async () => {
    const doc = await documentFor({ headingTheme: { h2: '#f2c94c', h3: '#9b51e0' } });
    const style = doc.querySelector<HTMLElement>('.learner-handout')!.style;
    expect(style.getPropertyValue('--theme-h2')).toBe('#f2c94c');
    expect(style.getPropertyValue('--theme-h3')).toBe('#9b51e0');
    const unsafe = await documentFor({
      headingTheme: { h2: '</style><script>evil()</script>', h3: 'url(https://evil.test)' },
    });
    expect(unsafe.querySelector('.learner-handout')?.getAttribute('style')).toBeNull();
    expect(unsafe.querySelectorAll('script')).toHaveLength(1);
  });

  it('renders through the built html-publisher entry in plain Node with compiled CSS/playback assets', async () => {
    const assignment = fixture();
    const options = {
      pronunciationAudioUrl: 'https://audio.test/main.mp3',
      headingTheme: { h2: '#f2c94c' },
    };
    const expected = await renderAssignmentToHtml(assignment, options);
    const script = `import {readFileSync} from 'node:fs';
      import {registerHooks} from 'node:module';
      registerHooks({resolve(specifier, context, next) {
        if (/vite|\\.tsx$/.test(specifier)) throw new Error('Development runtime imported');
        return next(specifier, context);
      }});
      if (typeof window !== 'undefined' || typeof document !== 'undefined') throw new Error('DOM leaked');
      const entry = import.meta.resolve('@esl-pipeline/html-publisher');
      if (!entry.endsWith('/dist/src/index.js')) throw new Error('Publisher is not built');
      const server = import.meta.resolve('@esl-pipeline/learner-handout/server');
      if (!server.endsWith('/dist/server.js')) throw new Error('Handout is not built');
      const css = readFileSync(new URL('./handout.css', server), 'utf8');
      const playback = readFileSync(new URL('./pronunciation-playback.js', server), 'utf8');
      const {renderAssignmentToHtml} = await import(entry);
      const {assignment, options} = JSON.parse(readFileSync(0, 'utf8'));
      globalThis.fetch = () => { throw new Error('Network read'); };
      globalThis.Date = class { constructor() { throw new Error('Clock read'); } static now() { throw new Error('Clock read'); } };
      Math.random = () => { throw new Error('Random read'); };
      const html = await renderAssignmentToHtml(assignment, options);
      if (!html.includes(css) || !html.includes(playback)) throw new Error('Compiled assets missing from HTML');
      process.stdout.write(html);`;
    for (const TZ of ['UTC', 'Asia/Saigon', 'Pacific/Honolulu']) {
      expect(
        execFileSync(process.execPath, ['--input-type=module', '-e', script], {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          input: JSON.stringify({ assignment, options }),
          env: {
            ...process.env,
            TZ,
            NODE_ENV: TZ === 'UTC' ? 'production' : 'development',
            HANDOUT_BASE_URL: 'https://unused.invalid',
          },
          encoding: 'utf8',
        }),
      ).toBe(expected);
    }
  });
});
