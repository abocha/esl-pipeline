import { readFileSync as readAssignmentFixture } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AssignmentV1 as FixtureAssignmentV1 } from '@esl-pipeline/contracts';

import { createElevenLabsTtsProvider } from '../src/adapter.js';
import { buildStudyTextMp3, hashStudyText } from '../src/index.js';
import { createTtsAssignment } from './assignment-fixture.js';
import {
  buildPronunciationShadowSentenceMp3FromPath,
  createTempDir,
  mockConcat,
  setupClientMock,
  setupTtsTestSuite,
  writeFixture,
} from './index.test-harness.js';

setupTtsTestSuite();

describe('tts elevenlabs integration', () => {
  it('hashes study text deterministically', () => {
    expect(hashStudyText('hello')).toEqual(hashStudyText('hello'));
  });

  it('buildPronunciationShadowSentenceMp3 preview mode', async () => {
    const dir = await createTempDir('tts-shadow-');
    const assignmentPath = join(dir, 'lesson-shadow.md');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Pronunciation Lesson', student: 'Anna', level: 'B1', topic: 'test' },
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
            turns: [{ speakerId: 's0', text: 'Main text.' }],
          },
          pronunciation: {
            mode: 'shadow_sentence',
            target: '',
            focus: '',
            action: '',
            deliverable: '',
            shadowSentence: 'I was thinking about working this morning.',
            words: [
              { text: 'thinking', transcription: '/ˈθɪŋkɪŋ/' },
              { text: 'working', transcription: '/ˈwɜːrkɪŋ/' },
              { text: 'morning', transcription: '/ˈmɔːrnɪŋ/' },
            ],
          },
        }),
      ),
    );

    const convertMock = setupClientMock();
    const result = await buildPronunciationShadowSentenceMp3FromPath(
      assignmentPath,
      'voice_narrator',
      {
        outPath: dir,
        preview: true,
      },
    );
    expect(result.path.endsWith('-shadow-sentence.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(result.generatedCharacters).toBeGreaterThan(0);
    expect(convertMock).not.toHaveBeenCalled();
  });

  it('buildPronunciationShadowSentenceMp3 generates and caches output', async () => {
    const dir = await createTempDir('tts-shadow-cache-');
    const assignmentPath = join(dir, 'lesson-shadow-cache.md');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Pronunciation Lesson', student: 'Anna', level: 'B1', topic: 'test' },
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
            turns: [{ speakerId: 's0', text: 'Main text.' }],
          },
          pronunciation: {
            mode: 'shadow_sentence',
            target: '',
            focus: '',
            action: '',
            deliverable: '',
            shadowSentence: 'I was thinking about working this morning.',
            words: [
              { text: 'thinking', transcription: '/ˈθɪŋkɪŋ/' },
              { text: 'working', transcription: '/ˈwɜːrkɪŋ/' },
              { text: 'morning', transcription: '/ˈmɔːrnɪŋ/' },
            ],
          },
        }),
      ),
    );
    const convertMock = setupClientMock();

    const first = await buildPronunciationShadowSentenceMp3FromPath(
      assignmentPath,
      'voice_narrator',
      {
        outPath: dir,
      },
    );
    expect(first.generatedCharacters).toBeGreaterThan(0);
    expect(first.cachedCharacters).toBe(0);
    expect(convertMock).toHaveBeenCalledTimes(1);

    const second = await buildPronunciationShadowSentenceMp3FromPath(
      assignmentPath,
      'voice_narrator',
      {
        outPath: dir,
      },
    );
    expect(second.generatedCharacters).toBe(0);
    expect(second.cachedCharacters).toBeGreaterThan(0);
    expect(convertMock).toHaveBeenCalledTimes(1);
  });

  it('uses eleven_flash_v2_5 by default for pronunciation text synthesis', async () => {
    const dir = await createTempDir('tts-pronunciation-text-');
    const convertMock = setupClientMock();
    const provider = createElevenLabsTtsProvider();

    await provider.synthesizePronunciationText(
      {
        text: 'The device is as heavy as the old one.',
        voiceId: 'voice_narrator',
        title: 'Pronunciation Lesson',
      },
      {
        outPath: dir,
        ttsProvider: 'elevenlabs',
      },
    );

    expect(convertMock).toHaveBeenCalledWith(
      'voice_narrator',
      expect.objectContaining({
        modelId: 'eleven_flash_v2_5',
        text: 'The device is as heavy as the old one.',
      }),
    );
  });
});

it('keeps typed cast and cache identity and strips only paired highlight markers from speech', async () => {
  const assignment = assignmentFixture();
  const dir = await createTempDir('typed-eleven-');
  const voiceMapPath = join(dir, 'voices.yml');
  await writeFixture(voiceMapPath, 'default: voice_narrator');
  const context = structuredClone(assignment);
  const options = { outPath: dir, voiceMapPath, preview: true, ttsStrategy: 'tts' as const };
  const typed = await buildStudyTextMp3({ assignment }, options);
  const historical = await buildStudyTextMp3({ assignment: context }, options);
  expect(typed.hash).toBe(historical.hash);
  expect(typed.voiceAssignments).toEqual(historical.voiceAssignments);
  const convert = setupClientMock();
  mockConcat();
  assignment.input.studyText.turns[0]!.text = '**literal** <tag> `code` and a lone `';
  const stored = JSON.stringify(assignment);
  await buildStudyTextMp3({ assignment }, { ...options, preview: false });
  expect(
    convert.mock.calls.some(([, request]) =>
      request.text.includes('**literal** <tag> code and a lone `'),
    ),
  ).toBe(true);
  expect(JSON.stringify(assignment)).toBe(stored);
});

it.each(['Mary  Jane', 'Mary_Jane'])(
  'routes typed dialogue speaker %s to its typed cast',
  async (name) => {
    const assignment = assignmentFixture();
    assignment.input.studyText.speakers[1]!.displayName = name;
    const dir = await createTempDir('typed-speaker-routing-');
    const voiceMapPath = join(dir, 'voices.yml');
    await writeFixture(voiceMapPath, 'default: voice_narrator');
    const historical = structuredClone(assignment);
    const options = { outPath: dir, voiceMapPath, preview: true, ttsStrategy: 'dialogue' as const };
    const prior = await buildStudyTextMp3({ assignment: historical }, options);
    const native = await buildStudyTextMp3({ assignment }, options);
    expect(native.voiceAssignments).toEqual(prior.voiceAssignments);
    expect(native.hash).toBe(prior.hash);
  },
);

function assignmentFixture(): FixtureAssignmentV1 {
  return JSON.parse(
    readAssignmentFixture(
      new URL('../../contracts/tests/assignment-fixture.json', import.meta.url),
      'utf8',
    ),
  ) as FixtureAssignmentV1;
}
