import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
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

const mocks = vi.hoisted(() => ({ awsOptions: vi.fn(), accessToken: vi.fn(), fetch: vi.fn() }));
vi.mock('google-auth-library', () => ({
  AwsClient: class {
    constructor(options: unknown) {
      mocks.awsOptions(options);
    }
  },
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

const awsCredentialConfig = {
  type: 'external_account',
  audience:
    '//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/test/providers/aws',
  token_url: 'https://sts.googleapis.com/v1/token',
  credential_source: { environment_id: 'aws1' },
  service_account_impersonation_url:
    'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/gemini@test-project-123.iam.gserviceaccount.com:generateAccessToken',
};

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
      { speaker: 'Jo', voiceConfig: { voice: 'en-us-kira' } },
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
      { speaker: 'Jo', voiceConfig: { voice: 'en-us-kira' } },
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

  it('passes monologue direction separately from the transcript and keys the cache by direction', async () => {
    assignment.input.studyText.type = 'monologue';
    assignment.input.studyText.speakers = assignment.input.studyText.speakers.slice(0, 1);
    assignment.input.studyText.turns = [{ speakerId: 'alex', text: 'I found my shoe.' }];
    const studyText = assignment.input.studyText;
    const adapter = provider();
    const plain = await adapter.synthesizeStudyText({ assignment }, options());

    studyText.deliveryDirection = ' Leave a beat before the reveal. ';
    const styled = await adapter.synthesizeStudyText({ assignment }, options());
    const repeat = await adapter.synthesizeStudyText({ assignment }, options());
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(styled.hash).not.toBe(plain.hash);
    expect(repeat.hash).toBe(styled.hash);
    expect(repeat.cachedCharacters).toBe('I found my shoe.'.length);
    expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body).contents[0].parts).toEqual([
      { text: 'I found my shoe.', speechMetadata: { style: 'Leave a beat before the reveal.' } },
    ]);

    studyText.deliveryDirection = null;
    expect((await adapter.synthesizeStudyText({ assignment }, options())).hash).toBe(plain.hash);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps speaker routing when applying a shared direction to dialogue', async () => {
    const style = 'Speak at an unhurried pace and leave a beat between speakers.';
    assignment.input.studyText.deliveryDirection = style;
    await provider().synthesizeStudyText({ assignment }, options());
    expect(requestBody().contents[0].parts).toEqual([
      { text: 'First, open the app.', speechMetadata: { speaker: 'Alex', style } },
      { text: 'What happens next?', speechMetadata: { speaker: 'Jo', style } },
      { text: 'Then, select a feature.', speechMetadata: { speaker: 'Alex', style } },
    ]);
  });

  it('honors explicit voice maps and validates unsupported voices before credentials or dispatch', async () => {
    const map = join(directory, 'voices.yml');
    await writeFile(map, 'Alex: Charon\nJo: Kira\n');
    await provider().synthesizeStudyText({ assignment }, { ...options(), voiceMapPath: map });
    expect(
      requestBody().generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs,
    ).toEqual([
      { speaker: 'Alex', voiceConfig: { voice: 'Charon' } },
      { speaker: 'Jo', voiceConfig: { voice: 'en-us-kira' } },
    ]);
    await writeFile(map, 'Alex: Ashley\n');
    await expect(
      provider().synthesizeStudyText({ assignment }, { ...options(), voiceMapPath: map }),
    ).rejects.toThrow('supported prebuilt or allowlisted library voice');
    expect(mocks.accessToken).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the authored profile to cast both speakers before using gender fallbacks', async () => {
    const [alex, jo] = assignment.input.studyText.speakers;
    Object.assign(alex!, {
      gender: 'male',
      role: 'Instructor',
      voiceDirection: 'Upbeat',
      accent: null,
    });
    Object.assign(jo!, { gender: 'female', voiceDirection: 'Warm', accent: 'American English' });

    const result = await provider().synthesizeStudyText({ assignment }, options());

    expect(result.voiceAssignments).toEqual({ Alex: 'Puck', Jo: 'Sulafat' });
    expect(
      requestBody().generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs,
    ).toEqual([
      { speaker: 'Alex', voiceConfig: { voice: 'Puck' } },
      { speaker: 'Jo', voiceConfig: { voice: 'Sulafat' } },
    ]);
  });

  it('uses Mako and Kira when the casting shortlist cannot match the speaker', async () => {
    const [alex, jo] = assignment.input.studyText.speakers;
    Object.assign(alex!, { gender: 'male', voiceDirection: null, accent: null });
    Object.assign(jo!, { gender: 'female', voiceDirection: 'Warm', accent: 'British' });

    const result = await provider().synthesizeStudyText({ assignment }, options());

    expect(result.voiceAssignments).toEqual({ Alex: 'en-us-mako', Jo: 'en-us-kira' });
    expect(result.voices[1]?.selectionReason).toMatch(/requested accent is unverified/);
  });

  it('keeps an automatic voice distinct from a later explicit dialogue override', async () => {
    const [alex, jo] = assignment.input.studyText.speakers;
    Object.assign(alex!, { gender: 'male', voiceDirection: 'Upbeat', accent: null });
    Object.assign(jo!, { gender: 'male', accent: null });
    const map = join(directory, 'voices.yml');
    await writeFile(map, 'Jo: Puck\n');

    const result = await provider().synthesizeStudyText(
      { assignment },
      { ...options(), voiceMapPath: map },
    );

    expect(result.voiceAssignments).toEqual({ Alex: 'en-us-mako', Jo: 'Puck' });
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
    const authFailure = await provider()
      .synthesizePronunciationText({ text: 'Hello.', voiceId: 'Kore' }, options())
      .catch((error: unknown) => error);
    expect(authFailure).toBeInstanceOf(Error);
    expect(String(authFailure)).toContain('Application Default Credentials');
    expect(inspect(authFailure)).not.toMatch(/secret-token|private file details/);
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValueOnce(new Response('secret provider response', { status: 403 }));
    const providerFailure = await provider()
      .synthesizePronunciationText({ text: 'Hello.', voiceId: 'Kore' }, options())
      .catch((error: unknown) => error);
    expect(providerFailure).toBeInstanceOf(GeminiTtsError);
    expect(providerFailure).toMatchObject({
      category: 'provider_contract_error',
      status: 403,
    });
    expect(inspect(providerFailure)).not.toContain('secret provider response');
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

  it('keeps catalog lookup credential-free and includes the supported library fallbacks', async () => {
    const catalog = await createGeminiTtsProvider().voice.loadCatalog();
    expect(catalog.voices.filter((voice) => voice.category === 'prebuilt')).toHaveLength(30);
    expect(
      catalog.voices.filter((voice) => voice.category === 'library').map((voice) => voice.id),
    ).toEqual(['en-us-mako', 'en-us-kira']);
    expect(catalog.voices.some((voice) => voice.id === 'Kore')).toBe(true);
    expect(mocks.accessToken).not.toHaveBeenCalled();
  });

  it('uses Gemini-specific credentials only when it needs to synthesize audio', async () => {
    const file = join(directory, 'gemini-aws.json');
    await writeFile(file, JSON.stringify(awsCredentialConfig));
    vi.stubEnv('ESL_TTS_PROVIDER_GEMINI_CREDENTIALS_FILE', file);
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/app/secrets/other-google.json');
    const adapter = provider();
    const input = { text: 'Wait by the station.', voiceId: 'Kore' };
    await adapter.synthesizePronunciationText(input, { ...options(), preview: true });
    expect(mocks.awsOptions).not.toHaveBeenCalled();
    await adapter.synthesizePronunciationText(input, options());
    expect(mocks.awsOptions).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        audience: awsCredentialConfig.audience,
        token_url: awsCredentialConfig.token_url,
        service_account_impersonation_url: awsCredentialConfig.service_account_impersonation_url,
      }),
    );
    expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBe('/app/secrets/other-google.json');
  });

  it('rejects an unexpected federation token endpoint before authentication or synthesis', async () => {
    const file = join(directory, 'gemini-aws.json');
    await writeFile(
      file,
      JSON.stringify({ ...awsCredentialConfig, token_url: 'https://example.test/token' }),
    );
    vi.stubEnv('ESL_TTS_PROVIDER_GEMINI_CREDENTIALS_FILE', file);
    await expect(
      provider().synthesizePronunciationText({ text: 'Wait here.', voiceId: 'Kore' }, options()),
    ).rejects.toThrow('could not obtain Google credentials');
    expect(mocks.awsOptions).not.toHaveBeenCalled();
    expect(mocks.accessToken).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
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
