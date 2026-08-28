import { expect, it } from 'vitest';

import { describeMdValidatorSuite } from './validator.test-harness.js';

interface SpeakerProfileLike {
  role?: string;
  persona?: string;
}

function buildSpeakerProfileDoc(extraProfiles: string): string {
  return `
---
title: "Dialogue Test"
student: Alex
level: B1
topic: "travel"
input_type: generate
speaker_labels: ["Alex", "Mara"]
${extraProfiles}
---

## 1. This Week's Mission Briefing
text

## 2. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Alex: Hello!
Mara: Hi there.
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
  `.trim();
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

## 2. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Alex: Hello!
Mara: Hi there.
:::

### Comprehension Check
1) item
2) item

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

## 2. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Alex: Hello!
Sam: Hi there.
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

## 2. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Alex: Hello!
Mara: Hi there.
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
      expect(res.warnings.join('\n')).toMatch(
        /speaker_profiles id "Sam" is not present in speaker_labels/i,
      );
    });

    it('preserves descriptive ESL dialogue roles from pasted LLM drafts', async () => {
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

## 2. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Receptionist: Hello!
Customer: Hi there.
FlightAttendant: Please fasten your seatbelt.
Passenger: Sure, thank you.
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
      expect(res.errors.join('\n')).not.toMatch(/speaker_profiles\.\d+\.role/i);
      expect(
        res.meta?.speaker_profiles?.map((profile: SpeakerProfileLike) => profile.role),
      ).toEqual(['receptionist', 'customer', 'flight attendant', 'passenger']);
    });

    it('preserves descriptive speaker roles without catalog-shaped warnings', async () => {
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

## 2. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Ava: Hello!
Noah: Hi there.
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

      const res = await validateMarkdownFile(file, { strict: true });
      expect(res.errors.join('\n')).not.toMatch(/speaker_profiles\.\d+\.role/i);
      expect(res.errors.join('\n')).not.toMatch(/speaker_profiles role/i);
      expect(res.warnings.join('\n')).not.toMatch(/speaker_profiles role "alien ambassador"/i);
      expect(
        res.meta?.speaker_profiles?.map((profile: SpeakerProfileLike) => profile.role),
      ).toEqual(['alien ambassador', 'customer']);
    });

    it('warns that legacy style and voice fields are ignored while preserving persona', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'speaker-profile-legacy-voice-style.md');
      await writeFile(
        file,
        buildSpeakerProfileDoc(
          [
            'speaker_profiles:',
            '  - id: Alex',
            '    role: project manager clarifying an unrealistic deadline',
            '    persona: warm, practical, and direct',
            '    style: conversational',
            '    voice: legacy-voice-id',
            '  - id: Mara',
            '    role: colleague offering a workable compromise',
          ].join('\n'),
        ),
      );

      const res = await validateMarkdownFile(file);
      expect(res.warnings.join('\n')).toMatch(/speaker_profiles style .* ignored/i);
      expect(res.warnings.join('\n')).toMatch(/speaker_profiles voice .* ignored/i);
      expect(res.meta?.speaker_profiles?.[0]).toMatchObject({
        role: 'project manager clarifying an unrealistic deadline',
        persona: 'warm, practical, and direct',
      });
    });

    it('preserves voice direction and ignores placeholder accents', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'speaker-profile-voice-direction.md');
      await writeFile(
        file,
        buildSpeakerProfileDoc(
          [
            'speaker_profiles:',
            '  - id: Alex',
            '    role: project manager clarifying an unrealistic deadline',
            '    persona: warm, practical, and direct',
            '    voice_direction: calm, neutral, clear, conversational adult voice',
            '    accent: neutral',
            '  - id: Mara',
            '    role: colleague offering a workable compromise',
          ].join('\n'),
        ),
      );

      const res = await validateMarkdownFile(file);
      expect(res.warnings.join('\n')).toMatch(/speaker_profiles accent "neutral".*ignored/i);
      expect(res.meta?.speaker_profiles?.[0]).toMatchObject({
        voice_direction: 'calm, neutral, clear, conversational adult voice',
      });
      expect(res.meta?.speaker_profiles?.[0]?.accent).toBeUndefined();
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

## 2. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
Alex: Hello!
Mara: Hi there.
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
      expect(res.warnings.join('\n')).toMatch(
        /speaker label "Mara" has no matching speaker_profile/i,
      );
    });
  },
);
