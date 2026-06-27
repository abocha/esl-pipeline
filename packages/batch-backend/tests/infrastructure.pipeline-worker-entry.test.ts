import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyUserSettingsToEnv,
  resolveEffectiveElevenLabsApiKey,
} from '../src/infrastructure/pipeline-worker-env.js';
import { toWorkerV2FailureError } from '../src/infrastructure/pipeline-worker-v2.js';

const ORIGINAL_ELEVEN_KEY = process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY;
const ORIGINAL_DEFAULT_PROVIDER = process.env.ESL_TTS_DEFAULT_PROVIDER;

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
        ttsProvider: 'google',
      },
      'configured-eleven-key',
    );

    expect(process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY).toBe('user-eleven-key');
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

  it('does not carry runtime fallback code that downgrades manifest storage to filesystem', async () => {
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../src/infrastructure/pipeline-worker-entry.ts',
    );
    const source = await fs.readFile(sourcePath, 'utf8');

    expect(source).not.toContain('falling back to filesystem manifest store');
    expect(source).not.toContain("manifestStore: 'filesystem'");
  });

  it('maps fresh-job voice preferences into new-assignment orchestrator flags', async () => {
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../src/infrastructure/pipeline-worker-entry.ts',
    );
    const source = await fs.readFile(sourcePath, 'utf8');

    expect(source).toContain('accentPreference: payload.voiceAccent ?? undefined');
    expect(source).toContain('voiceId: payload.voiceId ?? undefined');
  });

  it('maps persisted learning preset versions into new-assignment orchestrator flags', async () => {
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../src/infrastructure/pipeline-worker-entry.ts',
    );
    const source = await fs.readFile(sourcePath, 'utf8');

    expect(source).toContain('learningPresetVersion: payload.learningPresetVersion');
  });

  it('maps persisted color presets into rerun orchestrator flags', async () => {
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../src/infrastructure/pipeline-worker-entry.ts',
    );
    const source = await fs.readFile(sourcePath, 'utf8');
    const rerunPipelineSource = source.slice(source.indexOf('async function runRerunPipeline'));

    expect(rerunPipelineSource).toContain('preset: payload.preset');
  });
});
