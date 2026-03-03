import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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

  it('fails when prompt defaults are not active in DB catalog', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const uploadDir = path.join(root, 'uploads');
    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const config = loadConfig();

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
    ).rejects.toThrow('Prompt defaults are not active in the DB catalog');
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
});
