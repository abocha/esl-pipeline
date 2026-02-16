import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdownContext } from '@esl-pipeline/pmd';

import type { PipelineLogEvent, PipelineLogger } from '@esl-pipeline/contracts';

import * as assign from '../src/assign.js';
import * as dialogue from '../src/dialogue.js';
import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import { buildStudyTextMp3 } from '../src/index.js';

const buildStudyTextMp3FromPath = async (
  mdPath: string,
  ...args: Parameters<typeof buildStudyTextMp3> extends [any, ...infer Rest] ? Rest : never
) => {
  const markdown = await readFile(mdPath, 'utf8');
  const context = parseMarkdownContext(markdown);
  return buildStudyTextMp3({ context, mdPath }, ...args);
};

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
    { id: 'voice_a', name: 'VoiceA', labels: { gender: 'female', use_case: 'narration' } },
    { id: 'voice_b', name: 'VoiceB', labels: { gender: 'male', use_case: 'conversational' } },
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
  process.env.ELEVENLABS_API_KEY = 'test-api-key';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ELEVENLABS_TTS_STRATEGY;
  delete process.env.ELEVENLABS_TTS_DEBUG;
  delete process.env.ELEVENLABS_API_KEY;
});

describe('TTS strategy selection', () => {
  it('auto -> dialogue for multi-speaker content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-strategy-'));
    const md = join(dir, 'lesson.md');
    const voiceMap = join(dir, 'voices.yml');

    await writeFixture(
      md,
      `
---
title: Dialogue
student: Anna
input_type: dialogue
speaker_labels: [Alex, Mara]
speaker_profiles:
  - id: Alex
    gender: male
  - id: Mara
    gender: female
---

:::study-text
Alex: Hi!
Mara: Hello!
:::
      `,
    );
    await writeFixture(voiceMap, 'auto: true');

    const convertMock = vi.fn(async (_voiceId: string, request: any) =>
      makeMockStream(request?.text ?? 'audio'),
    );
    vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
      textToSpeech: { convert: convertMock },
    } as any);

    const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
      audioPath: join(dir, 'dialogue.mp3'),
      hash: 'x'.repeat(64),
      duration: 1,
    });
    await writeFile(join(dir, 'dialogue.mp3'), 'mock-audio');

    process.env.ELEVENLABS_TTS_DEBUG = '1';
    const logs: PipelineLogEvent[] = [];
    const logger: PipelineLogger = { log: (event) => logs.push(event) };

    await buildStudyTextMp3FromPath(md, { voiceMapPath: voiceMap, outPath: dir, logger });

    expect(dialogueSpy).toHaveBeenCalled();
    expect(convertMock).not.toHaveBeenCalled();
    expect(logs.some((log) => log.message.includes('Using TTS strategy: dialogue'))).toBe(true);
  });

  it('auto -> dialogue for short/simple single-speaker text (many short sentences)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-strategy-'));
    const md = join(dir, 'lesson.md');
    const voiceMap = join(dir, 'voices.yml');

    await writeFixture(
      md,
      `
---
title: A Busy Monday
student: Anna
input_type: monologue
---

:::study-text
On Monday, I woke up early. I slept well, so I felt good. I went to work by bus.

At work, I did many tasks. I met my colleagues. We said hello.
:::
      `,
    );
    await writeFixture(voiceMap, 'auto: true');

    const convertMock = vi.fn(async (_voiceId: string, request: any) =>
      makeMockStream(request?.text ?? 'audio'),
    );
    vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
      textToSpeech: { convert: convertMock },
    } as any);

    const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue').mockResolvedValue({
      audioPath: join(dir, 'dialogue.mp3'),
      hash: 'y'.repeat(64),
      duration: 1,
    });
    await writeFile(join(dir, 'dialogue.mp3'), 'mock-audio');

    process.env.ELEVENLABS_TTS_DEBUG = '1';
    const logs: PipelineLogEvent[] = [];
    const logger: PipelineLogger = { log: (event) => logs.push(event) };

    await buildStudyTextMp3FromPath(md, { voiceMapPath: voiceMap, outPath: dir, logger });

    expect(dialogueSpy).toHaveBeenCalled();
    expect(convertMock).not.toHaveBeenCalled();
    expect(logs.some((log) => log.message.includes('Using TTS strategy: dialogue'))).toBe(true);
  });

  it('auto -> tts for longer single-speaker text (longer sentences)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-strategy-'));
    const md = join(dir, 'lesson.md');
    const voiceMap = join(dir, 'voices.yml');

    await writeFixture(
      md,
      `
---
title: Apartment
student: Anna
input_type: monologue
---

:::study-text
I’ve been living here for two years, and while the building has charm, the logistics are a nightmare.
Last month, I tried to organize a petition to collect signatures from the neighbors to install a video intercom at the back.
:::
      `,
    );
    await writeFixture(voiceMap, 'default: voice_a');

    const convertMock = vi.fn(async (_voiceId: string, request: any) =>
      makeMockStream(request?.text ?? 'audio'),
    );
    vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
      textToSpeech: { convert: convertMock },
    } as any);

    const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue');

    process.env.ELEVENLABS_TTS_DEBUG = '1';
    const logs: PipelineLogEvent[] = [];
    const logger: PipelineLogger = { log: (event) => logs.push(event) };

    await buildStudyTextMp3FromPath(md, { voiceMapPath: voiceMap, outPath: dir, logger });

    expect(dialogueSpy).not.toHaveBeenCalled();
    expect(convertMock).toHaveBeenCalled();
    expect(logs.some((log) => log.message.includes('Using TTS strategy: tts'))).toBe(true);
  });

  it('explicit override and env var: ttsStrategy wins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-strategy-'));
    const md = join(dir, 'lesson.md');
    const voiceMap = join(dir, 'voices.yml');

    await writeFixture(
      md,
      `
---
title: Dialogue
student: Anna
input_type: dialogue
---

:::study-text
Alex: Hi!
Mara: Hello!
:::
      `,
    );
    await writeFixture(voiceMap, 'default: voice_a');

    const convertMock = vi.fn(async (_voiceId: string, request: any) =>
      makeMockStream(request?.text ?? 'audio'),
    );
    vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
      textToSpeech: { convert: convertMock },
    } as any);
    const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue');

    process.env.ELEVENLABS_TTS_STRATEGY = 'dialogue';

    await buildStudyTextMp3FromPath(md, { voiceMapPath: voiceMap, outPath: dir, ttsStrategy: 'tts' });

    expect(dialogueSpy).not.toHaveBeenCalled();
    expect(convertMock).toHaveBeenCalled();
  });
});
