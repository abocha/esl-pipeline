import { expect, it } from 'vitest';

import { describeMdValidatorSuite } from './validator.test-harness.js';

describeMdValidatorSuite(
  'md-validator [speaker-and-study-text]',
  ({ mkdtemp, path, tmpdir, validateMarkdownFile, writeFile }) => {
    it('allows letter-style study text continuation after speaker line', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'letter-study-text.md');
      await writeFile(
        file,
        `
---
title: Letter Test
student: Ana
level: B1
topic: choices
input_type: generate
speaker_labels: [Narrator, Alex]
---

## 1. This Week's Mission Briefing
text

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
:::study-text Transcript
Alex: Hey there,

I wanted to share some big news with you. There's an art studio in Lisbon offering me a position, and it's a dream come true.

The catch is the salary. It's much lower than what I'm making now, so I'd need to tighten my budget for a while.

If you were me, would you take the plunge or stay put?

Talk soon,
Alex
:::

## 4. Language Toolkit: Useful Language
text

## 5. Practice & Pronunciation
### A. Controlled Practice
1) item
2) item
3) item
4) item
5) item
6) item
7) item
8) item
### B. Comprehension Check
1) question
2) question

### C. Pronunciation Micro-Focus
text

## 6. Your Turn: Complete the Mission!
text

## 7. Why This Mission Helps You
text

## 8. Answer Key & Sample Mission
:::toggle-heading Answer Key
content
:::

## 9. Teacher's Follow-up Plan
:::toggle-heading Teacher's Follow-up Plan
content
:::
    `.trim(),
      );

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('allows narrator-only story without explicit speaker prefixes', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'narrator-story.md');
      await writeFile(
        file,
        `
---
title: Story Test
student: Vera
level: A2
topic: narrative
input_type: generate
speaker_labels: [Narrator]
---

## 1. This Week's Mission Briefing
text

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
:::study-text
It was a rainy day, and Leo left his umbrella on the bus.

He ran back quickly, but the bus had already gone. Leo sighed and decided to buy a new one.
:::

## 4. Language Toolkit: Useful Language
text

## 5. Practice & Pronunciation
### A. Controlled Practice
1) item
2) item
3) item
4) item
5) item
6) item
7) item
8) item
### B. Comprehension Check
1) question
2) question

### C. Pronunciation Micro-Focus
text

## 6. Your Turn: Complete the Mission!
text

## 7. Why This Mission Helps You
text

## 8. Answer Key & Sample Mission
:::toggle-heading Answer Key
content
:::

## 9. Teacher's Follow-up Plan
:::toggle-heading Teacher's Follow-up Plan
content
:::
    `.trim(),
      );

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.errors).toHaveLength(0);
    });
  },
);
