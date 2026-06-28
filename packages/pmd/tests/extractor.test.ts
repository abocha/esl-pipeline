import { describe, expect, it } from 'vitest';

import {
  extractAnswerKey,
  extractFrontmatter,
  extractPronunciationFocus,
  extractPronunciationShadowFocus,
  extractSections,
  extractStudyText,
  extractTeacherNotes,
  parseMarkdownContext,
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

  it('tracks content line offset after frontmatter', () => {
    expect(context.contentLineOffset).toBe(8);
    expect(context.contentLines[1]).toBe('## 1. study text');
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

  it('accepts word drill lines without a dash delimiter', () => {
    const noDashVariant = parseMarkdownContext(
      sample
        .replace('1. **thinking** — /ˈθɪŋkɪŋ/', '1. **thinking** /ˈθɪŋkɪŋ/')
        .replace('2. **working** — /ˈwɜːrkɪŋ/', '2. **working** /ˈwɜːrkɪŋ/')
        .replace('3. **morning** — /ˈmɔːrnɪŋ/', '3. **morning** /ˈmɔːrnɪŋ/'),
    );
    const pronunciation = extractPronunciationShadowFocus(noDashVariant);
    expect(pronunciation?.mode).toBe('shadow_sentence');
    expect(pronunciation?.words).toHaveLength(3);
    expect(pronunciation?.words[0]?.text).toBe('thinking');
    expect(pronunciation?.words[0]?.transcription).toBe('/ˈθɪŋkɪŋ/');
    expect(pronunciation?.issues).toHaveLength(0);
  });

  it('preserves slash-bearing words in dashed and no-dash drill lines', () => {
    const withSlashWord = parseMarkdownContext(
      sample
        .replace(
          '**Shadow sentence:** I was thinking about working this morning.',
          '**Shadow sentence:** Please practice and/or quickly this morning.',
        )
        .replace('1. **thinking** — /ˈθɪŋkɪŋ/', '1. **and/or** — /ˈændɔːr/')
        .replace('2. **working** — /ˈwɜːrkɪŋ/', '2. **working** /ˈwɜːrkɪŋ/')
        .replace('3. **morning** — /ˈmɔːrnɪŋ/', '3. **morning** /ˈmɔːrnɪŋ/'),
    );
    const pronunciation = extractPronunciationShadowFocus(withSlashWord);
    expect(pronunciation?.mode).toBe('shadow_sentence');
    expect(pronunciation?.words).toHaveLength(3);
    expect(pronunciation?.words[0]?.text).toBe('and/or');
    expect(pronunciation?.words[0]?.transcription).toBe('/ˈændɔːr/');
    expect(pronunciation?.words[1]?.text).toBe('working');
    expect(pronunciation?.words[1]?.transcription).toBe('/ˈwɜːrkɪŋ/');
    expect(pronunciation?.issues).toHaveLength(0);
  });

  it('extracts minimal-pair pronunciation metadata', () => {
    const minimalPairContext = parseMarkdownContext(
      sample
        .replace('**Mode:** shadow_sentence', '**Mode:** minimal_pair')
        .replace(
          '**Shadow sentence:** I was thinking about working this morning.',
          '**Target:** Hear the short /ɪ/ and the long /iː/ clearly.',
        )
        .replace('1. **thinking** — /ˈθɪŋkɪŋ/', '1. ship /ʃɪp/ — sheep /ʃiːp/')
        .replace('2. **working** — /ˈwɜːrkɪŋ/', '2. live /lɪv/ — leave /liːv/')
        .replace('3. **morning** — /ˈmɔːrnɪŋ/', ''),
    );
    const pronunciation = extractPronunciationFocus(minimalPairContext);
    expect(pronunciation?.mode).toBe('minimal_pair');
    if (pronunciation?.mode !== 'minimal_pair') return;
    expect(pronunciation.pairs).toHaveLength(2);
    expect(pronunciation.pairs[0]?.left.text).toBe('ship');
    expect(pronunciation.pairs[0]?.right.text).toBe('sheep');
  });

  it('extracts connected-speech pronunciation metadata', () => {
    const connectedSpeechContext = parseMarkdownContext(
      sample
        .replace('**Mode:** shadow_sentence', '**Mode:** connected_speech')
        .replace(
          '**Shadow sentence:** I was thinking about working this morning.',
          '**Action:** Read the careful form first, then the connected form.',
        )
        .replace('1. **thinking** — /ˈθɪŋkɪŋ/', '1. "Change helps us." -> Change help-sus.')
        .replace('2. **working** — /ˈwɜːrkɪŋ/', '2. "It gives us food." -> It give-sus food.')
        .replace(
          '3. **morning** — /ˈmɔːrnɪŋ/',
          '**Natural sentence practice:** The device is as heavy as the old one.',
        ),
    );
    const pronunciation = extractPronunciationFocus(connectedSpeechContext);
    expect(pronunciation?.mode).toBe('connected_speech');
    if (pronunciation?.mode !== 'connected_speech') return;
    expect(pronunciation.lines).toHaveLength(2);
    expect(pronunciation.lines[0]?.careful).toBe('Change helps us.');
    expect(pronunciation.lines[0]?.connected).toBe('Change help-sus.');
    expect(pronunciation.naturalSentence).toBe('The device is as heavy as the old one.');
  });

  it('extracts intonation pronunciation metadata', () => {
    const intonationContext = parseMarkdownContext(
      sample
        .replace('**Mode:** shadow_sentence', '**Mode:** intonation')
        .replace(
          '**Shadow sentence:** I was thinking about working this morning.',
          '**Contour cue:** rise-fall',
        )
        .replace('1. **thinking** — /ˈθɪŋkɪŋ/', '1. Are you free tonight? — /ɑː juː friː təˈnaɪt/')
        .replace(
          '2. **working** — /ˈwɜːrkɪŋ/',
          '2. That sounds really great. — /ðæt saʊndz ˈrɪə.li ɡreɪt/',
        )
        .replace(
          '3. **morning** — /ˈmɔːrnɪŋ/',
          '**Natural sentence practice:** Are you free tonight after work?',
        ),
    );
    const pronunciation = extractPronunciationFocus(intonationContext);
    expect(pronunciation?.mode).toBe('intonation');
    if (pronunciation?.mode !== 'intonation') return;
    expect(pronunciation.drills).toHaveLength(2);
    expect(pronunciation.contourCue).toBe('rise-fall');
    expect(pronunciation.drills[0]?.transcription).toBe('/ɑː juː friː təˈnaɪt/');
    expect(pronunciation.naturalSentence).toBe('Are you free tonight after work?');
  });
});
