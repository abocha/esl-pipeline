import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';

import { ConfigurationError } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import {
  StorageConfigurationService,
  createStorageConfigService,
} from '../infrastructure/storage-config.js';
import { PromptOptionError, getPromptOptions } from './prompt-options.js';

export async function validateTranscriptionConfig(
  overrides?: Partial<{
    config: BatchBackendConfig;
    storageConfig: StorageConfigurationService;
  }>,
): Promise<void> {
  const config = overrides?.config ?? loadConfig();
  const storageConfig = overrides?.storageConfig ?? createStorageConfigService();

  await validateStorageConfig(storageConfig);
  await validatePromptAssets(config);
}

async function validateStorageConfig(storageConfig: StorageConfigurationService): Promise<void> {
  if (!storageConfig.isFilesystemProvider()) return;

  const uploadDir = storageConfig.getFilesystemConfig().uploadDir;
  if (!uploadDir) {
    throw new ConfigurationError('FILESYSTEM_UPLOAD_DIR must be configured for filesystem storage');
  }

  try {
    await fs.mkdir(uploadDir, { recursive: true });
  } catch (error) {
    throw new ConfigurationError(`Unable to create filesystem upload directory: ${uploadDir}`, {
      cause: error,
    });
  }

  let stats;
  try {
    stats = await fs.stat(uploadDir);
  } catch (error) {
    throw new ConfigurationError(`Filesystem upload directory does not exist: ${uploadDir}`, {
      cause: error,
    });
  }

  if (!stats.isDirectory()) {
    throw new ConfigurationError(`Filesystem upload directory is not a directory: ${uploadDir}`);
  }

  try {
    await fs.access(uploadDir, fsConstants.W_OK);
  } catch (error) {
    throw new ConfigurationError(`Filesystem upload directory is not writable: ${uploadDir}`, {
      cause: error,
    });
  }
}

async function validatePromptAssets(config: BatchBackendConfig): Promise<void> {
  try {
    await getPromptOptions({ config });
  } catch (error) {
    if (error instanceof PromptOptionError) {
      throw new ConfigurationError(`Prompt configuration invalid: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}
