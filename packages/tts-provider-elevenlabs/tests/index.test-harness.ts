import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseMarkdownContext } from '@esl-pipeline/pmd';
import { afterEach, beforeEach, vi } from 'vitest';

import * as assign from '../src/assign.js';
import * as dialogue from '../src/dialogue.js';
import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import * as google from '../src/google.js';
import {
  buildPronunciationShadowSentenceMp3,
  buildStudyTextMp3,
} from '../src/index.js';

const encoder = new TextEncoder();

export const makeMockStream = (payload: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });

export const writeFixture = async (filePath: string, contents: string) => {
  await writeFile(filePath, contents.trim());
};

export const buildStudyTextMp3FromPath = async (
  mdPath: string,
  ...args: Parameters<typeof buildStudyTextMp3> extends [any, ...infer Rest] ? Rest : never
) => {
  const markdown = await readFile(mdPath, 'utf8');
  const context = parseMarkdownContext(markdown);
  return buildStudyTextMp3({ context, mdPath }, ...args);
};

export const buildPronunciationShadowSentenceMp3FromPath = async (
  mdPath: string,
  voiceId: string,
  ...args: Parameters<typeof buildPronunciationShadowSentenceMp3> extends [any, ...infer Rest]
    ? Rest
    : never
) => {
  const markdown = await readFile(mdPath, 'utf8');
  const context = parseMarkdownContext(markdown);
  return buildPronunciationShadowSentenceMp3({ context, mdPath, voiceId }, ...args);
};

export const writeBasicMonologueFixture = async (dir: string) => {
  const tempMdPath = join(dir, 'lesson-basic.md');
  const tempVoiceMapPath = join(dir, 'voices.yml');
  await writeFixture(
    tempMdPath,
    `
---
title: Retry Test
student: Anna
input_type: monologue
---

:::study-text
This is a short line for retry behavior checks.
:::
    `,
  );
  await writeFixture(
    tempVoiceMapPath,
    `
default: voice_id_default
    `,
  );
  return { tempMdPath, tempVoiceMapPath };
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

export const setupClientMock = () => {
  const convertMock = vi.fn(async (_voiceId: string, request: any) =>
    makeMockStream(request?.text ?? 'audio'),
  );
  vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
    textToSpeech: { convert: convertMock },
  } as any);
  return convertMock;
};

export const setupGoogleSynthesizeMock = () => {
  const synthMock = vi.fn(async () => Buffer.from('mock-google-audio'));
  vi.spyOn(google, 'synthesizeGoogleSpeech').mockImplementation(synthMock);
  return synthMock;
};

export const mockConcat = () =>
  vi.spyOn(ffm, 'concatMp3Segments').mockImplementation(async (_segments, outFile) => {
    await writeFile(outFile, 'mock-audio');
  });

export const mockDialogue = () =>
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

export const createTempDir = (prefix: string) => mkdtemp(join(tmpdir(), prefix));

export const setupTtsTestSuite = () => {
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
};
