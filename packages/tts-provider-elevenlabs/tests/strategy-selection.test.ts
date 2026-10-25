import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AssignmentV1 as FixtureAssignmentV1,
  PipelineLogEvent,
  PipelineLogger,
} from '@esl-pipeline/contracts';

import * as assign from '../src/assign.js';
import * as dialogue from '../src/dialogue.js';
import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import { buildStudyTextMp3 } from '../src/index.js';
import { createTtsAssignment } from './assignment-fixture.js';

const buildStudyTextMp3FromPath = async (
  mdPath: string,
  ...args: Parameters<typeof buildStudyTextMp3> extends [any, ...infer Rest] ? Rest : never
) => {
  const source = await readFile(mdPath, 'utf8');
  const context = JSON.parse(source) as FixtureAssignmentV1;
  return buildStudyTextMp3({ assignment: context, mdPath }, ...args);
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
  process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY = 'test-api-key';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY;
  delete process.env.ESL_TTS_DEBUG;
  delete process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY;
});

describe('TTS strategy selection', () => {
  it('auto -> dialogue for multi-speaker content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-strategy-'));
    const md = join(dir, 'assignment.json');
    const voiceMap = join(dir, 'voices.yml');

    await writeFixture(
      md,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Dialogue', student: 'Anna', level: 'B1', topic: 'test' },
          studyText: {
            type: 'dialogue',
            speakers: [
              {
                id: 's0',
                displayName: 'Alex',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'male',
                age: null,
                accent: null,
              },
              {
                id: 's1',
                displayName: 'Mara',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'female',
                age: null,
                accent: null,
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Hi!' },
              { speakerId: 's1', text: 'Hello!' },
            ],
          },
          pronunciation: null,
        }),
      ),
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

    process.env.ESL_TTS_DEBUG = '1';
    const logs: PipelineLogEvent[] = [];
    const logger: PipelineLogger = { log: (event) => logs.push(event) };

    await buildStudyTextMp3FromPath(md, { voiceMapPath: voiceMap, outPath: dir, logger });

    expect(dialogueSpy).toHaveBeenCalled();
    expect(convertMock).not.toHaveBeenCalled();
    expect(logs.some((log) => log.message.includes('Using TTS strategy: dialogue'))).toBe(true);
  });

  it('auto -> dialogue for short/simple single-speaker text (many short sentences)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-strategy-'));
    const md = join(dir, 'assignment.json');
    const voiceMap = join(dir, 'voices.yml');

    await writeFixture(
      md,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'A Busy Monday', student: 'Anna', level: 'B1', topic: 'test' },
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
            turns: [
              {
                speakerId: 's0',
                text: 'On Monday, I woke up early. I slept well, so I felt good. I went to work by bus.',
              },
              {
                speakerId: 's0',
                text: 'At work, I did many tasks. I met my colleagues. We said hello.',
              },
            ],
          },
          pronunciation: null,
        }),
      ),
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

    process.env.ESL_TTS_DEBUG = '1';
    const logs: PipelineLogEvent[] = [];
    const logger: PipelineLogger = { log: (event) => logs.push(event) };

    await buildStudyTextMp3FromPath(md, { voiceMapPath: voiceMap, outPath: dir, logger });

    expect(dialogueSpy).toHaveBeenCalled();
    expect(convertMock).not.toHaveBeenCalled();
    expect(logs.some((log) => log.message.includes('Using TTS strategy: dialogue'))).toBe(true);
  });

  it('auto -> tts for longer single-speaker text (longer sentences)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-strategy-'));
    const md = join(dir, 'assignment.json');
    const voiceMap = join(dir, 'voices.yml');

    await writeFixture(
      md,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Apartment', student: 'Anna', level: 'B1', topic: 'test' },
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
            turns: [
              {
                speakerId: 's0',
                text: 'I’ve been living here for two years, and while the building has charm, the logistics are a nightmare.',
              },
              {
                speakerId: 's0',
                text: 'Last month, I tried to organize a petition to collect signatures from the neighbors to install a video intercom at the back.',
              },
            ],
          },
          pronunciation: null,
        }),
      ),
    );
    await writeFixture(voiceMap, 'default: voice_a');

    const convertMock = vi.fn(async (_voiceId: string, request: any) =>
      makeMockStream(request?.text ?? 'audio'),
    );
    vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
      textToSpeech: { convert: convertMock },
    } as any);

    const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue');

    process.env.ESL_TTS_DEBUG = '1';
    const logs: PipelineLogEvent[] = [];
    const logger: PipelineLogger = { log: (event) => logs.push(event) };

    await buildStudyTextMp3FromPath(md, { voiceMapPath: voiceMap, outPath: dir, logger });

    expect(dialogueSpy).not.toHaveBeenCalled();
    expect(convertMock).toHaveBeenCalled();
    expect(logs.some((log) => log.message.includes('Using TTS strategy: tts'))).toBe(true);
  });

  it('explicit override and env var: ttsStrategy wins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-strategy-'));
    const md = join(dir, 'assignment.json');
    const voiceMap = join(dir, 'voices.yml');

    await writeFixture(
      md,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Dialogue', student: 'Anna', level: 'B1', topic: 'test' },
          studyText: {
            type: 'dialogue',
            speakers: [
              {
                id: 's0',
                displayName: 'Alex',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
              {
                id: 's1',
                displayName: 'Mara',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Hi!' },
              { speakerId: 's1', text: 'Hello!' },
            ],
          },
          pronunciation: null,
        }),
      ),
    );
    await writeFixture(voiceMap, 'default: voice_a');

    const convertMock = vi.fn(async (_voiceId: string, request: any) =>
      makeMockStream(request?.text ?? 'audio'),
    );
    vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
      textToSpeech: { convert: convertMock },
    } as any);
    const dialogueSpy = vi.spyOn(dialogue, 'synthesizeDialogue');

    process.env.ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY = 'dialogue';

    await buildStudyTextMp3FromPath(md, {
      voiceMapPath: voiceMap,
      outPath: dir,
      ttsStrategy: 'tts',
    });

    expect(dialogueSpy).not.toHaveBeenCalled();
    expect(convertMock).toHaveBeenCalled();
  });
});
