import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateMarkdown } from '../src/validator.js';

const fixturesPath = path.join(import.meta.dirname, '..', 'fixtures');
const ORIGINAL_ENV = { ...process.env };

async function validateMarkdownFile(
  pathValue: string,
  opts?: {
    strict?: boolean;
    learningPresetId?: string;
    learningPresetVersion?: string;
    preset?: string;
  },
) {
  return validateMarkdown({
    path: pathValue,
    strict: opts?.strict,
    learningPresetId: opts?.learningPresetId,
    learningPresetVersion: opts?.learningPresetVersion,
    preset: opts?.preset,
  });
}

function buildBaseDoc(firstSectionContent: string): string {
  return `
---
title: 'Homework Assignment: Conditionals Type 2'
student: Anna
level: A2
topic: Second Conditional
input_type: generate
speaker_labels: [Alex, Mara]
---

## 1. 🎯 This Week's Mission Briefing

${firstSectionContent}

## 2. 🎧 Input Material: The Source

### B. 🤖 Generated Material

- **Text:**
:::study-text
[Alex]: Hi!
[Mara]: Hello!
:::

### 🤔 Comprehension Check

1. x
2. y

## 3. 🛠️ Language Toolkit: Useful Language

### A. 👀 Notice the Grammar

text

### B. 🗣️ Useful Chunks & Vocabulary

text

## 4. ✍️ Practice & Pronunciation

### A. 🔩 Controlled Practice

1. a
2. b
3. c
4. d
5. e
6. f
7. g
8. h

### B. 🎙️ Pronunciation Micro-Focus (≈1 min)

text

## 5. ✅ Your Turn: Complete the Mission!

text

## 6. 🧠 Why This Mission Helps You

text

## 7. 🔑 Answer Key & Sample Mission

:::toggle Answer Key

### A. Controlled Practice Answers

...
:::

## 8. 👨‍🏫 Teacher's Follow-up Plan

:::toggle Teacher’s Follow-up Plan
notes
:::
  `.trim();
}

function withPronunciationSection(doc: string, sectionContent: string): string {
  return doc.replace(
    [
      '### B. 🎙️ Pronunciation Micro-Focus (≈1 min)',
      '',
      'text',
      '',
      '## 5. ✅ Your Turn: Complete the Mission!',
    ].join('\n'),
    [
      '### B. 🎙️ Pronunciation Micro-Focus (≈1 min)',
      '',
      sectionContent,
      '',
      '## 5. ✅ Your Turn: Complete the Mission!',
    ].join('\n'),
  );
}

function withStrictReadyFrontmatter(doc: string): string {
  return doc.replace(
    'speaker_labels: [Alex, Mara]\n---',
    [
      'speaker_labels: [Alex, Mara]',
      'study_text_type: dialogue',
      'speaker_profiles:',
      '  - id: Alex',
      '    role: student',
      '    gender: male',
      '  - id: Mara',
      '    role: teacher',
      '    gender: female',
      '---',
    ].join('\n'),
  );
}

export function describeMdValidatorSuite(title: string, register: (ctx: any) => void): void {
  describe(title, () => {
    beforeEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    register({
      buildBaseDoc,
      expect,
      fixturesPath,
      it,
      mkdtemp,
      path,
      process,
      tmpdir,
      validateMarkdownFile,
      withPronunciationSection,
      withStrictReadyFrontmatter,
      writeFile,
    });
  });
}
