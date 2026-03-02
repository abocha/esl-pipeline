import { describe, expect, it } from 'vitest';

import {
  extractAnswerKey,
  extractFrontmatter,
  extractPronunciationShadowFocus,
  parseMarkdownContext,
  extractSections,
  extractStudyText,
  extractTeacherNotes,
} from '../src/index.js';

const sample = `---
title: "Homework Assignment: Weather"
student: "Anna"
level: A2
topic: ["weather", "forecast"]
input_type: "dialogue"
speaker_labels: ["A","B"]
---

## 1. study text

:::study-text
A: Hello!
B: Hi, how are you?
A: I'm fine.
:::

## 2. comprehension check

- Q1

### C. 🎙️ Pronunciation Micro-Focus (≈1 min)

:::callout 🗣️
**Mode:** shadow_sentence
**Shadow sentence:** I was thinking about working this morning.
1. **thinking** — /ˈθɪŋkɪŋ/
2. **working** — /ˈwɜːrkɪŋ/
3. **morning** — /ˈmɔːrnɪŋ/
:::

## 9. teacher's follow-up plan

:::toggle Teacher’s Follow-up Plan
- Next time: focus on intonation.
:::

## 8. answer key (for real doc it’s section #8)

:::toggle Answer Key
1) She is fine.
:::
`;

describe('pmd extractor', () => {
  const context = parseMarkdownContext(sample);

  it('frontmatter', () => {
    const fm = extractFrontmatter(context);
    expect(fm.title).toBe('Homework Assignment: Weather');
    expect(fm.student).toBe('Anna');
    expect(fm.level).toBe('A2');
  });

  it('study-text', () => {
    const st = extractStudyText(context);
    expect(st.type).toBe('dialogue');
    expect(st.lines.length).toBeGreaterThan(0);
  });

  it('answer key', () => {
    const ak = extractAnswerKey(context);
    expect(ak).toContain('She is fine');
  });

  it("teacher's notes", () => {
    const tn = extractTeacherNotes(context);
    expect(tn).toContain('intonation');
  });

  it('sections h2/h3 slice', () => {
    const sections = extractSections(context);
    const titles = sections.map((s) => s.title.toLowerCase());
    expect(titles.join('|')).toContain('study text');
  });

  it('extracts pronunciation shadow focus metadata', () => {
    const pronunciation = extractPronunciationShadowFocus(context);
    expect(pronunciation).not.toBeNull();
    expect(pronunciation?.mode).toBe('shadow_sentence');
    expect(pronunciation?.shadowSentence).toContain('thinking about working');
    expect(pronunciation?.words).toHaveLength(3);
    expect(pronunciation?.issues).toHaveLength(0);
  });

  it('returns null when pronunciation mode is not shadow_sentence', () => {
    const nonShadow = parseMarkdownContext(
      sample.replace('**Mode:** shadow_sentence', '**Mode:** intonation'),
    );
    expect(extractPronunciationShadowFocus(nonShadow)).toBeNull();
  });

  it('parses bullet-prefixed bold mode marker', () => {
    const bulletMode = parseMarkdownContext(
      sample.replace('**Mode:** shadow_sentence', '- **Mode:** shadow_sentence'),
    );
    const pronunciation = extractPronunciationShadowFocus(bulletMode);
    expect(pronunciation?.mode).toBe('shadow_sentence');
  });

  it('parses LLM-variant shadow sentence fields and word drill notes', () => {
    const llmVariant = parseMarkdownContext(
      sample
        .replace('**Mode:** shadow_sentence', '- `**Mode:** shadow_sentence`')
        .replace(
          '**Shadow sentence:** I was thinking about working this morning.',
          '- `**Shadow sentence:** I was thinking about working this morning.`',
        )
        .replace('1. **thinking** — /ˈθɪŋkɪŋ/', '- 1. `thinking` — /ˈθɪŋkɪŋ/')
        .replace('2. **working** — /ˈwɜːrkɪŋ/', '- 2. `working` — /ˈwɜːrkɪŋ/')
        .replace(
          '3. **morning** — /ˈmɔːrnɪŋ/',
          '- 3. `morning` — /ˈmɔːrnɪŋ/ (keep final NG sound)',
        ),
    );
    const pronunciation = extractPronunciationShadowFocus(llmVariant);
    expect(pronunciation?.mode).toBe('shadow_sentence');
    expect(pronunciation?.shadowSentence).toContain('thinking about working');
    expect(pronunciation?.words).toHaveLength(3);
    expect(pronunciation?.words[2]?.transcription).toBe('/ˈmɔːrnɪŋ/');
    expect(pronunciation?.issues).toHaveLength(0);
  });
});
