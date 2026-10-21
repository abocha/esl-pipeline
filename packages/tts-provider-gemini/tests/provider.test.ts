import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssignmentV1 } from '@esl-pipeline/contracts';
import {
  createIdentitySpeechPerformancePlan,
  createTtsEngine,
  TtsSynthesisCancelledError,
} from '@esl-pipeline/tts-core';

import { encodeGeminiMp3 } from '../src/audio.js';
import { createGeminiClient, GeminiTtsError, validateGeminiWav } from '../src/client.js';
import { createGeminiTtsProvider } from '../src/index.js';

const mocks = vi.hoisted(() => ({ accessToken: vi.fn(), fetch: vi.fn() }));
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getAccessToken = mocks.accessToken;
  },
}));
vi.mock('../src/audio.js', () => ({
  encodeGeminiMp3: vi.fn(async (_audio: Buffer, target: string) => {
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, Buffer.from('mock-encoded-mp3'));
  }),
}));

/** Independent PCM WAV fixture, one second of silent 24 kHz mono PCM16. */
function wav() {
  const data = Buffer.alloc(48044);
  data.write('RIFF', 0);
  data.writeUInt32LE(48036, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(24000, 24);
  data.writeUInt32LE(48000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(48000, 40);
  return data;
}
function response(finishReason = 'STOP') {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason,
          content: {
            parts: [{ inlineData: { mimeType: 'audio/wav', data: wav().toString('base64') } }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 35,
        candidatesTokensDetails: [
          { modality: 'AUDIO', tokenCount: 25 },
          { modality: 'TEXT', tokenCount: 10 },
        ],
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

let directory: string;
let assignment: AssignmentV1;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'gemini-tts-'));
  vi.stubEnv('BATCH_TTS_CACHE_DIR', join(directory, 'cache'));
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.accessToken.mockResolvedValue('unit-token');
  mocks.fetch.mockImplementation(async () => response());
  assignment = JSON.parse(
    await readFile(
      new URL('../../contracts/tests/assignment-fixture.json', import.meta.url),
      'utf8',
    ),
  );
  assignment.input.studyText.turns = assignment.input.studyText.turns.slice(0, 3);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
const options = () => ({
  voiceMapPath: join(directory, 'absent.yml'),
  outPath: join(directory, 'out'),
  ttsProvider: 'gemini' as const,
});
const provider = () => createGeminiTtsProvider({ projectId: 'test-project-123' });
const requestBody = () => JSON.parse(mocks.fetch.mock.calls[0]![1].body);

describe('Gemini provider boundary', () => {
  it('uses one native dialogue request with separate exact transcript turns and no ranker', async () => {
    const rank = vi.fn();
    const engine = createTtsEngine([provider()]);
    const input = { assignment };
    const prepared = await engine.prepareStudyTextSynthesis(input, {
      ...options(),
      voiceRanker: { metadata: { provider: 'openai', model: 'unused', generatedAt: 'now' }, rank },
    });
    const speechPlan = createIdentitySpeechPerformancePlan(prepared);
    const result = await engine.buildStudyTextMp3(input, {
      ...options(),
      voicePlan: prepared.voicePlan,
      speechPlan,
    });
    expect(rank).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]![0]).toBe(
      'https://aiplatform.googleapis.com/v1/projects/test-project-123/locations/global/publishers/google/models/gemini-3.8-flash-lite-tts:generateContent',
    );
    expect(requestBody().contents[0].parts).toEqual([
      { text: 'First, open the app.', speechMetadata: { speaker: 'Alex' } },
      { text: 'What happens next?', speechMetadata: { speaker: 'Jo' } },
      { text: 'Then, select a feature.', speechMetadata: { speaker: 'Alex' } },
    ]);
    expect(
      requestBody().generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs,
    ).toEqual([
      { speaker: 'Alex', voiceConfig: { voice: 'Puck' } },
      { speaker: 'Jo', voiceConfig: { voice: 'Kore' } },
    ]);
    expect(result).toMatchObject({
      provider: 'gemini',
      modelId: 'gemini-3.8-flash-lite-tts',
      duration: 1,
      generatedCharacters: 61,
      cachedCharacters: 0,
    });
  });

  it('preserves authored dialogue across real prepare and build despite a conflicting legacy tts flag', async () => {
    const engine = createTtsEngine([provider()]);
    const prepared = await engine.prepareStudyTextSynthesis({ assignment }, options());
    await engine.buildStudyTextMp3(
      { assignment },
      {
        ...options(),
        ttsStrategy: 'tts',
        voicePlan: prepared.voicePlan,
        speechPlan: createIdentitySpeechPerformancePlan(prepared),
      },
    );
    expect(
      requestBody().generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs,
    ).toEqual([
      { speaker: 'Alex', voiceConfig: { voice: 'Puck' } },
      { speaker: 'Jo', voiceConfig: { voice: 'Kore' } },
    ]);
    expect(
      requestBody().contents[0].parts.map(
        (part: { speechMetadata: { speaker: string } }) => part.speechMetadata.speaker,
      ),
    ).toEqual(['Alex', 'Jo', 'Alex']);
  });

  it('preserves authored monologue across prepare and build despite a conflicting legacy dialogue flag', async () => {
    assignment.input.studyText.type = 'monologue';
    assignment.input.studyText.speakers = assignment.input.studyText.speakers.slice(0, 1);
    assignment.input.studyText.turns = assignment.input.studyText.turns.map((turn) => ({
      ...turn,
      speakerId: 'alex',
    }));
    const engine = createTtsEngine([provider()]);
    const prepared = await engine.prepareStudyTextSynthesis(
      { assignment },
      { ...options(), ttsStrategy: 'dialogue' },
    );
    await engine.buildStudyTextMp3(
      { assignment },
      {
        ...options(),
        ttsStrategy: 'dialogue',
        voicePlan: prepared.voicePlan,
        speechPlan: createIdentitySpeechPerformancePlan(prepared),
      },
    );
    expect(requestBody().contents[0].parts).toEqual([
      { text: 'First, open the app.\nWhat happens next?\nThen, select a feature.' },
    ]);
    expect(requestBody().generationConfig.speechConfig).toEqual({ voiceConfig: { voice: 'Kore' } });
  });

  it('honors explicit voice maps and validates unsupported voices before credentials or dispatch', async () => {
    const map = join(directory, 'voices.yml');
    await writeFile(map, 'Alex: Charon\nJo: Leda\n');
    await provider().synthesizeStudyText({ assignment }, { ...options(), voiceMapPath: map });
    expect(
      requestBody().generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs[0]
        .voiceConfig.voice,
    ).toBe('Charon');
    await writeFile(map, 'Alex: Ashley\n');
    await expect(
      provider().synthesizeStudyText({ assignment }, { ...options(), voiceMapPath: map }),
    ).rejects.toThrow('supported prebuilt voice');
    expect(mocks.accessToken).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported speaker counts and stale prepared voice/speech plans before dispatch', async () => {
    assignment.input.studyText.speakers.push({
      ...assignment.input.studyText.speakers[0]!,
      id: 'third',
      displayName: 'Third',
    });
    assignment.input.studyText.turns.push({ speakerId: 'third', text: 'Third speaker.' });
    await expect(provider().synthesizeStudyText({ assignment }, options())).rejects.toThrow(
      'exactly two',
    );
    expect(mocks.accessToken).not.toHaveBeenCalled();
    assignment.input.studyText.turns.pop();
    assignment.input.studyText.speakers.pop();
    const engine = createTtsEngine([provider()]);
    const prepared = await engine.prepareStudyTextSynthesis({ assignment }, options());
    const plan = createIdentitySpeechPerformancePlan(prepared);
    plan.sourceHash = 'old-source';
    await expect(
      provider().synthesizeStudyText({ assignment }, { ...options(), speechPlan: plan }),
    ).rejects.toThrow('source hash');
    await expect(
      provider().synthesizeStudyText(
        { assignment },
        { ...options(), voicePlan: { ...prepared.voicePlan!, provider: 'inworld' } },
      ),
    ).rejects.toThrow('source hash');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('reuses a complete cache without ADC; text, voice, model and project invalidate identity; force regenerates', async () => {
    const p = provider();
    const input = { text: 'Thirteen, not thirty.', voiceId: 'Kore' };
    const first = await p.synthesizePronunciationText(input, options());
    const repeat = await p.synthesizePronunciationText(input, {
      ...options(),
      outPath: join(directory, 'other-output'),
    });
    expect(repeat).toMatchObject({
      hash: first.hash,
      generatedCharacters: 0,
      cachedCharacters: input.text.length,
    });
    expect(await readFile(repeat.path, 'utf8')).toBe('mock-encoded-mp3');
    expect(mocks.accessToken).toHaveBeenCalledTimes(1);
    for (const changed of [
      { ...input, text: 'Thirty, not thirteen.' },
      { ...input, voiceId: 'Puck' },
    ]) {
      expect((await p.synthesizePronunciationText(changed, options())).hash).not.toBe(first.hash);
    }
    expect(
      (
        await p.synthesizePronunciationText(input, {
          ...options(),
          ttsModel: 'gemini-3.8-flash-tts',
        })
      ).hash,
    ).not.toBe(first.hash);
    expect(
      (
        await createGeminiTtsProvider({
          projectId: 'other-project-123',
        }).synthesizePronunciationText(input, options())
      ).hash,
    ).not.toBe(first.hash);
    await p.synthesizePronunciationText(input, { ...options(), force: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(6);
  });

  it('preview validates selection but does not authenticate, synthesize, or encode', async () => {
    const result = await provider().synthesizeStudyText(
      { assignment },
      { ...options(), preview: true },
    );
    expect(result.path).toMatch(/\.mp3$/);
    expect(mocks.accessToken).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(encodeGeminiMp3).not.toHaveBeenCalled();
  });

  it('rejects incomplete/MAX_TOKENS output without encoding or caching it', async () => {
    mocks.fetch.mockImplementationOnce(async () => response('MAX_TOKENS'));
    await expect(
      provider().synthesizePronunciationText({ text: 'Hello.', voiceId: 'Kore' }, options()),
    ).rejects.toBeInstanceOf(GeminiTtsError);
    expect(encodeGeminiMp3).not.toHaveBeenCalled();
    await provider().synthesizePronunciationText({ text: 'Hello.', voiceId: 'Kore' }, options());
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('reports AUDIO-specific usage and never logs source text, token or combined candidate tokens as audio', async () => {
    const log = vi.fn();
    await provider().synthesizePronunciationText(
      { text: 'Private learner line.', voiceId: 'Kore' },
      { ...options(), logger: { log } },
    );
    const usage = log.mock.calls.find(
      ([event]) => event.message === 'Gemini Cloud TTS synthesis completed',
    )![0];
    expect(usage.detail).toMatchObject({ audioOutputTokens: 25, textInputTokens: 12 });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/unit-token|Private learner line|35/);
  });

  it('sanitizes auth/provider errors and does not retry deterministic failures', async () => {
    mocks.accessToken.mockRejectedValueOnce(new Error('secret-token private file details'));
    await expect(
      provider().synthesizePronunciationText({ text: 'Hello.', voiceId: 'Kore' }, options()),
    ).rejects.toThrow('Application Default Credentials');
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValueOnce(new Response('secret provider response', { status: 403 }));
    const failed = provider().synthesizePronunciationText(
      { text: 'Hello.', voiceId: 'Kore' },
      options(),
    );
    await expect(failed).rejects.toMatchObject({
      category: 'provider_contract_error',
      status: 403,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(encodeGeminiMp3).not.toHaveBeenCalled();
  });

  it('cancels before credentials and while ADC is pending', async () => {
    const cancelled = AbortSignal.abort();
    await expect(
      provider().synthesizePronunciationText(
        { text: 'Hello.', voiceId: 'Kore' },
        { ...options(), signal: cancelled },
      ),
    ).rejects.toBeInstanceOf(TtsSynthesisCancelledError);
    expect(mocks.accessToken).not.toHaveBeenCalled();
    mocks.accessToken.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = provider().synthesizePronunciationText(
      { text: 'Hello.', voiceId: 'Kore' },
      { ...options(), signal: controller.signal },
    );
    await vi.waitFor(() => expect(mocks.accessToken).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(TtsSynthesisCancelledError);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('keeps catalog lookup credential-free and limited to supported prebuilt voices', async () => {
    const catalog = await createGeminiTtsProvider().voice.loadCatalog();
    expect(catalog.voices).toHaveLength(30);
    expect(catalog.voices.some((voice) => voice.id === 'Kore')).toBe(true);
    expect(mocks.accessToken).not.toHaveBeenCalled();
  });

  it('bounds pending ADC work with the configured timeout instead of waiting indefinitely', async () => {
    mocks.accessToken.mockImplementationOnce(() => new Promise(() => {}));
    const client = createGeminiClient({ projectId: 'test-project-123', timeoutMs: 1000 });
    await expect(
      client.synthesize(
        {
          contents: [{ role: 'user', parts: [{ text: 'Hello.' }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { voice: 'Kore' } },
          },
        },
        'gemini-3.8-flash-lite-tts',
        {},
      ),
    ).rejects.toMatchObject({ category: 'provider_timeout' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('classifies malformed or blocked successful HTTP responses as contract failures', async () => {
    for (const body of [
      null,
      { promptFeedback: { blockReason: 'SAFETY' } },
      { candidates: [null] },
      { candidates: [{ finishReason: 'STOP', content: { parts: [null] } }] },
    ]) {
      mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(body)));
      await expect(
        provider().synthesizePronunciationText({ text: 'Hello.', voiceId: 'Kore' }, options()),
      ).rejects.toMatchObject({ category: 'provider_contract_error' });
    }
    expect(encodeGeminiMp3).not.toHaveBeenCalled();
  });
});

describe('unary WAV integrity', () => {
  it('rejects truncated PCM and an inconsistent RIFF size instead of accepting partial audio', () => {
    expect(validateGeminiWav(wav())).toBe(1);
    expect(() => validateGeminiWav(wav().subarray(0, -2))).toThrow();
    const corrupt = wav();
    corrupt.writeUInt32LE(12, 4);
    expect(() => validateGeminiWav(corrupt)).toThrow();
  });
});
