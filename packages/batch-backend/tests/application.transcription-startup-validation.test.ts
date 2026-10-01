import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PromptOptionError } from '../src/application/prompt-options.js';
import { validateTranscriptionConfig } from '../src/application/validate-transcription-config.js';
import { loadConfig } from '../src/config/env.js';
import { logger } from '../src/infrastructure/logger.js';
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
    config.stt.providers.elevenlabs.apiKey = 'el-test-key';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => ({
          templates: [{ id: 'template.md', label: 'Template' }],
          defaults: {
            templateId: 'template.md',
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
    config.stt.providers.elevenlabs.apiKey = 'el-test-key';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => ({
          templates: [{ id: 'template.md', label: 'Template' }],
          defaults: {
            templateId: null,
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
    config.stt.providers.elevenlabs.apiKey = 'el-test-key';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => {
          throw new PromptOptionError(
            'templateId must reference an allowlisted template',
            'bad_path',
          );
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
    config.stt.providers.elevenlabs.apiKey = 'el-test-key';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: async () => ({
          templates: [{ id: 'template.md', label: 'Template' }],
          defaults: {
            templateId: 'template.md',
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
          defaults: {
            templateId: 'template.md',
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
          defaults: {
            templateId: 'template.md',
          },
        }),
      }),
    ).rejects.toThrow(/GOOGLE_STT_PROJECT_ID|GOOGLE_STT_GCS_STAGING_BUCKET/i);
  });

  it('rejects an ElevenLabs global override because it cannot handle every topology', async () => {
    const { config, storageConfig } = await createValidStartupInputs();
    config.transcription.hardOverride = 'elevenlabs';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: activePromptOptions,
      }),
    ).rejects.toThrow(/STT_PROVIDER is an all-topology emergency override.*only deepgram/i);
  });

  it('rejects a Google global override even when Google provider prerequisites are present', async () => {
    const { config, storageConfig } = await createValidStartupInputs();
    config.transcription.hardOverride = 'google';
    config.stt.providers.google.projectId = 'test-project';
    config.stt.providers.google.gcsStagingBucket = 'test-bucket';

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: activePromptOptions,
      }),
    ).rejects.toThrow(/STT_PROVIDER is an all-topology emergency override.*only deepgram/i);
  });

  it('accepts and logs Deepgram as the all-topology rollback override', async () => {
    const { config, storageConfig } = await createValidStartupInputs();
    config.transcription.hardOverride = 'deepgram';
    config.stt.providers.elevenlabs.apiKey = undefined;
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(
      validateTranscriptionConfig({
        config,
        storageConfig,
        promptOptionsLoader: activePromptOptions,
      }),
    ).resolves.toBeUndefined();

    expect(warning).toHaveBeenCalledWith(
      'STT topology routing bypassed by STT_PROVIDER all-topology emergency override.',
      {
        event: 'stt_global_override_active',
        provider: 'deepgram',
      },
    );
  });
});

const activePromptOptions = async () => ({
  templates: [{ id: 'template.md', label: 'Template' }],
  defaults: {
    templateId: 'template.md',
  },
});

async function createValidStartupInputs() {
  const root = await makeTempDir('esl-transcription-');
  tempDirs.push(root);
  const config = loadConfig();
  config.stt.providers.deepgram.apiKey = 'dg-test-key';
  config.stt.providers.deepgram.accessToken = undefined;
  config.stt.providers.elevenlabs.apiKey = 'el-test-key';

  return {
    config,
    storageConfig: createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir: path.join(root, 'uploads') },
    }),
  };
}

function withActiveSttProvider(
  config: ReturnType<typeof loadConfig>,
  provider: 'deepgram' | 'elevenlabs' | 'google',
): ReturnType<typeof loadConfig> {
  const next = structuredClone(config);
  next.transcription.sttProvider = provider;
  next.stt.defaultProvider = provider;
  return next;
}
