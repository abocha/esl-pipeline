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
  resolveGoogleSpeakerAssignments,
  resolveGoogleTtsModel,
} from '../src/index.js';

beforeEach(() => {
  process.env.ESL_TTS_PROVIDER_GOOGLE_SILENCE_TAIL_SECONDS = '0';
});

afterEach(() => {
  delete process.env.ESL_TTS_PROVIDER_GOOGLE_SILENCE_TAIL_SECONDS;
  vi.restoreAllMocks();
});

describe('google provider adapter basics', () => {
  it('defaults model family to chirp3_hd', () => {
    delete process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL;
    expect(resolveGoogleTtsModel()).toBe('chirp3_hd');
  });

  it('exposes a voice catalog containing chirp 3 hd default voice', async () => {
    const catalog = await loadGoogleVoicesCatalog();
    expect(catalog.voices.some((voice) => voice.id === 'en-US-Chirp3-HD-Charon')).toBe(true);
  });

  it('resolves deterministic speaker assignments from voice map', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'google-tts-provider-test-'));
    const voiceMapPath = join(workdir, 'voices.yml');
    await writeFile(
      voiceMapPath,
      ['default: en-US-Chirp3-HD-Charon', 'Teacher: en-US-Studio-O'].join('\n'),
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
      'Teacher: Hello there.',
      'Student: Nice to meet you.',
      ':::',
      '',
    ].join('\n');

    const assignments = await resolveGoogleSpeakerAssignments(
      { context: parseMarkdownContext(md) },
      { voiceMapPath, outPath: workdir, googleTtsModel: 'chirp3_hd' },
    );

    expect(assignments).toEqual([
      { speaker: 'Teacher', voiceId: 'en-US-Studio-O', source: 'voiceMap' },
      { speaker: 'Student', voiceId: 'en-US-Chirp3-HD-Charon', source: 'default' },
    ]);
  });
});

describe('google cache-key regression coverage', () => {
  it('regenerates study text when googleLanguageCode changes with force=false', async () => {
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
