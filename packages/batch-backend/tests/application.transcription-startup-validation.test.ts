import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  vi.restoreAllMocks();
});

describe('validateTranscriptionConfig', () => {
  it('passes when storage and prompt paths are valid', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const recordingsRoot = path.join(root, 'recordings');
    await fs.mkdir(recordingsRoot, { recursive: true });

    const promptRoot = path.join(root, 'prompts');
    await fs.mkdir(promptRoot, { recursive: true });
    const templatePath = path.join(promptRoot, 'template.md');
    await fs.writeFile(templatePath, '# Template');

    const profileRoot = path.join(root, 'profiles');
    await fs.mkdir(profileRoot, { recursive: true });
    const profilePath = path.join(profileRoot, 'profile.md');
    await fs.writeFile(profilePath, '# Profile');

    const uploadDir = path.join(root, 'uploads');
    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const baseConfig = loadConfig();
    const config = {
      ...baseConfig,
      recordings: { ...baseConfig.recordings, root: recordingsRoot },
      prompt: {
        ...baseConfig.prompt,
        templatePath,
        defaultProfilePath: profilePath,
      },
    };

    await expect(
      validateTranscriptionConfig({ config, storageConfig }),
    ).resolves.toBeUndefined();
  });

  it('throws when RECORDINGS_ROOT is missing', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const promptRoot = path.join(root, 'prompts');
    await fs.mkdir(promptRoot, { recursive: true });
    const templatePath = path.join(promptRoot, 'template.md');
    await fs.writeFile(templatePath, '# Template');

    const profileRoot = path.join(root, 'profiles');
    await fs.mkdir(profileRoot, { recursive: true });
    const profilePath = path.join(profileRoot, 'profile.md');
    await fs.writeFile(profilePath, '# Profile');

    const uploadDir = path.join(root, 'uploads');
    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const baseConfig = loadConfig();
    const missingRoot = path.join(root, 'missing');
    const config = {
      ...baseConfig,
      recordings: { ...baseConfig.recordings, root: missingRoot },
      prompt: {
        ...baseConfig.prompt,
        templatePath,
        defaultProfilePath: profilePath,
      },
    };

    await expect(
      validateTranscriptionConfig({ config, storageConfig }),
    ).rejects.toThrow(`RECORDINGS_ROOT does not exist: ${missingRoot}`);
  });

  it('throws when filesystem upload dir cannot be created', async () => {
    const root = await makeTempDir('esl-transcription-');
    tempDirs.push(root);

    const promptRoot = path.join(root, 'prompts');
    await fs.mkdir(promptRoot, { recursive: true });
    const templatePath = path.join(promptRoot, 'template.md');
    await fs.writeFile(templatePath, '# Template');

    const profileRoot = path.join(root, 'profiles');
    await fs.mkdir(profileRoot, { recursive: true });
    const profilePath = path.join(profileRoot, 'profile.md');
    await fs.writeFile(profilePath, '# Profile');

    const uploadDir = path.join(root, 'uploads');
    await fs.writeFile(uploadDir, 'not-a-dir');

    const storageConfig = createStorageConfigService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });

    const baseConfig = loadConfig();
    const config = {
      ...baseConfig,
      recordings: { ...baseConfig.recordings, root },
      prompt: {
        ...baseConfig.prompt,
        templatePath,
        defaultProfilePath: profilePath,
      },
    };

    await expect(
      validateTranscriptionConfig({ config, storageConfig }),
    ).rejects.toThrow('Unable to create filesystem upload directory');
  });
});
