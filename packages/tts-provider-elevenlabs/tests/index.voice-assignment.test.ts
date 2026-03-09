import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import * as speakers from '../src/speakerAssignment.js';
import {
  buildStudyTextMp3FromPath,
  createTempDir,
  makeMockStream,
  mockConcat,
  setupClientMock,
  setupTtsTestSuite,
  writeFixture,
} from './index.test-harness.js';

setupTtsTestSuite();

describe('tts elevenlabs integration', () => {
  it('passes default accent preference to voice resolver', async () => {
    const dir = await createTempDir('tts-');
    const tempMdPath = join(dir, 'lesson-accent.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Accent Test
student: Default
level: A1
topic: greetings
input_type: dialogue
speaker_labels: [Alex]
speaker_profiles:
  - id: Alex
    role: student
    gender: male

---

:::study-text
[Alex]: Hello there!
:::
    `,
    );
    await writeFixture(
      tempVoiceMapPath,
      `
auto: true
    `,
    );

    vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
      textToSpeech: { convert: vi.fn(() => makeMockStream('audio')) },
    } as any);
    vi.spyOn(ffm, 'concatMp3Segments').mockImplementation(async (_segments, outFile) => {
      await writeFile(outFile, 'mock');
    });

    const accentSpy = vi.spyOn(speakers, 'resolveSpeakerVoices');
    await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      preview: true,
      defaultAccent: 'british',
    });

    expect(accentSpy).toHaveBeenCalled();
    const call = accentSpy.mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call).toMatchObject({ defaultAccent: 'british' });
  });

  it('assigns continuation lines in a letter to the initial speaker', async () => {
    const dir = await createTempDir('tts-');
    const tempMdPath = join(dir, 'letter.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Letter Lesson
student: Max
level: B1
topic: decisions
input_type: generate
speaker_labels: [Narrator, Alex]
speaker_profiles:
  - id: Alex
    role: student
    gender: male

---

# Warm-up

:::study-text Transcript
Alex: Hey there,

I wanted to get your advice on a big decision. There's an art studio in Lisbon offering me a role.

The pay would be tight at first, but it feels like the right move for my creativity.

What would you do if you were in my shoes?

Talk soon,
Alex
:::
    `,
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: voice_id_alex
default: voice_id_default
    `,
    );

    const result = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      preview: true,
    });

    expect(result.voices).toHaveLength(1);
    expect(result.voices[0]).toMatchObject({
      speaker: 'Alex',
      voiceId: 'voice_id_alex',
      source: 'voiceMap',
    });
  });

  it('auto-selects distinct voices for multiple speakers when possible', async () => {
    const dir = await createTempDir('tts-');
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Auto Voices
student: Anna
level: B1
topic: routines
input_type: dialogue
speaker_labels: ["Narrator", "Chloe", "Mia", "Ethan"]
speaker_profiles:
  - id: Narrator
    role: narrator
    gender: female
    style: professional
  - id: Chloe
    role: student
    gender: female
    style: social
  - id: Mia
    role: student
    gender: neutral
    style: thoughtful
  - id: Ethan
    role: student
    gender: male
    style: practical

---

:::study-text
Narrator: Welcome to the demo.
Chloe: Hey, I'm ready to learn.
Mia: Great, let's get started.
Ethan: I'm here to explain the steps.
:::
    `,
    );
    await writeFixture(
      tempVoiceMapPath,
      `
auto: true
    `,
    );

    const convertMock = setupClientMock();
    mockConcat();
    const result = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(convertMock).toHaveBeenCalledTimes(4);
    const voiceIds = convertMock.mock.calls.map((call) => call[0]);
    expect(new Set(voiceIds).size).toBe(4);
    expect(result.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ speaker: 'Narrator', voiceId: 'voice_narrator', source: 'auto' }),
        expect.objectContaining({
          speaker: 'Chloe',
          voiceId: 'voice_student_female',
          source: 'auto',
        }),
        expect.objectContaining({
          speaker: 'Mia',
          voiceId: 'voice_student_neutral',
          source: 'auto',
        }),
        expect.objectContaining({
          speaker: 'Ethan',
          voiceId: 'voice_student_male',
          source: 'auto',
        }),
      ]),
    );
  });
});
