import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import * as speakers from '../src/speakerAssignment.js';
import { createTtsAssignment } from './assignment-fixture.js';
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
    const assignmentPath = join(dir, 'lesson-accent.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Accent Test', student: 'Default', level: 'A1', topic: 'greetings' },
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
            ],
            turns: [{ speakerId: 's0', text: 'Hello there!' }],
          },
          pronunciation: null,
        }),
      ),
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
    await buildStudyTextMp3FromPath(assignmentPath, {
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
    const assignmentPath = join(dir, 'letter.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Letter Lesson', student: 'Max', level: 'B1', topic: 'decisions' },
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
            ],
            turns: [
              { speakerId: 's0', text: 'Hey there,' },
              {
                speakerId: 's0',
                text: "I wanted to get your advice on a big decision. There's an art studio in Lisbon offering me a role.",
              },
              {
                speakerId: 's0',
                text: 'The pay would be tight at first, but it feels like the right move for my creativity.',
              },
              { speakerId: 's0', text: 'What would you do if you were in my shoes?' },
              { speakerId: 's0', text: 'Talk soon,' },
              { speakerId: 's0', text: 'Alex' },
            ],
          },
          pronunciation: null,
        }),
      ),
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: voice_id_alex
default: voice_id_default
    `,
    );

    const result = await buildStudyTextMp3FromPath(assignmentPath, {
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
    const assignmentPath = join(dir, 'assignment.json');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Auto Voices', student: 'Anna', level: 'B1', topic: 'routines' },
          studyText: {
            type: 'dialogue',
            speakers: [
              {
                id: 's0',
                displayName: 'Narrator',
                role: 'narrator',
                persona: null,
                voiceDirection: null,
                gender: 'female',
                age: null,
                accent: null,
              },
              {
                id: 's1',
                displayName: 'Chloe',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'female',
                age: null,
                accent: null,
              },
              {
                id: 's2',
                displayName: 'Mia',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
              {
                id: 's3',
                displayName: 'Ethan',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'male',
                age: null,
                accent: null,
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Welcome to the demo.' },
              { speakerId: 's1', text: "Hey, I'm ready to learn." },
              { speakerId: 's2', text: "Great, let's get started." },
              { speakerId: 's3', text: "I'm here to explain the steps." },
            ],
          },
          pronunciation: null,
        }),
      ),
    );
    await writeFixture(
      tempVoiceMapPath,
      `
auto: true
    `,
    );

    const convertMock = setupClientMock();
    mockConcat();
    const result = await buildStudyTextMp3FromPath(assignmentPath, {
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
