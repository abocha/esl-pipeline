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
\`\`\`markdown
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

## 2. 🗺️ Your Homework Roadmap

Text

## 3. 🎧 Input Material: The Source

### B. 🤖 Generated Material

- **Text:**
:::study-text
[Alex]: Hi!
[Mara]: Hello!
:::

## 4. 🛠️ Language Toolkit: Useful Language

### A. 👀 Notice the Grammar

text

### B. 🗣️ Useful Chunks & Vocabulary

text

## 5. ✍️ Practice & Pronunciation

### A. 🔩 Controlled Practice

1. a
2. b
3. c
4. d
5. e
6. f
7. g
8. h

### B. 🤔 Comprehension Check

1. x
2. y

### C. 🎙️ Pronunciation Micro-Focus (≈1 min)

text

## 6. ✅ Your Turn: Complete the Mission!

text

## 7. 🧠 Why This Mission Helps You

text

## 8. 🔑 Answer Key & Sample Mission

:::toggle Answer Key

### A. Controlled Practice Answers

...
:::

## 9. 👨‍🏫 Teacher's Follow-up Plan

:::toggle Teacher’s Follow-up Plan
notes
:::
\`\`\`
  `.trim();
}

function withPronunciationSection(doc: string, sectionContent: string): string {
  return doc.replace(
    ['### C. 🎙️ Pronunciation Micro-Focus (≈1 min)', '', 'text', '', '## 6. ✅ Your Turn: Complete the Mission!'].join(
      '\n',
    ),
    [
      '### C. 🎙️ Pronunciation Micro-Focus (≈1 min)',
      '',
      sectionContent,
      '',
      '## 6. ✅ Your Turn: Complete the Mission!',
    ].join('\n'),
  );
}

function withoutLegacyFence(doc: string): string {
  return doc.replace(/^```markdown\n/, '').replace(/\n```$/, '');
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

describe('md-validator', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('passes ok fixture', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'));
    expect(res.ok).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.warnings).toContain('Legacy fenced markdown is deprecated; remove the code fence.');
  });

  it('fails bad fixture', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'bad.md'));
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('returns structured issues and ruleset metadata for default resolution', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'));
    expect(res.ruleset).toMatchObject({
      id: 'general-english',
      version: 'v1',
      fallbackApplied: false,
    });
    expect(Array.isArray(res.issues)).toBe(true);
    expect(res.issues?.length).toBeGreaterThan(0);
  });

  it('falls back to general-english ruleset for unknown learningPresetId and warns', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'), {
      learningPresetId: 'ielts-academic',
    });
    expect(res.ok).toBe(true);
    expect(res.ruleset).toMatchObject({
      id: 'general-english',
      fallbackApplied: true,
      fallbackReason: 'unknown_preset',
      requestedId: 'ielts-academic',
    });
    expect(res.warnings.join('\n')).toMatch(/unknown learning preset/i);
    expect(res.issues?.some((issue) => issue.code === 'ruleset.unknown_preset_fallback')).toBe(
      true,
    );
    const fallbackIssues = (res.issues ?? []).filter((issue) =>
      /unknown learning preset/i.test(issue.message),
    );
    expect(fallbackIssues).toHaveLength(1);
    expect(fallbackIssues[0]).toMatchObject({
      ruleId: 'ruleset-resolution',
      blockingInStrict: false,
      severity: 'warning',
    });
  });

  it('maps legacy preset input to general-english ruleset', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'), {
      preset: 'b1-default',
    });
    expect(res.ok).toBe(true);
    expect(res.ruleset).toMatchObject({
      id: 'general-english',
      fallbackApplied: true,
      fallbackReason: 'legacy_preset_mapping',
      requestedId: 'b1-default',
    });
  });

  it('resolves known learning preset aliases without fallback warnings', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'), {
      learningPresetId: 'general-english-intensive',
    });
    expect(res.ok).toBe(true);
    expect(res.ruleset).toMatchObject({
      id: 'general-english',
      requestedId: 'general-english-intensive',
      fallbackApplied: false,
    });
    expect(res.warnings.join('\n')).not.toMatch(/unknown learning preset/i);
    expect(
      (res.issues ?? []).some((issue) => issue.code === 'ruleset.unknown_preset_fallback'),
    ).toBe(false);
  });

  it('allows flexible H2 wording', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'flex-h2.md');
    await writeFile(
      file,
      `
\`\`\`markdown
---
title: "Flexible H2 Test"
student: Anna
level: B1
topic: travel
input_type: generate
speaker_labels: ["Anna"]
---

## 1. Lesson Recap & Mission Overview
text

## 2. Homework Plan
text

## 3. Source Text (Input)
:::study-text
Anna: Hello there!
:::

## 4. Grammar & Useful Language
text

## 5. Practice and Speaking
### A. Controlled Practice
1) one
2) two
3) three
4) four
5) five
6) six
7) seven
8) eight
### B. Comprehension Check
1) q1
2) q2

### C. Pronunciation Micro-Focus
text

## 6. Your Task: Tell your story!
text

## 7. Why this helps
text

## 8. Answers & Example
:::toggle-heading Answer Key
answers
:::

## 9. Next Lesson Plan
:::toggle-heading Teacher's Follow-up Plan
plan
:::
\`\`\`
      `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('allows extra H2 sections appended after section 9', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'extra-h2-after-core.md');
    const md = buildBaseDoc('text').replace(
      '\n```',
      '\n\n## 10. Appendix Notes\ntext\n```',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings).toContain(
      'Additional H2 sections after section 9 are ignored by structure validation.',
    );
  });

  it('warns when an extra H2 is inserted before the core section sequence completes', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'extra-h2-mid-sequence.md');
    const md = buildBaseDoc('text').replace(
      "## 9. 👨‍🏫 Teacher's Follow-up Plan",
      "## 8.5. Appendix Notes\ntext\n\n## 9. 👨‍🏫 Teacher's Follow-up Plan",
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/H2 #9 mismatch/i);
  });

  it('warns when fewer than 9 core H2 sections are present', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'missing-core-h2.md');
    const md = `${buildBaseDoc('text').split("\n## 9. 👨‍🏫 Teacher's Follow-up Plan")[0]}\n\`\`\``;
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/Expected at least 9 H2 sections, found 8\./i);
  });

  it('warns on overly-generic section 5 headings that are semantically underspecified', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'generic-practice-heading.md');
    const md = buildBaseDoc('text').replace('## 5. ✍️ Practice & Pronunciation', '## 5. Practice');
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/H2 #5 mismatch/i);
  });

  it('accepts semantically-rich synonym headings for section 4', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'synonym-heading-section-4.md');
    const md = buildBaseDoc('text').replace(
      '## 4. 🛠️ Language Toolkit: Useful Language',
      '## 4. Useful Vocabulary Toolbox',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.warnings).not.toContain(expect.stringMatching(/Speaker/));
  });

  it('warns on unknown speaker labels with helpful message', async () => {
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/unknown speaker "Sam"/);
  });

  it('warns when speaker_profiles ids are not listed in speaker_labels', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'speaker-profile-mismatch.md');
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
speaker_profiles:
  - id: Alex
    role: student
    gender: male
  - id: Sam
    role: student
    gender: female
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(
      /speaker_profiles id "Sam" is not present in speaker_labels/i,
    );
  });

  it('accepts expanded ESL dialogue role aliases from pasted LLM drafts', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'speaker-profile-role-case.md');
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
speaker_labels: ["Receptionist", "Customer", "FlightAttendant", "Passenger"]
speaker_profiles:
  - id: Receptionist
    role: receptionist
    gender: female
  - id: Customer
    role: customer
    gender: male
  - id: FlightAttendant
    role: flight attendant
    gender: female
  - id: Passenger
    role: passenger
    gender: male
---

## 1. This Week's Mission Briefing
text

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Receptionist: Hello!
Customer: Hi there.
FlightAttendant: Please fasten your seatbelt.
Passenger: Sure, thank you.
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.errors.join('\n')).not.toMatch(/speaker_profiles\.\d+\.role/i);
    expect(res.meta?.speaker_profiles?.map((profile) => profile.role)).toEqual([
      'teacher',
      'student',
      'teacher',
      'student',
    ]);
  });

  it('warns on unknown speaker role and keeps validation non-blocking', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'speaker-profile-role-unknown.md');
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
speaker_labels: ["Ava", "Noah"]
speaker_profiles:
  - id: Ava
    role: alien ambassador
    gender: female
  - id: Noah
    role: customer
    gender: male
---

## 1. This Week's Mission Briefing
text

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Ava: Hello!
Noah: Hi there.
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file, { strict: true });
    expect(res.errors.join('\n')).not.toMatch(/speaker_profiles\.\d+\.role/i);
    expect(res.errors.join('\n')).not.toMatch(/speaker_profiles role/i);
    expect(res.warnings.join('\n')).toMatch(/speaker_profiles role "alien ambassador"/i);
    expect(res.warnings.join('\n')).toMatch(/Role score will be 0/i);
    expect(res.meta?.speaker_profiles?.map((profile) => profile.role)).toEqual([
      undefined,
      'student',
    ]);
  });

  it('warns when speaker labels are missing speaker profiles', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'speaker-profile-missing.md');
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
speaker_profiles:
  - id: Alex
    role: student
    gender: male
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(
      /speaker label "Mara" has no matching speaker_profile/i,
    );
  });

  it('accepts video directive URL when separated by a space', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'video-directive-space.md');
    await writeFile(
      file,
      buildBaseDoc(`
:::video https://example.com/demo.mp4
      `.trim()),
    );

    const res = await validateMarkdownFile(file);
    expect(res.errors).not.toContain(
      expect.stringContaining('video directive requires a URL after ":::video".'),
    );
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

  it('warns when study-text closing marker is indented', async () => {
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
\`\`\`
    `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/closing marker must be ":::"/i);
  });

  it('warns when column-list has no columns', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'column-list-empty.md');
    const md = buildBaseDoc(
      ['Text', ':::column-list', 'This has no column markers', ':::'].join('\n'),
    );
    await writeFile(file, md);
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/column-list.*at least one ":::column"/i);
  });

  it('accepts column-list with columns', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'column-list-ok.md');
    const md = buildBaseDoc(
      [
        'Text',
        ':::column-list',
        ':::column',
        'Left content',
        ':::',
        ':::column',
        'Right content',
        ':::',
        ':::',
      ].join('\n'),
    );
    await writeFile(file, md);
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('warns when synced-block has no content and no source id', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'synced-empty.md');
    const md = buildBaseDoc(['Text', ':::synced-block', ':::'].join('\n'));
    await writeFile(file, md);
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/synced-block.*must include content/i);
  });

  it('warns when table rows are ragged', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'table-ragged.md');
    const md = buildBaseDoc(
      ['Text', '| A | B |', '| -- | -- |', '| 1 | 2 |', '| only-one |'].join('\n'),
    );
    await writeFile(file, md);
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/Table .* inconsistent column counts/i);
  });

  it('accepts controlled practice heading with trailing qualifier text', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'controlled-practice-qualifier.md');
    const md = buildBaseDoc('text').replace(
      '### A. 🔩 Controlled Practice',
      '### A. 🔩 Controlled Practice (Fossil Hunter)',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings).not.toContain('No "### A. Controlled Practice" section found under H2 #5.');
  });

  it('warns when Comprehension Check is missing under H2 #5 even if a similarly named heading exists elsewhere', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'comprehension-offscope.md');
    const md = buildBaseDoc('text')
      .replace('### B. 🤔 Comprehension Check', '### B. Reflection')
      .replace(
        "## 9. 👨‍🏫 Teacher's Follow-up Plan",
        [
          '### B. Comprehension Check',
          '1) offscope',
          '2) offscope',
          '',
          "## 9. 👨‍🏫 Teacher's Follow-up Plan",
        ].join('\n'),
      );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings).toContain('No "### B. Comprehension Check" section found under H2 #5.');
  });

  it('accepts comprehension check heading with trailing qualifier text under H2 #5', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'comprehension-qualifier.md');
    const md = buildBaseDoc('text').replace(
      '### B. 🤔 Comprehension Check',
      '### B. 🤔 Comprehension Check (Fossil Hunter)',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings).not.toContain('No "### B. Comprehension Check" section found under H2 #5.');
  });

  it('treats missing H2 #5 comprehension check as blocking in strict mode', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'missing-comprehension-strict.md');
    const md = buildBaseDoc('text').replace('### B. 🤔 Comprehension Check', '### B. Reflection');
    await writeFile(file, md);

    const res = await validateMarkdownFile(file, { strict: true });
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('No "### B. Comprehension Check" section found under H2 #5.');
  });

  it('keeps comprehension-count recommendation non-blocking in strict mode', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'strict-comprehension-count.md');
    const md = withStrictReadyFrontmatter(withoutLegacyFence(buildBaseDoc('text'))).replace(
      '1. x\n2. y',
      '1. x',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file, { strict: true });
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/Comprehension Check has 1 item\(s\)/i);
  });

  it('treats H2 contract mismatches as blocking in strict mode', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'strict-h2-mismatch.md');
    const md = withStrictReadyFrontmatter(withoutLegacyFence(buildBaseDoc('text'))).replace(
      '## 5. ✍️ Practice & Pronunciation',
      '## 5. Practice',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file, { strict: true });
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/H2 #5 mismatch/i);
  });

  it('treats speaker alignment warnings as blocking in strict mode', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'strict-speaker-mismatch.md');
    const md = withStrictReadyFrontmatter(withoutLegacyFence(buildBaseDoc('text'))).replace(
      '[Mara]: Hello!',
      'Sam: Hello!',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file, { strict: true });
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/unknown speaker "Sam"/i);
  });

  it('accepts pronunciation micro-focus heading under H2 #5 with non-C letter prefix', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'pronunciation-non-c-prefix.md');
    const md = buildBaseDoc('text').replace(
      '### C. 🎙️ Pronunciation Micro-Focus (≈1 min)',
      '### F. 🎙️ Pronunciation Micro-Focus (Fossil Hunter)',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).not.toContain(
      'Missing "### <letter>. Pronunciation Micro-Focus" section under H2 #5.',
    );
  });

  it('fails when pronunciation micro-focus heading is missing under H2 #5', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'pronunciation-missing-under-h2-5.md');
    const md = buildBaseDoc('text').replace(
      '### C. 🎙️ Pronunciation Micro-Focus (≈1 min)',
      '### C. 🎙️ Accent Drill (≈1 min)',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(false);
    expect(res.errors).toContain(
      'Missing "### <letter>. Pronunciation Micro-Focus" section under H2 #5.',
    );
  });

  it('keeps extra-after-core H2 warning non-blocking in strict mode', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'strict-extra-h2-after-core.md');
    const md = `${withStrictReadyFrontmatter(withoutLegacyFence(buildBaseDoc('text')))}\n\n## 10. Appendix Notes\ntext`;
    await writeFile(file, md);

    const res = await validateMarkdownFile(file, { strict: true });
    expect(res.ok).toBe(true);
    expect(res.warnings).toContain(
      'Additional H2 sections after section 9 are ignored by structure validation.',
    );
  });

  it('warns about missing study_text_type in compatibility mode', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'missing-study-text-type.md');
    await writeFile(file, buildBaseDoc('text'));

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/study_text_type is required/i);
    expect(res.voiceDiagnostics?.compatibilityMode?.enabled).toBe(true);
  });

  it('emits shadow mismatch diagnostics when v2 is enabled without strict mode', async () => {
    process.env.VOICE_ALIGNMENT_V2_ENABLED = 'true';
    process.env.VOICE_ALIGNMENT_V2_STRICT_VALIDATION = 'false';

    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'shadow-mode-mismatch.md');
    await writeFile(file, buildBaseDoc('text'));

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.voiceDiagnostics?.shadowMode?.enabled).toBe(true);
    expect(res.voiceDiagnostics?.shadowMode?.mismatchClasses?.missing_study_text_type).toBe(1);
    expect(res.voiceDiagnostics?.shadowMode?.mismatchTotal).toBeGreaterThanOrEqual(1);
  });

  it('hard-fails missing study_text_type when strict voice alignment flags are enabled', async () => {
    process.env.VOICE_ALIGNMENT_V2_ENABLED = 'true';
    process.env.VOICE_ALIGNMENT_V2_STRICT_VALIDATION = 'true';

    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'missing-study-text-type-strict.md');
    await writeFile(file, buildBaseDoc('text'));

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/study_text_type is required/i);
    expect(res.voiceDiagnostics?.compatibilityMode?.enabled).toBe(false);
  });

  it('hard-fails invalid speaker_profiles.voice when strict alignment and catalog are available', async () => {
    process.env.VOICE_ALIGNMENT_V2_ENABLED = 'true';
    process.env.VOICE_ALIGNMENT_V2_STRICT_VALIDATION = 'true';

    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const voicesPath = path.join(tempDir, 'voices.json');
    process.env.ELEVENLABS_VOICES_PATH = voicesPath;
    await writeFile(
      voicesPath,
      JSON.stringify({
        voices: [{ id: 'voice_1', name: 'Friendly Voice', labels: { accent: 'american' } }],
      }),
    );

    const file = path.join(tempDir, 'bad-voice-override.md');
    const md = buildBaseDoc('text')
      .replace(
        'input_type: generate',
        ['input_type: generate', 'study_text_type: dialogue'].join('\n'),
      )
      .replace(
        'speaker_labels: [Alex, Mara]\n---',
        [
          'speaker_labels: [Alex, Mara]',
          'speaker_profiles:',
          '  - id: Alex',
          '    role: student',
          '    gender: male',
          '    voice: missing-voice-id',
          '  - id: Mara',
          '    role: student',
          '    gender: female',
          '    voice: Friendly Voice',
          '---',
        ].join('\n'),
      );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/does not exist in the current voice catalog/i);
  });

  it('accepts valid shadow_sentence pronunciation structure', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'shadow-pronunciation-ok.md');
    const section = [
      ':::callout 🗣️',
      '**Mode:** shadow_sentence',
      '**Shadow sentence:** I was thinking about working this morning.',
      '1. thinking — /ˈθɪŋkɪŋ/',
      '2. working — /ˈwɜːrkɪŋ/',
      '3. morning — /ˈmɔːrnɪŋ/',
      ':::',
    ].join('\n');
    await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('accepts LLM-variant shadow_sentence structure with bullets/backticks and trailing note', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'shadow-pronunciation-llm-variant.md');
    const section = [
      ':::callout 🗣️',
      '- `**Mode:** shadow_sentence`',
      '- `**Shadow sentence:** There was a flood, so the vehicle stopped working.`',
      '- 1. `Flood` — /flʌd/',
      '- 2. `Vehicle` — /viːɪkl/',
      '- 3. `Stopped` — /stɒpt/ (End with T sound)',
      ':::',
    ].join('\n');
    await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('accepts shadow_sentence word drill lines without dash delimiters', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'shadow-pronunciation-no-dash.md');
    const section = [
      ':::callout 🗣️',
      '**Mode:** shadow_sentence',
      '**Shadow sentence:** I was thinking about working this morning.',
      '1. thinking /ˈθɪŋkɪŋ/',
      '2. working /ˈwɜːrkɪŋ/',
      '3. morning /ˈmɔːrnɪŋ/',
      ':::',
    ].join('\n');
    await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('fails shadow_sentence mode when shadow sentence is missing', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'shadow-pronunciation-missing-sentence.md');
    const section = [
      ':::callout 🗣️',
      '**Mode:** shadow_sentence',
      '1. thinking — /ˈθɪŋkɪŋ/',
      '2. working — /ˈwɜːrkɪŋ/',
      '3. morning — /ˈmɔːrnɪŋ/',
      ':::',
    ].join('\n');
    await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/missing "\*\*Shadow sentence:\*\* <sentence>"/i);
  });

  it('fails shadow_sentence mode when word drill count is outside 3-5', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'shadow-pronunciation-word-count.md');
    const section = [
      ':::callout 🗣️',
      '**Mode:** shadow_sentence',
      '**Shadow sentence:** I was thinking about working this morning.',
      '1. thinking — /ˈθɪŋkɪŋ/',
      '2. working — /ˈwɜːrkɪŋ/',
      ':::',
    ].join('\n');
    await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/requires 3-5 word drill lines/i);
  });

  it('fails shadow_sentence mode when transcription delimiters are missing', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'shadow-pronunciation-transcription.md');
    const section = [
      ':::callout 🗣️',
      '**Mode:** shadow_sentence',
      '**Shadow sentence:** I was thinking about working this morning.',
      '1. thinking — ˈθɪŋkɪŋ',
      '2. working — /ˈwɜːrkɪŋ/',
      '3. morning — /ˈmɔːrnɪŋ/',
      ':::',
    ].join('\n');
    await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/must be wrapped in forward slashes/i);
  });
});
