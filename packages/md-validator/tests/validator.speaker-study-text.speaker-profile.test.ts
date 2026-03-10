import { describeMdValidatorSuite } from './validator.test-harness.js';
import { expect, it } from 'vitest';

interface SpeakerProfileLike {
  role?: string;
}

describeMdValidatorSuite(
  'md-validator [speaker-and-study-text]',
  ({ mkdtemp, path, tmpdir, validateMarkdownFile, writeFile }) => {
    it('accepts dialogue lines without brackets', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'dialogue.md');
      await writeFile(
        file,
        `
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
    `.trim(),
      );

      const res = await validateMarkdownFile(file);
      expect(res.errors.join('\n')).not.toMatch(/speaker_profiles\.\d+\.role/i);
      expect(res.meta?.speaker_profiles?.map((profile: SpeakerProfileLike) => profile.role)).toEqual([
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
    `.trim(),
      );

      const res = await validateMarkdownFile(file, { strict: true });
      expect(res.errors.join('\n')).not.toMatch(/speaker_profiles\.\d+\.role/i);
      expect(res.errors.join('\n')).not.toMatch(/speaker_profiles role/i);
      expect(res.warnings.join('\n')).toMatch(/speaker_profiles role "alien ambassador"/i);
      expect(res.warnings.join('\n')).toMatch(/Role score will be 0/i);
      expect(res.meta?.speaker_profiles?.map((profile: SpeakerProfileLike) => profile.role)).toEqual([
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
    `.trim(),
      );

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(
        /speaker label "Mara" has no matching speaker_profile/i,
      );
    });
  },
);
