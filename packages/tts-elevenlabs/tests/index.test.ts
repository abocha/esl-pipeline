import { describe, expect, it, vi, afterEach } from 'vitest';
import { hashStudyText, buildStudyTextMp3 } from '../src/index.js';
import * as ffm from '../src/ffmpeg.js';
import * as eleven from '../src/eleven.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const setupClientMock = () => {
  const convertMock = vi.fn(async (_voiceId: string, request: any) =>
    makeMockStream(request?.text ?? 'audio')
  );
  vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
    textToSpeech: { convert: convertMock },
  } as any);
  return convertMock;
};

afterEach(() => {
  vi.restoreAllMocks();
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

# Warm-up

:::study-text
This is a monologue line for preview.
:::
    `
    );
    await writeFixture(
      tempVoiceMapPath,
      `
default: voice_id_default
    `
    );

    const convertMock = setupClientMock();
    const spy = vi.spyOn(ffm, 'concatMp3Segments').mockResolvedValue();
    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      preview: true,
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).not.toHaveBeenCalled();
    expect(convertMock).not.toHaveBeenCalled();
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

# Warm-up

:::study-text
Alex: Hello, how are you?
Mara: I'm fine, thank you. And you?
Alex: Very well, thanks.
:::
    `
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: voice_id_1
Mara: voice_id_2
default: voice_id_default
    `
    );

    const convertMock = setupClientMock();
    const spy = vi.spyOn(ffm, 'concatMp3Segments').mockResolvedValue();
    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).toHaveBeenCalledWith(expect.any(Array), expect.stringContaining('.mp3'), true);
    expect(convertMock).toHaveBeenCalledTimes(3);
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

# Warm-up

:::study-text
This is a monologue line.
This is another line.
:::
    `
    );
    await writeFixture(
      tempVoiceMapPath,
      `
default: voice_id_default
    `
    );

    const convertMock = setupClientMock();
    const spy = vi.spyOn(ffm, 'concatMp3Segments').mockResolvedValue();
    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).toHaveBeenCalledWith(expect.any(Array), expect.stringContaining('.mp3'), true);
    expect(convertMock).toHaveBeenCalledTimes(2);
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

# Warm-up

:::study-text
Alex: Hello, how are you?
Observer: Just listening.
:::
    `
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: voice_id_1
default: voice_id_default
    `
    );

    const convertMock = setupClientMock();
    const spy = vi.spyOn(ffm, 'concatMp3Segments').mockResolvedValue();
    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).toHaveBeenCalledWith(expect.any(Array), expect.stringContaining('.mp3'), true);
    expect(convertMock).toHaveBeenCalledTimes(2);
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

# Warm-up

:::study-text
This is a monologue line.
:::
    `
    );
    await writeFixture(
      tempVoiceMapPath,
      `
default: voice_id_default
    `
    );

    const convertMock = setupClientMock();
    await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
    });
    expect(convertMock).toHaveBeenCalledTimes(1);

    convertMock.mockClear();
    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
    });
    expect(result.hash).toHaveLength(64);
    expect(convertMock).not.toHaveBeenCalled();
  });
});
