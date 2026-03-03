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
    promptOptionsLoader: typeof getPromptOptions;
  }>,
): Promise<void> {
  const config = overrides?.config ?? loadConfig();
  const storageConfig = overrides?.storageConfig ?? createStorageConfigService();
  const promptOptionsLoader = overrides?.promptOptionsLoader ?? getPromptOptions;

  await validateStorageConfig(storageConfig);
  await validatePromptAssets(config, promptOptionsLoader);
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

async function validatePromptAssets(
  config: BatchBackendConfig,
  promptOptionsLoader: typeof getPromptOptions,
): Promise<void> {
  const bootstrapCommand =
    'pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap';

  try {
    const options = await promptOptionsLoader({ config });
    if (options.templates.length === 0 || options.profiles.length === 0) {
      throw new ConfigurationError(
        `Prompt catalog is empty. Run ${bootstrapCommand} before starting backend services.`,
      );
    }
    if (!options.defaults.templateId || !options.defaults.profileId) {
      throw new ConfigurationError(
        `Prompt defaults are not active in the DB catalog. Run ${bootstrapCommand} to seed and activate defaults.`,
      );
    }
  } catch (error) {
    if (error instanceof PromptOptionError) {
      throw new ConfigurationError(`Prompt configuration invalid: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}
