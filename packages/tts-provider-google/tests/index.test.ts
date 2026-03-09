import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseMarkdownContext } from '@esl-pipeline/pmd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as googleApi from '../src/google.js';
import {
  buildPronunciationShadowSentenceMp3Google,
  buildStudyTextMp3Google,
  loadGoogleVoicesCatalog,
  resetGoogleVoiceCatalogCacheForTests,
  resolveGoogleSpeakerAssignments,
  resolveGoogleTtsModel,
} from '../src/index.js';
import type { GoogleVoiceListEntry } from '../src/google.js';

function mockGoogleVoiceList(voices: GoogleVoiceListEntry[]) {
  vi.spyOn(googleApi, 'listGoogleVoices').mockResolvedValue(voices);
}

function createRichEnglishMockVoices(): GoogleVoiceListEntry[] {
  return [
    { name: 'en-US-Chirp3-HD-Charon', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Chirp3-HD-Aoede', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'en-GB-Chirp3-HD-Gacrux', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
    { name: 'en-US-Studio-O', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'en-US-Studio-Q', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Neural2-A', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Neural2-F', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'en-US-Wavenet-A', languageCodes: ['en-US'], ssmlGender: 'MALE' },
    { name: 'en-US-Wavenet-F', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
    { name: 'es-ES-Chirp3-HD-Despina', languageCodes: ['es-ES'], ssmlGender: 'FEMALE' },
  ];
}

beforeEach(() => {
  process.env.ESL_TTS_PROVIDER_GOOGLE_SILENCE_TAIL_SECONDS = '0';
  resetGoogleVoiceCatalogCacheForTests();
});

afterEach(() => {
  delete process.env.ESL_TTS_PROVIDER_GOOGLE_SILENCE_TAIL_SECONDS;
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
    expect(catalog.capabilities?.style).toEqual(['chirp3_hd', 'neural2', 'studio', 'wavenet']);
  });

  it('caches Google voice catalog for 15 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T00:00:00.000Z'));
    const spy = vi.spyOn(googleApi, 'listGoogleVoices').mockResolvedValue(createRichEnglishMockVoices());
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

    const md = [
      '---',
      'student: Example',
      'speaker_labels: [Narrator, Alex, Yulia]',
      'speaker_profiles:',
      '  - id: Narrator',
      '    role: narrator',
      '    gender: female',
      '    accent: british',
      '    style: narration',
      '  - id: Alex',
      '    role: student',
      '    gender: male',
      '    accent: american',
      '    style: conversational',
      '  - id: Yulia',
      '    role: student',
      '    gender: female',
      '    accent: american',
      '    style: conversational',
      '---',
      '',
      '## A) Study Text',
      '',
      ':::study-text Transcript',
      'Narrator: The class is starting.',
      'Alex: Hi Yulia!',
      'Yulia: Hi Alex!',
      ':::',
      '',
    ].join('\n');

    const result = await buildStudyTextMp3Google(
      { context: parseMarkdownContext(md), mdPath: join(workdir, 'lesson.md') },
      { voiceMapPath, outPath: workdir, googleTtsModel: 'chirp3_hd', preview: true },
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

  it('accepts explicit voices.yml mappings within selected model family', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-explicit-ok-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(
      voiceMapPath,
      ['default: en-US-Chirp3-HD-Charon', 'Alex: en-US-Chirp3-HD-Aoede'].join('\n'),
      'utf8',
    );

    const md = [
      '---',
      'student: Example',
      '---',
      '',
      '## A) Study Text',
      '',
      ':::study-text Transcript',
      'Alex: Hello there.',
      'Yulia: Nice to meet you.',
      ':::',
      '',
    ].join('\n');

    const assignments = await resolveGoogleSpeakerAssignments(
      { context: parseMarkdownContext(md) },
      { voiceMapPath, outPath: workdir, googleTtsModel: 'chirp3_hd' },
    );

    expect(assignments).toEqual([
      expect.objectContaining({ speaker: 'Alex', voiceId: 'en-US-Chirp3-HD-Aoede', source: 'voiceMap' }),
      expect.objectContaining({ speaker: 'Yulia', voiceId: 'en-US-Chirp3-HD-Charon', source: 'default' }),
    ]);
  });

  it('rejects explicit mappings that cross selected model family', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-explicit-cross-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, ['default: en-US-Studio-O'].join('\n'), 'utf8');

    const md = [
      '---',
      'student: Example',
      '---',
      '',
      '## A) Study Text',
      '',
      ':::study-text Transcript',
      'Narrator: Cross-family validation.',
      ':::',
      '',
    ].join('\n');

    await expect(
      resolveGoogleSpeakerAssignments(
        { context: parseMarkdownContext(md) },
        { voiceMapPath, outPath: workdir, googleTtsModel: 'chirp3_hd' },
      ),
    ).rejects.toThrow(/selected model family is chirp3_hd/i);
  });

  it.each([
    ['studio', /^en-[A-Z]{2}-Studio-/],
    ['neural2', /^en-[A-Z]{2}-Neural2-/],
    ['wavenet', /^en-[A-Z]{2}-Wavenet-/],
  ] as const)(
    'selects only %s voices for auto assignment',
    async (model, expectedPattern) => {
      mockGoogleVoiceList(createRichEnglishMockVoices());
      const workdir = await mkdtemp(join(tmpdir(), `google-tts-provider-model-${model}-`));
      const voiceMapPath = join(workdir, 'voices.yml');
      await writeFile(voiceMapPath, 'auto: true\n', 'utf8');

      const md = [
        '---',
        'student: Example',
        'speaker_labels: [Narrator, Alex]',
        'speaker_profiles:',
        '  - id: Narrator',
        '    role: narrator',
        '    gender: female',
        '  - id: Alex',
        '    role: student',
        '    gender: male',
        '---',
        '',
        '## A) Study Text',
        '',
        ':::study-text Transcript',
        'Narrator: Model test line one.',
        'Alex: Model test line two.',
        ':::',
        '',
      ].join('\n');

      const result = await buildStudyTextMp3Google(
        { context: parseMarkdownContext(md), mdPath: join(workdir, 'lesson.md') },
        { voiceMapPath, outPath: workdir, googleTtsModel: model, preview: true },
      );

      for (const voice of result.voices) {
        expect(voice.voiceId).toMatch(expectedPattern);
      }
    },
  );

  it('returns deterministic assignments for identical input', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-determinism-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, 'auto: true\n', 'utf8');

    const md = [
      '---',
      'student: Example',
      'speaker_labels: [Narrator, Alex, Yulia]',
      'speaker_profiles:',
      '  - id: Narrator',
      '    role: narrator',
      '    gender: female',
      '    accent: british',
      '  - id: Alex',
      '    role: student',
      '    gender: male',
      '  - id: Yulia',
      '    role: student',
      '    gender: female',
      '---',
      '',
      '## A) Study Text',
      '',
      ':::study-text Transcript',
      'Narrator: Determinism one.',
      'Alex: Determinism two.',
      'Yulia: Determinism three.',
      ':::',
      '',
    ].join('\n');

    const first = await resolveGoogleSpeakerAssignments(
      { context: parseMarkdownContext(md) },
      { voiceMapPath, outPath: workdir, googleTtsModel: 'chirp3_hd' },
    );
    const second = await resolveGoogleSpeakerAssignments(
      { context: parseMarkdownContext(md) },
      { voiceMapPath, outPath: workdir, googleTtsModel: 'chirp3_hd' },
    );

    expect(first).toEqual(second);
  });
});

describe('google cache-key regression coverage', () => {
  it('regenerates study text when googleLanguageCode changes with force=false', async () => {
    mockGoogleVoiceList(createRichEnglishMockVoices());
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-cache-language-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(voiceMapPath, 'default: en-US-Chirp3-HD-Charon\n', 'utf8');

    const context = parseMarkdownContext([
      '---',
      'student: Example',
      '---',
      '',
      ':::study-text Transcript',
      'Narrator: Cache key language regression test.',
      ':::',
      '',
    ].join('\n'));

    const synthSpy = vi
      .spyOn(googleApi, 'synthesizeGoogleSpeech')
      .mockResolvedValue(Buffer.from('mock-audio'));

    const first = await buildStudyTextMp3Google(
      { context, mdPath: join(workdir, 'lesson.md') },
      { voiceMapPath, outPath: workdir, googleLanguageCode: 'en-US' },
    );
    const second = await buildStudyTextMp3Google(
      { context, mdPath: join(workdir, 'lesson.md') },
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

    const context = parseMarkdownContext([
      '---',
      'student: Example',
      '---',
      '',
      ':::study-text Transcript',
      'Narrator: Cache key model regression test.',
      ':::',
      '',
    ].join('\n'));

    const synthSpy = vi
      .spyOn(googleApi, 'synthesizeGoogleSpeech')
      .mockResolvedValue(Buffer.from('mock-audio'));

    const first = await buildStudyTextMp3Google(
      { context, mdPath: join(workdir, 'lesson.md') },
      { voiceMapPath, outPath: workdir, googleModelName: 'model-A' },
    );
    const second = await buildStudyTextMp3Google(
      { context, mdPath: join(workdir, 'lesson.md') },
      { voiceMapPath, outPath: workdir, googleModelName: 'model-B' },
    );

    expect(first.hash).not.toBe(second.hash);
    expect(first.path).not.toBe(second.path);
    expect(synthSpy).toHaveBeenCalledTimes(2);
  });

  it('regenerates shadow sentence when googleLanguageCode changes with force=false', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-cache-shadow-'));
    const context = parseMarkdownContext([
      '---',
      'student: Example',
      '---',
      '',
      '### C. Pronunciation Micro-Focus',
      '- **Mode:** shadow_sentence',
      '- **Shadow sentence:** Language-sensitive pronunciation sample.',
      '',
    ].join('\n'));

    const synthSpy = vi
      .spyOn(googleApi, 'synthesizeGoogleSpeech')
      .mockResolvedValue(Buffer.from('mock-audio'));

    const first = await buildPronunciationShadowSentenceMp3Google(
      { context, mdPath: join(workdir, 'lesson.md'), voiceId: 'en-US-Chirp3-HD-Charon' },
      { outPath: workdir, googleLanguageCode: 'en-US' },
    );
    const second = await buildPronunciationShadowSentenceMp3Google(
      { context, mdPath: join(workdir, 'lesson.md'), voiceId: 'en-US-Chirp3-HD-Charon' },
      { outPath: workdir, googleLanguageCode: 'es-ES' },
    );

    expect(first.hash).not.toBe(second.hash);
    expect(first.path).not.toBe(second.path);
    expect(synthSpy).toHaveBeenCalledTimes(2);
  });
});
