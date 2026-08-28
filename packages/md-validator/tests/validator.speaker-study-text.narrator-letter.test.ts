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

## 2. Input Material: The Source
:::study-text Transcript
Alex: Hey there,

I wanted to share some big news with you. There's an art studio in Lisbon offering me a position, and it's a dream come true.

The catch is the salary. It's much lower than what I'm making now, so I'd need to tighten my budget for a while.

If you were me, would you take the plunge or stay put?

Talk soon,
Alex
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

## 2. Input Material: The Source
:::study-text
It was a rainy day, and Leo left his umbrella on the bus.

He ran back quickly, but the bus had already gone. Leo sighed and decided to buy a new one.
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
      expect(res.errors).toHaveLength(0);
    });

    it('classifies repeated single-speaker markers as monologue', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'repeated-narrator-monologue.md');
      await writeFile(
        file,
        `
---
title: Narrator Blocks
student: Vera
level: A2
topic: narrative
input_type: generate
study_text_type: monologue
speaker_labels: [Narrator]
---

## 1. This Week's Mission Briefing
text

## 2. Input Material: The Source
:::study-text
Narrator: Leo walked into the station and checked the big clock.

Narrator: The train was delayed, so he bought tea and reviewed his notes.

Narrator: When the train arrived, Leo felt calm and ready for the meeting.
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
      expect(res.errors).toHaveLength(0);
      expect(res.warnings.join('\n')).not.toMatch(
        /study_text_type "monologue".*detected "dialogue"/i,
      );
    });

    it('still detects multiple speaker markers as dialogue', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'multi-speaker-dialogue.md');
      await writeFile(
        file,
        `
---
title: Dialogue Contrast
student: Vera
level: A2
topic: narrative
input_type: generate
study_text_type: monologue
speaker_labels: [Alex, Mara]
---

## 1. This Week's Mission Briefing
text

## 2. Input Material: The Source
:::study-text
Alex: Did you see the new timetable?
Mara: Yes, the meeting moved to Friday afternoon.
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
      expect(res.warnings.join('\n')).toMatch(/study_text_type "monologue".*detected "dialogue"/i);
    });
  },
);
