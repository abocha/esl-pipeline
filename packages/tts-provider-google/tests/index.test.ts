import { readFileSync as readAssignmentFixture } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssignmentV1 as FixtureAssignmentV1 } from '@esl-pipeline/contracts';

import * as ffmpeg from '../src/ffmpeg.js';
import type { GoogleVoiceListEntry } from '../src/google.js';
import * as googleApi from '../src/google.js';
import {
  buildPronunciationShadowSentenceMp3Google,
  buildStudyTextMp3Google,
  loadGoogleVoicesCatalog,
  resetGoogleVoiceCatalogCacheForTests,
  resolveGoogleSpeakerAssignments,
  resolveGoogleTtsModel,
} from '../src/index.js';
import { createTtsAssignment } from './assignment-fixture.js';

function mockGoogleVoiceList(voices: GoogleVoiceListEntry[]) {
  process.env.ESL_TTS_PROVIDER_GOOGLE_API_ENDPOINT = 'test-texttospeech.googleapis.com';
  vi.spyOn(googleApi, 'listGoogleVoices').mockResolvedValue(voices);
}

function createRichEnglishMockVoices(): GoogleVoiceListEntry[] {
  return [
    { name: 'en-US-Chirp3-HD-Charon', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Chirp3-HD-Aoede', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'en-GB-Chirp3-HD-Gacrux', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
    { name: 'en-IE-Chirp3-HD-Orpheus', languageCodes: ['en-IE'], ssmlGender: 'MALE' },
    { name: 'en-AU-Chirp3-HD-Orion', languageCodes: ['en-AU'], ssmlGender: 'MALE' },
    { name: 'en-NZ-Chirp3-HD-Kea', languageCodes: ['en-NZ'], ssmlGender: 'FEMALE' },
    { name: 'en-US-Studio-O', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'en-US-Studio-Q', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Neural2-A', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Neural2-F', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'en-US-Wavenet-A', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Wavenet-F', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'es-ES-Chirp3-HD-Despina', languageCodes: ['es-ES'], ssmlGender: 'FEMALE' },
  ];
}

function createNoBritishButIrishVoices(): GoogleVoiceListEntry[] {
  return [
    { name: 'en-US-Chirp3-HD-Charon', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Chirp3-HD-Aoede', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'en-IE-Chirp3-HD-Orpheus', languageCodes: ['en-IE'], ssmlGender: 'MALE' },
  ];
}

function createNoBritishNoIrishVoices(): GoogleVoiceListEntry[] {
  return [
    { name: 'en-US-Chirp3-HD-Charon', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Chirp3-HD-Aoede', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'en-AU-Chirp3-HD-Orion', languageCodes: ['en-AU'], ssmlGender: 'MALE' },
    { name: 'en-NZ-Chirp3-HD-Kea', languageCodes: ['en-NZ'], ssmlGender: 'FEMALE' },
  ];
}

beforeEach(() => {
  process.env.ESL_TTS_PROVIDER_GOOGLE_SILENCE_TAIL_SECONDS = '0';
  vi.spyOn(ffmpeg, 'setMp3TitleMetadata').mockResolvedValue();
  vi.spyOn(ffmpeg, 'resolveFfmpegPath').mockResolvedValue('ffmpeg');
  resetGoogleVoiceCatalogCacheForTests();
});

afterEach(() => {
  delete process.env.ESL_TTS_PROVIDER_GOOGLE_SILENCE_TAIL_SECONDS;
  delete process.env.ESL_TTS_PROVIDER_GOOGLE_API_ENDPOINT;
  resetGoogleVoiceCatalogCacheForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('google provider adapter basics', () => {
  it('defaults model family to chirp3_hd', () => {
    delete process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL;
    expect(resolveGoogleTtsModel()).toBe('chirp3_hd');
  });

  it('loads english-only catalog from Google listVoices and normalizes labels', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const catalog = await loadGoogleVoicesCatalog();
    expect(catalog.voices.some((voice) => voice.id === 'es-ES-Chirp3-HD-Despina')).toBe(false);
    expect(catalog.voices.some((voice) => voice.id === 'en-US-Chirp3-HD-Charon')).toBe(true);
    expect(catalog.voices.some((voice) => voice.id === 'en-US-Studio-O')).toBe(true);
    const charon = catalog.voices.find((voice) => voice.id === 'en-US-Chirp3-HD-Charon');
    expect(charon?.labels?.model_family).toBe('chirp3_hd');
    expect(charon?.labels?.locale).toBe('en-US');
    expect(charon?.labels?.accent).toBe('american');
    const kea = catalog.voices.find((voice) => voice.id === 'en-NZ-Chirp3-HD-Kea');
    expect(kea?.labels?.accent).toBe('new_zealand');
    expect(catalog.capabilities?.style).toEqual(['chirp3_hd', 'neural2', 'studio', 'wavenet']);
  });

  it('uses fallback catalog without live Google listing when no live capability source is configured', async () => {
    const spy = vi.spyOn(googleApi, 'listGoogleVoices');

    const catalog = await loadGoogleVoicesCatalog();

    expect(spy).not.toHaveBeenCalled();
    expect(catalog.capabilities?.style).toEqual(['chirp3_hd', 'neural2', 'studio', 'wavenet']);
    expect(catalog.voices.some((voice) => voice.id === 'en-US-Chirp3-HD-Charon')).toBe(true);
  });

  it('caches Google voice catalog for 15 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T00:00:00.000Z'));
    process.env.ESL_TTS_PROVIDER_GOOGLE_API_ENDPOINT = 'test-texttospeech.googleapis.com';
    const spy = vi
      .spyOn(googleApi, 'listGoogleVoices')
      .mockResolvedValue(createRichEnglishMockVoices());
    await loadGoogleVoicesCatalog();
    await loadGoogleVoicesCatalog();
    expect(spy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-03-09T00:14:59.000Z'));
    await loadGoogleVoicesCatalog();
    expect(spy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-03-09T00:15:01.000Z'));
    await loadGoogleVoicesCatalog();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('resolves profile-aware chirp3 speaker assignments', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-assignment-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, ['auto: true'].join('\n'), 'utf8');

    const result = await buildStudyTextMp3Google(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
                accent: 'british',
              },
              {
                id: 's1',
                displayName: 'Alex',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'male',
                age: null,
                accent: 'american',
              },
              {
                id: 's2',
                displayName: 'Yulia',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'female',
                age: null,
                accent: 'american',
              },
            ],
            turns: [
              { speakerId: 's0', text: 'The class is starting.' },
              { speakerId: 's1', text: 'Hi Yulia!' },
              { speakerId: 's2', text: 'Hi Alex!' },
            ],
          },
          pronunciation: null,
        }),
        mdPath: join(workdir, 'assignment.json'),
      },
      { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd', preview: true },
    );

    const narrator = result.voices.find((voice) => voice.speaker === 'Narrator');
    const alex = result.voices.find((voice) => voice.speaker === 'Alex');
    const yulia = result.voices.find((voice) => voice.speaker === 'Yulia');
    expect(narrator?.voiceId).toBe('en-GB-Chirp3-HD-Gacrux');
    expect(alex?.voiceId).toBe('en-US-Chirp3-HD-Charon');
    expect(yulia?.voiceId).toBe('en-US-Chirp3-HD-Aoede');
    expect(narrator?.selectionReason).toContain('heuristic');
    expect(Array.isArray(narrator?.capabilityMatches)).toBe(true);
  });

  it('keeps exact accent match as highest-priority auto tier', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-accent-exact-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, ['auto: true'].join('\n'), 'utf8');

    const result = await buildStudyTextMp3Google(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
                accent: 'british',
              },
            ],
            turns: [{ speakerId: 's0', text: 'Exact accent match should win.' }],
          },
          pronunciation: null,
        }),
        mdPath: join(workdir, 'assignment.json'),
      },
      { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd', preview: true },
    );

    expect(result.voices[0]?.voiceId).toBe('en-GB-Chirp3-HD-Gacrux');
    expect(result.voices[0]?.selectionReason).toContain('exact accent match');
  });

  it('falls back to regional-close accent when exact accent is unavailable', async () => {
    mockGoogleVoiceList(createNoBritishButIrishVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-accent-regional-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, ['auto: true'].join('\n'), 'utf8');

    const result = await buildStudyTextMp3Google(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
          studyText: {
            type: 'monologue',
            speakers: [
              {
                id: 's0',
                displayName: 'Narrator',
                role: 'narrator',
                persona: null,
                voiceDirection: null,
                gender: 'male',
                age: null,
                accent: 'british',
              },
            ],
            turns: [{ speakerId: 's0', text: 'Regional close fallback should pick Irish.' }],
          },
          pronunciation: null,
        }),
        mdPath: join(workdir, 'assignment.json'),
      },
      { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd', preview: true },
    );

    expect(result.voices[0]?.voiceId).toBe('en-IE-Chirp3-HD-Orpheus');
    expect(result.voices[0]?.selectionReason).toContain('regional close accent fallback');
  });

  it('falls back to en-US when exact and regional accents are unavailable', async () => {
    mockGoogleVoiceList(createNoBritishNoIrishVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-accent-en-us-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, ['auto: true'].join('\n'), 'utf8');

    const result = await buildStudyTextMp3Google(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
                accent: 'british',
              },
            ],
            turns: [{ speakerId: 's0', text: 'Final fallback should prefer en-US.' }],
          },
          pronunciation: null,
        }),
        mdPath: join(workdir, 'assignment.json'),
      },
      { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd', preview: true },
    );

    expect(result.voices[0]?.voiceId).toBe('en-US-Chirp3-HD-Aoede');
    expect(result.voices[0]?.selectionReason).toContain('en-US fallback');
  });

  it('handles unknown accents deterministically without crashing', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-accent-unknown-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, ['auto: true'].join('\n'), 'utf8');

    const first = await buildStudyTextMp3Google(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
                accent: 'martian',
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Unknown accent should still resolve deterministically.' },
            ],
          },
          pronunciation: null,
        }),
        mdPath: join(workdir, 'assignment.json'),
      },
      { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd', preview: true },
    );
    const second = await buildStudyTextMp3Google(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
                accent: 'martian',
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Unknown accent should still resolve deterministically.' },
            ],
          },
          pronunciation: null,
        }),
        mdPath: join(workdir, 'assignment.json'),
      },
      { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd', preview: true },
    );

    expect(first.voices[0]?.voiceId.startsWith('en-US-')).toBe(true);
    expect(second.voices[0]?.voiceId).toBe(first.voices[0]?.voiceId);
  });

  it('accepts explicit voices.yml mappings within selected model family', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-explicit-ok-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(
      voiceMapPath,
      ['default: en-US-Chirp3-HD-Charon', 'Alex: en-US-Chirp3-HD-Aoede'].join('\n'),
      'utf8',
    );

    const assignments = await resolveGoogleSpeakerAssignments(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
                displayName: 'Yulia',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Hello there.' },
              { speakerId: 's1', text: 'Nice to meet you.' },
            ],
          },
          pronunciation: null,
        }),
      },
      { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd' },
    );

    expect(assignments).toEqual([
      expect.objectContaining({
        speaker: 'Alex',
        voiceId: 'en-US-Chirp3-HD-Aoede',
        source: 'voiceMap',
      }),
      expect.objectContaining({
        speaker: 'Yulia',
        voiceId: 'en-US-Chirp3-HD-Charon',
        source: 'default',
      }),
    ]);
  });

  it('rejects explicit mappings that cross selected model family', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-explicit-cross-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, ['default: en-US-Studio-O'].join('\n'), 'utf8');

    await expect(
      resolveGoogleSpeakerAssignments(
        {
          assignment: createTtsAssignment({
            metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
              turns: [{ speakerId: 's0', text: 'Cross-family validation.' }],
            },
            pronunciation: null,
          }),
        },
        { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd' },
      ),
    ).rejects.toThrow(/selected model family is chirp3_hd/i);
  });

  it.each([
    ['studio', /^en-[A-Z]{2}-Studio-/],
    ['neural2', /^en-[A-Z]{2}-Neural2-/],
    ['wavenet', /^en-[A-Z]{2}-Wavenet-/],
  ] as const)('selects only %s voices for auto assignment', async (model, expectedPattern) => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), `google-tts-provider-model-${model}-`));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, 'auto: true\n', 'utf8');

    const result = await buildStudyTextMp3Google(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
              { speakerId: 's0', text: 'Model test line one.' },
              { speakerId: 's1', text: 'Model test line two.' },
            ],
          },
          pronunciation: null,
        }),
        mdPath: join(workdir, 'assignment.json'),
      },
      { voiceMapPath, outPath: workdir, ttsModel: model, preview: true },
    );

    for (const voice of result.voices) {
      expect(voice.voiceId).toMatch(expectedPattern);
    }
  });

  it('returns deterministic assignments for identical input', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-determinism-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, 'auto: true\n', 'utf8');

    const first = await resolveGoogleSpeakerAssignments(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
                accent: 'british',
              },
              {
                id: 's1',
                displayName: 'Alex',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'male',
                age: null,
                accent: null,
              },
              {
                id: 's2',
                displayName: 'Yulia',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'female',
                age: null,
                accent: null,
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Determinism one.' },
              { speakerId: 's1', text: 'Determinism two.' },
              { speakerId: 's2', text: 'Determinism three.' },
            ],
          },
          pronunciation: null,
        }),
      },
      { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd' },
    );
    const second = await resolveGoogleSpeakerAssignments(
      {
        assignment: createTtsAssignment({
          metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
                accent: 'british',
              },
              {
                id: 's1',
                displayName: 'Alex',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'male',
                age: null,
                accent: null,
              },
              {
                id: 's2',
                displayName: 'Yulia',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'female',
                age: null,
                accent: null,
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Determinism one.' },
              { speakerId: 's1', text: 'Determinism two.' },
              { speakerId: 's2', text: 'Determinism three.' },
            ],
          },
          pronunciation: null,
        }),
      },
      { voiceMapPath, outPath: workdir, ttsModel: 'chirp3_hd' },
    );

    expect(first).toEqual(second);
  });

  it('prefers voice locale over env language default for study-text synthesis', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const previousEnvLanguage = process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE;
    process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE = 'en-US';

    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-language-locale-study-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, ['default: en-GB-Chirp3-HD-Gacrux'].join('\n'), 'utf8');

    const context = createTtsAssignment({
      metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
        turns: [{ speakerId: 's0', text: 'Locale should follow voice.' }],
      },
      pronunciation: null,
    });

    const synthSpy = vi
      .spyOn(googleApi, 'synthesizeGoogleSpeech')
      .mockResolvedValue(Buffer.from('mock-audio'));

    try {
      await buildStudyTextMp3Google(
        { assignment: context, mdPath: join(workdir, 'assignment.json') },
        { voiceMapPath, outPath: workdir },
      );

      const firstCall = synthSpy.mock.calls[0]?.[0];
      expect(firstCall?.voiceName).toBe('en-GB-Chirp3-HD-Gacrux');
      expect(firstCall?.languageCode).toBe('en-GB');
    } finally {
      if (previousEnvLanguage === undefined) {
        delete process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE;
      } else {
        process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE = previousEnvLanguage;
      }
    }
  });

  it('prefers voice locale over env language default for shadow-sentence synthesis', async () => {
    const previousEnvLanguage = process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE;
    process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE = 'en-US';

    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-language-locale-shadow-'));
    const context = createTtsAssignment({
      metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
        turns: [],
      },
      pronunciation: {
        mode: 'shadow_sentence',
        target: '',
        focus: '',
        action: '',
        deliverable: '',
        shadowSentence: 'Locale should follow voice.',
        words: [],
      },
    });

    const synthSpy = vi
      .spyOn(googleApi, 'synthesizeGoogleSpeech')
      .mockResolvedValue(Buffer.from('mock-audio'));

    try {
      await buildPronunciationShadowSentenceMp3Google(
        {
          assignment: context,
          mdPath: join(workdir, 'assignment.json'),
          voiceId: 'en-GB-Chirp3-HD-Gacrux',
        },
        { outPath: workdir },
      );

      const firstCall = synthSpy.mock.calls[0]?.[0];
      expect(firstCall?.voiceName).toBe('en-GB-Chirp3-HD-Gacrux');
      expect(firstCall?.languageCode).toBe('en-GB');
    } finally {
      if (previousEnvLanguage === undefined) {
        delete process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE;
      } else {
        process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE = previousEnvLanguage;
      }
    }
  });
});

describe('google cache-key regression coverage', () => {
  it('regenerates study text when googleLanguageCode changes with force=false', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-cache-language-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, 'default: en-US-Chirp3-HD-Charon\n', 'utf8');

    const context = createTtsAssignment({
      metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
        turns: [{ speakerId: 's0', text: 'Cache key language regression test.' }],
      },
      pronunciation: null,
    });

    const synthSpy = vi
      .spyOn(googleApi, 'synthesizeGoogleSpeech')
      .mockResolvedValue(Buffer.from('mock-audio'));

    const first = await buildStudyTextMp3Google(
      { assignment: context, mdPath: join(workdir, 'assignment.json') },
      { voiceMapPath, outPath: workdir, googleLanguageCode: 'en-US' },
    );
    const second = await buildStudyTextMp3Google(
      { assignment: context, mdPath: join(workdir, 'assignment.json') },
      { voiceMapPath, outPath: workdir, googleLanguageCode: 'es-ES' },
    );

    expect(first.hash).not.toBe(second.hash);
    expect(first.path).not.toBe(second.path);
    expect(synthSpy).toHaveBeenCalledTimes(2);
  });

  it('regenerates study text when googleModelName changes with force=false', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-cache-model-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, 'default: en-US-Chirp3-HD-Charon\n', 'utf8');

    const context = createTtsAssignment({
      metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
        turns: [{ speakerId: 's0', text: 'Cache key model regression test.' }],
      },
      pronunciation: null,
    });

    const synthSpy = vi
      .spyOn(googleApi, 'synthesizeGoogleSpeech')
      .mockResolvedValue(Buffer.from('mock-audio'));

    const first = await buildStudyTextMp3Google(
      { assignment: context, mdPath: join(workdir, 'assignment.json') },
      { voiceMapPath, outPath: workdir, googleModelName: 'model-A' },
    );
    const second = await buildStudyTextMp3Google(
      { assignment: context, mdPath: join(workdir, 'assignment.json') },
      { voiceMapPath, outPath: workdir, googleModelName: 'model-B' },
    );

    expect(first.hash).not.toBe(second.hash);
    expect(first.path).not.toBe(second.path);
    expect(synthSpy).toHaveBeenCalledTimes(2);
  });

  it('regenerates shadow sentence when googleLanguageCode changes with force=false', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-cache-shadow-'));
    const context = createTtsAssignment({
      metadata: { title: 'Test', student: 'Example', level: 'B1', topic: 'test' },
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
        turns: [],
      },
      pronunciation: {
        mode: 'shadow_sentence',
        target: '',
        focus: '',
        action: '',
        deliverable: '',
        shadowSentence: 'Language-sensitive pronunciation sample.',
        words: [],
      },
    });

    const synthSpy = vi
      .spyOn(googleApi, 'synthesizeGoogleSpeech')
      .mockResolvedValue(Buffer.from('mock-audio'));

    const first = await buildPronunciationShadowSentenceMp3Google(
      {
        assignment: context,
        mdPath: join(workdir, 'assignment.json'),
        voiceId: 'en-US-Chirp3-HD-Charon',
      },
      { outPath: workdir, googleLanguageCode: 'en-US' },
    );
    const second = await buildPronunciationShadowSentenceMp3Google(
      {
        assignment: context,
        mdPath: join(workdir, 'assignment.json'),
        voiceId: 'en-US-Chirp3-HD-Charon',
      },
      { outPath: workdir, googleLanguageCode: 'es-ES' },
    );

    expect(first.hash).not.toBe(second.hash);
    expect(first.path).not.toBe(second.path);
    expect(synthSpy).toHaveBeenCalledTimes(2);
  });
});

it('keeps native typed cast and cache identity for unchanged typed speech', async () => {
  mockGoogleVoiceList(createRichEnglishMockVoices());
  const assignment = assignmentFixture();
  const dir = await mkdtemp(join(tmpdir(), 'typed-google-'));
  const voiceMapPath = join(dir, 'voices.yml');
  await writeFile(voiceMapPath, 'default: en-US-Chirp3-HD-Charon');
  const context = structuredClone(assignment);
  const options = { outPath: dir, voiceMapPath, preview: true };
  const typed = await buildStudyTextMp3Google({ assignment }, options);
  const historical = await buildStudyTextMp3Google({ assignment: context }, options);
  expect(typed.hash).toBe(historical.hash);
  expect(typed.voiceAssignments).toEqual(historical.voiceAssignments);
  assignment.input.studyText.turns[0]!.text = '**First**, open the app.';
  const literal = await buildStudyTextMp3Google({ assignment }, options);
  expect(literal.hash).not.toBe(typed.hash);
});

function assignmentFixture(): FixtureAssignmentV1 {
  return JSON.parse(
    readAssignmentFixture(
      new URL('../../contracts/tests/assignment-fixture.json', import.meta.url),
      'utf8',
    ),
  ) as FixtureAssignmentV1;
}
