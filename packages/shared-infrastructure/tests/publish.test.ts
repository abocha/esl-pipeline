import { describe, expect, it } from 'vitest';

import {
  insertGeneratedAudioLinks,
  resolveHeadingTheme,
  resolveMarkdownTitle,
} from '../src/index.js';

describe('publish helpers', () => {
  it('inserts generated study/pronunciation links and removes stale generated links', () => {
    const markdown = [
      '# Lesson',
      '',
      ':::study-text Transcript',
      'Narrator: Hello',
      ':::',
      '',
      '### 🤔 Comprehension Check',
      '1. What happened?',
      '',
      '### Pronunciation Micro-Focus',
      '**Shadow sentence:** Hello there',
      '',
      '[Audio recording: Study Text](https://old.example.com/study.mp3)',
      '',
    ].join('\n');

    const output = insertGeneratedAudioLinks(markdown, {
      studyTextUrl: 'https://new.example.com/study.mp3',
      pronunciationAudioUrl: 'https://new.example.com/pronunciation.mp3',
    });

    expect(output).toContain('[Audio recording: Study Text](https://new.example.com/study.mp3)');
    expect(output).toContain(
      '[Audio recording: Pronunciation Practice](https://new.example.com/pronunciation.mp3)',
    );
    expect(output).not.toContain('https://old.example.com/study.mp3');
    expect(output.indexOf('Audio recording: Study Text')).toBeLessThan(
      output.indexOf(':::study-text Transcript'),
    );
    expect(output.indexOf(':::study-text Transcript')).toBeLessThan(
      output.indexOf('### 🤔 Comprehension Check'),
    );
    expect(output.lastIndexOf('Audio recording: Pronunciation Practice')).toBeGreaterThan(
      output.indexOf('Shadow sentence'),
    );
  });

  it('supports preview placeholder injection and removes prior generated placeholder directives', () => {
    const markdown = [
      '# Lesson',
      '',
      '<!-- esl-generated-study-text-audio-placeholder -->',
      ':::audio',
      '',
      ':::study-text Transcript',
      'Narrator: Hello',
      ':::',
      '',
      '### Pronunciation Micro-Focus',
      '**Shadow sentence:**',
      '  Hello there',
      '',
      '<!-- esl-generated-pronunciation-audio-placeholder -->',
      ':::audio',
      '',
    ].join('\n');

    const output = insertGeneratedAudioLinks(markdown, {
      includePronunciation: true,
      insertStudyPlaceholderWhenMissing: true,
      insertPronunciationPlaceholderWhenMissing: true,
      removeGeneratedPlaceholderMarkers: {
        study: '<!-- esl-generated-study-text-audio-placeholder -->',
        pronunciation: '<!-- esl-generated-pronunciation-audio-placeholder -->',
      },
    });

    const placeholders = output.match(/^:::audio$/gm) ?? [];
    expect(placeholders).toHaveLength(2);
    expect(output).not.toContain('<!-- esl-generated-study-text-audio-placeholder -->');
    expect(output).not.toContain('<!-- esl-generated-pronunciation-audio-placeholder -->');
  });

  it('removes legacy pronunciation links before inserting the canonical one', () => {
    const markdown = [
      '# Lesson',
      '',
      '### Pronunciation Micro-Focus',
      '**Shadow sentence:** Hello there',
      '',
      '[Audio recording: Pronunciation Shadow Sentence](https://old.example.com/pronunciation.mp3)',
    ].join('\n');

    const output = insertGeneratedAudioLinks(markdown, {
      pronunciationAudioUrl: 'https://new.example.com/pronunciation.mp3',
    });

    expect(output).toContain(
      '[Audio recording: Pronunciation Practice](https://new.example.com/pronunciation.mp3)',
    );
    expect(output).not.toContain('Pronunciation Shadow Sentence');
    expect(output).not.toContain('https://old.example.com/pronunciation.mp3');
  });

  it('does not inject pronunciation links when there is no sentence anchor', () => {
    const markdown = [
      '# Lesson',
      '',
      '### Pronunciation Micro-Focus',
      '**Mode:** minimal_pair',
      '1. ship /ʃɪp/ — sheep /ʃiːp/',
      '2. live /lɪv/ — leave /liːv/',
    ].join('\n');

    const output = insertGeneratedAudioLinks(markdown, {
      pronunciationAudioUrl: 'https://new.example.com/pronunciation.mp3',
    });

    expect(output).not.toContain('Audio recording: Pronunciation Practice');
  });

  it('does not anchor an empty natural sentence line to a following study-text block', () => {
    const markdown = [
      '# Lesson',
      '',
      '### Pronunciation Micro-Focus',
      '**Mode:** connected_speech',
      '**Natural sentence practice:**',
      ':::study-text Transcript',
      'Narrator: Hello',
      ':::',
    ].join('\n');

    const output = insertGeneratedAudioLinks(markdown, {
      includePronunciation: true,
      insertPronunciationPlaceholderWhenMissing: true,
    });

    expect(output).not.toContain('Audio recording: Pronunciation Practice');
    expect(output.indexOf(':::audio')).toBeGreaterThan(output.indexOf('Natural sentence practice'));
    expect(output.indexOf(':::audio')).toBeLessThan(output.indexOf(':::study-text Transcript'));
  });

  it('resolves markdown title with explicit/meta/frontmatter/heading/fallback precedence', () => {
    const markdown = ['---', 'title: Frontmatter Title', '---', '', '# Heading Title'].join('\n');

    expect(
      resolveMarkdownTitle({
        markdown,
        fallback: 'Fallback',
        explicitTitle: 'Explicit Title',
        metaTitle: 'Meta Title',
        preferFrontmatterTitle: true,
      }),
    ).toBe('Explicit Title');

    expect(
      resolveMarkdownTitle({
        markdown,
        fallback: 'Fallback',
        metaTitle: 'Meta Title',
        preferFrontmatterTitle: true,
      }),
    ).toBe('Meta Title');

    expect(
      resolveMarkdownTitle({
        markdown,
        fallback: 'Fallback',
        preferFrontmatterTitle: true,
      }),
    ).toBe('Frontmatter Title');

    expect(
      resolveMarkdownTitle({
        markdown: '# Heading Only',
        fallback: 'Fallback',
      }),
    ).toBe('Heading Only');
  });

  it('maps notion colors into heading theme hex values', () => {
    expect(resolveHeadingTheme({ h2: 'blue', h3: 'green' })).toEqual({
      h2: '#2d9cdb',
      h3: '#27ae60',
    });
    expect(resolveHeadingTheme({})).toBeUndefined();
  });
});
