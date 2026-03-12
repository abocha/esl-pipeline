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

  validateActiveSttProviderConfig(config);
  await validateStorageConfig(storageConfig);
  await validatePromptAssets(config, promptOptionsLoader);
}

function validateActiveSttProviderConfig(config: BatchBackendConfig): void {
  const activeProvider = config.transcription.sttProvider ?? config.stt.defaultProvider;

  if (activeProvider === 'deepgram') {
    const deepgramApiKey = config.stt.providers.deepgram.apiKey?.trim();
    const deepgramAccessToken = config.stt.providers.deepgram.accessToken?.trim();
    if (!deepgramApiKey && !deepgramAccessToken) {
      throw new ConfigurationError(
        'STT provider deepgram requires ESL_STT_PROVIDER_DEEPGRAM_API_KEY or ESL_STT_PROVIDER_DEEPGRAM_ACCESS_TOKEN.',
      );
    }
    return;
  }

  if (activeProvider === 'elevenlabs') {
    const elevenlabsApiKey =
      config.stt.providers.elevenlabs.apiKey?.trim() ??
      config.orchestrator.elevenLabsApiKey?.trim() ??
      process.env.ESL_STT_PROVIDER_ELEVENLABS_API_KEY?.trim() ??
      process.env.ESL_STT_PROVIDER_ELEVENLABS_API_TOKEN?.trim() ??
      process.env.ELEVENLABS_API_KEY?.trim() ??
      process.env.ELEVENLABS_API_TOKEN?.trim();
    if (!elevenlabsApiKey) {
      throw new ConfigurationError(
        'STT provider elevenlabs requires ESL_STT_PROVIDER_ELEVENLABS_API_KEY (or compatible alias).',
      );
    }
    return;
  }

  if (activeProvider === 'google') {
    const projectId = config.stt.providers.google.projectId?.trim();
    const location = config.stt.providers.google.location?.trim();
    const stagingBucket = config.stt.providers.google.gcsStagingBucket?.trim();
    if (!projectId) {
      throw new ConfigurationError('STT provider google requires GOOGLE_STT_PROJECT_ID.');
    }
    if (!location) {
      throw new ConfigurationError('STT provider google requires GOOGLE_STT_LOCATION.');
    }
    if (!stagingBucket) {
      throw new ConfigurationError(
        'STT provider google requires GOOGLE_STT_GCS_STAGING_BUCKET for non-gs:// uploads.',
      );
    }
  }
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
  const bootstrapCommand = 'pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap';

  try {
    const options = await promptOptionsLoader({ config });
    if (options.templates.length === 0 || options.profiles.length === 0) {
      await logPromptCatalogStartupWarning(
        `Prompt catalog is empty. Run ${bootstrapCommand} before starting backend services.`,
      );
      return;
    }
    if (!options.defaults.templateId || !options.defaults.profileId) {
      await logPromptCatalogStartupWarning(
        `Prompt defaults are not active in the DB catalog. Run ${bootstrapCommand} to seed and activate defaults.`,
      );
      return;
    }
  } catch (error) {
    if (error instanceof PromptOptionError) {
      await logPromptCatalogStartupWarning(`Prompt configuration invalid: ${error.message}`);
      return;
    }
    await logPromptCatalogStartupWarning(
      `Prompt catalog startup validation skipped due to unexpected error: ${String(error)}`,
    );
  }
}

async function logPromptCatalogStartupWarning(message: string): Promise<void> {
  try {
    const { logger } = await import('../infrastructure/logger.js');
    logger.warn(message, {
      event: 'prompt_catalog_startup_validation_warning',
    });
  } catch {
    console.warn(`[prompt_catalog_startup_validation_warning] ${message}`);
  }
}
