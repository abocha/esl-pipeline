import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildStudyTextMp3FromPath,
  createTempDir,
  mockConcat,
  setupClientMock,
  setupTtsTestSuite,
  writeFixture,
} from './index.test-harness.js';

setupTtsTestSuite();

describe('tts elevenlabs integration', () => {
  it('buildStudyTextMp3 preview mode', async () => {
    const dir = await createTempDir('tts-');
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: monologue
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    role: narrator
    gender: female

---

# Warm-up

:::study-text
This is a monologue line for preview.
:::
    `,
    );
    await writeFixture(
      tempVoiceMapPath,
      `
default: voice_id_default
    `,
    );

    const convertMock = setupClientMock();
    const spy = mockConcat();
    const result = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      preview: true,
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(result.path).toContain('anna-');
    expect(spy).not.toHaveBeenCalled();
    expect(convertMock).not.toHaveBeenCalled();
    expect(result.voices).toEqual([
      expect.objectContaining({
        speaker: 'Narrator',
        voiceId: 'voice_id_default',
        source: 'default',
      }),
    ]);
  });

  it('buildStudyTextMp3 creates concatenated file for dialogue', async () => {
    const dir = await createTempDir('tts-');
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: dialogue
speaker_labels: ["Alex", "Mara"]
speaker_profiles:
  - id: Alex
    role: student
    gender: male
    style: social
  - id: Mara
    role: student
    gender: female
    style: social

---

# Warm-up

:::study-text
Alex: Hello, how are you?
Mara: I'm fine, thank you. And you?
Alex: Very well, thanks.
:::
    `,
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: voice_id_1
Mara: voice_id_2
default: voice_id_default
    `,
    );

    const convertMock = setupClientMock();
    const spy = mockConcat();
    const result = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining('.mp3'),
      true,
      'ffmpeg',
    );
    expect(convertMock).toHaveBeenCalledTimes(3);
    expect(result.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ speaker: 'Alex', voiceId: 'voice_id_1', source: 'voiceMap' }),
        expect.objectContaining({ speaker: 'Mara', voiceId: 'voice_id_2', source: 'voiceMap' }),
      ]),
    );
  });

  it('buildStudyTextMp3 handles monologue as multiple segments', async () => {
    const dir = await createTempDir('tts-');
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: monologue
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    role: narrator
    gender: female

---

# Warm-up

:::study-text
This is a monologue line.
This is another line.
:::
    `,
    );
    await writeFixture(
      tempVoiceMapPath,
      `
default: voice_id_default
    `,
    );

    const convertMock = setupClientMock();
    const spy = mockConcat();
    const result = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining('.mp3'),
      true,
      'ffmpeg',
    );
    expect(convertMock).toHaveBeenCalledTimes(1);
    const voiceIds = convertMock.mock.calls.map((call) => call[0]);
    expect(new Set(voiceIds).size).toBe(1);
    expect(result.voices).toEqual([
      expect.objectContaining({ speaker: 'Narrator', source: 'default' }),
    ]);
  });

  it('buildStudyTextMp3 handles default fallback voice', async () => {
    const dir = await createTempDir('tts-');
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: dialogue
speaker_labels: ["Alex", "Mara"]
speaker_profiles:
  - id: Alex
    role: student
    gender: male
  - id: Mara
    role: student
    gender: female

---

# Warm-up

:::study-text
Alex: Hello, how are you?
Observer: Just listening.
:::
    `,
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: voice_id_1
default: voice_id_default
    `,
    );

    const convertMock = setupClientMock();
    const spy = mockConcat();
    const result = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining('.mp3'),
      true,
      'ffmpeg',
    );
    expect(convertMock).toHaveBeenCalledTimes(2);
    const voiceIds = convertMock.mock.calls.map((call) => call[0]);
    expect(new Set(voiceIds).size).toBe(2);
    expect(result.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ speaker: 'Alex', voiceId: 'voice_id_1', source: 'voiceMap' }),
        expect.objectContaining({
          speaker: 'Observer',
          voiceId: 'voice_id_default',
          source: 'default',
        }),
        expect.objectContaining({
          speaker: 'Mara',
          source: expect.stringMatching(/auto|fallback/),
        }),
      ]),
    );
  });

  it('strips markdown formatting before synthesis', async () => {
    const dir = await createTempDir('tts-');
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Formatting Lesson
student: Anna
speaker_labels: [Alex]
speaker_profiles:
  - id: Alex
    role: student
    gender: female

---

:::study-text
Alex: I **really** _love_ \`code\`!
:::
    `,
    );
    await writeFixture(
      tempVoiceMapPath,
      `
default: voice_id_default
    `,
    );

    const convertMock = setupClientMock();
    mockConcat();
    await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(convertMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ text: 'I really love code!' }),
    );
  });
});
