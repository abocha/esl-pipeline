import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import {
  assignmentPlainText,
  type FreshAssignmentV1,
  serializeAssignmentV1,
  validateAssignmentV1,
} from '@esl-pipeline/contracts';

import legacyFixture from '../../contracts/tests/assignment-fixture.json';
import grammarFixture from '../../contracts/tests/assignment-grammar-fixture.json';
import missionFixture from '../../contracts/tests/assignment-mission-fixture.json';
import rationaleFixture from '../../contracts/tests/assignment-rationale-fixture.json';
import { createFixture, pronunciationModes } from '../preview/fixtures.js';
import { renderLearnerHandoutDocument } from '../src/server.js';

const documentFor = (props = createFixture()) =>
  new JSDOM(renderLearnerHandoutDocument(props)).window.document;

describe('React learner handout static foundation', () => {
  it('uses authored support language in static and React roots while keeping target English explicit', () => {
    const assignment = validateAssignmentV1({
      ...grammarFixture,
      metadata: { ...grammarFixture.metadata, instructionLanguage: 'ru' },
      learnerRationale: 'Это поможет вам объяснять свои планы.',
      teacherRationale: 'INTERNAL_LANGUAGE_SELECTION_SENTINEL',
    });
    assignment.toolkit.vocabulary[0]!.meaning = 'сначала';
    const before = serializeAssignmentV1(assignment);
    const doc = documentFor({ assignment });
    expect(doc.documentElement.lang).toBe('ru');
    expect(doc.querySelector('.learner-handout')?.getAttribute('lang')).toBe('ru');
    expect(doc.querySelector('.mission-key-language')?.getAttribute('lang')).toBe('en');
    expect(doc.querySelector('.study-text p')?.getAttribute('lang')).toBe('en');
    expect(doc.querySelector('.grammar-form p span')?.getAttribute('lang')).toBe('en');
    const cells = doc.querySelectorAll('tbody tr:first-child td');
    expect(cells[0]?.getAttribute('lang')).toBe('en');
    expect(cells[1]?.getAttribute('lang')).toBeNull();
    expect(cells[1]?.querySelector('.vocabulary-value')?.textContent).toBe('сначала');
    expect(cells[2]?.getAttribute('lang')).toBe('en');
    expect(doc.querySelector('#assignment-section-1')?.getAttribute('lang')).toBe('en');
    expect(doc.body.textContent).toContain('Это поможет вам объяснять свои планы.');
    expect(doc.documentElement.outerHTML).not.toContain('INTERNAL_LANGUAGE_SELECTION_SENTINEL');
    expect(serializeAssignmentV1(assignment)).toBe(before);
    expect(
      documentFor({ assignment: validateAssignmentV1(legacyFixture) }).documentElement.lang,
    ).toBe('en');
  });
  it('renders forms, paired meaning contrasts and distinct trap roles without changing data', () => {
    const assignment = validateAssignmentV1(grammarFixture);
    const before = JSON.stringify(assignment);
    const doc = documentFor({ assignment });
    const topic = doc.querySelector('.grammar-card')!;
    const grammar = grammarFixture.toolkit.grammar[0]!;
    expect(topic.querySelector('h4')?.textContent).toBe(grammar.name);
    expect(
      [...topic.querySelectorAll('.grammar-form')].map((form) => ({
        label: form.querySelector('h5')?.textContent,
        pattern: form.querySelector('p')?.textContent,
        examples: [...form.querySelectorAll('li')].map((li) => li.textContent),
      })),
    ).toEqual(
      grammar.formBlocks.map((block) => ({
        label: block.label,
        pattern: `Pattern: ${block.pattern}`,
        examples: block.examples,
      })),
    );
    const comparison = topic.querySelector('.grammar-comparison')!;
    expect(topic.querySelectorAll('.grammar-comparison')).toHaveLength(1);
    expect(comparison.querySelector('h5')?.textContent).toBe(grammar.comparisons[0]!.label);
    expect(
      [...comparison.querySelectorAll('.grammar-alternative')].map((alternative) => ({
        label: alternative.querySelector('h6')?.textContent,
        example: alternative.querySelector('em')?.textContent,
        explanation: alternative.querySelector('p:last-child')?.textContent,
      })),
    ).toEqual(grammar.comparisons[0]!.alternatives);
    expect([...topic.querySelectorAll('.grammar-trap p')].map((p) => p.textContent)).toEqual([
      `Wrong: ${grammar.traps[0]!.original}`,
      `Corrected: ${grammar.traps[0]!.improved}`,
      `Explanation: ${grammar.traps[0]!.explanation}`,
    ]);
    expect(topic.querySelector('.grammar-guidance')?.textContent).toContain(
      grammar.uses[0]!.example,
    );
    expect(JSON.stringify(assignment)).toBe(before);
  });

  it('omits absent grammar contrasts and guidance while escaping structured grammar text', () => {
    const input = structuredClone(grammarFixture);
    const grammar = input.toolkit.grammar[0]!;
    const hostile = '<img src=x onerror=evil()> **plain**';
    grammar.formBlocks = [{ label: hostile, pattern: hostile, examples: [hostile] }];
    grammar.comparisons = [];
    grammar.examples = [];
    grammar.uses = [];
    grammar.traps = [];
    const doc = documentFor({ assignment: validateAssignmentV1(input) });
    expect(
      doc.querySelectorAll('img, .grammar-comparison, .grammar-guidance, .grammar-traps'),
    ).toHaveLength(0);
    expect(doc.querySelector('.grammar-form h5')?.textContent).toBe(hostile);
    expect(doc.querySelector('.grammar-form p')?.textContent).toBe(`Pattern: ${hostile}`);
    expect(doc.querySelector('.grammar-form li')?.textContent).toBe(hostile);
  });

  it.each([legacyFixture, missionFixture])(
    'renders legacy grammar directly with sensible form and traps',
    (input) => {
      const assignment = validateAssignmentV1(input);
      const before = JSON.stringify(assignment);
      const doc = documentFor({ assignment });
      const topic = doc.querySelector('.grammar-card')!;
      expect(topic.textContent).toContain(`Form: ${input.toolkit.grammar[0]!.form}`);
      expect(topic.textContent).toContain(input.toolkit.grammar[0]!.explanation);
      expect(topic.querySelectorAll('.grammar-form, .grammar-comparison')).toHaveLength(0);
      expect(topic.querySelector('.grammar-trap')?.textContent).toContain('Corrected:');
      expect(JSON.stringify(assignment)).toBe(before);
    },
  );

  it('renders the structured mission in teaching order with one prominent task and separate sample', () => {
    const props = createFixture();
    const before = JSON.stringify(props);
    const doc = documentFor(props);
    const mission = doc.querySelector('.output-mission')!;
    expect(mission.getAttribute('aria-labelledby')).toBe('assignment-section-5');
    expect(mission.firstElementChild?.classList.contains('mission-task')).toBe(true);
    expect(mission.querySelector('.mission-task')?.textContent).toBe(
      missionFixture.outputTask.task,
    );
    expect([...mission.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
      'Prepare',
      'Include in your response',
      'How to do it',
      'Before you finish',
    ]);
    expect(
      [...mission.querySelectorAll('ul')].map((list) =>
        [...list.querySelectorAll('li')].map((li) => li.textContent),
      ),
    ).toEqual([
      missionFixture.outputTask.preparation,
      missionFixture.outputTask.requirements,
      missionFixture.outputTask.selfCheck,
    ]);
    expect(mission.textContent).toContain(missionFixture.outputTask.delivery);
    expect(mission.textContent).toContain(
      `Optional extension: ${missionFixture.outputTask.extension}`,
    );
    expect(mission.textContent).not.toContain(missionFixture.outputTask.sampleResponse);
    expect(doc.querySelector('#assignment-section-7 + details')?.textContent).toContain(
      missionFixture.outputTask.sampleResponse,
    );
    expect(mission.querySelectorAll('.callout')).toHaveLength(1);
    expect(JSON.stringify(props)).toBe(before);
  });

  it.each(['preparation', 'requirements', 'delivery', 'selfCheck', 'all'] as const)(
    'omits empty supporting roles without empty headings: %s',
    (absent) => {
      const props = createFixture();
      const outputTask: FreshAssignmentV1['outputTask'] = structuredClone(
        missionFixture.outputTask,
      );
      for (const field of ['preparation', 'requirements', 'selfCheck'] as const)
        if (absent === field || absent === 'all') outputTask[field] = [];
      if (absent === 'delivery' || absent === 'all') outputTask.delivery = null;
      outputTask.extension = null;
      props.assignment = validateAssignmentV1({ ...missionFixture, outputTask });
      const mission = documentFor(props).querySelector('.output-mission')!;
      const roles = [
        ['preparation', 'Prepare'],
        ['requirements', 'Include in your response'],
        ['delivery', 'How to do it'],
        ['selfCheck', 'Before you finish'],
      ];
      expect([...mission.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(
        roles.filter(([field]) => absent !== field && absent !== 'all').map(([, label]) => label),
      );
      expect(mission.textContent).toContain(outputTask.task);
      expect(mission.textContent).not.toContain('Optional extension');
    },
  );

  it.each([legacyFixture, rationaleFixture])(
    'renders legacy output-task without inferring mission roles',
    (assignment) => {
      const props = createFixture();
      props.assignment = validateAssignmentV1(assignment);
      const before = JSON.stringify(props.assignment);
      const mission = documentFor(props).querySelector('.output-mission')!;
      expect(mission.querySelector('.mission-task')?.textContent).toBe(assignment.outputTask.task);
      expect(mission.querySelectorAll('h3, ul')).toHaveLength(0);
      expect(JSON.stringify(props.assignment)).toBe(before);
    },
  );

  it('escapes every structured mission role as authored plain text', () => {
    const props = createFixture();
    const hostile = '<img src=x onerror=evil()> **plain**';
    props.assignment = validateAssignmentV1({
      ...missionFixture,
      outputTask: {
        task: hostile,
        preparation: [hostile],
        requirements: [hostile],
        delivery: hostile,
        selfCheck: [hostile],
        extension: hostile,
        sampleResponse: hostile,
      },
    });
    const doc = documentFor(props);
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(
      [...doc.querySelectorAll('.output-mission .plain-text')].map((p) => p.textContent),
    ).toEqual([hostile, hostile, hostile, hostile, hostile, `Optional extension: ${hostile}`]);
  });

  it.each(['teacher', 'null', 'legacy'] as const)(
    'publishes only learner rationale for %s, with no hidden rationale copies',
    (shape) => {
      const legacySentinel = 'ESL24_AMBIGUOUS_LEGACY_ONLY';
      const props = createFixture();
      props.assignment = validateAssignmentV1(
        shape === 'legacy'
          ? { ...legacyFixture, rationale: legacySentinel }
          : {
              ...rationaleFixture,
              teacherRationale: shape === 'null' ? null : rationaleFixture.teacherRationale,
            },
      );
      const before = JSON.stringify(props.assignment);
      const html = renderLearnerHandoutDocument(props);
      const doc = new JSDOM(html).window.document;
      // Entire emitted bytes cover scripts, attributes, comments, disclosures and serialized data.
      expect(html).not.toContain('ESL24_TEACHER_ONLY');
      expect(html).not.toContain(legacySentinel);
      expect(doc.querySelector('#assignment-section-6') !== null).toBe(shape !== 'legacy');
      expect(html.includes('Why This Mission Helps You')).toBe(shape !== 'legacy');
      expect(html.includes(rationaleFixture.learnerRationale)).toBe(shape !== 'legacy');
      expect(
        doc.querySelector('#assignment-section-6')?.nextElementSibling?.textContent ?? null,
      ).toBe(shape === 'legacy' ? null : rationaleFixture.learnerRationale);
      expect(doc.querySelector('#assignment-section-7')?.textContent).toContain('7.');
      expect(doc.querySelector('#assignment-section-8')).toBeNull();
      expect(JSON.stringify(props.assignment)).toBe(before);
    },
  );

  it.each(['shadow_sentence', 'none'] as const)(
    'renders the complete surface with pronunciation=%s',
    (mode) => {
      const props = createFixture(mode);
      const before = JSON.stringify(props);
      const doc = documentFor(props);
      const a = props.assignment;
      expect(doc.querySelectorAll('main > h2')).toHaveLength(7);
      expect(doc.querySelectorAll('nav, .toc-shell, .table-of-contents')).toHaveLength(0);
      expect(
        [...doc.querySelectorAll('.mission-key-language li')].map((li) => li.textContent),
      ).toEqual(a.mission.keyLanguage);
      expect(doc.querySelector('#assignment-section-4')?.textContent).toBe(
        mode === 'none' ? '4. ✍️ Practice' : '4. ✍️ Practice & Pronunciation',
      );
      expect(doc.querySelector('[data-assignment-pronunciation]') !== null).toBe(mode !== 'none');
      const transcript = doc.querySelector<HTMLDetailsElement>('details.study-text')!;
      expect(transcript.open).toBe(false);
      expect(transcript.previousElementSibling?.matches('.audio-figure')).toBe(true);
      expect(transcript.textContent).toContain(a.input.studyText.turns[0]!.text);
      expect(doc.querySelector('table tbody')?.textContent).toContain(
        assignmentPlainText(a.toolkit.vocabulary[0]!.example),
      );
      expect(doc.querySelector('.grammar-card')?.textContent).toContain(
        a.toolkit.grammar[0]!.uses[0]!.example,
      );
      expect(doc.querySelector('main')?.textContent).toContain(rationaleFixture.learnerRationale);
      expect(doc.querySelector('main')?.textContent).toContain(a.outputTask.task);
      const key = [...doc.querySelectorAll('details')].find(
        (d) => d.querySelector('summary')?.textContent === 'Answer Key',
      )!;
      expect(key.open).toBe(false);
      expect([...key.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
        'Comprehension Check Answers',
        'A. Controlled Practice Answers',
        'Sample Mission',
      ]);
      expect(
        [...key.querySelectorAll('.answer-key-item')].map((item) =>
          [...item.querySelectorAll('p')].map((p) => p.textContent),
        ),
      ).toEqual(
        [...a.input.comprehension, ...a.practice.flatMap((part) => part.items)].map((q) => [
          assignmentPlainText(q.prompt),
          `Answer: ${q.answer}`,
          ...(q.explanation === null ? [] : [`Explanation: ${q.explanation}`]),
        ]),
      );
      const parts = a.practice.map(
        (part, i) =>
          `Part ${i + 1}${part.title ? `: ${assignmentPlainText(part.title).replace(/^\d+\.\s*/, '')}` : ''}`,
      );
      expect([...key.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(parts);
      expect(
        [...doc.querySelectorAll('main > .practice-part h4')].map((h) => h.textContent),
      ).toEqual(parts);
      expect(key.textContent).toContain(a.outputTask.sampleResponse);
      expect(doc.documentElement.outerHTML).not.toContain(a.teacherFollowUp.correctionFocus);
      expect(JSON.stringify(props)).toBe(before);
    },
  );

  it('preserves trap punctuation and compact generated titles, plus authentic source attribution', () => {
    const props = createFixture();
    props.assignment.toolkit.grammar[0]!.traps = [
      { original: 'Does he rides?', improved: 'Does he ride?', explanation: 'Use the base verb!' },
      { original: '<wrong>', improved: 'Wait...', explanation: 'Authored ellipsis...' },
    ];
    const doc = documentFor(props);
    expect(
      [...doc.querySelectorAll('.grammar-trap')].map((t) =>
        [...t.querySelectorAll('p')].map((p) => p.textContent),
      ),
    ).toEqual(
      props.assignment.toolkit.grammar[0]!.traps.map((t) => [
        `Wrong: ${t.original}`,
        `Corrected: ${t.improved}`,
        `Explanation: ${t.explanation}`,
      ]),
    );
    expect(doc.querySelector('.source-title')?.textContent).toBe('A useful demo');
    for (const title of [props.assignment.metadata.title, props.assignment.metadata.topic]) {
      props.assignment.input.source.title = title;
      expect(documentFor(props).querySelector('.source-title')?.textContent).toBe(title);
    }
    props.assignment.input.kind = 'authentic';
    const authentic = documentFor(props);
    expect(authentic.querySelector('main')?.textContent).toContain(
      props.assignment.input.source.title!,
    );
    expect(authentic.querySelector('main')?.textContent).toContain('Local demonstration fixture');
    expect(authentic.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/source?a=1&b=2',
    );
    expect(authentic.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each(pronunciationModes)(
    'renders %s available, absent clip, and unavailable audio states',
    (mode) => {
      const available = documentFor(createFixture(mode, 'available'));
      expect(
        available
          .querySelector('[data-assignment-pronunciation]')
          ?.getAttribute('data-assignment-pronunciation'),
      ).toBe(mode);
      expect(
        available.querySelectorAll('[data-pronunciation-clip]:not(:disabled)').length,
      ).toBeGreaterThan(0);
      const unavailable = documentFor(createFixture(mode, 'unavailable'));
      expect(unavailable.querySelectorAll('[data-pronunciation-clip]:not(:disabled)')).toHaveLength(
        0,
      );
      expect(
        unavailable.querySelectorAll('[data-pronunciation-clip]:disabled').length,
      ).toBeGreaterThan(0);
      expect(unavailable.querySelector('.audio-placeholder')).not.toBeNull();
      const props = createFixture(mode);
      props.media = {};
      expect(
        documentFor(props).querySelectorAll('[data-assignment-pronunciation] button:disabled')
          .length,
      ).toBeGreaterThan(0);
    },
  );

  it('keeps punctuation-aware stress, chunk boundaries and safe source embeds', () => {
    const stressed = documentFor(createFixture('sentence_stress'));
    expect(stressed.querySelector('.pronunciation-line-text strong')?.textContent).toBe('First');
    expect(
      documentFor(createFixture('rhythm_chunking')).querySelector('.pronunciation-line-text')
        ?.textContent,
    ).toBe('First, | save it.');
    const props = createFixture();
    props.assignment.input.media = [
      { kind: 'video', url: 'https://youtu.be/abcdefghijk' },
      { kind: 'video', url: 'https://vimeo.com/123456?x=1&y=2' },
    ];
    expect([...documentFor(props).querySelectorAll('iframe')].map((f) => f.src)).toEqual([
      'https://www.youtube.com/embed/abcdefghijk',
      'https://player.vimeo.com/video/123456?x=1&y=2',
    ]);
  });

  it('escapes plain text and rejects unsafe links, embeds, and every audio input', () => {
    const props = createFixture('minimal_pair');
    const hostile = '</script><script>evil()</script><img src=x onerror=evil()> **plain**';
    props.assignment.metadata.title = hostile;
    props.assignment.input.studyText.turns[0]!.text = hostile;
    props.assignment.toolkit.vocabulary[0]!.expression = hostile;
    props.publication = { displayDate: hostile };
    props.assignment.input.source.url = 'javascript:evil()';
    props.assignment.input.media = [
      { kind: 'audio', url: 'data:audio/wav,evil' },
      { kind: 'video', url: 'https://youtube.com.evil.test/embed/abcdefghijk' },
    ];
    props.media!.studyTextAudioUrl = 'https://audio.test/a.wav?x=1&y=2';
    props.media!.pronunciationAudio!.primaryClip!.url = 'javascript:evil()';
    for (const url of [
      'javascript:evil()',
      'data:text/html,evil',
      '//evil.test/a.wav',
      'https://user:pass@evil.test/a.wav',
      '/\\evil.test/a.wav',
      'file:///a.wav',
    ]) {
      props.media!.pronunciationAudio!.itemClips = [
        { id: hostile, itemIndex: 0, kind: 'pair_left', text: hostile, url },
      ];
      const html = renderLearnerHandoutDocument(props);
      const doc = new JSDOM(html).window.document;
      expect(doc.querySelector('h1')?.textContent).toBe('🧭 ' + hostile);
      expect(doc.querySelectorAll('img, object, embed')).toHaveLength(0);
      expect(doc.querySelectorAll('iframe')).toHaveLength(0);
      expect(doc.querySelectorAll('script')).toHaveLength(1);
      expect(doc.querySelector('audio')?.getAttribute('src')).toBe(
        'https://audio.test/a.wav?x=1&y=2',
      );
      expect(doc.querySelector('[data-pronunciation-clip]')?.hasAttribute('disabled')).toBe(true);
      expect(
        doc.querySelector('[data-pronunciation-clip]')?.getAttribute('data-audio-url'),
      ).toBeNull();
      expect(doc.querySelector('a[href^="javascript:"]')).toBeNull();
      expect(html).not.toContain('</script><script>evil()');
    }
  });

  it('is byte-identical across repeated renders and different mocked ambient clocks', () => {
    const props = createFixture();
    const original = renderLearnerHandoutDocument(props);
    vi.useFakeTimers();
    try {
      for (const time of ['2000-01-01T00:00:00Z', '2040-12-31T23:59:59Z']) {
        vi.setSystemTime(new Date(time));
        expect(renderLearnerHandoutDocument(props)).toBe(original);
        expect(renderLearnerHandoutDocument(props)).toBe(original);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs compiled server JavaScript in plain Node with no DOM, Vite, network, clock, random, or timezone inputs', () => {
    const props = createFixture();
    const script = `import {readFileSync} from 'node:fs';
      const props = JSON.parse(readFileSync(0, 'utf8'));
      if (typeof window !== 'undefined' || typeof document !== 'undefined') throw new Error('DOM leaked');
      const {renderLearnerHandoutDocument} = await import('@esl-pipeline/learner-handout/server');
      globalThis.fetch = () => { throw new Error('Network read'); };
      globalThis.Date = class { constructor() { throw new Error('Clock read'); } static now() { throw new Error('Clock read'); } };
      Math.random = () => { throw new Error('Random read'); };
      process.stdout.write(renderLearnerHandoutDocument(props));`;
    for (const TZ of ['UTC', 'Pacific/Honolulu', 'Asia/Saigon']) {
      expect(
        execFileSync(process.execPath, ['--input-type=module', '-e', script], {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          input: JSON.stringify(props),
          env: { ...process.env, TZ, HANDOUT_BASE_URL: `https://${TZ.replace('/', '-')}.invalid` },
          encoding: 'utf8',
        }),
      ).toBe(renderLearnerHandoutDocument(props));
    }
  });

  it('saved output binds clips by item/side, handles disabled controls and reports playback failure without hydration', async () => {
    const props = createFixture('minimal_pair', 'mixed');
    props.media!.pronunciationAudio!.itemClips = props.media!.pronunciationAudio!.itemClips!.map(
      (clip, i) => ({ ...clip, url: clip.url ? `https://audio.test/${i}-${clip.kind}.wav` : null }),
    );
    const dom = new JSDOM(renderLearnerHandoutDocument(props), { runScripts: 'dangerously' });
    const urls: string[] = [];
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    dom.window.Audio = class extends dom.window.EventTarget {
      constructor(url: string) {
        super();
        urls.push(url);
      }
      play = play;
      pause = pause;
    } as unknown as typeof dom.window.Audio;
    const buttons = [
      ...dom.window.document.querySelectorAll<HTMLButtonElement>('[data-pronunciation-clip]'),
    ];
    expect(buttons.map((b) => b.dataset.pronunciationClip)).toEqual(
      props.media!.pronunciationAudio!.itemClips!.map((c) => c.id),
    );
    buttons[2]!.click();
    expect(urls).toEqual(['https://audio.test/2-pair_left.wav']);
    expect(play).toHaveBeenCalledTimes(1);
    buttons[1]!.click();
    expect(play).toHaveBeenCalledTimes(1);
    play.mockRejectedValueOnce(new Error('Missing audio'));
    buttons[0]!.click();
    await Promise.resolve();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(buttons[0]!.textContent).toBe('Retry');
    expect(buttons[2]!.textContent).toBe('Play');
    expect(dom.window.document.querySelector('.playback-status')).toBeNull();
    dom.window.close();
  });
});
