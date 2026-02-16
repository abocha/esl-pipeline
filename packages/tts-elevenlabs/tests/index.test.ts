import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdownContext } from '@esl-pipeline/pmd';

import * as assign from '../src/assign.js';
import * as dialogue from '../src/dialogue.js';
import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import { buildStudyTextMp3, hashStudyText } from '../src/index.js';
import * as speakers from '../src/speakerAssignment.js';

const encoder = new TextEncoder();

const makeMockStream = (payload: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });

const writeFixture = async (filePath: string, contents: string) => {
  await writeFile(filePath, contents.trim());
};

const buildStudyTextMp3FromPath = async (
  mdPath: string,
  ...args: Parameters<typeof buildStudyTextMp3> extends [any, ...infer Rest] ? Rest : never
) => {
  const markdown = await readFile(mdPath, 'utf8');
  const context = parseMarkdownContext(markdown);
  return buildStudyTextMp3({ context, mdPath }, ...args);
};

const catalogMock = {
  voices: [
    {
      id: 'voice_narrator',
      name: 'NarratorVoice',
      category: 'premade',
      labels: {
        gender: 'female',
        use_case: 'narration',
        accent: 'american',
        age: 'adult',
        descriptive: 'professional',
      },
    },
    {
      id: 'voice_student_female',
      name: 'ChloeVoice',
      category: 'premade',
      labels: {
        gender: 'female',
        use_case: 'conversational',
        accent: 'british',
        age: 'young',
        descriptive: 'social',
      },
    },
    {
      id: 'voice_student_neutral',
      name: 'MiaVoice',
      category: 'premade',
      labels: {
        gender: 'neutral',
        use_case: 'conversational',
        accent: 'canadian',
        age: 'teen',
        descriptive: 'thoughtful',
      },
    },
    {
      id: 'voice_student_male',
      name: 'EthanVoice',
      category: 'premade',
      labels: {
        gender: 'male',
        use_case: 'conversational',
        accent: 'american',
        age: 'young',
        descriptive: 'confident',
      },
    },
    {
      id: 'voice_fallback',
      name: 'FallbackVoice',
      category: 'premade',
      labels: {
        gender: 'male',
        use_case: 'news',
        accent: 'american',
        age: 'adult',
        descriptive: 'professional',
      },
    },
  ],
};

const setupClientMock = () => {
  const convertMock = vi.fn(async (_voiceId: string, request: any) =>
    makeMockStream(request?.text ?? 'audio'),
  );
  vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
    textToSpeech: { convert: convertMock },
  } as any);
  return convertMock;
};

const mockConcat = () =>
  vi.spyOn(ffm, 'concatMp3Segments').mockImplementation(async (_segments, outFile) => {
    await writeFile(outFile, 'mock-audio');
  });

const mockDialogue = () =>
  vi
    .spyOn(dialogue, 'synthesizeDialogue')
    .mockImplementation(async (_options, _apiKey, outputDir) => {
      const audioPath = join(outputDir, 'mock-dialogue.mp3');
      await writeFile(audioPath, 'mock-audio');
      return {
        audioPath,
        duration: 5.2,
        hash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
      };
    });

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(assign, 'loadVoicesCatalog').mockResolvedValue(catalogMock as any);
  vi.spyOn(ffm, 'resolveFfmpegPath').mockResolvedValue('ffmpeg');
  vi.spyOn(ffm, 'synthSilenceMp3').mockImplementation(async (outFile: string) => {
    await writeFile(outFile, 'silence');
  });
  vi.spyOn(ffm, 'setMp3TitleMetadata').mockResolvedValue();
  // Mock console.log to suppress TTS mode selection messages
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('tts elevenlabs integration', () => {
  it('hashes study text deterministically', () => {
    expect(hashStudyText('hello')).toEqual(hashStudyText('hello'));
  });

  it('buildStudyTextMp3 preview mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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

  it('passes default accent preference to voice resolver', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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

  it('buildStudyTextMp3 creates concatenated file for dialogue', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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
      ttsStrategy: 'tts', // Force TTS strategy for this test
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
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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
      ttsStrategy: 'tts', // Force TTS strategy for this test
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

  it('assigns continuation lines in a letter to the initial speaker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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
      ttsStrategy: 'tts', // Force TTS strategy for this test
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

  it('strips markdown formatting before synthesis', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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

  it('reuses generated audio when file already exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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

---

# Warm-up

:::study-text
This is a monologue line.
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
    const concatSpy = mockConcat();
    await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(convertMock).toHaveBeenCalledTimes(1);

    convertMock.mockClear();
    const result = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(result.hash).toHaveLength(64);
    expect(convertMock).not.toHaveBeenCalled();
    expect(concatSpy).toHaveBeenCalled();
  });

  it('reuses monologue chunk cache when final file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    const tempMdPath = join(dir, 'lesson-chunk-cache.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Chunk Cache
student: Anna
input_type: monologue
---

:::study-text
This is a monologue line that should be chunk-cached and reused across runs.
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
    const first = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(convertMock).toHaveBeenCalledTimes(1);

    await unlink(first.path);
    convertMock.mockClear();

    await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(convertMock).not.toHaveBeenCalled();
  });

  it('reuses generated dialogue audio when file already exists and force=false', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    const tempMdPath = join(dir, 'dialogue-cache.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Dialogue Cache
student: Anna
input_type: dialogue

---

:::study-text
Alex: Hi there.
Mara: Hello.
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

    const dialogueSpy = mockDialogue();
    const first = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
    });
    expect(first.hash).toHaveLength(64);
    expect(dialogueSpy).toHaveBeenCalledTimes(1);

    dialogueSpy.mockClear();
    const second = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
      force: false,
    });
    expect(second.path).toBe(first.path);
    expect(dialogueSpy).not.toHaveBeenCalled();
  });

  it('regenerates dialogue audio when force=true', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    const tempMdPath = join(dir, 'dialogue-force.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Dialogue Force
student: Anna
input_type: dialogue

---

:::study-text
Alex: Hi there.
Mara: Hello.
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

    const dialogueSpy = mockDialogue();
    await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
    });
    expect(dialogueSpy).toHaveBeenCalledTimes(1);

    dialogueSpy.mockClear();
    await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
      force: true,
    });
    expect(dialogueSpy).toHaveBeenCalledTimes(1);
  });

  it('does not reuse dialogue cache when outputFormat changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    const tempMdPath = join(dir, 'dialogue-format-cache.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Dialogue Format Cache
student: Anna
input_type: dialogue

---

:::study-text
Alex: Hi there.
Mara: Hello.
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

    const dialogueSpy = mockDialogue();
    await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
      outputFormat: 'mp3_22050_32',
    });
    expect(dialogueSpy).toHaveBeenCalledTimes(1);

    dialogueSpy.mockClear();
    await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
      force: false,
      outputFormat: 'mp3_44100_128',
    });
    expect(dialogueSpy).toHaveBeenCalledTimes(1);
  });
});
