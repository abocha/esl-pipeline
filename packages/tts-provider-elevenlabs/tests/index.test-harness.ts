import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';

import type { AssignmentV1 as FixtureAssignmentV1 } from '@esl-pipeline/contracts';

import type { VoiceCatalog } from '../src/assign.js';
import * as assign from '../src/assign.js';
import * as dialogue from '../src/dialogue.js';
import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import { buildPronunciationShadowSentenceMp3, buildStudyTextMp3 } from '../src/index.js';
import { createTtsAssignment } from './assignment-fixture.js';

const encoder = new TextEncoder();
type Tail<T extends readonly unknown[]> = T extends readonly [unknown, ...infer Rest]
  ? Rest
  : never;
type StudyTextTailArgs = Tail<Parameters<typeof buildStudyTextMp3>>;
type ShadowSentenceTailArgs = Tail<Parameters<typeof buildPronunciationShadowSentenceMp3>>;
type ElevenConvertRequest = Parameters<
  ReturnType<typeof eleven.getElevenClient>['textToSpeech']['convert']
>[1];

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

export const buildStudyTextMp3FromPath = async (mdPath: string, ...args: StudyTextTailArgs) => {
  const source = await readFile(mdPath, 'utf8');
  const context = JSON.parse(source) as FixtureAssignmentV1;
  return buildStudyTextMp3({ assignment: context, mdPath }, ...args);
};

export const buildPronunciationShadowSentenceMp3FromPath = async (
  mdPath: string,
  voiceId: string,
  ...args: ShadowSentenceTailArgs
) => {
  const source = await readFile(mdPath, 'utf8');
  const context = JSON.parse(source) as FixtureAssignmentV1;
  return buildPronunciationShadowSentenceMp3({ assignment: context, mdPath, voiceId }, ...args);
};

export const writeBasicMonologueFixture = async (dir: string) => {
  const assignmentPath = join(dir, 'assignment-basic.json');
  const tempVoiceMapPath = join(dir, 'voices.yml');
  await writeFixture(
    assignmentPath,
    JSON.stringify(
      createTtsAssignment({
        metadata: { title: 'Retry Test', student: 'Anna', level: 'B1', topic: 'test' },
        studyText: {
          type: 'monologue',
          speakers: [
            {
              id: 's0',
              displayName: 'Narrator',
              role: 'student',
              persona: null,
              voiceDirection: null,
              gender: 'neutral',
              age: null,
              accent: null,
            },
          ],
          turns: [{ speakerId: 's0', text: 'This is a short line for retry behavior checks.' }],
        },
        pronunciation: null,
      }),
    ),
  );
  await writeFixture(
    tempVoiceMapPath,
    `
default: voice_id_default
    `,
  );
  return { assignmentPath, tempVoiceMapPath };
};

const catalogMock: VoiceCatalog = {
  voices: [
    {
      id: 'voice_narrator',
      name: 'NarratorVoice',
      category: 'premade',
      labels: {
        gender: 'female',
        use_case: 'narrative_story',
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
        descriptive: 'casual',
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
        descriptive: 'calm',
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
  const convertMock = vi.fn(async (_voiceId: string, request: ElevenConvertRequest) =>
    makeMockStream(request?.text ?? 'audio'),
  );
  vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
    textToSpeech: { convert: convertMock },
  } as unknown as ReturnType<typeof eleven.getElevenClient>);
  return convertMock;
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
    vi.spyOn(assign, 'loadVoicesCatalog').mockResolvedValue(catalogMock);
    vi.spyOn(ffm, 'resolveFfmpegPath').mockResolvedValue('ffmpeg');
    vi.spyOn(ffm, 'synthSilenceMp3').mockImplementation(async (outFile: string) => {
      await writeFile(outFile, 'silence');
    });
    vi.spyOn(ffm, 'setMp3TitleMetadata').mockResolvedValue();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
};
