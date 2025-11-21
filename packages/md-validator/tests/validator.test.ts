import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateMarkdownFile } from '../src/validator.js';

const fixturesPath = path.join(import.meta.dirname, '..', 'fixtures');

describe('md-validator', () => {
  it('passes ok fixture', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'));
    expect(res.ok).toBe(true);
    expect(res.errors.length).toBe(0);
  });

  it('fails bad fixture', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'bad.md'));
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('accepts dialogue lines without brackets', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'dialogue.md');
    await writeFile(
      file,
      `
\`\`\`markdown
---
title: "Dialogue Test"
student: Alex
level: B1
topic: ["travel", "conversation"]
input_type: generate
speaker_labels: ["Alex", "Mara"]
---

## 1. This Week's Mission Briefing
text

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Alex: Hello!
Mara: Hi there.
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
1) item
2) item

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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.warnings).not.toContain(expect.stringMatching(/Speaker/));
  });

  it('flags unknown speaker labels with helpful message', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'dialogue-bad.md');
    await writeFile(
      file,
      `
\`\`\`markdown
---
title: "Dialogue Test"
student: Alex
level: B1
topic: "travel"
input_type: generate
speaker_labels: ["Alex", "Mara"]
---

## 1. This Week's Mission Briefing
text

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Alex: Hello!
Sam: Hi there.
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/unknown speaker "Sam"/);
  });

  it('allows inline descriptor after study-text marker', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'inline-study-text.md');
    await writeFile(
      file,
      `
\`\`\`markdown
---
title: Inline Test
student: Leo
level: B1
topic: focus
input_type: generate
speaker_labels: [Narrator]
---

## 1. This Week's Mission Briefing
text

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
:::study-text Transcript
Narrator: Hello there.
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('allows letter-style study text continuation after speaker line', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'letter-study-text.md');
    await writeFile(
      file,
      `
\`\`\`markdown
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
\`\`\`
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
\`\`\`markdown
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('fails when study-text marker is indented', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'indented-study-text.md');
    await writeFile(
      file,
      `
\`\`\`markdown
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

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
  :::study-text
Narrator: Hello there.
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/must start at column 1/i);
  });

  it('fails when study-text closing marker is missing or indented', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'missing-closing-study-text.md');
    await writeFile(
      file,
      `
\`\`\`markdown
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

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
:::study-text
Narrator: Hello there.
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/closing marker must be ":::"/i);
  });
});
