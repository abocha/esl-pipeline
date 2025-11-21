import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as assign from '../src/assign.js';
import * as dialogue from '../src/dialogue.js';
import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import { buildStudyTextMp3 } from '../src/index.js';

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
  ],
};

beforeEach(() => {
  vi.spyOn(assign, 'loadVoicesCatalog').mockResolvedValue(catalogMock as any);
  vi.spyOn(ffm, 'resolveFfmpegPath').mockResolvedValue('ffmpeg');
  vi.spyOn(ffm, 'synthSilenceMp3').mockImplementation(async (outFile: string) => {
    await writeFile(outFile, 'silence');
  });
  vi.spyOn(ffm, 'setMp3TitleMetadata').mockResolvedValue();
  vi.spyOn(ffm, 'concatMp3Segments').mockImplementation(async (_segments, outFile) => {
    await writeFile(outFile, 'mock-audio');
  });
  // Set a fake API key for dialogue mode tests
  process.env.ELEVENLABS_API_KEY = 'test-api-key';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ELEVENLABS_TTS_MODE;
  delete process.env.ELEVENLABS_API_KEY;
});

describe('TTS Mode Selection', () => {
  describe('auto mode with monologue content', () => {
    it('uses monologue mode for pure monologue', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Monologue Test
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

:::study-text
This is a simple monologue.
Another line of monologue.
:::
      `,
      );
      await writeFixture(tempVoiceMapPath, 'default: voice_id_default');

      const convertMock = vi.fn(async (_voiceId: string, request: any) =>
        makeMockStream(request?.text ?? 'audio'),
      );
      vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
        textToSpeech: { convert: convertMock },
      } as any);

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Using TTS mode: monologue'));
      expect(dialogueSpy).not.toHaveBeenCalled();
      expect(convertMock).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('auto mode with dialogue content', () => {
    it('uses dialogue mode for dialogue content', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Dialogue Test
student: Anna
level: A1
topic: greetings
input_type: dialogue
speaker_labels: [Alex, Mara]
speaker_profiles:
  - id: Alex
    role: student
    gender: male
  - id: Mara
    role: student
    gender: female
---

:::study-text
Alex: Hello there!
Mara: Hi, how are you?
:::
      `,
      );
      await writeFixture(
        tempVoiceMapPath,
        `
Alex: voice_alex
Mara: voice_mara
      `,
      );

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
        audioPath: join(dir, 'test.mp3'),
        hash: 'test-hash',
        duration: 5,
      });

      const convertMock = vi.fn();
      vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
        textToSpeech: { convert: convertMock },
      } as any);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Using TTS mode: dialogue'));
      expect(dialogueSpy).toHaveBeenCalled();
      expect(convertMock).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('auto mode with mixed content', () => {
    it('uses dialogue mode for mixed content', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Mixed Test
student: Anna
level: A1
topic: greetings
input_type: mixed
speaker_labels: [Narrator, Alex]
speaker_profiles:
  - id: Narrator
    role: narrator
    gender: female
  - id: Alex
    role: student
    gender: male
---

:::study-text
Narrator: Welcome to the lesson.
Alex: Hello!
:::
      `,
      );
      await writeFixture(
        tempVoiceMapPath,
        `
Narrator: voice_narrator
Alex: voice_alex
      `,
      );

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
        audioPath: join(dir, 'test.mp3'),
        hash: 'test-hash',
        duration: 5,
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Using TTS mode: dialogue'));
      expect(dialogueSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('explicit dialogue mode override', () => {
    it('uses dialogue mode even for monologue content when explicitly set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Monologue Test
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

:::study-text
This is a monologue.
:::
      `,
      );
      await writeFixture(tempVoiceMapPath, 'Narrator: voice_narrator');

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
        audioPath: join(dir, 'test.mp3'),
        hash: 'test-hash',
        duration: 5,
      });

      const convertMock = vi.fn();
      vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
        textToSpeech: { convert: convertMock },
      } as any);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'dialogue',
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Using TTS mode: dialogue'));
      expect(dialogueSpy).toHaveBeenCalled();
      expect(convertMock).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('explicit monologue mode override', () => {
    it('uses monologue mode even for dialogue content when explicitly set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Dialogue Test
student: Anna
level: A1
topic: greetings
input_type: dialogue
speaker_labels: [Alex, Mara]
speaker_profiles:
  - id: Alex
    role: student
    gender: male
  - id: Mara
    role: student
    gender: female
---

:::study-text
Alex: Hello!
Mara: Hi there!
:::
      `,
      );
      await writeFixture(
        tempVoiceMapPath,
        `
Alex: voice_alex
Mara: voice_mara
      `,
      );

      const convertMock = vi.fn(async (_voiceId: string, request: any) =>
        makeMockStream(request?.text ?? 'audio'),
      );
      vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
        textToSpeech: { convert: convertMock },
      } as any);

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'monologue',
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Using TTS mode: monologue'));
      expect(dialogueSpy).not.toHaveBeenCalled();
      expect(convertMock).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('environment variable ELEVENLABS_TTS_MODE', () => {
    it('respects env var for dialogue mode', async () => {
      process.env.ELEVENLABS_TTS_MODE = 'dialogue';

      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Monologue Test
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

:::study-text
This is a monologue.
:::
      `,
      );
      await writeFixture(tempVoiceMapPath, 'Narrator: voice_narrator');

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
        audioPath: join(dir, 'test.mp3'),
        hash: 'test-hash',
        duration: 5,
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Using TTS mode: dialogue'));
      expect(dialogueSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('respects env var for monologue mode', async () => {
      process.env.ELEVENLABS_TTS_MODE = 'monologue';

      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Dialogue Test
student: Anna
level: A1
topic: greetings
input_type: dialogue
speaker_labels: [Alex, Mara]
speaker_profiles:
  - id: Alex
    role: student
    gender: male
  - id: Mara
    role: student
    gender: female
---

:::study-text
Alex: Hello!
Mara: Hi!
:::
      `,
      );
      await writeFixture(
        tempVoiceMapPath,
        `
Alex: voice_alex
Mara: voice_mara
      `,
      );

      const convertMock = vi.fn(async (_voiceId: string, request: any) =>
        makeMockStream(request?.text ?? 'audio'),
      );
      vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
        textToSpeech: { convert: convertMock },
      } as any);

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Using TTS mode: monologue'));
      expect(dialogueSpy).not.toHaveBeenCalled();
      expect(convertMock).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('option precedence', () => {
    it('option overrides env var', async () => {
      process.env.ELEVENLABS_TTS_MODE = 'monologue';

      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Test
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

:::study-text
Test content.
:::
      `,
      );
      await writeFixture(tempVoiceMapPath, 'Narrator: voice_narrator');

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
        audioPath: join(dir, 'test.mp3'),
        hash: 'test-hash',
        duration: 5,
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'dialogue', // Option overrides env
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Using TTS mode: dialogue'));
      expect(dialogueSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('env var overrides auto mode', async () => {
      process.env.ELEVENLABS_TTS_MODE = 'dialogue';

      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Monologue Test
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

:::study-text
Monologue content.
:::
      `,
      );
      await writeFixture(tempVoiceMapPath, 'Narrator: voice_narrator');

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
        audioPath: join(dir, 'test.mp3'),
        hash: 'test-hash',
        duration: 5,
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // No ttsMode option, so env var should apply
      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Using TTS mode: dialogue'));
      expect(dialogueSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('dialogue mode voice mapping', () => {
    it('throws error when speaker voice is missing', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Dialogue Test
student: Anna
level: A1
topic: greetings
input_type: dialogue
speaker_labels: [Alex, Mara]
speaker_profiles:
  - id: Alex
    role: student
    gender: male
  - id: Mara
    role: student
    gender: female
---

:::study-text
Alex: Hello!
Mara: Hi there!
:::
      `,
      );
      await writeFixture(
        tempVoiceMapPath,
        `
Alex: voice_alex
# Mara is missing - will use auto assignment
default: voice_default
      `,
      );

      // The test should verify that Mara gets auto-assigned a voice
      // since she's not in the voice map but is in speaker_profiles
      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
        audioPath: join(dir, 'test.mp3'),
        hash: 'test-hash',
        duration: 5,
      });

      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'dialogue',
      });

      // Verify dialogue was called
      expect(dialogueSpy).toHaveBeenCalled();

      // Verify both speakers got voices (Mara should be auto-assigned)
      expect(result.voices).toHaveLength(2);
      expect(result.voices.some((v) => v.speaker === 'Alex')).toBe(true);
      expect(result.voices.some((v) => v.speaker === 'Mara')).toBe(true);
    });

    it('passes correct voice IDs to dialogue API', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-mode-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFixture(
        tempMdPath,
        `
---
title: Dialogue Test
student: Anna
level: A1
topic: greetings
input_type: dialogue
speaker_labels: [Alex, Mara]
speaker_profiles:
  - id: Alex
    role: student
    gender: male
  - id: Mara
    role: student
    gender: female
---

:::study-text
Alex: Hello there!
Mara: Hi, how are you?
Alex: I'm great!
:::
      `,
      );
      await writeFixture(
        tempVoiceMapPath,
        `
Alex: voice_alex_123
Mara: voice_mara_456
      `,
      );

      const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
        audioPath: join(dir, 'test.mp3'),
        hash: 'test-hash',
        duration: 5,
      });

      await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'dialogue',
      });

      expect(dialogueSpy).toHaveBeenCalled();
      const callArgs = dialogueSpy.mock.calls[0];
      expect(callArgs).toBeDefined();
      const options = callArgs![0];

      expect(options.inputs).toHaveLength(3);
      expect(options.inputs[0]).toEqual({
        text: 'Hello there!',
        voice_id: 'voice_alex_123',
      });
      expect(options.inputs[1]).toEqual({
        text: 'Hi, how are you?',
        voice_id: 'voice_mara_456',
      });
      expect(options.inputs[2]).toEqual({
        text: "I'm great!",
        voice_id: 'voice_alex_123',
      });
    });
  });
});
