import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createTtsAssignment } from './assignment-fixture.js';
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
    const assignmentPath = join(dir, 'assignment.json');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Test Lesson', student: 'Anna', level: 'A1', topic: 'greetings' },
          studyText: {
            type: 'monologue',
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
            ],
            turns: [{ speakerId: 's0', text: 'This is a monologue line for preview.' }],
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

    const convertMock = setupClientMock();
    const spy = mockConcat();
    const result = await buildStudyTextMp3FromPath(assignmentPath, {
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
    const assignmentPath = join(dir, 'assignment.json');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Test Lesson', student: 'Anna', level: 'A1', topic: 'greetings' },
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
              { speakerId: 's0', text: 'Hello, how are you?' },
              { speakerId: 's1', text: "I'm fine, thank you. And you?" },
              { speakerId: 's0', text: 'Very well, thanks.' },
            ],
          },
          pronunciation: null,
        }),
      ),
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
    const result = await buildStudyTextMp3FromPath(assignmentPath, {
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
    const assignmentPath = join(dir, 'assignment.json');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Test Lesson', student: 'Anna', level: 'A1', topic: 'greetings' },
          studyText: {
            type: 'monologue',
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
            ],
            turns: [
              { speakerId: 's0', text: 'This is a monologue line.' },
              { speakerId: 's0', text: 'This is another line.' },
            ],
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

    const convertMock = setupClientMock();
    const spy = mockConcat();
    const result = await buildStudyTextMp3FromPath(assignmentPath, {
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
    const assignmentPath = join(dir, 'assignment.json');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Test Lesson', student: 'Anna', level: 'A1', topic: 'greetings' },
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
                displayName: 'Observer',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
              {
                id: 's2',
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
              { speakerId: 's0', text: 'Hello, how are you?' },
              { speakerId: 's1', text: 'Just listening.' },
            ],
          },
          pronunciation: null,
        }),
      ),
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
    const result = await buildStudyTextMp3FromPath(assignmentPath, {
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

  it('strips paired highlight markers while preserving other literal formatting in typed speech', async () => {
    const dir = await createTempDir('tts-');
    const assignmentPath = join(dir, 'assignment.json');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Formatting Lesson', student: 'Anna', level: 'B1', topic: 'test' },
          studyText: {
            type: 'dialogue',
            speakers: [
              {
                id: 's0',
                displayName: 'Alex',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'female',
                age: null,
                accent: null,
              },
            ],
            turns: [{ speakerId: 's0', text: 'I **really** _love_ `code`!' }],
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

    const convertMock = setupClientMock();
    mockConcat();
    await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(convertMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ text: 'I **really** _love_ code!' }),
    );
  });
});
