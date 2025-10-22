import { describe, it, expect } from 'vitest';
import { extractFrontmatter, extractStudyText, extractAnswerKey, extractTeacherNotes, extractSections } from '../src/index.js';

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

## 9. teacher's follow-up plan

:::toggle-heading Teacher’s Follow-up Plan
- Next time: focus on intonation.
:::

## 8. answer key (for real doc it’s section #8)

:::toggle-heading Answer Key
1) She is fine.
:::
`;

describe('md-extractor', () => {
  it('frontmatter', () => {
    const fm = extractFrontmatter(sample);
    expect(fm.title).toBe('Homework Assignment: Weather');
    expect(fm.student).toBe('Anna');
    expect(fm.level).toBe('A2');
  });

  it('study-text', () => {
    const st = extractStudyText(sample);
    expect(st.type).toBe('dialogue');
    expect(st.lines.length).toBeGreaterThan(0);
  });

  it('answer key', () => {
    const ak = extractAnswerKey(sample);
    expect(ak).toContain('She is fine');
  });

  it("teacher's notes", () => {
    const tn = extractTeacherNotes(sample);
    expect(tn).toContain('intonation');
  });

  it('sections h2/h3 slice', () => {
    const sections = extractSections(sample);
    const titles = sections.map(s => s.title.toLowerCase());
    expect(titles.join('|')).toContain('study text');
  });
});
