import { afterEach, describe, expect, it } from 'vitest';

import {
  applyUserSettingsToEnv,
  resolveEffectiveElevenLabsApiKey,
} from '../src/infrastructure/pipeline-worker-env.js';
import {
  resolveWorkerApiVersion,
  toWorkerV2FailureError,
} from '../src/infrastructure/pipeline-worker-v2.js';

const ORIGINAL_ELEVEN_KEY = process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY;
const ORIGINAL_DEFAULT_PROVIDER = process.env.ESL_TTS_DEFAULT_PROVIDER;
const ORIGINAL_NOTION_TOKEN = process.env.NOTION_TOKEN;

describe('infrastructure/pipeline-worker-entry', () => {
  afterEach(() => {
    if (ORIGINAL_ELEVEN_KEY === undefined) {
      delete process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY;
    } else {
      process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY = ORIGINAL_ELEVEN_KEY;
    }

    if (ORIGINAL_DEFAULT_PROVIDER === undefined) {
      delete process.env.ESL_TTS_DEFAULT_PROVIDER;
    } else {
      process.env.ESL_TTS_DEFAULT_PROVIDER = ORIGINAL_DEFAULT_PROVIDER;
    }

    if (ORIGINAL_NOTION_TOKEN === undefined) {
      delete process.env.NOTION_TOKEN;
    } else {
      process.env.NOTION_TOKEN = ORIGINAL_NOTION_TOKEN;
    }
  });

  it('resolves configured key when user override is absent', () => {
    expect(
      resolveEffectiveElevenLabsApiKey({
        settings: undefined,
        configuredElevenLabsApiKey: 'configured-eleven-key',
      }),
    ).toBe('configured-eleven-key');
  });

  it('applies canonical ElevenLabs env key from backend config when user override is absent', () => {
    delete process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY;

    applyUserSettingsToEnv(undefined, 'configured-eleven-key');

    expect(process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY).toBe('configured-eleven-key');
  });

  it('prefers user ElevenLabs key over configured fallback and applies provider preference', () => {
    applyUserSettingsToEnv(
      {
        elevenLabsApiKey: 'user-eleven-key',
        notionToken: 'user-notion-token',
        ttsProvider: 'google',
      },
      'configured-eleven-key',
    );

    expect(process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY).toBe('user-eleven-key');
    expect(process.env.NOTION_TOKEN).toBe('user-notion-token');
    expect(process.env.ESL_TTS_DEFAULT_PROVIDER).toBe('google');
  });

  it('maps v2 failure causeName to error.name to preserve provider identity', () => {
    const error = toWorkerV2FailureError(
      {
        message: 'No such bucket',
        code: 'INFRASTRUCTURE_ERROR',
        causeName: 'NoSuchBucket',
        category: 'infrastructure',
      },
      'fallback message',
    );

    expect(error.message).toBe('No such bucket');
    expect(error.name).toBe('NoSuchBucket');
    expect((error as { code?: string }).code).toBe('INFRASTRUCTURE_ERROR');
    expect((error as { causeName?: string }).causeName).toBe('NoSuchBucket');
  });

  it('falls back to v2 code for error.name when causeName is absent', () => {
    const error = toWorkerV2FailureError(
      {
        message: 'Infrastructure failure',
        code: 'INFRASTRUCTURE_ERROR',
      },
      'fallback message',
    );

    expect(error.name).toBe('INFRASTRUCTURE_ERROR');
    expect((error as { code?: string }).code).toBe('INFRASTRUCTURE_ERROR');
    expect((error as { causeName?: string }).causeName).toBeUndefined();
  });

  it('resolves worker api version from explicit v1 override', () => {
    expect(resolveWorkerApiVersion('v1', 'v2')).toBe('v1');
  });

  it('resolves worker api version from explicit v2 override', () => {
    expect(resolveWorkerApiVersion('v2', 'v1')).toBe('v2');
  });

  it('resolves worker api version from config default when override is missing', () => {
    expect(resolveWorkerApiVersion(undefined, 'v2')).toBe('v2');
  });
});
