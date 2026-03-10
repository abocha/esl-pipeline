import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { PromptOptionError } from '../src/application/prompt-options.js';
import { validateTranscriptionConfig } from '../src/application/validate-transcription-config.js';
import { loadConfig } from '../src/config/env.js';
import { createStorageConfigService } from '../src/infrastructure/storage-config.js';

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), prefix));
}

let tempDirs: string[] = [];

afterEach(async () => {
  const cleanup = tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }));
  tempDirs = [];
  await Promise.all(cleanup);
});

describe('validateTranscriptionConfig', () => {
  it('passes when storage is writable and prompt catalog defaults are active', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const uploadDir = path.join(root, 'uploads');
    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const config = loadConfig();
    config.stt.providers.deepgram.apiKey = 'dg-test-key';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => ({
          templates: [{ id: 'template.md', label: 'Template' }],
          profiles: [{ id: 'profile.md', label: 'Profile' }],
          defaults: {
            templateId: 'template.md',
            profileId: 'profile.md',
          },
        }),
      }),
    ).resolves.toBeUndefined();
  });

  it('does not block startup when prompt defaults are not active in DB catalog', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const uploadDir = path.join(root, 'uploads');
    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const config = loadConfig();
    config.stt.providers.deepgram.apiKey = 'dg-test-key';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => ({
          templates: [{ id: 'template.md', label: 'Template' }],
          profiles: [{ id: 'profile.md', label: 'Profile' }],
          defaults: {
            templateId: null,
            profileId: null,
          },
        }),
      }),
    ).resolves.toBeUndefined();
  });

  it('does not block startup when prompt option loading fails', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const uploadDir = path.join(root, 'uploads');
    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const config = loadConfig();
    config.stt.providers.deepgram.apiKey = 'dg-test-key';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => {
          throw new PromptOptionError('profilePath must reference an allowlisted profile', 'bad_path');
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('throws when filesystem upload dir cannot be created', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const uploadDir = path.join(root, 'uploads');
    await fs.writeFile(uploadDir, 'not-a-dir');

    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const config = loadConfig();
    config.stt.providers.deepgram.apiKey = 'dg-test-key';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => ({
          templates: [{ id: 'template.md', label: 'Template' }],
          profiles: [{ id: 'profile.md', label: 'Profile' }],
          defaults: {
            templateId: 'template.md',
            profileId: 'profile.md',
          },
        }),
      }),
    ).rejects.toThrow('Unable to create filesystem upload directory');
  });

  it('throws when active deepgram STT provider has no credentials', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const uploadDir = path.join(root, 'uploads');
    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const config = withActiveSttProvider(loadConfig(), 'deepgram');
    config.stt.providers.deepgram.apiKey = undefined;
    config.stt.providers.deepgram.accessToken = undefined;

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => ({
          templates: [{ id: 'template.md', label: 'Template' }],
          profiles: [{ id: 'profile.md', label: 'Profile' }],
          defaults: {
            templateId: 'template.md',
            profileId: 'profile.md',
          },
        }),
      }),
    ).rejects.toThrow(/STT provider deepgram requires/i);
  });

  it('throws when active google STT provider is missing staging prerequisites', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const uploadDir = path.join(root, 'uploads');
    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const config = withActiveSttProvider(loadConfig(), 'google');
    config.stt.providers.google.projectId = '';
    config.stt.providers.google.gcsStagingBucket = '';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => ({
          templates: [{ id: 'template.md', label: 'Template' }],
          profiles: [{ id: 'profile.md', label: 'Profile' }],
          defaults: {
            templateId: 'template.md',
            profileId: 'profile.md',
          },
        }),
      }),
    ).rejects.toThrow(/GOOGLE_STT_PROJECT_ID|GOOGLE_STT_GCS_STAGING_BUCKET/i);
  });
});

function withActiveSttProvider(
  config: ReturnType<typeof loadConfig>,
  provider: 'deepgram' | 'elevenlabs' | 'google',
): ReturnType<typeof loadConfig> {
  const next = structuredClone(config);
  next.transcription.sttProvider = provider;
  next.stt.defaultProvider = provider;
  return next;
}
