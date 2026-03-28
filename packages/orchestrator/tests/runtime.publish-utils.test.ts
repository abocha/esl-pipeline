import { describe, expect, it } from 'vitest';

import {
  insertGeneratedAudioLinks,
  resolveHeadingTheme,
  resolveMarkdownTitle,
} from '../src/runtime/publish-utils.js';

describe('runtime/publish-utils', () => {
  it('inserts study and pronunciation links without duplicating existing generated links', () => {
    const markdown = [
      '# Lesson Title',
      '',
      ':::study-text Transcript',
      'Narrator: Hello',
      ':::',
      '',
      '### Pronunciation Micro-Focus',
      '**Shadow sentence:** Hello there',
      '',
      '[Audio recording: Study Text](https://old.example.com/study.mp3)',
      '',
    ].join('\n');

    const updated = insertGeneratedAudioLinks(markdown, {
      studyTextUrl: 'https://new.example.com/study.mp3',
      pronunciationAudioUrl: 'https://new.example.com/pronunciation.mp3',
    });

    expect(updated).toContain('[Audio recording: Study Text](https://new.example.com/study.mp3)');
    expect(updated).toContain(
      '[Audio recording: Pronunciation Practice](https://new.example.com/pronunciation.mp3)',
    );
    expect(updated).not.toContain('https://old.example.com/study.mp3');
    expect(updated.lastIndexOf('Audio recording: Pronunciation Practice')).toBeGreaterThan(
      updated.indexOf('Shadow sentence'),
    );
  });

  it('replaces legacy pronunciation links with the canonical pronunciation label', () => {
    const markdown = [
      '# Lesson Title',
      '',
      '### Pronunciation Micro-Focus',
      '**Shadow sentence:** Hello there',
      '',
      '[Audio recording: Pronunciation Shadow Sentence](https://old.example.com/pronunciation.mp3)',
    ].join('\n');

    const updated = insertGeneratedAudioLinks(markdown, {
      pronunciationAudioUrl: 'https://new.example.com/pronunciation.mp3',
    });

    expect(updated).toContain(
      '[Audio recording: Pronunciation Practice](https://new.example.com/pronunciation.mp3)',
    );
    expect(updated).not.toContain('https://old.example.com/pronunciation.mp3');
  });

  it('does not add a pronunciation link for minimal_pair sections without a sentence anchor', () => {
    const markdown = [
      '# Lesson Title',
      '',
      '### Pronunciation Micro-Focus',
      '**Mode:** minimal_pair',
      '1. ship /ʃɪp/ — sheep /ʃiːp/',
      '2. live /lɪv/ — leave /liːv/',
    ].join('\n');

    const updated = insertGeneratedAudioLinks(markdown, {
      pronunciationAudioUrl: 'https://new.example.com/pronunciation.mp3',
    });

    expect(updated).not.toContain('Audio recording: Pronunciation Practice');
  });

  it('resolves title using meta title first, then heading, then fallback', () => {
    const markdown = '# Heading Title\n\nContent';

    expect(resolveMarkdownTitle(markdown, 'Fallback', 'Meta Title')).toBe('Meta Title');
    expect(resolveMarkdownTitle(markdown, 'Fallback', '')).toBe('Heading Title');
    expect(resolveMarkdownTitle('No heading', 'Fallback', null)).toBe('Fallback');
  });

  it('maps notion preset colors into heading theme hex values', () => {
    const theme = resolveHeadingTheme({ h2: 'blue', h3: 'green' });
    expect(theme).toEqual({ h2: '#2d9cdb', h3: '#27ae60' });
    expect(resolveHeadingTheme({})).toBeUndefined();
  });
});
