import { expect, it } from 'vitest';

import { describeMdValidatorSuite } from './validator.test-harness.js';

describeMdValidatorSuite(
  'md-validator [speaker-and-study-text]',
  ({ mkdtemp, path, tmpdir, validateMarkdownFile, writeFile }) => {
    it('fails when study-text marker is indented', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'indented-study-text.md');
      await writeFile(
        file,
        `
---
title: Indented Test
student: Leo
level: B1
topic: focus
input_type: generate
speaker_labels: [Narrator]
---

## 1. This Week's Mission Briefing
text

## 2. Input Material: The Source
  :::study-text
Narrator: Hello there.
:::

### Comprehension Check
1) question
2) question

## 3. Language Toolkit: Useful Language
text

## 4. Practice & Pronunciation
### A. Controlled Practice
1) item
2) item
3) item
4) item
5) item
6) item
7) item
8) item
## 5. Your Turn: Complete the Mission!
text

## 6. Why This Mission Helps You
text

## 7. Answer Key & Sample Mission
:::toggle-heading Answer Key
content
:::

## 8. Teacher's Follow-up Plan
:::toggle-heading Teacher's Follow-up Plan
content
:::
    `.trim(),
      );

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/must start at column 1/i);
    });

    it('warns when study-text closing marker is indented', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'missing-closing-study-text.md');
      await writeFile(
        file,
        `
---
title: Closing Test
student: Leo
level: B1
topic: focus
input_type: generate
speaker_labels: [Narrator]
---

## 1. This Week's Mission Briefing
text

## 2. Input Material: The Source
:::study-text
Narrator: Hello there.
  :::

### Comprehension Check
1) question
2) question

## 3. Language Toolkit: Useful Language
text

## 4. Practice & Pronunciation
### A. Controlled Practice
1) item
2) item
3) item
4) item
5) item
6) item
7) item
8) item
### B. Pronunciation Micro-Focus
text

## 5. Your Turn: Complete the Mission!
text

## 6. Why This Mission Helps You
text

## 7. Answer Key & Sample Mission
:::toggle-heading Answer Key
content
:::

## 8. Teacher's Follow-up Plan
:::toggle-heading Teacher's Follow-up Plan
content
:::
    `.trim(),
      );

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/closing marker must be ":::"/i);
    });
  },
);
